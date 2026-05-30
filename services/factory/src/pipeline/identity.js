"use strict";

const crypto = require("node:crypto");
const { hashSeed } = require("../utils/crypto");

/**
 * Generate a complete persona identity for account creation.
 *
 * @param {{ name: string, niche: string, platform: string, personaId: string }} input
 * @returns {{ email: string, usernameOptions: string[], password: string, bio: string, fingerprintSeed: string }}
 */
function generateIdentity({ name, niche, platform, personaId }) {
  const baseHandle = buildBaseHandle(name);
  const usernameOptions = generateUsernameVariations(baseHandle);
  const password = generateSecurePassword(16);
  const bio = buildBio(name, niche, platform);
  const fingerprintSeed = hashSeed(personaId);
  const emailHandle = `${baseHandle.replace(/[^a-z0-9]/g, "")}${randomDigits(4)}`;
  const email = `${emailHandle}@inbox.personagen.com`;

  return {
    email,
    usernameOptions,
    password,
    bio,
    fingerprintSeed,
  };
}

/**
 * Convert a display name into a base handle (lowercase, no spaces).
 * @param {string} name
 * @returns {string}
 */
function buildBaseHandle(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "");
}

/**
 * Generate 8 username variations from a base handle.
 * @param {string} base
 * @returns {string[]}
 */
function generateUsernameVariations(base) {
  const year = new Date().getFullYear().toString().slice(-2);
  const digits2 = randomDigits(2);
  const digits3 = randomDigits(3);
  const digits4 = randomDigits(4);

  const variations = [
    base,
    `${base}_`,
    `${base}${digits2}`,
    `${base}_${digits3}`,
    `${base}.${digits2}`,
    `${base}${year}`,
    `_${base}_`,
    `${base}.official`,
  ];

  const seen = new Set();
  return variations.filter((v) => {
    const key = v.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return v.length >= 3 && v.length <= 30;
  });
}

/**
 * Generate a cryptographically secure random password.
 * Guarantees at least one uppercase, one lowercase, one digit, one symbol.
 * @param {number} length
 * @returns {string}
 */
function generateSecurePassword(length) {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%^&*_+-=";
  const all = upper + lower + digits + symbols;

  const required = [
    upper[crypto.randomInt(upper.length)],
    lower[crypto.randomInt(lower.length)],
    digits[crypto.randomInt(digits.length)],
    symbols[crypto.randomInt(symbols.length)],
  ];

  const remaining = [];
  for (let i = 0; i < length - required.length; i++) {
    remaining.push(all[crypto.randomInt(all.length)]);
  }

  const combined = [...required, ...remaining];
  for (let i = combined.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }

  return combined.join("");
}

/**
 * Build a short bio string.
 * @param {string} name
 * @param {string} niche
 * @param {string} platform
 * @returns {string}
 */
function buildBio(name, niche, platform) {
  const templates = [
    `${name} | ${niche}`,
    `${niche} ✨ Follow for more`,
    `${name} — ${niche} content`,
    `Living the ${niche} life 🔥`,
    `${niche} enthusiast | Creator`,
  ];
  return templates[crypto.randomInt(templates.length)];
}

function randomDigits(n) {
  let s = "";
  for (let i = 0; i < n; i++) {
    s += crypto.randomInt(10).toString();
  }
  return s;
}

module.exports = { generateIdentity };
