"use strict";

const http = require("node:http");
const https = require("node:https");
const config = require("../config");

/**
 * Provision a new inbox on the AgenticMail service.
 *
 * @param {{ address: string, name?: string }} opts
 * @returns {Promise<{ inboxId: string, apiKey: string, address: string }>}
 */
async function createInbox({ address, name }) {
  const url = new URL("/api/inboxes", config.MAIL_URL);
  const payload = JSON.stringify({
    address,
    name: name || address.split("@")[0],
  });

  const response = await postJson(url, payload, {
    Authorization: `Bearer ${config.MAIL_API_KEY}`,
    "Content-Type": "application/json",
  });

  if (response.error) {
    if (response.error.includes("duplicate") || response.error.includes("exists")) {
      throw new DuplicateInboxError(`Inbox already exists: ${address}`);
    }
    throw new InboxCreationError(response.error);
  }

  if (!response.inboxId && !response.id) {
    throw new InboxCreationError(
      `Unexpected response from mail service: ${JSON.stringify(response)}`
    );
  }

  return {
    inboxId: response.inboxId || response.id,
    apiKey: response.apiKey || config.MAIL_API_KEY,
    address: response.address || address,
  };
}

/**
 * Fetch messages from an AgenticMail inbox.
 *
 * @param {string} inboxId
 * @param {{ limit?: number, since?: string }} opts
 * @returns {Promise<object[]>}
 */
async function fetchMessages(inboxId, opts = {}) {
  const url = new URL(`/api/inboxes/${inboxId}/messages`, config.MAIL_URL);
  if (opts.limit) url.searchParams.set("limit", String(opts.limit));
  if (opts.since) url.searchParams.set("since", opts.since);

  return getJson(url, {
    Authorization: `Bearer ${config.MAIL_API_KEY}`,
  });
}

/* ── Custom errors ───────────────────────────── */

class DuplicateInboxError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "DuplicateInboxError";
    this.code = "DUPLICATE_INBOX";
  }
}

class InboxCreationError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "InboxCreationError";
    this.code = "INBOX_CREATION_FAILED";
  }
}

/* ── HTTP helpers ────────────────────────────── */

function selectTransport(url) {
  return url.protocol === "https:" ? https : http;
}

function postJson(url, body, headers) {
  return new Promise((resolve, reject) => {
    const transport = selectTransport(url);
    const opts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        ...headers,
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = transport.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve({ raw, statusCode: res.statusCode });
        }
      });
    });

    req.on("error", (err) =>
      reject(new InboxCreationError(`Mail service connection error: ${err.message}`))
    );
    req.setTimeout(15_000, () =>
      req.destroy(new InboxCreationError("Mail service request timed out"))
    );
    req.write(body);
    req.end();
  });
}

function getJson(url, headers) {
  return new Promise((resolve, reject) => {
    const transport = selectTransport(url);
    const opts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname + url.search,
      method: "GET",
      headers: { ...headers, Accept: "application/json" },
    };

    const req = transport.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve([]);
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(15_000, () => req.destroy(new Error("Request timed out")));
    req.end();
  });
}

module.exports = { createInbox, fetchMessages, DuplicateInboxError, InboxCreationError };
