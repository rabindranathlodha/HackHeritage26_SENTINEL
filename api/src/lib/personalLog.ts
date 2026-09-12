import { withRole } from "./withRole.ts";

// The audit trail, read by the person it is about.
//
// The transparency screen tells someone that every access to their record is
// written down. This is what lets them check, rather than believe. For the
// people this product is hardest to earn trust from, a promise they can verify
// themselves is worth more than a stronger promise they cannot.

export type PersonalAccessEvent = {
  id: string;
  /** e.g. VIEW_INDIVIDUAL_SCORE */
  action: string;
  /** The staff id that looked. Named on purpose — "who looked" was the promise. */
  actor_id: string;
  actor_role: string;
  at: Date;
};

export async function personalAccessLog(
  userId: string,
  limit = 20,
): Promise<PersonalAccessEvent[]> {
  return withRole("sentinel_personnel", userId, async (tx) => {
    // Not a SELECT on "AuditLog" — sentinel_personnel holds no privilege on
    // that table. The accessor filters to the caller inside the database.
    //
    // ::int for the same reason as every other function call taking a number:
    // Prisma binds a JS number as bigint and Postgres will not implicitly cast
    // that when resolving an overload.
    return tx.$queryRaw<PersonalAccessEvent[]>`
      SELECT * FROM sentinel_personal_access_log(${limit}::int)
    `;
  });
}
