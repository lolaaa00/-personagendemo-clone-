"use strict";

const http = require("node:http");
const { execSync } = require("node:child_process");

const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || "8081", 10);
const MAIL_API_PORT = parseInt(process.env.MAIL_API_PORT || "8080", 10);

function log(level, msg, extra = {}) {
  console.log(
    JSON.stringify({
      level,
      msg,
      service: "mail-health",
      ...extra,
      ts: new Date().toISOString(),
    })
  );
}

/**
 * Check if Stalwart mail server process is running.
 * @returns {{ up: boolean, detail: string }}
 */
function checkStalwart() {
  try {
    /* Check if any process is listening on port 587 (submission) */
    const result = execSync(
      'ss -tlnp | grep ":587" || netstat -tlnp 2>/dev/null | grep ":587" || echo "not found"',
      { encoding: "utf8", timeout: 5000 }
    ).trim();

    if (result.includes("not found") || result === "") {
      return { up: false, detail: "Stalwart not listening on port 587" };
    }
    return { up: true, detail: "Stalwart listening on port 587" };
  } catch (err) {
    /* Fallback: try to connect to SMTP port */
    return new Promise((resolve) => {
      const socket = require("node:net").createConnection(
        { port: 587, host: "127.0.0.1", timeout: 3000 },
        () => {
          socket.destroy();
          resolve({ up: true, detail: "Stalwart SMTP responsive" });
        }
      );
      socket.on("error", () => {
        socket.destroy();
        resolve({ up: false, detail: "Stalwart SMTP not reachable" });
      });
      socket.on("timeout", () => {
        socket.destroy();
        resolve({ up: false, detail: "Stalwart SMTP connection timed out" });
      });
    });
  }
}

/**
 * Check if the AgenticMail API is responding.
 * @returns {Promise<{ up: boolean, detail: string }>}
 */
function checkAgenticMailAPI() {
  return new Promise((resolve) => {
    const req = http.get(
      `http://127.0.0.1:${MAIL_API_PORT}/health`,
      { timeout: 5000 },
      (res) => {
        res.resume();
        resolve({
          up: res.statusCode === 200,
          detail:
            res.statusCode === 200
              ? "AgenticMail API healthy"
              : `AgenticMail API returned ${res.statusCode}`,
        });
      }
    );

    req.on("error", (err) => {
      resolve({ up: false, detail: `AgenticMail API error: ${err.message}` });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({ up: false, detail: "AgenticMail API timed out" });
    });
  });
}

/* ── Health HTTP server ──────────────────────── */

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    const stalwartResult = await Promise.resolve(checkStalwart());
    const stalwart =
      stalwartResult instanceof Promise ? await stalwartResult : stalwartResult;
    const agenticmail = await checkAgenticMailAPI();

    const healthy = stalwart.up && agenticmail.up;

    const body = JSON.stringify({
      healthy,
      stalwart: stalwart.up ? "up" : "down",
      stalwartDetail: stalwart.detail,
      agenticmail: agenticmail.up ? "up" : "down",
      agenticmailDetail: agenticmail.detail,
      uptime: Math.floor(process.uptime()),
      ts: new Date().toISOString(),
    });

    res.writeHead(healthy ? 200 : 503, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": "no-cache",
    });
    res.end(body);
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(HEALTH_PORT, () => {
  log("info", `Health check server listening on port ${HEALTH_PORT}`, {
    port: HEALTH_PORT,
  });
});

/* ── Graceful shutdown ───────────────────────── */

function shutdown(signal) {
  log("info", `Received ${signal}, shutting down health server`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
