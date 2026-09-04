import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const HASH_PREFIX = "scrypt";
const KEY_LENGTH = 64;

export function hashPin(pin: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pin, salt, KEY_LENGTH).toString("hex");
  return `${HASH_PREFIX}$${salt}$${hash}`;
}

export function verifyPin(storedPin: string | null | undefined, pin: string) {
  if (!storedPin) return false;

  if (!storedPin.startsWith(`${HASH_PREFIX}$`)) {
    const stored = Buffer.from(storedPin);
    const candidate = Buffer.from(pin);
    return stored.length === candidate.length && timingSafeEqual(stored, candidate);
  }

  const [, salt, expectedHex] = storedPin.split("$");
  if (!salt || !expectedHex || !/^[a-f0-9]+$/i.test(expectedHex)) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const candidate = scryptSync(pin, salt, expected.length);
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}

export function isHashedPin(value: string | null | undefined) {
  return Boolean(value?.startsWith(`${HASH_PREFIX}$`));
}
