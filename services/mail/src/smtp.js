"use strict";

/**
 * smtp.js — Lightweight Node.js SMTP server for PersonaGen
 * Accepts all inbound mail, extracts verification codes, writes to inboxes.json
 */

const { SMTPServer } = require("smtp-server");
const { simpleParser } = require("mailparser");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SMTP_PORT = parseInt(process.env.SMTP_PORT || "2525", 10);
const MAIL_DOMAIN = process.env.MAIL_DOMAIN || "l2gseo.com";
const DB_FILE = "/data/inboxes/inboxes.json";

function log(level, msg, extra = {}) {
  console.log(JSON.stringify({ level, msg, service: "mail-smtp", ...extra, ts: new Date().toISOString() }));
}

function loadInboxes() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch { return {}; }
}

function saveInboxes(data) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function extractCode(text = "") {
  const m = text.match(/\b(\d{6})\b/);
  return m ? m[1] : null;
}

const server = new SMTPServer({
  name: MAIL_DOMAIN,
  // Accept all — no auth required for inbound
  authOptional: true,
  allowInsecureAuth: true,
  disabledCommands: ["STARTTLS"],

  // Accept any sender/recipient without verification
  onMailFrom(address, session, cb) { cb(); },
  onRcptTo(address, session, cb) { cb(); },

  onData(stream, session, cb) {
    const chunks = [];
    stream.on("data", c => chunks.push(c));
    stream.on("end", async () => {
      try {
        const raw = Buffer.concat(chunks);
        const parsed = await simpleParser(raw);

        const toAddress = (parsed.to?.value?.[0]?.address || "").toLowerCase();
        const from = parsed.from?.text || "";
        const subject = parsed.subject || "";
        const body = parsed.text || parsed.html || "";
        const code = extractCode(subject + " " + body);

        log("info", "Email received", { to: toAddress, from, subject: subject.slice(0, 60), hasCode: !!code, code });

        // Find matching inbox
        const inboxes = loadInboxes();
        const inbox = Object.values(inboxes).find(i => i.address?.toLowerCase() === toAddress);

        if (!inbox) {
          log("warn", "No matching inbox", { to: toAddress });
          return cb(); // accept but discard
        }

        if (!inbox.messages) inbox.messages = [];
        inbox.messages.push({
          id: `msg-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
          from,
          to: toAddress,
          subject,
          body: body.slice(0, 5000),
          code,
          receivedAt: new Date().toISOString(),
        });

        // Keep last 50
        if (inbox.messages.length > 50) inbox.messages = inbox.messages.slice(-50);
        saveInboxes(inboxes);
        log("info", "Message saved to inbox", { inboxId: inbox.id, to: toAddress, code });

        cb();
      } catch (err) {
        log("error", "Failed to process email", { error: err.message });
        cb(); // accept anyway
      }
    });
    stream.on("error", cb);
  },
});

server.on("error", err => log("error", "SMTP server error", { error: err.message }));

server.listen(SMTP_PORT, () => {
  log("info", `SMTP server listening on port ${SMTP_PORT}`, { port: SMTP_PORT, domain: MAIL_DOMAIN });
});

process.on("SIGTERM", () => { server.close(() => process.exit(0)); });
process.on("SIGINT",  () => { server.close(() => process.exit(0)); });
