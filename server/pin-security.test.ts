import assert from "node:assert/strict";
import test from "node:test";
import { hashPin, isHashedPin, verifyPin } from "./pin-security";

test("PIN hashes never expose the original code and verify correctly", () => {
  const hash = hashPin("4827");

  assert.equal(isHashedPin(hash), true);
  assert.notEqual(hash, "4827");
  assert.equal(verifyPin(hash, "4827"), true);
  assert.equal(verifyPin(hash, "4828"), false);
});

test("PIN verification supports one-time migration from legacy plaintext storage", () => {
  assert.equal(verifyPin("4827", "4827"), true);
  assert.equal(verifyPin("4827", "0000"), false);
  assert.equal(verifyPin(null, "4827"), false);
});
