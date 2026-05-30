"use strict";

const { pollForInstagramSMS } = require("../utils/google-voice");

/**
 * Google Voice phone verification for Instagram.
 *
 * @param {{ page: object }} browser — active browser page
 * @param {{ email: string, appPassword: string }} googleCreds — Google account with Voice forwarding
 * @param {string} accountId — for logging
 * @returns {Promise<{ verified: boolean, code: string }>}
 */
async function verifyPhone({ page }, googleCreds, accountId) {
  console.log(
    JSON.stringify({
      level: "info",
      msg: "Starting phone verification via Google Voice",
      accountId,
      ts: new Date().toISOString(),
    })
  );

  /* ── Trigger SMS send if there's a "Send Code" button ── */
  const sendBtn = await page.$(
    'button:has-text("Send Code"), button:has-text("Send Security Code"), button:has-text("Send")'
  );
  if (sendBtn) {
    await sendBtn.click();
    await page.waitForTimeout(3000);
  }

  /* ── Poll Google Voice for the SMS code ── */
  const since = new Date();
  const result = await pollForInstagramSMS(googleCreds, { since });

  console.log(
    JSON.stringify({
      level: "info",
      msg: "SMS code received from Google Voice",
      code: result.code,
      from: result.from,
      accountId,
      ts: new Date().toISOString(),
    })
  );

  /* ── Submit the code in the browser ── */
  const codeInput = await page.$(
    'input[name="security_code"], input[name="code"], input[aria-label="Security Code"], input[placeholder*="code"]'
  );

  if (!codeInput) {
    throw new Error("Could not locate phone verification code input field");
  }

  for (const digit of result.code) {
    await codeInput.type(digit, { delay: 70 + Math.random() * 90 });
  }

  const confirmBtn = await page.$(
    'button:has-text("Confirm"), button:has-text("Submit"), button[type="submit"]'
  );
  if (confirmBtn) {
    await confirmBtn.click();
  }

  await page.waitForTimeout(3000);

  /* ── Check result ── */
  const pageContent = await page.content();
  const verified =
    !pageContent.includes("incorrect") &&
    !pageContent.includes("expired") &&
    !pageContent.includes("didn't work");

  if (!verified) {
    throw new Error("Phone verification failed — Instagram rejected the SMS code");
  }

  return { verified: true, code: result.code };
}

module.exports = { verifyPhone };
