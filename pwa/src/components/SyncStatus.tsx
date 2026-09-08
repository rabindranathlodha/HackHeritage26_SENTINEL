"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { flush, pendingCount } from "@/lib/offlineQueue";

// The offline banner and sync status, together, because they are one thought:
// "is anything waiting, and is it moving?"
//
// Tone is deliberate (spec 6): a non-alarming banner, never an error dump. A
// person in a remote posting has done nothing wrong by having no signal, and
// the app should not imply otherwise.
export function SyncStatus() {
  // Translated here rather than passed in: the "N check-ins syncing" string is
  // an ICU plural, and a formatter function cannot be handed to a client
  // component. next-intl's client hook does the formatting where the count is.
  const t = useTranslations("offline");
  const reduceMotion = useReducedMotion();
  const [online, setOnline] = useState(true);
  const [waiting, setWaiting] = useState(0);
  const [justSynced, setJustSynced] = useState(false);

  const refresh = useCallback(async () => {
    setWaiting(await pendingCount());
  }, []);

  const trySend = useCallback(async () => {
    if (!navigator.onLine) return;
    const { sent, remaining } = await flush();
    setWaiting(remaining);
    if (sent > 0 && remaining === 0) {
      setJustSynced(true);
      // Long enough to be read, short enough not to linger as clutter.
      setTimeout(() => setJustSynced(false), 4000);
    }
  }, []);

  useEffect(() => {
    setOnline(navigator.onLine);
    void refresh();

    const goOnline = () => {
      setOnline(true);
      void trySend();
    };
    const goOffline = () => setOnline(false);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    // Also on mount: the app may have been opened fresh with items already
    // queued from a previous session, with no online event to react to.
    void trySend();

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [refresh, trySend]);

  const message = !online
    ? t("banner")
    : waiting > 0
      ? t("syncing", { count: waiting })
      : justSynced
        ? t("synced")
        : null;

  const transition = reduceMotion ? { duration: 0 } : { duration: 0.25 };

  return (
    <AnimatePresence initial={false}>
      {message && (
        <motion.p
          key={message}
          role="status"
          aria-live="polite"
          data-testid="sync-status"
          data-pending={waiting}
          data-online={online}
          initial={reduceMotion ? false : { opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -6 }}
          transition={transition}
          className="bg-muted text-muted-foreground rounded-xl px-4 py-3 text-sm"
        >
          {message}
        </motion.p>
      )}
    </AnimatePresence>
  );
}
