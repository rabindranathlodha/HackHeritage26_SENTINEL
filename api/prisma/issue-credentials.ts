// Issues sign-in credentials for the Personnel Companion PWA.
//
// Lives under prisma/ for two reasons: it is a seeding concern, and prisma/ is
// already bind-mounted into the api container so this runs without a rebuild.
//
// Runs as the OWNER connection, not sentinel_app. Issuing a credential is
// deliberately outside every application role's reach — sentinel_auth can read
// a hash to check a password and cannot write one.
//
//   docker compose exec -T \
//     -e DATABASE_URL="postgresql://sentinel:sentinel@db:5432/sentinel" \
//     api node prisma/issue-credentials.ts --all --limit 5
//
//   ... --user syn-000034 --password 'chosen-password'
//
// Passwords are printed ONCE, to the operator's terminal, and never stored in
// any recoverable form. There is no command to read one back.

import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";

import { PrismaClient } from "@prisma/client";

import { hashPassword } from "../src/lib/password.ts";

const { values } = parseArgs({
  options: {
    user: { type: "string" },
    password: { type: "string" },
    all: { type: "boolean", default: false },
    limit: { type: "string", default: "5" },
    rotate: { type: "boolean", default: false },
  },
});

const ownerUrl = process.env.DATABASE_URL;
if (!ownerUrl) {
  console.error(
    "DATABASE_URL (owner connection) must be set. The app's own connection " +
      "cannot write credentials, which is the point.",
  );
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: ownerUrl } } });

/** Readable at a glance, typed on a phone keyboard, ~62 bits of entropy. */
function generatePassword(): string {
  // No look-alike characters: someone reads this off a screen and types it on a
  // phone in bad light. 0/O and 1/l/I cost support calls, not security.
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(13);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars
    .slice(8, 13)
    .join("")}`;
}

async function issue(userId: string, password: string): Promise<void> {
  const passwordHash = await hashPassword(password);
  await prisma.$executeRaw`
    INSERT INTO "PersonnelCredential" ("userId", "loginId", "passwordHash")
    VALUES (${userId}, ${userId}, ${passwordHash})
    ON CONFLICT ("userId") DO UPDATE SET "passwordHash" = EXCLUDED."passwordHash"
  `;
}

try {
  // The login id is the person's own opaque user id. No name, no service
  // number, nothing that identifies a human being outside this system.
  const targets: string[] = [];

  if (values.user) {
    targets.push(values.user);
  } else if (values.all) {
    const limit = Number(values.limit);
    if (!Number.isInteger(limit) || limit < 1) {
      console.error("--limit must be a positive integer");
      process.exit(1);
    }
    const people = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "User" WHERE role = 'PERSONNEL' ORDER BY id LIMIT ${limit}
    `;
    targets.push(...people.map((p: { id: string }) => p.id));
  } else {
    console.error("give either --user <id> or --all [--limit n]");
    process.exit(1);
  }

  if (targets.length === 0) {
    console.error("no matching PERSONNEL users; generate the synthetic data first");
    process.exit(1);
  }

  const existing = await prisma.$queryRaw<{ userId: string }[]>`
    SELECT "userId" FROM "PersonnelCredential" WHERE "userId" = ANY(${targets})
  `;
  const alreadyIssued = new Set(existing.map((row: { userId: string }) => row.userId));

  console.log(`login id           password`);
  console.log(`-----------------  ---------------`);

  let skipped = 0;
  for (const userId of targets) {
    if (alreadyIssued.has(userId) && !values.rotate) {
      skipped += 1;
      continue;
    }
    const password = values.password ?? generatePassword();
    await issue(userId, password);
    console.log(`${userId.padEnd(17)}  ${password}`);
  }

  if (skipped > 0) {
    console.log(
      `\n${skipped} already had a credential and were left alone. ` +
        `Pass --rotate to replace them.`,
    );
  }
  console.log(
    "\nThese passwords are shown once and stored only as scrypt hashes. " +
      "There is no way to read them back.",
  );
} finally {
  await prisma.$disconnect();
}
