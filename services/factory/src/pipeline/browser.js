"use strict";

const path = require("node:path");
const fs = require("node:fs");
const config = require("../config");
const { toPlaywrightConfig } = require("../utils/proxy");

/**
 * Launch a CloakBrowser instance with deterministic fingerprint and persistent profile.
 *
 * @param {{ personaId: string, fingerprintSeed: string, proxy?: object }} persona
 * @returns {Promise<{ browser: object, context: object, page: object }>}
 */
async function launch(persona) {
  const cloakbrowser = await import("cloakbrowser");
  const launchFn = cloakbrowser.launch || cloakbrowser.default?.launch;

  const profilePath = getProfilePath(persona.personaId);
  fs.mkdirSync(profilePath, { recursive: true });

  const launchOpts = {
    fingerprint: {
      seed: persona.fingerprintSeed,
    },
    humanize: true,
    geoip: true,
    userDataDir: profilePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  };

  const proxyConfig = persona.proxy
    ? toPlaywrightConfig(persona.proxy)
    : config.proxy
      ? toPlaywrightConfig(config.proxy)
      : undefined;

  if (proxyConfig) {
    launchOpts.proxy = proxyConfig;
  }

  const browser = await launchFn(launchOpts);

  const contexts = browser.contexts();
  const context = contexts.length > 0 ? contexts[0] : await browser.newContext();
  const page = await context.newPage();

  console.log(
    JSON.stringify({
      level: "info",
      msg: "CloakBrowser launched",
      personaId: persona.personaId,
      profilePath,
      hasProxy: !!proxyConfig,
      ts: new Date().toISOString(),
    })
  );

  return { browser, context, page };
}

/**
 * Clean shutdown of a CloakBrowser instance.
 * @param {object} browser
 */
async function close(browser) {
  try {
    if (browser && typeof browser.close === "function") {
      await browser.close();
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "warn",
        msg: "CloakBrowser close error",
        error: err.message,
        ts: new Date().toISOString(),
      })
    );
  }
}

/**
 * Get the persistent profile directory for a persona.
 * @param {string} personaId
 * @returns {string}
 */
function getProfilePath(personaId) {
  return path.join(config.PROFILES_DIR, personaId);
}

module.exports = { launch, close, getProfilePath };
