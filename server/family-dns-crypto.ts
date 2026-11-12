import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { FamilyDnsCredential } from "@shared/schema";

const VERSION = 1;
const SALT = Buffer.from("safenet-family-dns-credential-encryption-v1");
const INFO = Buffer.from("AES-256-GCM family DNS API key");
const IV_BYTES = 12;
type Provider = FamilyDnsCredential["provider"];
type Encrypted = Pick<FamilyDnsCredential, "tokenCiphertext" | "tokenIv" | "tokenAuthTag" | "encryptionKeyVersion">;

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("DNS provider credential encryption is unavailable.");
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret), SALT, INFO, 32));
}

export function encryptFamilyDnsToken(token: string, userId: string, provider: Provider): Encrypted {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(`${provider}\0${VERSION}\0${userId}`));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return {
    tokenCiphertext: ciphertext.toString("base64"),
    tokenIv: iv.toString("base64"),
    tokenAuthTag: cipher.getAuthTag().toString("base64"),
    encryptionKeyVersion: VERSION,
  };
}

export function decryptFamilyDnsToken(credential: FamilyDnsCredential, userId: string): string {
  try {
    if (credential.encryptionKeyVersion !== VERSION) throw new Error();
    const iv = Buffer.from(credential.tokenIv, "base64");
    const tag = Buffer.from(credential.tokenAuthTag, "base64");
    if (iv.length !== IV_BYTES || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAAD(Buffer.from(`${credential.provider}\0${VERSION}\0${userId}`));
    decipher.setAuthTag(tag);
    const token = Buffer.concat([
      decipher.update(Buffer.from(credential.tokenCiphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
    if (!token) throw new Error();
    return token;
  } catch {
    throw new Error("DNS provider credentials could not be decrypted.");
  }
}
