#!/usr/bin/env node
"use strict";

/**
 * inbox-deliver.js — Stalwart pipe delivery handler.
 *
 * Stalwart pipes inbound email (raw RFC 5322) to this script via stdin.
 * We parse the To/From/Subject, extract verification codes, and append
 * the message to the matching inbox in /data/inboxes/inboxes.json.
 */

const fs = require("node:fs");
const path = require("node:path");

const DB_DIR = "/data/inboxes";
const DB_FILE = path.join(DB_DIR, "inboxes.json");

function loadInboxes() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveInboxes(data) {
  fs.mkdirSync(DB_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

/** Parse basic headers from raw email */
function parseEmail(raw) {
  const headerEnd = raw.indexOf("\r\n\r\n");
  const headerBlock = headerEnd > 0 ? raw.substring(0, headerEnd) : raw.substring(0, 2000);
  const body = headerEnd > 0 ? raw.substring(headerEnd + 4) : "";

  const getHeader = (name) => {
    const re = new RegExp(`^${name}:\\s*(.+)$`, "mi");
    const m = headerBlock.match(re);
    return m ? m[1].trim() : "";
  };

  return {
    from: getHeader("From"),
    to: getHeader("To"),
    subject: getHeader("Subject"),
    date: getHeader("Date"),
    messageId: getHeader("Message-ID"),
    body: body.substring(0, 10000),
    raw: raw.substring(0, 50000),
  };
}

/** Extract verification code (6-digit) from email body or subject */
function extractCode(email) {
  const combined = `${email.subject} ${email.body}`;
  const match = combined.match(/\b(\d{6})\b/);
  return match ? match[1] : null;
}

/** Extract the local part of a To address */
function extractAddress(to) {
  const match = to.match(/<([^>]+)>/) || [null, to];
  return (match[1] || "").trim().toLowerCase();
}

/* ── Main ── */
async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const rawEmail = Buffer.concat(chunks).toString("utf8");

  const email = parseEmail(rawEmail);
  const toAddress = extractAddress(email.to);
  const code = extractCode(email);

  const inboxes = loadInboxes();

  // Find matching inbox by address
  const inbox = Object.values(inboxes).find(
    (i) => i.address && i.address.toLowerCase() === toAddress
  );

  if (!inbox) {
    // No matching inbox — log and exit (Stalwart will bounce)
    console.error(
      JSON.stringify({
        level: "warn",
        msg: "No matching inbox for delivery",
        to: toAddress,
        from: email.from,
        service: "inbox-deliver",
        ts: new Date().toISOString(),
      })
    );
    process.exit(0); // exit 0 so Stalwart doesn't retry
  }

  // Append message to inbox
  if (!inbox.messages) inbox.messages = [];
  inbox.messages.push({
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    from: email.from,
    to: email.to,
    subject: email.subject,
    date: email.date || new Date().toISOString(),
    messageId: email.messageId,
    body: email.body.substring(0, 5000),
    code,
    receivedAt: new Date().toISOString(),
  });

  // Keep only last 50 messages per inbox
  if (inbox.messages.length > 50) {
    inbox.messages = inbox.messages.slice(-50);
  }

  saveInboxes(inboxes);

  console.log(
    JSON.stringify({
      level: "info",
      msg: "Email delivered to inbox",
      inboxId: inbox.id,
      to: toAddress,
      from: email.from,
      subject: email.subject,
      hasCode: !!code,
      code: code || undefined,
      service: "inbox-deliver",
      ts: new Date().toISOString(),
    })
  );
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      level: "error",
      msg: "Delivery failed",
      error: err.message,
      service: "inbox-deliver",
      ts: new Date().toISOString(),
    })
  );
  process.exit(1);
});
