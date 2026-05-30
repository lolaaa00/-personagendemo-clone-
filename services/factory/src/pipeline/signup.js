"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SIGNUP_URL = "https://www.instagram.com/accounts/emailsignup/";
const SCREENSHOT_DIR = "/data/screenshots";

/* ── Custom errors ───────────────────────────── */

class EmailBlockedError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "EmailBlockedError";
    this.code = "EMAIL_BLOCKED";
  }
}

class RateLimitError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "RateLimitError";
    this.code = "RATE_LIMITED";
  }
}

/**
 * Automate Instagram signup using a CloakBrowser page with human-like interaction.
 *
 * @param {{ page: object }} browser — { page } from browser.launch()
 * @param {{ email: string, fullName: string, usernameOptions: string[], password: string }} identity
 * @param {string} accountId — used for screenshot naming
 * @returns {Promise<{ success: boolean, handle?: string, needsCaptcha?: boolean, needsPhone?: boolean, screenshot?: string }>}
 */
async function signup({ page }, identity, accountId) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  await page.goto(SIGNUP_URL, { waitUntil: "networkidle", timeout: 30_000 });
  await screenshot(page, accountId, "01-loaded");

  /* Wait for sign-up form */
  await page.waitForSelector('input[name="emailOrPhone"]', { timeout: 15_000 });

  /* ── Fill email ───────────────────────────── */
  await humanType(page, 'input[name="emailOrPhone"]', identity.email);
  await screenshot(page, accountId, "02-email");

  /* ── Fill full name ───────────────────────── */
  await humanType(page, 'input[name="fullName"]', identity.fullName);
  await screenshot(page, accountId, "03-name");

  /* ── Fill username — cycle through options ── */
  let chosenHandle = null;

  for (const username of identity.usernameOptions) {
    await clearInput(page, 'input[name="username"]');
    await humanType(page, 'input[name="username"]', username);
    await page.waitForTimeout(1500);

    const usernameTaken = await page.evaluate(() => {
      const err = document.querySelector('[data-testid="username-error"]');
      if (err && err.textContent.includes("isn't available")) return true;
      const spans = Array.from(document.querySelectorAll("span"));
      return spans.some(
        (s) =>
          s.textContent.includes("isn't available") ||
          s.textContent.includes("not available")
      );
    });

    if (!usernameTaken) {
      chosenHandle = username;
      break;
    }

    console.log(
      JSON.stringify({
        level: "info",
        msg: "Username taken, trying next",
        username,
        accountId,
        ts: new Date().toISOString(),
      })
    );
  }

  if (!chosenHandle) {
    throw new Error(
      `All ${identity.usernameOptions.length} username options were taken`
    );
  }

  await screenshot(page, accountId, "04-username");

  /* ── Fill password ────────────────────────── */
  await humanType(page, 'input[name="password"]', identity.password);
  await screenshot(page, accountId, "05-password");

  /* ── Click Sign Up ────────────────────────── */
  const signUpBtn = await page.$(
    'button[type="submit"], button:has-text("Sign up"), button:has-text("Next")'
  );

  if (!signUpBtn) {
    throw new Error("Could not locate sign-up submit button");
  }

  await signUpBtn.click();
  await page.waitForTimeout(3000);
  await screenshot(page, accountId, "06-submitted");

  /* ── Detect response state ────────────────── */

  const pageContent = await page.content();
  const pageUrl = page.url();

  /* Rate limited */
  if (
    pageContent.includes("Please wait a few minutes") ||
    pageContent.includes("Try again later") ||
    pageContent.includes("rate limit")
  ) {
    throw new RateLimitError("Instagram rate limited the signup attempt");
  }

  /* Email blocked */
  if (
    pageContent.includes("email address is not valid") ||
    pageContent.includes("email was blocked") ||
    pageContent.includes("Another account is using")
  ) {
    throw new EmailBlockedError("Email address was blocked or invalid for signup");
  }

  /* CAPTCHA challenge */
  if (
    pageContent.includes("captcha") ||
    pageContent.includes("security check") ||
    pageContent.includes("Verify that you") ||
    pageUrl.includes("challenge")
  ) {
    const screenshotPath = await screenshot(page, accountId, "07-captcha");
    return { success: false, needsCaptcha: true, screenshot: screenshotPath, handle: chosenHandle };
  }

  /* Phone verification required */
  if (
    pageContent.includes("Confirm Your Phone") ||
    pageContent.includes("phone number") ||
    pageContent.includes("Enter the code we sent")
  ) {
    return { success: false, needsPhone: true, handle: chosenHandle };
  }

  /* Success — check for birthday or confirmation page */
  if (
    pageUrl.includes("birthday") ||
    pageUrl.includes("challenge") === false
  ) {
    /* Handle birthday step if present */
    const birthdaySelect = await page.$('select[title="Month"]');
    if (birthdaySelect) {
      await page.selectOption('select[title="Month"]', "3");
      await page.selectOption('select[title="Day"]', "15");
      await page.selectOption('select[title="Year"]', "1995");
      const nextBtn = await page.$('button:has-text("Next")');
      if (nextBtn) await nextBtn.click();
      await page.waitForTimeout(2000);
      await screenshot(page, accountId, "07-birthday");
    }
  }

  return { success: true, handle: chosenHandle };
}

/* ── Helpers ─────────────────────────────────── */

/**
 * Human-like typing with random delays between keystrokes.
 */
async function humanType(page, selector, text) {
  await page.click(selector);
  for (const char of text) {
    await page.type(selector, char, { delay: 50 + Math.random() * 120 });
  }
}

/**
 * Clear an input field.
 */
async function clearInput(page, selector) {
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.press("Backspace");
}

/**
 * Take a named screenshot and save it to the screenshots directory.
 * @returns {string} path to screenshot file
 */
async function screenshot(page, accountId, stepName) {
  const filename = `${accountId}_${stepName}.png`;
  const filepath = path.join(SCREENSHOT_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: true });
  return filepath;
}

module.exports = { signup, EmailBlockedError, RateLimitError };
