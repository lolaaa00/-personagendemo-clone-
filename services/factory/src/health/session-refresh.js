"use strict";

const browser = require("../pipeline/browser");
const { captureSession } = require("../pipeline/session-capture");
const db = require("../db");

/**
 * Refresh an account's session by re-launching its browser profile,
 * checking if Instagram is still logged in, and capturing fresh cookies.
 *
 * @param {string} accountId
 * @returns {Promise<{ refreshed: boolean, cookies?: object, error?: string }>}
 */
async function refreshSession(accountId) {
  const account = db.getAccount(accountId);
  if (!account) {
    throw new Error(`Account not found: ${accountId}`);
  }

  console.log(
    JSON.stringify({
      level: "info",
      msg: "Starting session refresh",
      accountId,
      handle: account.handle,
      ts: new Date().toISOString(),
    })
  );

  let instance;

  try {
    /* ── Launch the persistent browser profile ── */
    instance = await browser.launch({
      personaId: account.persona_id,
      fingerprintSeed: account.fingerprint_seed,
      proxy: account.proxy ? JSON.parse(account.proxy) : undefined,
    });

    /* ── Navigate to Instagram ── */
    await instance.page.goto("https://www.instagram.com/", {
      waitUntil: "networkidle",
      timeout: 30_000,
    });

    await instance.page.waitForTimeout(3000);

    /* ── Check if still logged in ── */
    const pageUrl = instance.page.url();
    const pageContent = await instance.page.content();

    const isLoggedOut =
      pageUrl.includes("/accounts/login") ||
      pageContent.includes("Log in") && !pageContent.includes("Log out") ||
      pageContent.includes("Sign up");

    if (isLoggedOut) {
      await db.updateAccount(accountId, {
        status: "session_expired",
        last_health_check: new Date().toISOString(),
        error_log: "Session expired — manual re-login required",
      });

      return {
        refreshed: false,
        error: "Session expired — browser profile no longer authenticated. Manual intervention required.",
      };
    }

    /* ── Capture fresh cookies ── */
    const sessionData = await captureSession(
      { context: instance.context },
      accountId
    );

    await db.updateAccount(accountId, {
      session_cookies: sessionData.cookies,
      session_expires: sessionData.sessionExpires,
      status: "active",
      last_health_check: new Date().toISOString(),
      error_log: null,
    });

    console.log(
      JSON.stringify({
        level: "info",
        msg: "Session refreshed successfully",
        accountId,
        sessionExpires: sessionData.sessionExpires,
        ts: new Date().toISOString(),
      })
    );

    return { refreshed: true, cookies: sessionData.cookies };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "Session refresh failed",
        accountId,
        error: err.message,
        ts: new Date().toISOString(),
      })
    );

    await db.updateAccount(accountId, {
      status: "refresh_failed",
      last_health_check: new Date().toISOString(),
      error_log: err.message,
    });

    return { refreshed: false, error: err.message };
  } finally {
    if (instance) {
      await browser.close(instance.browser);
    }
  }
}

module.exports = { refreshSession };
