"use strict";

const { EventEmitter } = require("node:events");
const { v4: uuidv4 } = require("uuid");
const https = require("node:https");
const http = require("node:http");
const config = require("../config");
const db = require("../db");
const { generateIdentity } = require("./identity");
const { createInbox } = require("./email");
const { launch, close: closeBrowser } = require("./browser");
const { signup } = require("./signup");
const { verifyEmail } = require("./verify-email");
const { verifyPhone } = require("./verify-phone");
const { verifyCaptcha } = require("./verify-captcha");
const { setupProfile } = require("./profile-setup");
const { captureSession } = require("./session-capture");

const PIPELINE_STEPS = [
  "identity",
  "email",
  "browser",
  "signup",
  "verify-email",
  "verify-phone",
  "verify-captcha",
  "profile-setup",
  "session-capture",
];

class Orchestrator extends EventEmitter {
  constructor() {
    super();
    this._running = new Map();
  }

  /**
   * Run the full account creation pipeline.
   *
   * @param {{ accountId?: string, name: string, niche: string, platform?: string, personaId?: string, bio?: string, photoPath?: string, isPrivate?: boolean, googleVoiceCreds?: { email: string, appPassword: string }, retryFromStep?: string }} opts
   * @returns {Promise<object>} final account record
   */
  async run(opts) {
    const accountId = opts.accountId || uuidv4();
    const personaId = opts.personaId || uuidv4();
    const platform = opts.platform || "instagram";

    /* ── Rate-limit check ───────────────────── */
    const recentCount = db.countRecentCreations();
    if (recentCount >= config.MAX_CREATIONS_PER_DAY) {
      throw new PipelineError(
        "RATE_LIMIT",
        `Daily creation limit reached (${config.MAX_CREATIONS_PER_DAY}/day)`
      );
    }

    const lastTime = db.lastCreationTime();
    if (lastTime) {
      const elapsed = Date.now() - new Date(lastTime).getTime();
      const cooldownMs = config.COOLDOWN_MINUTES * 60 * 1000;
      if (elapsed < cooldownMs) {
        const remaining = Math.ceil((cooldownMs - elapsed) / 60_000);
        throw new PipelineError(
          "COOLDOWN",
          `Cooldown active — ${remaining} minute(s) remaining`
        );
      }
    }

    /* ── Initialize DB record ───────────────── */
    db.createAccount({
      id: accountId,
      persona_id: personaId,
      platform,
      status: "running",
    });

    this.emit("start", { accountId, personaId, platform });
    this._running.set(accountId, { status: "running", step: "identity" });

    const state = {
      accountId,
      personaId,
      platform,
      identity: null,
      inbox: null,
      browser: null,
      signupResult: null,
    };

    const startStep = opts.retryFromStep
      ? PIPELINE_STEPS.indexOf(opts.retryFromStep)
      : 0;

    if (startStep < 0) {
      throw new PipelineError("UNKNOWN_STEP", `Unknown pipeline step: ${opts.retryFromStep}`);
    }

    try {
      for (let i = startStep; i < PIPELINE_STEPS.length; i++) {
        const stepName = PIPELINE_STEPS[i];
        this._running.set(accountId, { status: "running", step: stepName });
        this.emit("step", { accountId, step: stepName });

        db.updateAccount(accountId, { status: `step:${stepName}` });

        await this._executeStep(stepName, state, opts);
      }

      /* ── Pipeline complete ── */
      const finalAccount = db.updateAccount(accountId, { status: "active" });

      this.emit("complete", { accountId, account: finalAccount });
      this._running.delete(accountId);

      await this._webhook("success", finalAccount);

      return finalAccount;
    } catch (err) {
      const currentStep = this._running.get(accountId)?.step || "unknown";

      console.error(
        JSON.stringify({
          level: "error",
          msg: "Pipeline failed",
          accountId,
          step: currentStep,
          error: err.message,
          code: err.code,
          ts: new Date().toISOString(),
        })
      );

      const failedAccount = db.updateAccount(accountId, {
        status: `failed:${currentStep}`,
        error_log: JSON.stringify({
          step: currentStep,
          error: err.message,
          code: err.code || "UNKNOWN",
          timestamp: new Date().toISOString(),
        }),
      });

      this.emit("error", { accountId, step: currentStep, error: err });
      this._running.delete(accountId);

      await this._webhook("failure", failedAccount);

      throw err;
    } finally {
      /* Always close the browser */
      if (state.browser) {
        await closeBrowser(state.browser.browser).catch(() => {});
      }
    }
  }

  /**
   * Execute a single pipeline step.
   */
  async _executeStep(stepName, state, opts) {
    switch (stepName) {
      case "identity": {
        state.identity = generateIdentity({
          name: opts.name,
          niche: opts.niche,
          platform: state.platform,
          personaId: state.personaId,
        });

        db.updateAccount(state.accountId, {
          email: state.identity.email,
          fingerprint_seed: state.identity.fingerprintSeed,
        });
        break;
      }

      case "email": {
        state.inbox = await createInbox({
          address: state.identity.email,
          name: opts.name,
        });

        db.updateAccount(state.accountId, {
          inbox_id: state.inbox.inboxId,
          email: state.inbox.address,
        });
        break;
      }

      case "browser": {
        state.browser = await launch({
          personaId: state.personaId,
          fingerprintSeed: state.identity.fingerprintSeed,
          proxy: config.proxy || undefined,
        });

        if (config.proxy) {
          db.updateAccount(state.accountId, {
            proxy: JSON.stringify(config.proxy),
          });
        }
        break;
      }

      case "signup": {
        state.signupResult = await signup(
          state.browser,
          {
            email: state.inbox.address,
            fullName: opts.name,
            usernameOptions: state.identity.usernameOptions,
            password: state.identity.password,
          },
          state.accountId
        );

        if (state.signupResult.handle) {
          db.updateAccount(state.accountId, {
            handle: state.signupResult.handle,
          });
        }

        /* If signup returned a conditional result, store it but continue the pipeline
           — the next steps (verify-email, verify-phone, verify-captcha) will handle it */
        break;
      }

      case "verify-email": {
        if (state.signupResult && state.signupResult.success === false && state.signupResult.needsPhone) {
          /* Skip email verification if phone is needed first */
          break;
        }

        await verifyEmail(state.browser, state.inbox.inboxId, state.accountId);
        break;
      }

      case "verify-phone": {
        if (!state.signupResult?.needsPhone) break;

        const gvCreds = opts.googleVoiceCreds || (
          config.GOOGLE_VOICE_EMAIL && config.GOOGLE_VOICE_APP_PASSWORD
            ? { email: config.GOOGLE_VOICE_EMAIL, appPassword: config.GOOGLE_VOICE_APP_PASSWORD }
            : null
        );

        if (!gvCreds) {
          throw new PipelineError(
            "PHONE_REQUIRED",
            "Phone verification required but no Google Voice credentials provided"
          );
        }

        await verifyPhone(state.browser, gvCreds, state.accountId);
        break;
      }

      case "verify-captcha": {
        if (!state.signupResult?.needsCaptcha) break;

        const captchaResult = await verifyCaptcha(state.browser, state.accountId);
        if (!captchaResult.solved) {
          throw new PipelineError("CAPTCHA_FAILED", "CAPTCHA solving failed");
        }
        break;
      }

      case "profile-setup": {
        await setupProfile(
          state.browser,
          {
            bio: opts.bio || state.identity.bio,
            photoPath: opts.photoPath || undefined,
            isPrivate: opts.isPrivate,
          },
          state.accountId
        );
        break;
      }

      case "session-capture": {
        const sessionData = await captureSession(
          { context: state.browser.context },
          state.accountId
        );

        db.updateAccount(state.accountId, {
          session_cookies: sessionData.cookies,
          session_expires: sessionData.sessionExpires,
        });
        break;
      }

      default:
        throw new PipelineError("UNKNOWN_STEP", `Unknown pipeline step: ${stepName}`);
    }
  }

  /**
   * Get status of a running pipeline.
   */
  getStatus(accountId) {
    return this._running.get(accountId) || null;
  }

  /**
   * Fire webhook to local engine on completion/failure.
   */
  async _webhook(event, account) {
    if (!config.ENGINE_WEBHOOK_URL) return;

    const body = JSON.stringify({
      event,
      accountId: account.id,
      personaId: account.persona_id,
      platform: account.platform,
      handle: account.handle,
      status: account.status,
      timestamp: new Date().toISOString(),
    });

    try {
      const url = new URL(config.ENGINE_WEBHOOK_URL);
      const transport = url.protocol === "https:" ? https : http;
      await new Promise((resolve, reject) => {
        const req = transport.request(
          {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(body),
            },
            timeout: 10_000,
          },
          (res) => {
            res.resume();
            resolve();
          }
        );
        req.on("error", reject);
        req.on("timeout", () => req.destroy(new Error("Webhook timed out")));
        req.write(body);
        req.end();
      });
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "warn",
          msg: "Webhook delivery failed (non-fatal)",
          url: config.ENGINE_WEBHOOK_URL,
          error: err.message,
          ts: new Date().toISOString(),
        })
      );
    }
  }
}

class PipelineError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PipelineError";
    this.code = code;
  }
}

/* Singleton instance */
const orchestrator = new Orchestrator();

module.exports = { orchestrator, PipelineError, PIPELINE_STEPS };
