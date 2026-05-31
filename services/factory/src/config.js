"use strict";

const { z } = require("zod");

const hexKey32 = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, "ENCRYPTION_KEY must be a 64-char hex string (32 bytes)")
  .optional();

const envSchema = z.object({
  /* ── required ─────────────────────────────── */
  FACTORY_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  FACTORY_API_KEY: z.string().min(16, "FACTORY_API_KEY must be at least 16 characters"),
  MAIL_DOMAIN: z.string().default("l2gseo.com"),
  MAIL_URL: z.string().url("MAIL_URL must be a valid URL").optional(),
  MAIL_API_KEY: z.string().min(1, "MAIL_API_KEY is required"),

  /* ── Google Voice (phone verification) ───── */
  GOOGLE_VOICE_EMAIL: z.string().email().optional(),
  GOOGLE_VOICE_APP_PASSWORD: z.string().optional(),

  /* ── CORS ─────────────────────────────────── */
  ALLOWED_ORIGINS: z.string().default("*"),

  /* ── proxy (optional) ─────────────────────── */
  PROXY_HOST: z.string().optional(),
  PROXY_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  PROXY_USER: z.string().optional(),
  PROXY_PASS: z.string().optional(),

  /* ── CAPTCHA (optional) ────────────────────── */
  CAPTCHA_PROVIDER: z.enum(["2captcha", "anticaptcha"]).optional(),
  CAPTCHA_API_KEY: z.string().optional(),

  /* ── n8n webhook (optional) ────────────────── */
  N8N_WEBHOOK_URL: z.string().url().optional(),

  /* ── safety limits ─────────────────────────── */
  MAX_CREATIONS_PER_DAY: z.coerce.number().int().min(1).default(3),
  COOLDOWN_MINUTES: z.coerce.number().int().min(0).default(30),

  /* ── storage ───────────────────────────────── */
  PROFILES_DIR: z.string().default("/data/profiles"),
  DB_PATH: z.string().default("/data/factory.db"),

  /* ── encryption ────────────────────────────── */
  ENCRYPTION_KEY: hexKey32,
});

let config;

try {
  config = envSchema.parse(process.env);
} catch (err) {
  const issues = err.issues || [];
  const formatted = issues
    .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  console.error(
    JSON.stringify({
      level: "fatal",
      msg: "Invalid environment configuration",
      issues: formatted,
      ts: new Date().toISOString(),
    })
  );
  process.exit(1);
}

/* ── derived helpers ──────────────────────────── */

config.proxy = null;
if (config.PROXY_HOST && config.PROXY_PORT) {
  config.proxy = {
    host: config.PROXY_HOST,
    port: config.PROXY_PORT,
    username: config.PROXY_USER || undefined,
    password: config.PROXY_PASS || undefined,
  };
}

config.allowedOrigins = config.ALLOWED_ORIGINS === "*"
  ? "*"
  : config.ALLOWED_ORIGINS.split(",").map((o) => o.trim());

module.exports = config;
