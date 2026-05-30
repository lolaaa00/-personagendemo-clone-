"use strict";

const net = require("node:net");

/**
 * Parse a "host:port:user:pass" proxy string.
 * user:pass are optional — "host:port" is also valid.
 * @param {string} str
 * @returns {{ host: string, port: number, username?: string, password?: string }}
 */
function parseProxy(str) {
  if (!str || typeof str !== "string") {
    throw new Error("parseProxy: input must be a non-empty string");
  }
  const parts = str.split(":");
  if (parts.length < 2) {
    throw new Error("parseProxy: expected at least host:port");
  }
  const host = parts[0];
  const port = parseInt(parts[1], 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`parseProxy: invalid port "${parts[1]}"`);
  }
  const result = { host, port };
  if (parts.length >= 4) {
    result.username = parts[2];
    result.password = parts.slice(3).join(":");
  }
  return result;
}

/**
 * Convert our proxy object to Playwright's proxy config format.
 * @param {{ host: string, port: number, username?: string, password?: string }} proxy
 * @returns {{ server: string, username?: string, password?: string }}
 */
function toPlaywrightConfig(proxy) {
  if (!proxy || !proxy.host || !proxy.port) return undefined;
  const cfg = { server: `http://${proxy.host}:${proxy.port}` };
  if (proxy.username) cfg.username = proxy.username;
  if (proxy.password) cfg.password = proxy.password;
  return cfg;
}

/**
 * Test TCP connectivity to the proxy host:port.
 * @param {{ host: string, port: number }} proxy
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<{ reachable: boolean, latencyMs: number }>}
 */
function validate(proxy, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();

    socket.setTimeout(timeoutMs);

    socket.on("connect", () => {
      const latencyMs = Date.now() - start;
      socket.destroy();
      resolve({ reachable: true, latencyMs });
    });

    socket.on("timeout", () => {
      socket.destroy();
      resolve({ reachable: false, latencyMs: timeoutMs });
    });

    socket.on("error", () => {
      socket.destroy();
      resolve({ reachable: false, latencyMs: Date.now() - start });
    });

    socket.connect(proxy.port, proxy.host);
  });
}

module.exports = { parseProxy, toPlaywrightConfig, validate };
