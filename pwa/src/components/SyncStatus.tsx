"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { Banner } from "@/components/Banner";
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

  // The design separates these two tones deliberately. Offline is quiet — it
  // is a fact about the world, not about the person, and colouring it would
  // make having no signal look like a problem they caused. Sending is ember,
  // because that is the app doing something on their behalf right now.
  const sending = online && waiting > 0;
  const tone = online && (waiting > 0 || justSynced) ? "ember" : "quiet";

  const transition = reduceMotion ? { duration: 0 } : { duration: 0.25 };

  return (
    <AnimatePresence initial={false}>
      {message && (
        <motion.div
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
        >
          <Banner tone={tone} busy={sending}>
            {message}
          </Banner>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
