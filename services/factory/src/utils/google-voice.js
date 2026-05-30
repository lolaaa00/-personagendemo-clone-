"use strict";

const https = require("node:https");

/**
 * Google Voice SMS verification code extractor.
 *
 * Strategy: Google Voice forwards SMS to Gmail. We poll the Gmail REST API
 * (via an app-password-based OAuth-less approach using IMAP) for messages
 * from Instagram containing a verification code.
 *
 * In production this would use the Gmail API with a service account.
 * Here we provide a self-contained HTTPS poller against Gmail's IMAP-to-REST bridge.
 */

const INSTAGRAM_SMS_PATTERN = /(\d{6})/;
const POLL_INTERVAL_MS = 10_000;
const MAX_POLL_DURATION_MS = 5 * 60 * 1000;

/**
 * Poll for an Instagram verification SMS forwarded through Google Voice → Gmail.
 *
 * @param {{ email: string, appPassword: string }} creds — Gmail credentials (app password)
 * @param {{ since?: Date }} opts
 * @returns {Promise<{ code: string, from: string, timestamp: string }>}
 */
async function pollForInstagramSMS(creds, opts = {}) {
  const since = opts.since || new Date();
  const deadline = Date.now() + MAX_POLL_DURATION_MS;

  while (Date.now() < deadline) {
    try {
      const result = await fetchLatestSMS(creds, since);
      if (result) return result;
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "warn",
          msg: "Google Voice poll error",
          error: err.message,
          ts: new Date().toISOString(),
        })
      );
    }
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error("Google Voice SMS poll timed out after 5 minutes");
}

/**
 * Fetch the latest SMS-forwarded email from Gmail via basic-auth IMAP proxy.
 * Uses Google's IMAP with app passwords — parsed via a lightweight HTTPS call
 * to the Gmail API (requires enabling "Less secure apps" or app password).
 *
 * @param {{ email: string, appPassword: string }} creds
 * @param {Date} since
 * @returns {Promise<{ code: string, from: string, timestamp: string }|null>}
 */
async function fetchLatestSMS(creds, since) {
  const sinceStr = since.toISOString().split("T")[0];
  const query = encodeURIComponent(
    `from:(txt.voice.google.com OR verify@instagram.com) after:${sinceStr} subject:(Instagram OR verification)`
  );

  const basicAuth = Buffer.from(`${creds.email}:${creds.appPassword}`).toString("base64");

  const body = await httpsGet(
    `https://www.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=1`,
    { Authorization: `Basic ${basicAuth}` }
  );

  if (!body.messages || body.messages.length === 0) return null;

  const msgId = body.messages[0].id;
  const msgBody = await httpsGet(
    `https://www.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
    { Authorization: `Basic ${basicAuth}` }
  );

  const snippet = msgBody.snippet || "";
  const match = snippet.match(INSTAGRAM_SMS_PATTERN);
  if (!match) return null;

  const fromHeader =
    (msgBody.payload?.headers || []).find((h) => h.name === "From")?.value || "unknown";

  return {
    code: match[1],
    from: fromHeader,
    timestamp: new Date(parseInt(msgBody.internalDate, 10)).toISOString(),
  };
}

/**
 * Minimal HTTPS GET that returns parsed JSON.
 */
function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers: { ...headers, Accept: "application/json" },
    };

    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error(`Invalid JSON from ${url}: ${raw.slice(0, 200)}`));
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(15_000, () => {
      req.destroy(new Error(`Request timed out: ${url}`));
    });
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { pollForInstagramSMS };
