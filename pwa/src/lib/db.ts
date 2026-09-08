import { openDB, type DBSchema, type IDBPDatabase } from "idb";

import type { CheckInSubmission } from "@/lib/schemas";

// The app's local database. One connection, shared by the outbox and the
// journal, because two `openDB` calls on the same name race their upgrades.
//
// Everything here lives on the person's phone and is never uploaded. The
// journal store in particular holds their own words, which is exactly what the
// transparency screen promises stays put.

const DB_NAME = "sentinel-companion";
const DB_VERSION = 2;

export const OUTBOX = "outbox";
export const JOURNAL = "journal";
export const SIGNALS = "signals";

export type QueuedSubmission = CheckInSubmission & {
  /** When the person pressed the button, not when it was sent. */
  queuedAt: number;
  attempts: number;
  lastError?: string;
};

export type JournalEntry = {
  id: string;
  writtenAt: number;
  /** The person's own words. Kept only when they chose to keep them. */
  text: string;
};

/** A derived number waiting to be attached to the next check-in. */
export type PendingSignal = {
  id: "nlp";
  value: number;
  at: number;
};

export interface CompanionDB extends DBSchema {
  [OUTBOX]: {
    key: string;
    value: QueuedSubmission;
    indexes: { queuedAt: number };
  };
  [JOURNAL]: {
    key: string;
    value: JournalEntry;
    indexes: { writtenAt: number };
  };
  [SIGNALS]: {
    key: string;
    value: PendingSignal;
  };
}

let dbPromise: Promise<IDBPDatabase<CompanionDB>> | null = null;

export function db(): Promise<IDBPDatabase<CompanionDB>> {
  dbPromise ??= openDB<CompanionDB>(DB_NAME, DB_VERSION, {
    upgrade(database, oldVersion) {
      // Version-guarded rather than "create if missing": an installed app that
      // already has an outbox must not lose it when the journal is added.
      if (oldVersion < 1) {
        const outbox = database.createObjectStore(OUTBOX, { keyPath: "clientId" });
        outbox.createIndex("queuedAt", "queuedAt");
      }
      if (oldVersion < 2) {
        const journal = database.createObjectStore(JOURNAL, { keyPath: "id" });
        journal.createIndex("writtenAt", "writtenAt");
        database.createObjectStore(SIGNALS, { keyPath: "id" });
      }
    },
  });
  return dbPromise;
}
