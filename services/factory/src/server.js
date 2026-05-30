"use strict";

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const config = require("./config");
const db = require("./db");
const { orchestrator, PIPELINE_STEPS, PipelineError } = require("./pipeline/orchestrator");
const { checkSession } = require("./health/session-check");
const { refreshSession } = require("./health/session-refresh");

const app = express();

/* ── Middleware ────────────────────────────────── */

app.use(helmet());

app.use(
  cors({
    origin: config.allowedOrigins,
    methods: ["GET", "POST", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  })
);

app.use(express.json({ limit: "1mb" }));

/* General rate limit: 100 requests per 15 minutes */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests", code: "RATE_LIMITED" },
});
app.use("/api", generalLimiter);

/* Strict rate limit for account creation: 5 per hour */
const createLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Account creation rate limit exceeded", code: "RATE_LIMITED" },
});

/* ── Health endpoint (no auth) ────────────────── */

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "personagen-factory",
    version: "1.0.0",
    uptime: Math.floor(process.uptime()),
    ts: new Date().toISOString(),
  });
});

/* ── Auth middleware ───────────────────────────── */

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Missing or invalid Authorization header",
      code: "UNAUTHORIZED",
    });
  }

  const token = authHeader.slice(7);
  if (token !== config.FACTORY_API_KEY) {
    return res.status(403).json({
      error: "Invalid API key",
      code: "FORBIDDEN",
    });
  }

  next();
}

app.use("/api", authMiddleware);

/* ── Request validation schemas ───────────────── */

const createAccountSchema = z.object({
  name: z.string().min(2).max(100),
  niche: z.string().min(2).max(100),
  platform: z.enum(["instagram"]).default("instagram"),
  personaId: z.string().uuid().optional(),
  bio: z.string().max(150).optional(),
  photoPath: z.string().optional(),
  isPrivate: z.boolean().optional(),
  googleVoiceCreds: z
    .object({
      email: z.string().email(),
      appPassword: z.string().min(1),
    })
    .optional(),
});

const retrySchema = z.object({
  fromStep: z.enum(PIPELINE_STEPS).optional(),
});

/* ── Routes ───────────────────────────────────── */

/* POST /api/accounts/create — Kick off account creation pipeline */
app.post("/api/accounts/create", createLimiter, async (req, res, next) => {
  try {
    const parsed = createAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: parsed.error.issues,
      });
    }

    const opts = parsed.data;

    /* Fire-and-forget the pipeline — return immediately with accountId */
    const accountId = require("uuid").v4();
    const personaId = opts.personaId || require("uuid").v4();

    console.log(
      JSON.stringify({
        level: "info",
        msg: "Account creation requested",
        accountId,
        name: opts.name,
        platform: opts.platform,
        ts: new Date().toISOString(),
      })
    );

    /* Start pipeline asynchronously */
    orchestrator
      .run({ ...opts, personaId })
      .catch((err) => {
        console.error(
          JSON.stringify({
            level: "error",
            msg: "Pipeline failed (async)",
            error: err.message,
            code: err.code,
            ts: new Date().toISOString(),
          })
        );
      });

    res.status(202).json({
      message: "Account creation started",
      accountId: personaId,
      status: "running",
    });
  } catch (err) {
    next(err);
  }
});

/* GET /api/accounts/:id/status — Get pipeline/account status */
app.get("/api/accounts/:id/status", (req, res, next) => {
  try {
    const account = db.getAccount(req.params.id);
    if (!account) {
      return res.status(404).json({ error: "Account not found", code: "NOT_FOUND" });
    }

    const pipelineStatus = orchestrator.getStatus(req.params.id);

    res.json({
      id: account.id,
      status: account.status,
      handle: account.handle,
      platform: account.platform,
      pipeline: pipelineStatus,
      createdAt: account.created_at,
      lastHealthCheck: account.last_health_check,
      errorLog: account.error_log ? JSON.parse(account.error_log) : null,
    });
  } catch (err) {
    next(err);
  }
});

/* POST /api/accounts/:id/retry — Retry a failed pipeline from a specific step */
app.post("/api/accounts/:id/retry", createLimiter, async (req, res, next) => {
  try {
    const account = db.getAccount(req.params.id);
    if (!account) {
      return res.status(404).json({ error: "Account not found", code: "NOT_FOUND" });
    }

    if (!account.status.startsWith("failed:")) {
      return res.status(400).json({
        error: "Account is not in a failed state",
        code: "INVALID_STATE",
      });
    }

    const parsed = retrySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: parsed.error.issues,
      });
    }

    const failedStep = account.status.replace("failed:", "");
    const retryStep = parsed.data.fromStep || failedStep;

    console.log(
      JSON.stringify({
        level: "info",
        msg: "Retry requested",
        accountId: req.params.id,
        retryFromStep: retryStep,
        ts: new Date().toISOString(),
      })
    );

    /* Re-run pipeline from the retry step */
    orchestrator
      .run({
        name: "retry",
        niche: "retry",
        personaId: account.persona_id,
        retryFromStep: retryStep,
      })
      .catch((err) => {
        console.error(
          JSON.stringify({
            level: "error",
            msg: "Retry pipeline failed (async)",
            accountId: req.params.id,
            error: err.message,
            ts: new Date().toISOString(),
          })
        );
      });

    res.status(202).json({
      message: "Retry started",
      accountId: req.params.id,
      retryFromStep: retryStep,
    });
  } catch (err) {
    next(err);
  }
});

/* POST /api/accounts/:id/refresh — Refresh session cookies */
app.post("/api/accounts/:id/refresh", async (req, res, next) => {
  try {
    const account = db.getAccount(req.params.id);
    if (!account) {
      return res.status(404).json({ error: "Account not found", code: "NOT_FOUND" });
    }

    const result = await refreshSession(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/* GET /api/accounts/:id/health — Check session health */
app.get("/api/accounts/:id/health", async (req, res, next) => {
  try {
    const account = db.getAccount(req.params.id);
    if (!account) {
      return res.status(404).json({ error: "Account not found", code: "NOT_FOUND" });
    }

    if (!account.session_cookies) {
      return res.json({
        valid: false,
        reason: "No session cookies stored",
        handle: account.handle,
      });
    }

    const health = await checkSession(account.session_cookies);

    /* Update health check timestamp */
    db.updateAccount(req.params.id, {
      last_health_check: new Date().toISOString(),
    });

    res.json({
      ...health,
      handle: account.handle,
      sessionExpires: account.session_expires,
    });
  } catch (err) {
    next(err);
  }
});

/* GET /api/accounts — List all accounts */
app.get("/api/accounts", (req, res, next) => {
  try {
    const filters = {
      status: req.query.status || undefined,
      platform: req.query.platform || undefined,
      limit: req.query.limit ? parseInt(req.query.limit, 10) : 50,
      offset: req.query.offset ? parseInt(req.query.offset, 10) : 0,
    };

    const accounts = db.listAccounts(filters);

    /* Strip session cookies from list response for security */
    const safe = accounts.map((a) => ({
      ...a,
      session_cookies: a.session_cookies ? "[encrypted]" : null,
    }));

    res.json({
      accounts: safe,
      count: safe.length,
      filters,
    });
  } catch (err) {
    next(err);
  }
});

/* DELETE /api/accounts/:id — Delete an account */
app.delete("/api/accounts/:id", (req, res, next) => {
  try {
    const deleted = db.deleteAccount(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: "Account not found", code: "NOT_FOUND" });
    }
    res.json({ deleted: true, id: req.params.id });
  } catch (err) {
    next(err);
  }
});

/* ── Error handler ────────────────────────────── */

app.use((err, _req, res, _next) => {
  const statusMap = {
    RATE_LIMIT: 429,
    COOLDOWN: 429,
    VALIDATION_ERROR: 400,
    NOT_FOUND: 404,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
  };

  const status = statusMap[err.code] || 500;

  console.error(
    JSON.stringify({
      level: "error",
      msg: "Unhandled error",
      error: err.message,
      code: err.code,
      stack: status === 500 ? err.stack : undefined,
      ts: new Date().toISOString(),
    })
  );

  res.status(status).json({
    error: status === 500 ? "Internal server error" : err.message,
    code: err.code || "INTERNAL_ERROR",
  });
});

/* ── Server start ─────────────────────────────── */

const PORT = config.FACTORY_PORT;

const server = app.listen(PORT, () => {
  console.log(
    JSON.stringify({
      level: "info",
      msg: `PersonaGen Factory API listening on port ${PORT}`,
      port: PORT,
      ts: new Date().toISOString(),
    })
  );
});

/* ── Graceful shutdown ────────────────────────── */

function gracefulShutdown(signal) {
  console.log(
    JSON.stringify({
      level: "info",
      msg: `Received ${signal}, shutting down gracefully`,
      ts: new Date().toISOString(),
    })
  );

  server.close(() => {
    console.log(
      JSON.stringify({
        level: "info",
        msg: "HTTP server closed",
        ts: new Date().toISOString(),
      })
    );

    db.close();
    process.exit(0);
  });

  /* Force shutdown after 10 seconds */
  setTimeout(() => {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "Forced shutdown after timeout",
        ts: new Date().toISOString(),
      })
    );
    process.exit(1);
  }, 10_000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

module.exports = app;
