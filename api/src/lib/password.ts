import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { promisify } from "node:util";

// promisify() picks scrypt's three-argument overload and drops the one that
// takes options, so the cost parameters would be silently unusable through it.
// The cast restores the overload that actually matters here.
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

// scrypt from node:crypto rather than argon2id. argon2id would be the first
// choice on merit, but every Node binding for it is a native module, and this
// service runs in a slim container. scrypt is memory-hard, in the standard
// library, and listed by OWASP as acceptable where argon2id is unavailable —
// a dependency-free correct answer beats a better answer that needs a compiler.
//
// N=2^16, r=8, p=1 costs ~64 MB and ~100 ms per verification. That is the
// point: it is the same cost for an attacker, per guess.
const N = 65536;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

// scrypt refuses to allocate past maxmem, whose default is below what these
// parameters need. 128 * N * r is the formula; double it for headroom.
const MAX_MEMORY = 256 * N * R;

const PREFIX = "scrypt";

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  return (await scryptAsync(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N,
    r: R,
    p: P,
    maxmem: MAX_MEMORY,
  })) as Buffer;
}

/** Encodes as scrypt$N$r$p$salt$hash, so the parameters travel with the hash. */
export async function hashPassword(password: string): Promise<string> {
  if (!password) throw new Error("refusing to hash an empty password");
  const salt = randomBytes(SALT_LENGTH);
  const hash = await derive(password, salt);
  return [PREFIX, N, R, P, salt.toString("base64"), hash.toString("base64")].join("$");
}

/**
 * Constant-time verification. Returns false rather than throwing on a malformed
 * stored value: a corrupt row must fail the login, not surface a stack trace to
 * whoever is probing the endpoint.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;

  const [, n, r, p, saltB64, hashB64] = parts;
  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  if (!Number.isInteger(cost.N) || !Number.isInteger(cost.r) || !Number.isInteger(cost.p)) {
    return false;
  }

  let expected: Buffer;
  let salt: Buffer;
  try {
    salt = Buffer.from(saltB64, "base64");
    expected = Buffer.from(hashB64, "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let actual: Buffer;
  try {
    // The stored parameters, not the current constants — an old hash must stay
    // verifiable after the cost is raised.
    actual = (await scryptAsync(password.normalize("NFKC"), salt, expected.length, {
      ...cost,
      maxmem: 256 * cost.N * cost.r,
    })) as Buffer;
  } catch {
    return false;
  }

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
