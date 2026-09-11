import { useEffect, useState } from "react";
import type { PrivacyPreferences } from "./types";

/**
 * Small client-side store for non-sensitive UI preferences only.
 * No check-in responses or reflection text are persisted here.
 */
export interface SentinelState {
  consentGiven: boolean;
  preferences: PrivacyPreferences;
  lastCheckInAt: string | null;
  lastCheckInQueued: boolean;
}

const STORAGE_KEY = "sentinel.ui-preferences.v1";

const defaultState: SentinelState = {
  consentGiven: false,
  preferences: {
    selfAssessment: true,
    voiceNotes: false,
    journal: true,
    transparencyAlerts: true,
  },
  lastCheckInAt: null,
  lastCheckInQueued: false,
};

let state: SentinelState = defaultState;
let hydrated = false;
const listeners = new Set<() => void>();

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) state = { ...defaultState, ...(JSON.parse(raw) as Partial<SentinelState>) };
  } catch {
    /* ignore corrupt preferences */
  }
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable */
  }
}

export function updateSentinelState(patch: Partial<SentinelState>) {
  state = { ...state, ...patch };
  persist();
  listeners.forEach((l) => l());
}

export function useSentinelState(): SentinelState {
  const [snapshot, setSnapshot] = useState<SentinelState>(defaultState);

  useEffect(() => {
    hydrate();
    setSnapshot(state);
    const listener = () => setSnapshot(state);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return snapshot;
}

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  return online;
}

export function useHydrated(): boolean {
  const [value, setValue] = useState(false);
  useEffect(() => setValue(true), []);
  return value;
}
