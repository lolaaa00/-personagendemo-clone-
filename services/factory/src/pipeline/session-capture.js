"use strict";

const config = require("../config");
const { encrypt } = require("../utils/crypto");

const SESSION_COOKIE_NAMES = [
  "sessionid",
  "csrftoken",
  "ds_user_id",
  "mid",
  "ig_did",
];

const EXPIRY_DAYS = {
  sessionid: 365,
  csrftoken: 400,
  ds_user_id: 90,
  mid: 730,
  ig_did: 730,
};

/**
 * Extract Instagram session cookies from the browser context, calculate expiry,
 * encrypt, and return for storage.
 *
 * @param {{ context: object }} browser — { context } from browser.launch()
 * @param {string} accountId — for logging
 * @returns {Promise<{ cookies: object, encrypted: string, expiryDates: object }>}
 */
async function captureSession({ context }, accountId) {
  console.log(
    JSON.stringify({
      level: "info",
      msg: "Capturing session cookies",
      accountId,
      ts: new Date().toISOString(),
    })
  );

  const allCookies = await context.cookies("https://www.instagram.com");
  const sessionCookies = {};
  const expiryDates = {};
  const now = Date.now();

  for (const cookie of allCookies) {
    if (SESSION_COOKIE_NAMES.includes(cookie.name)) {
      sessionCookies[cookie.name] = {
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite,
      };

      const expiryDaysCfg = EXPIRY_DAYS[cookie.name] || 90;
      const expiryMs = now + expiryDaysCfg * 24 * 60 * 60 * 1000;
      expiryDates[cookie.name] = new Date(expiryMs).toISOString();
    }
  }

  const foundKeys = Object.keys(sessionCookies);
  if (foundKeys.length === 0) {
    throw new Error("No Instagram session cookies found — login may have failed");
  }

  console.log(
    JSON.stringify({
      level: "info",
      msg: "Session cookies extracted",
      cookies: foundKeys,
      accountId,
      ts: new Date().toISOString(),
    })
  );

  const cookieJson = JSON.stringify(sessionCookies);
  let encrypted = cookieJson;

  if (config.ENCRYPTION_KEY) {
    encrypted = encrypt(cookieJson, config.ENCRYPTION_KEY);
  }

  /* Calculate the earliest expiry across all cookies */
  const earliestExpiry = Object.values(expiryDates).sort()[0] || null;

  return {
    cookies: sessionCookies,
    encrypted,
    expiryDates,
    sessionExpires: earliestExpiry,
  };
}

module.exports = { captureSession };
