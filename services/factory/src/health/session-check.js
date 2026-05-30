"use strict";

const https = require("node:https");

/**
 * Validate that stored Instagram session cookies are still active.
 *
 * @param {object} cookies — decrypted cookie map { sessionid: { value, ... }, csrftoken: { value, ... }, ... }
 * @returns {Promise<{ valid: boolean, username: string|null, daysUntilExpiry: number|null }>}
 */
async function checkSession(cookies) {
  if (!cookies || !cookies.sessionid || !cookies.csrftoken) {
    return { valid: false, username: null, daysUntilExpiry: null };
  }

  const cookieHeader = Object.entries(cookies)
    .map(([name, data]) => `${name}=${data.value || data}`)
    .join("; ");

  return new Promise((resolve) => {
    const opts = {
      hostname: "www.instagram.com",
      path: "/accounts/edit/",
      method: "GET",
      headers: {
        Cookie: cookieHeader,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
      },
      timeout: 15_000,
    };

    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const finalUrl = res.headers.location || "";

        /* If redirected to login → session invalid */
        if (
          res.statusCode === 302 &&
          (finalUrl.includes("/accounts/login") || finalUrl.includes("/challenge"))
        ) {
          resolve({ valid: false, username: null, daysUntilExpiry: null });
          return;
        }

        /* If we got a 200 with profile content → session valid */
        if (res.statusCode === 200) {
          const usernameMatch = body.match(/"username"\s*:\s*"([^"]+)"/);
          const username = usernameMatch ? usernameMatch[1] : null;

          /* Calculate days until ds_user_id expiry (the shortest-lived cookie) */
          let daysUntilExpiry = null;
          if (cookies.ds_user_id && cookies.ds_user_id.expires) {
            const expiryDate = new Date(cookies.ds_user_id.expires);
            daysUntilExpiry = Math.max(
              0,
              Math.ceil((expiryDate.getTime() - Date.now()) / (86400 * 1000))
            );
          }

          resolve({ valid: true, username, daysUntilExpiry });
          return;
        }

        /* Any other status code → treat as invalid */
        resolve({ valid: false, username: null, daysUntilExpiry: null });
      });
    });

    req.on("error", () => {
      resolve({ valid: false, username: null, daysUntilExpiry: null });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({ valid: false, username: null, daysUntilExpiry: null });
    });

    req.end();
  });
}

module.exports = { checkSession };
