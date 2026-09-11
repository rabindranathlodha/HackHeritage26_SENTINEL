// Creates the staff accounts the Welfare Console needs, and assigns the people
// who already have open alerts to an officer.
//
// Lives beside issue-credentials.ts and follows the same rules: it runs on the
// OWNER connection, because creating a user and reassigning caseloads is
// deliberately outside every application role's reach, and it prints each
// password exactly once.
//
// This seeds ACCOUNTS and ASSIGNMENTS only. It does not invent a single score,
// alert or assessment — those come from the synthetic cohort that is already
// labelled as synthetic. An officer signing in sees the alerts the escalation
// engine actually raised, or an empty queue.
//
//   docker compose exec -T \
//     -e DATABASE_URL="postgresql://sentinel:sentinel@db:5432/sentinel" \
//     api node prisma/seed-console.ts
//
//   ... --officer-password 'chosen' --commander-password 'chosen'

import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";

import { PrismaClient } from "@prisma/client";

import { hashPassword } from "../src/lib/password.ts";

const { values } = parseArgs({
  options: {
    "officer-id": { type: "string", default: "off-001" },
    "commander-id": { type: "string", default: "cmd-001" },
    "officer-password": { type: "string" },
    "commander-password": { type: "string" },
    unit: { type: "string" },
  },
});

const ownerUrl = process.env.DATABASE_URL;
if (!ownerUrl) {
  console.error(
    "DATABASE_URL (owner connection) must be set. The app's own connection " +
      "cannot create users, which is the point.",
  );
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: ownerUrl } } });

/** URL-safe, 18 bytes of entropy. Shown once and never recoverable. */
function generatePassword(): string {
  return randomBytes(18).toString("base64url");
}

async function upsertStaff(id: string, role: "WELFARE_OFFICER" | "COMMANDER", unitId: string) {
  await prisma.user.upsert({
    where: { id },
    // An existing account keeps its unit: re-running this must not silently
    // move an officer between units.
    update: { role },
    create: { id, role, unitId },
  });
}

async function issue(userId: string, loginId: string, password: string) {
  const passwordHash = await hashPassword(password);
  await prisma.personnelCredential.upsert({
    where: { userId },
    update: { passwordHash, loginId },
    create: { userId, loginId, passwordHash },
  });
}

async function main() {
  // Put the staff in the unit that actually has open alerts, so the demo shows
  // a queue rather than requiring someone to guess which unit to look at.
  const withAlerts = await prisma.alert.findMany({
    where: { status: { not: "ACTIONED" } },
    select: { userId: true },
  });
  const targetIds = [...new Set(withAlerts.map((alert) => alert.userId))];

  if (targetIds.length === 0) {
    console.error(
      "No open alerts exist, so an officer would sign in to an empty queue. " +
        "Run the scoring pipeline first; this script will not invent one.",
    );
  }

  const unitId =
    values.unit ??
    (targetIds.length > 0
      ? ((await prisma.user.findUnique({
          where: { id: targetIds[0] },
          select: { unitId: true },
        }))?.unitId ?? "HQ")
      : "HQ");

  const officerId = values["officer-id"];
  const commanderId = values["commander-id"];

  await upsertStaff(officerId, "WELFARE_OFFICER", unitId);
  await upsertStaff(commanderId, "COMMANDER", unitId);

  // Assign everyone who currently has an open alert. Without this the officer
  // has no caseload and sentinel_officer_may_view refuses every record — which
  // is correct behaviour and an unusable demo.
  const assigned = await prisma.user.updateMany({
    where: { id: { in: targetIds }, role: "PERSONNEL" },
    data: { welfareOfficerId: officerId },
  });

  const officerPassword = values["officer-password"] ?? generatePassword();
  const commanderPassword = values["commander-password"] ?? generatePassword();
  await issue(officerId, officerId, officerPassword);
  await issue(commanderId, commanderId, commanderPassword);

  console.log(`unit                ${unitId}`);
  console.log(`people assigned     ${assigned.count}`);
  console.log("");
  console.log("login id           role              password");
  console.log("-----------------  ----------------  ---------------");
  console.log(`${officerId.padEnd(17)}  WELFARE_OFFICER   ${officerPassword}`);
  console.log(`${commanderId.padEnd(17)}  COMMANDER         ${commanderPassword}`);
  console.log("");
  console.log(
    "These passwords are shown once and stored only as scrypt hashes. There is no way to read them back.",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
