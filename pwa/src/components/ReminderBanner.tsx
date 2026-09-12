"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { pushPermission, pushSupported } from "@/lib/push";

// The fallback for a phone that cannot receive a push.
//
// A person who asked to be reminded should be reminded, and on an old handset,
// a locked-down device, or a browser where they declined the permission, the
// notification will never arrive. Showing them a settings screen that says ON
// while nothing is ever delivered would be the app quietly failing a promise it
// made — so the reminder appears here instead, the next time they open it.
//
// It renders only when all three are true: they asked for reminders, a check-in
// is actually due, and push is not going to deliver. If push works, this would
// be a second reminder for something they have already been told about.
export function ReminderBanner({ due }: { due: boolean }) {
  const t = useTranslations("settings");
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!due) return;
    // Checked on the client because permission is a browser fact the server
    // cannot know. `pushPermission()` never prompts — it reads what is already
    // granted, so opening the app does not raise a dialog nobody asked for.
    const delivering = pushSupported() && pushPermission() === "granted";
    if (delivering) return;

    // Dismissal lasts for the session only. Someone who taps "not now" on
    // Sunday should still see it on Monday; someone who dismissed it a minute
    // ago should not see it again on every navigation.
    try {
      if (sessionStorage.getItem("companion.reminder-dismissed") === "1") return;
    } catch {
      // Private mode, or site data blocked. Showing the banner is the safe
      // side of this: a repeated nudge is a smaller failure than a missed one.
    }
    setShow(true);
  }, [due]);

  if (!show) return null;

  function dismiss() {
    try {
      sessionStorage.setItem("companion.reminder-dismissed", "1");
    } catch {
      // Nothing to do; it simply reappears on the next navigation.
    }
    setShow(false);
  }

  return (
    <div
      role="status"
      data-testid="reminder-banner"
      className="bg-ember-soft flex flex-col gap-3 rounded-md px-4 py-3.5"
    >
      <p className="text-ember-ink text-[15px]">{t("reminderBannerTitle")}</p>
      <div className="flex gap-2">
        <Link
          href="/check-in"
          className="bg-ember text-on-ember flex min-h-14 flex-1 items-center justify-center rounded-md text-base font-semibold"
        >
          {t("reminderBannerGo")}
        </Link>
        <button
          type="button"
          onClick={dismiss}
          className="text-ember-ink min-h-14 px-4 text-base"
        >
          {t("reminderBannerDismiss")}
        </button>
      </div>
    </div>
  );
}
