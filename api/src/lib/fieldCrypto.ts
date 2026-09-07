import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Field-level AES-256-GCM for Assessment.responsesEnc (spec 9.3).
// Layout: 12-byte IV, 16-byte tag, ciphertext. GCM so a tampered row fails
// loudly; fresh IV per write so identical answers don't produce identical rows.

const IV_BYTES = 12;
const TAG_BYTES = 16;

function key(): Buffer {
  const raw = process.env.AES_KEY;
  if (!raw) throw new Error("AES_KEY is not set; refusing to store plaintext");
  const material = Buffer.from(raw, "base64");
  if (material.length !== 32) {
    throw new Error(
      `AES_KEY must decode to 32 bytes for AES-256, got ${material.length}`,
    );
  }
  return material;
}

export function encryptJson(value: unknown): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function decryptJson<T>(blob: Buffer): T {
  if (blob.length <= IV_BYTES + TAG_BYTES) {
    throw new Error("ciphertext is too short to be well-formed");
  }
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([
    decipher.update(blob.subarray(IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]);
  return JSON.parse(plain.toString("utf8")) as T;
}
