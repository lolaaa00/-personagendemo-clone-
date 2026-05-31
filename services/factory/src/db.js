"use strict";

const Database = require("better-sqlite3");
const path = require("node:path");
const config = require("./config");
const { encrypt, decrypt } = require("./utils/crypto");

const DB_PATH = config.DB_PATH;
const ENC_KEY = config.ENCRYPTION_KEY;

let db;

function getDb() {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    const fs = require("node:fs");
    fs.mkdirSync(dir, { recursive: true });

    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    init();
  }
  return db;
}

function init() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id                TEXT PRIMARY KEY,
      persona_id        TEXT NOT NULL,
      platform          TEXT NOT NULL DEFAULT 'instagram',
      handle            TEXT,
      email             TEXT,
      inbox_id          TEXT,
      fingerprint_seed  TEXT,
      proxy             TEXT,
      session_cookies   TEXT,
      session_expires   TEXT,
      status            TEXT NOT NULL DEFAULT 'pending',
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      last_health_check TEXT,
      error_log         TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_accounts_persona ON accounts(persona_id);
    CREATE INDEX IF NOT EXISTS idx_accounts_status  ON accounts(status);
    CREATE INDEX IF NOT EXISTS idx_accounts_platform ON accounts(platform);
  `);
}

/* ── CRUD ────────────────────────────────────── */

const INSERT_SQL = `
  INSERT INTO accounts (id, persona_id, platform, handle, email, inbox_id,
    fingerprint_seed, proxy, session_cookies, session_expires, status,
    created_at, last_health_check, error_log)
  VALUES (@id, @persona_id, @platform, @handle, @email, @inbox_id,
    @fingerprint_seed, @proxy, @session_cookies, @session_expires, @status,
    @created_at, @last_health_check, @error_log)
`;

/**
 * Insert a new account record.
 * @param {object} acct
 * @returns {object} the inserted account (with cookies encrypted)
 */
function createAccount(acct) {
  const row = { ...acct };
  row.created_at = row.created_at || new Date().toISOString();
  row.status = row.status || "pending";
  row.handle = row.handle || null;
  row.email = row.email || null;
  row.inbox_id = row.inbox_id || null;
  row.fingerprint_seed = row.fingerprint_seed || null;
  row.proxy = row.proxy || null;
  row.session_cookies = row.session_cookies ? encryptCookies(row.session_cookies) : null;
  row.session_expires = row.session_expires || null;
  row.last_health_check = row.last_health_check || null;
  row.error_log = row.error_log || null;

  getDb().prepare(INSERT_SQL).run(row);
  return getAccount(row.id);
}

/**
 * Get a single account by id, decrypting cookies.
 * @param {string} id
 * @returns {object|null}
 */
function getAccount(id) {
  const row = getDb().prepare("SELECT * FROM accounts WHERE id = ?").get(id);
  if (!row) return null;
  return decryptRow(row);
}

/**
 * List accounts with optional filters.
 * @param {{ status?: string, platform?: string, limit?: number, offset?: number }} filters
 * @returns {object[]}
 */
function listAccounts(filters = {}) {
  const clauses = [];
  const params = {};

  if (filters.status) {
    clauses.push("status = @status");
    params.status = filters.status;
  }
  if (filters.platform) {
    clauses.push("platform = @platform");
    params.platform = filters.platform;
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(filters.limit || 50, 200);
  const offset = filters.offset || 0;

  const rows = getDb()
    .prepare(`SELECT * FROM accounts ${where} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset });

  return rows.map(decryptRow);
}

/**
 * Update specific fields on an account.
 * @param {string} id
 * @param {object} updates — partial fields
 * @returns {object|null}
 */
function updateAccount(id, updates) {
  const allowed = [
    "handle", "email", "inbox_id", "fingerprint_seed", "proxy",
    "session_cookies", "session_expires", "status",
    "last_health_check", "error_log",
  ];

  const sets = [];
  const params = { id };

  for (const key of allowed) {
    if (key in updates) {
      let val = updates[key];
      if (key === "session_cookies" && val) {
        val = encryptCookies(val);
      }
      sets.push(`${key} = @${key}`);
      params[key] = val;
    }
  }

  if (sets.length === 0) return getAccount(id);

  getDb()
    .prepare(`UPDATE accounts SET ${sets.join(", ")} WHERE id = @id`)
    .run(params);

  return getAccount(id);
}

/**
 * Delete an account.
 * @param {string} id
 * @returns {boolean}
 */
function deleteAccount(id) {
  const info = getDb().prepare("DELETE FROM accounts WHERE id = ?").run(id);
  return info.changes > 0;
}

/**
 * Count accounts created in the last 24 hours.
 * @returns {number}
 */
function countRecentCreations() {
  const row = getDb()
    .prepare(
      "SELECT COUNT(*) as cnt FROM accounts WHERE created_at > datetime('now', '-1 day')"
    )
    .get();
  return row.cnt;
}

/**
 * Get the most recent account creation timestamp.
 * @returns {string|null}
 */
function lastCreationTime() {
  const row = getDb()
    .prepare("SELECT MAX(created_at) as latest FROM accounts")
    .get();
  return row.latest || null;
}

/* ── encryption helpers ──────────────────────── */

function encryptCookies(cookies) {
  if (!ENC_KEY) return cookies;
  const raw = typeof cookies === "string" ? cookies : JSON.stringify(cookies);
  return encrypt(raw, ENC_KEY);
}

function decryptCookies(encrypted) {
  if (!ENC_KEY || !encrypted) return encrypted;
  try {
    const plain = decrypt(encrypted, ENC_KEY);
    try {
      return JSON.parse(plain);
    } catch {
      return plain;
    }
  } catch {
    return encrypted;
  }
}

function decryptRow(row) {
  if (!row) return row;
  return {
    ...row,
    session_cookies: row.session_cookies ? decryptCookies(row.session_cookies) : null,
  };
}

/* ── lifecycle ───────────────────────────────── */

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

// Initialize on first require
getDb();

module.exports = {
  createAccount,
  getAccount,
  updateAccount,
  listAccounts,
  deleteAccount,
  countRecentCreations,
  lastCreationTime,
  close,
};
