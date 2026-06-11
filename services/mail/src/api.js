"use strict";

const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MAIL_API_PORT = parseInt(process.env.MAIL_API_PORT || "8080", 10);
const MAIL_API_KEY = process.env.MAIL_API_KEY || "";
const MAIL_DOMAIN = process.env.MAIL_DOMAIN || "l2gseo.com";
const DB_DIR = "/data/inboxes";

if (!MAIL_API_KEY) {
  console.error(JSON.stringify({
    level: "fatal",
    msg: "MAIL_API_KEY is required; refusing to start an unauthenticated mail API",
    service: "mail-api",
    ts: new Date().toISOString(),
  }));
  process.exit(1);
}

// Ensure DB directory
fs.mkdirSync(DB_DIR, { recursive: true });

function log(level, msg, extra = {}) {
  console.log(JSON.stringify({ level, msg, service: "mail-api", ...extra, ts: new Date().toISOString() }));
}

/** Simple file-based inbox store (no external DB needed) */
function loadInboxes() {
  const file = path.join(DB_DIR, "inboxes.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function saveInboxes(data) {
  const file = path.join(DB_DIR, "inboxes.json");
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

function authCheck(req) {
  const auth = req.headers.authorization || "";
  return auth === `Bearer ${MAIL_API_KEY}`;
}

const server = http.createServer(async (req, res) => {
  // Health endpoint (no auth)
  if (req.method === "GET" && req.url === "/health") {
    const body = JSON.stringify({ status: "ok", service: "agenticmail-api", ts: new Date().toISOString() });
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(body);
  }

  // Auth check for all other routes
  if (!authCheck(req)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Unauthorized" }));
  }

  // POST /api/inboxes — create a new inbox
  if (req.method === "POST" && req.url === "/api/inboxes") {
    try {
      const body = await parseBody(req);
      const address = body.address;
      if (!address || !address.includes("@")) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Valid email address required" }));
      }

      const inboxes = loadInboxes();
      // Check for duplicates
      const existing = Object.values(inboxes).find((i) => i.address === address);
      if (existing) {
        res.writeHead(409, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Inbox already exists", inboxId: existing.id }));
      }

      const inboxId = crypto.randomUUID();
      const inbox = {
        id: inboxId,
        address,
        name: body.name || address.split("@")[0],
        domain: MAIL_DOMAIN,
        createdAt: new Date().toISOString(),
        messages: [],
      };

      inboxes[inboxId] = inbox;
      saveInboxes(inboxes);

      log("info", "Inbox created", { inboxId, address });

      res.writeHead(201, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ inboxId, address }));
    } catch (err) {
      log("error", "Failed to create inbox", { error: err.message });
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  // GET /api/inboxes/:id/messages — fetch messages
  const msgMatch = req.url?.match(/^\/api\/inboxes\/([^/]+)\/messages/);
  if (req.method === "GET" && msgMatch) {
    const inboxId = msgMatch[1];
    const inboxes = loadInboxes();
    const inbox = inboxes[inboxId];
    if (!inbox) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Inbox not found" }));
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(inbox.messages || []));
  }

  // GET /api/inboxes — list all inboxes
  if (req.method === "GET" && req.url === "/api/inboxes") {
    const inboxes = loadInboxes();
    const list = Object.values(inboxes).map(({ id, address, name, createdAt }) => ({
      id, address, name, createdAt,
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ inboxes: list, count: list.length }));
  }

  // 404
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(MAIL_API_PORT, () => {
  log("info", `AgenticMail API listening on port ${MAIL_API_PORT}`, { port: MAIL_API_PORT, domain: MAIL_DOMAIN });
});

process.on("SIGTERM", () => {
  log("info", "Received SIGTERM, shutting down API server");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
});

process.on("SIGINT", () => {
  log("info", "Received SIGINT, shutting down API server");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
});
