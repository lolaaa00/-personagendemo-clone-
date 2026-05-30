"use strict";

const { fetchMessages } = require("./email");

const OTP_REGEX = /(\d{6})/;
const POLL_INTERVAL_MS = 10_000;
const MAX_POLL_MS = 5 * 60 * 1000;

/**
 * Poll AgenticMail inbox for an Instagram verification code and submit it.
 *
 * @param {{ page: object }} browser — active browser page
 * @param {string} inboxId — AgenticMail inbox ID
 * @param {string} accountId — for logging
 * @returns {Promise<{ verified: boolean, code: string }>}
 */
async function verifyEmail({ page }, inboxId, accountId) {
  console.log(
    JSON.stringify({
      level: "info",
      msg: "Starting email verification polling",
      inboxId,
      accountId,
      ts: new Date().toISOString(),
    })
  );

  const since = new Date().toISOString();
  const deadline = Date.now() + MAX_POLL_MS;
  let code = null;

  /* ── Poll for the verification email ────── */
  while (Date.now() < deadline) {
    try {
      const messages = await fetchMessages(inboxId, { limit: 5, since });

      for (const msg of messages) {
        const body =
          msg.text || msg.body || msg.html || msg.snippet || JSON.stringify(msg);
        const fromAddr = (msg.from || "").toLowerCase();

        if (
          fromAddr.includes("instagram") ||
          fromAddr.includes("security@mail.instagram.com") ||
          body.includes("Instagram") ||
          body.includes("confirmation code")
        ) {
          const match = body.match(OTP_REGEX);
          if (match) {
            code = match[1];
            break;
          }
        }
      }

      if (code) break;
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "warn",
          msg: "Email poll error",
          error: err.message,
          accountId,
          ts: new Date().toISOString(),
        })
      );
    }

    await sleep(POLL_INTERVAL_MS);
  }

  if (!code) {
    throw new Error(
      `Email verification timed out after ${MAX_POLL_MS / 1000}s — no OTP received`
    );
  }

  console.log(
    JSON.stringify({
      level: "info",
      msg: "OTP code received",
      code,
      accountId,
      ts: new Date().toISOString(),
    })
  );

  /* ── Submit the code in browser ─────────── */
  const codeInput = await page.$(
    'input[name="email_confirmation_code"], input[name="code"], input[aria-label="Confirmation Code"], input[placeholder*="code"]'
  );

  if (!codeInput) {
    /* Check if the page already advanced past the code input */
    const pageContent = await page.content();
    if (
      pageContent.includes("Welcome to Instagram") ||
      pageContent.includes("Save Your Login Info") ||
      page.url().includes("/accounts/onetap")
    ) {
      return { verified: true, code };
    }
    throw new Error("Could not locate OTP code input field on the page");
  }

  /* Type code with human-like delays */
  for (const digit of code) {
    await codeInput.type(digit, { delay: 80 + Math.random() * 80 });
  }

  /* Click confirm / next */
  const confirmBtn = await page.$(
    'button:has-text("Confirm"), button:has-text("Next"), button[type="submit"]'
  );
  if (confirmBtn) {
    await confirmBtn.click();
  }

  await page.waitForTimeout(3000);

  /* Verify success */
  const pageContent = await page.content();
  const verified =
    !pageContent.includes("incorrect") &&
    !pageContent.includes("expired") &&
    !pageContent.includes("try again");

  if (!verified) {
    throw new Error("OTP verification failed — Instagram rejected the code");
  }

  return { verified: true, code };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { verifyEmail };
