import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { NextDnsCredential } from "@shared/schema";

const VERSION = 1;
const SALT = Buffer.from("safenet-nextdns-credential-encryption-v1");
const INFO = Buffer.from("AES-256-GCM NextDNS API key");
const IV_BYTES = 12;

export type EncryptedNextDnsCredential = Pick<
  NextDnsCredential,
  "tokenCiphertext" | "tokenIv" | "tokenAuthTag" | "encryptionKeyVersion"
>;

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("NextDNS credential encryption is unavailable.");
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret), SALT, INFO, 32));
}

export function encryptNextDnsToken(token: string, userId: string): EncryptedNextDnsCredential {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(`nextdns\0${VERSION}\0${userId}`));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return {
    tokenCiphertext: ciphertext.toString("base64"),
    tokenIv: iv.toString("base64"),
    tokenAuthTag: cipher.getAuthTag().toString("base64"),
    encryptionKeyVersion: VERSION,
  };
}

export function decryptNextDnsToken(credential: NextDnsCredential, userId: string): string {
  try {
    if (credential.encryptionKeyVersion !== VERSION) throw new Error("Invalid key version.");
    const iv = Buffer.from(credential.tokenIv, "base64");
    const tag = Buffer.from(credential.tokenAuthTag, "base64");
    if (iv.length !== IV_BYTES || tag.length !== 16) throw new Error("Invalid encrypted key.");
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAAD(Buffer.from(`nextdns\0${VERSION}\0${userId}`));
    decipher.setAuthTag(tag);
    const token = Buffer.concat([
      decipher.update(Buffer.from(credential.tokenCiphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
    if (!token) throw new Error("Empty key.");
    return token;
  } catch {
    throw new Error("NextDNS connection credentials could not be decrypted.");
  }
}
