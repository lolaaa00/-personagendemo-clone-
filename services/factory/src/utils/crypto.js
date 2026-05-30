"use strict";

const crypto = require("node:crypto");

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

/**
 * Encrypt plaintext with AES-256-GCM.
 * @param {string} plaintext
 * @param {string} hexKey — 64-char hex string (32 bytes)
 * @returns {string} "iv:tag:ciphertext" all hex-encoded
 */
function encrypt(plaintext, hexKey) {
  if (!hexKey || hexKey.length !== 64) {
    throw new Error("encrypt: hexKey must be a 64-char hex string (32 bytes)");
  }
  const key = Buffer.from(hexKey, "hex");
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt an "iv:tag:ciphertext" string produced by encrypt().
 * @param {string} packed
 * @param {string} hexKey
 * @returns {string} plaintext
 */
function decrypt(packed, hexKey) {
  if (!hexKey || hexKey.length !== 64) {
    throw new Error("decrypt: hexKey must be a 64-char hex string (32 bytes)");
  }
  const [ivHex, tagHex, ctHex] = packed.split(":");
  if (!ivHex || !tagHex || !ctHex) {
    throw new Error("decrypt: malformed ciphertext — expected iv:tag:ciphertext");
  }
  const key = Buffer.from(hexKey, "hex");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ct = Buffer.from(ctHex, "hex");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ct), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Generate a random 32-byte hex key suitable for AES-256-GCM.
 * @returns {string} 64-char hex string
 */
function generateKey() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Deterministic SHA-256 hash — used for browser fingerprint seeds.
 * @param {string} input
 * @returns {string} hex digest
 */
function hashSeed(input) {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

module.exports = { encrypt, decrypt, generateKey, hashSeed };
