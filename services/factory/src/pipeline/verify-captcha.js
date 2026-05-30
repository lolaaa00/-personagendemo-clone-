"use strict";

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const config = require("../config");

const SCREENSHOT_DIR = "/data/screenshots";

/**
 * Solve a CAPTCHA challenge by delegating to 2captcha or anticaptcha.
 *
 * @param {{ page: object }} browser — active browser page
 * @param {string} accountId — for naming screenshots
 * @returns {Promise<{ solved: boolean }>}
 */
async function verifyCaptcha({ page }, accountId) {
  if (!config.CAPTCHA_PROVIDER || !config.CAPTCHA_API_KEY) {
    throw new Error("CAPTCHA solving is required but CAPTCHA_PROVIDER/CAPTCHA_API_KEY are not configured");
  }

  console.log(
    JSON.stringify({
      level: "info",
      msg: "Starting CAPTCHA solving",
      provider: config.CAPTCHA_PROVIDER,
      accountId,
      ts: new Date().toISOString(),
    })
  );

  /* ── Screenshot the challenge ────────────── */
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const screenshotPath = path.join(SCREENSHOT_DIR, `${accountId}_captcha.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const imageBase64 = fs.readFileSync(screenshotPath).toString("base64");

  /* ── Detect CAPTCHA type ─────────────────── */
  const pageContent = await page.content();
  const siteKey = extractSiteKey(pageContent);
  const pageUrl = page.url();

  let solution;

  if (siteKey) {
    /* reCAPTCHA v2 — use token-based solving */
    solution = await solveRecaptcha(siteKey, pageUrl);
  } else {
    /* Image-based CAPTCHA — use image recognition */
    solution = await solveImageCaptcha(imageBase64);
  }

  /* ── Submit solution ─────────────────────── */
  if (siteKey && solution.token) {
    await page.evaluate((token) => {
      const textarea = document.querySelector("#g-recaptcha-response");
      if (textarea) {
        textarea.style.display = "block";
        textarea.value = token;
      }
      const callback =
        // eslint-disable-next-line no-undef
        typeof ___grecaptcha_cfg !== "undefined"
          ? Object.values(___grecaptcha_cfg.clients)[0]?.G?.G?.callback
          : null;
      if (callback) callback(token);
    }, solution.token);

    await page.waitForTimeout(2000);

    const submitBtn = await page.$(
      'button[type="submit"], button:has-text("Submit"), button:has-text("Verify")'
    );
    if (submitBtn) await submitBtn.click();
  } else if (solution.text) {
    const captchaInput = await page.$(
      'input[name="captcha"], input[name="response"], input[aria-label*="captcha"], input[type="text"]'
    );
    if (captchaInput) {
      await captchaInput.fill(solution.text);
      const submitBtn = await page.$(
        'button[type="submit"], button:has-text("Submit"), button:has-text("Verify")'
      );
      if (submitBtn) await submitBtn.click();
    }
  }

  await page.waitForTimeout(3000);

  /* ── Verify CAPTCHA was accepted ─────────── */
  const postContent = await page.content();
  const stillCaptcha =
    postContent.includes("captcha") &&
    (postContent.includes("security check") || postContent.includes("Verify"));

  return { solved: !stillCaptcha };
}

/* ── Provider-specific solvers ───────────────── */

async function solveRecaptcha(siteKey, pageUrl) {
  if (config.CAPTCHA_PROVIDER === "2captcha") {
    return solve2CaptchaRecaptcha(siteKey, pageUrl);
  }
  return solveAntiCaptchaRecaptcha(siteKey, pageUrl);
}

async function solveImageCaptcha(imageBase64) {
  if (config.CAPTCHA_PROVIDER === "2captcha") {
    return solve2CaptchaImage(imageBase64);
  }
  return solveAntiCaptchaImage(imageBase64);
}

/* ── 2captcha ────────────────────────────────── */

async function solve2CaptchaRecaptcha(siteKey, pageUrl) {
  const createBody = JSON.stringify({
    key: config.CAPTCHA_API_KEY,
    method: "userrecaptcha",
    googlekey: siteKey,
    pageurl: pageUrl,
    json: 1,
  });

  const createResp = await httpsPost("2captcha.com", "/in.php", createBody);
  if (createResp.status !== 1) {
    throw new Error(`2captcha submit failed: ${createResp.request || JSON.stringify(createResp)}`);
  }
  const taskId = createResp.request;
  const token = await poll2Captcha(taskId);
  return { token };
}

async function solve2CaptchaImage(imageBase64) {
  const createBody = JSON.stringify({
    key: config.CAPTCHA_API_KEY,
    method: "base64",
    body: imageBase64,
    json: 1,
  });

  const createResp = await httpsPost("2captcha.com", "/in.php", createBody);
  if (createResp.status !== 1) {
    throw new Error(`2captcha image submit failed: ${JSON.stringify(createResp)}`);
  }
  const taskId = createResp.request;
  const text = await poll2Captcha(taskId);
  return { text };
}

async function poll2Captcha(taskId) {
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(5000);
    const resp = await httpsGet(
      `https://2captcha.com/res.php?key=${config.CAPTCHA_API_KEY}&action=get&id=${taskId}&json=1`
    );
    if (resp.status === 1) return resp.request;
    if (resp.request !== "CAPCHA_NOT_READY") {
      throw new Error(`2captcha error: ${resp.request}`);
    }
  }
  throw new Error("2captcha solve timed out after 150s");
}

/* ── anticaptcha ─────────────────────────────── */

async function solveAntiCaptchaRecaptcha(siteKey, pageUrl) {
  const createBody = JSON.stringify({
    clientKey: config.CAPTCHA_API_KEY,
    task: {
      type: "RecaptchaV2TaskProxyless",
      websiteURL: pageUrl,
      websiteKey: siteKey,
    },
  });

  const createResp = await httpsPost("api.anti-captcha.com", "/createTask", createBody);
  if (createResp.errorId !== 0) {
    throw new Error(`anticaptcha create failed: ${createResp.errorDescription}`);
  }
  const solution = await pollAntiCaptcha(createResp.taskId);
  return { token: solution.gRecaptchaResponse };
}

async function solveAntiCaptchaImage(imageBase64) {
  const createBody = JSON.stringify({
    clientKey: config.CAPTCHA_API_KEY,
    task: {
      type: "ImageToTextTask",
      body: imageBase64,
    },
  });

  const createResp = await httpsPost("api.anti-captcha.com", "/createTask", createBody);
  if (createResp.errorId !== 0) {
    throw new Error(`anticaptcha image create failed: ${createResp.errorDescription}`);
  }
  const solution = await pollAntiCaptcha(createResp.taskId);
  return { text: solution.text };
}

async function pollAntiCaptcha(taskId) {
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(5000);
    const body = JSON.stringify({
      clientKey: config.CAPTCHA_API_KEY,
      taskId,
    });
    const resp = await httpsPost("api.anti-captcha.com", "/getTaskResult", body);
    if (resp.status === "ready") return resp.solution;
    if (resp.errorId !== 0) {
      throw new Error(`anticaptcha poll error: ${resp.errorDescription}`);
    }
  }
  throw new Error("anticaptcha solve timed out after 150s");
}

/* ── Helpers ─────────────────────────────────── */

function extractSiteKey(html) {
  const match = html.match(/data-sitekey="([^"]+)"/);
  if (match) return match[1];
  const match2 = html.match(/sitekey['"]\s*:\s*['"]([^'"]+)['"]/);
  return match2 ? match2[1] : null;
}

function httpsPost(hostname, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname,
      path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          reject(new Error("Invalid JSON from CAPTCHA provider"));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(30_000, () => req.destroy(new Error("CAPTCHA request timed out")));
    req.write(body);
    req.end();
  });
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            reject(new Error("Invalid JSON"));
          }
        });
      })
      .on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { verifyCaptcha };
