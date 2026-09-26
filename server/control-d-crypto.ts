import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import type { ControlDCredential } from "@shared/schema";

const CREDENTIAL_KEY_VERSION = 1;
const IV_BYTES = 12;
const KEY_BYTES = 32;
const KEY_SALT = Buffer.from("safenet-control-d-credential-encryption-v1", "utf8");
const KEY_INFO = Buffer.from("AES-256-GCM Control D API token", "utf8");

export type EncryptedControlDCredential = Pick<
  ControlDCredential,
  "tokenCiphertext" | "tokenIv" | "tokenAuthTag" | "encryptionKeyVersion"
>;

export class ControlDCredentialEncryptionError extends Error {
  constructor() {
    super("Control D credential encryption is unavailable.");
    this.name = "ControlDCredentialEncryptionError";
  }
}

function deriveKey(): Buffer {
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    throw new ControlDCredentialEncryptionError();
  }

  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(sessionSecret, "utf8"),
      KEY_SALT,
      KEY_INFO,
      KEY_BYTES,
    ),
  );
}

function getAssociatedData(userId: string, keyVersion: number): Buffer {
  return Buffer.from(`control-d-credential\0${keyVersion}\0${userId}`, "utf8");
}

export function encryptControlDToken(
  token: string,
  userId: string,
): EncryptedControlDCredential {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(), iv);
  cipher.setAAD(getAssociatedData(userId, CREDENTIAL_KEY_VERSION));
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);

  return {
    tokenCiphertext: ciphertext.toString("base64"),
    tokenIv: iv.toString("base64"),
    tokenAuthTag: cipher.getAuthTag().toString("base64"),
    encryptionKeyVersion: CREDENTIAL_KEY_VERSION,
  };
}

export function decryptControlDToken(
  credential: Pick<
    ControlDCredential,
    "tokenCiphertext" | "tokenIv" | "tokenAuthTag" | "encryptionKeyVersion"
  >,
  userId: string,
): string {
  try {
    if (credential.encryptionKeyVersion !== CREDENTIAL_KEY_VERSION) {
      throw new Error("Unsupported credential key version.");
    }

    const iv = Buffer.from(credential.tokenIv, "base64");
    const authTag = Buffer.from(credential.tokenAuthTag, "base64");
    if (iv.length !== IV_BYTES || authTag.length !== 16) {
      throw new Error("Invalid encrypted credential.");
    }

    const decipher = createDecipheriv("aes-256-gcm", deriveKey(), iv);
    decipher.setAAD(getAssociatedData(userId, credential.encryptionKeyVersion));
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(credential.tokenCiphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");

    if (!plaintext) {
      throw new Error("Empty credential.");
    }
    return plaintext;
  } catch {
    throw new ControlDCredentialEncryptionError();
  }
}