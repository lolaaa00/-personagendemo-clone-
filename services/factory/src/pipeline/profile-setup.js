"use strict";

/**
 * Post-creation Instagram profile setup.
 *
 * @param {{ page: object }} browser — active browser page
 * @param {{ bio?: string, photoPath?: string, isPrivate?: boolean }} profile
 * @param {string} accountId — for logging
 * @returns {Promise<{ profileComplete: boolean }>}
 */
async function setupProfile({ page }, profile, accountId) {
  console.log(
    JSON.stringify({
      level: "info",
      msg: "Starting profile setup",
      accountId,
      hasBio: !!profile.bio,
      hasPhoto: !!profile.photoPath,
      ts: new Date().toISOString(),
    })
  );

  /* ── Skip "Save Login Info" and "Turn On Notifications" dialogs ── */
  await dismissDialogs(page);

  /* ── Navigate to edit profile ─────────────── */
  await page.goto("https://www.instagram.com/accounts/edit/", {
    waitUntil: "networkidle",
    timeout: 20_000,
  });
  await page.waitForTimeout(2000);

  /* ── Upload profile photo ─────────────────── */
  if (profile.photoPath) {
    try {
      const changePhotoBtn = await page.$(
        'button:has-text("Change profile photo"), button:has-text("Change Photo"), [aria-label="Change profile photo"]'
      );
      if (changePhotoBtn) {
        await changePhotoBtn.click();
        await page.waitForTimeout(1000);

        const uploadBtn = await page.$(
          'button:has-text("Upload Photo"), button:has-text("Upload")'
        );
        if (uploadBtn) {
          const [fileChooser] = await Promise.all([
            page.waitForEvent("filechooser", { timeout: 5000 }),
            uploadBtn.click(),
          ]);
          await fileChooser.setFiles(profile.photoPath);
          await page.waitForTimeout(3000);

          console.log(
            JSON.stringify({
              level: "info",
              msg: "Profile photo uploaded",
              accountId,
              ts: new Date().toISOString(),
            })
          );
        }
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "warn",
          msg: "Profile photo upload failed (non-fatal)",
          error: err.message,
          accountId,
          ts: new Date().toISOString(),
        })
      );
    }
  }

  /* ── Set bio ──────────────────────────────── */
  if (profile.bio) {
    try {
      const bioTextarea = await page.$(
        'textarea[id="pepBio"], textarea[name="biography"], textarea[aria-label="Bio"]'
      );
      if (bioTextarea) {
        await bioTextarea.click({ clickCount: 3 });
        await page.keyboard.press("Backspace");
        for (const char of profile.bio) {
          await bioTextarea.type(char, { delay: 30 + Math.random() * 60 });
        }

        console.log(
          JSON.stringify({
            level: "info",
            msg: "Bio text set",
            accountId,
            ts: new Date().toISOString(),
          })
        );
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "warn",
          msg: "Bio set failed (non-fatal)",
          error: err.message,
          accountId,
          ts: new Date().toISOString(),
        })
      );
    }
  }

  /* ── Submit profile changes ───────────────── */
  const submitBtn = await page.$(
    'button:has-text("Submit"), button[type="submit"], button:has-text("Done")'
  );
  if (submitBtn) {
    await submitBtn.click();
    await page.waitForTimeout(2000);
  }

  /* ── Set account privacy ──────────────────── */
  if (typeof profile.isPrivate === "boolean") {
    try {
      await page.goto("https://www.instagram.com/accounts/privacy_and_security/", {
        waitUntil: "networkidle",
        timeout: 15_000,
      });
      await page.waitForTimeout(1500);

      const privateToggle = await page.$(
        'input[type="checkbox"][name="isPrivate"], [role="switch"]'
      );
      if (privateToggle) {
        const isCurrentlyPrivate = await privateToggle.isChecked().catch(() => false);
        if (profile.isPrivate !== isCurrentlyPrivate) {
          await privateToggle.click();
          await page.waitForTimeout(2000);

          /* Confirm privacy change dialog if it appears */
          const confirmBtn = await page.$(
            'button:has-text("Switch to Private"), button:has-text("Switch to Public"), button:has-text("Confirm")'
          );
          if (confirmBtn) await confirmBtn.click();
          await page.waitForTimeout(1500);
        }

        console.log(
          JSON.stringify({
            level: "info",
            msg: "Privacy setting updated",
            isPrivate: profile.isPrivate,
            accountId,
            ts: new Date().toISOString(),
          })
        );
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "warn",
          msg: "Privacy setting failed (non-fatal)",
          error: err.message,
          accountId,
          ts: new Date().toISOString(),
        })
      );
    }
  }

  return { profileComplete: true };
}

/**
 * Dismiss common Instagram post-signup dialogs.
 */
async function dismissDialogs(page) {
  const dismissSelectors = [
    'button:has-text("Save Info")',
    'button:has-text("Not Now")',
    'button:has-text("Skip")',
    'button:has-text("Not now")',
  ];

  for (const sel of dismissSelectors) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click();
        await page.waitForTimeout(1500);
      }
    } catch {
      /* Dialog not present — continue */
    }
  }
}

module.exports = { setupProfile };
