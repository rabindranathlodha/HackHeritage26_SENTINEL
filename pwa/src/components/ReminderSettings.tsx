"use client";

import { motion, useReducedMotion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import {
  pushPermission,
  pushSupported,
  subscribeToReminders,
  unsubscribeFromReminders,
} from "@/lib/push";

// The weekly reminder.
//
// Off until asked for, and asked for with a tap that also raises the browser's
// permission prompt — never on page load, because a prompt nobody invited is
// how an app gets permanently blocked, and a person who is denied once cannot
// be asked again by anybody.
//
// Every way this can fail is a fallback, not an error. An old handset, a
// browser without push, a device policy, a person who said no: in all of them
// the preference is still saved and the reminder appears inside the app on the
// next open. What must never happen is a toggle that reads ON while nothing
// will ever arrive.

type Schedule = { enabled: boolean; dow: number | null; hour: number | null; tz: string | null };

/** Sunday evening: the end of a week, not the start of a shift. */
const DEFAULT_DOW = 0;
const DEFAULT_HOUR = 19;

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function ReminderSettings({
  initial,
  devices,
}: {
  initial: Schedule;
  devices: number;
}) {
  const t = useTranslations("settings");
  const locale = useLocale();
  const reduceMotion = useReducedMotion();

  const [schedule, setSchedule] = useState<Schedule>(initial);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<
    "denied" | "unsupported" | "unavailable" | null
  >(null);

  const dow = schedule.dow ?? DEFAULT_DOW;
  const hour = schedule.hour ?? DEFAULT_HOUR;

  // Localised names, from the runtime rather than from the message files —
  // there is no version of these twenty-four strings worth translating by hand.
  const dayName = (value: number) =>
    new Intl.DateTimeFormat(locale, { weekday: "long" }).format(
      // 2024-01-07 was a Sunday, so +value lands on the right weekday.
      new Date(Date.UTC(2024, 0, 7 + value)),
    );
  const hourName = (value: number) =>
    new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(
      new Date(Date.UTC(2024, 0, 7, value, 0)),
    );

  async function save(next: Schedule) {
    setPending(true);
    try {
      const res = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reminder: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { reminder: Schedule };
      setSchedule(body.reminder);
      return true;
    } catch {
      setNotice("unavailable");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function toggle(next: boolean) {
    setNotice(null);

    if (!next) {
      // Drop the device first, then the preference. The other order leaves a
      // live endpoint against someone who has just said they do not want one.
      await unsubscribeFromReminders();
      await save({ enabled: false, dow: null, hour: null, tz: null });
      return;
    }

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const wanted: Schedule = { enabled: true, dow, hour, tz };

    if (!pushSupported()) {
      // Saved anyway: the preference is what drives the in-app banner, which is
      // the fallback this handset will actually get.
      setNotice(pushPermission() === "denied" ? "denied" : "unsupported");
      await save(wanted);
      return;
    }

    const outcome = await subscribeToReminders(locale);
    if (outcome.state === "denied") setNotice("denied");
    else if (outcome.state === "unsupported") setNotice("unsupported");
    else if (outcome.state === "unavailable") setNotice("unavailable");

    await save(wanted);
  }

  async function reschedule(patch: Partial<Schedule>) {
    const tz = schedule.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    await save({ enabled: true, dow, hour, tz, ...patch });
  }

  return (
    <div className="border-line bg-surface flex flex-col gap-3 rounded-xl border px-[17px] py-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">{t("reminderHeading")}</h2>
        <p className="text-ink-2 text-[13px] leading-snug">{t("reminderBody")}</p>
      </div>

      {/* What will actually appear on the lock screen, said before they agree
          to receive it. A notification is the one message that arrives whether
          or not they are holding the phone. */}
      <p className="bg-sunk text-ink-2 rounded-md px-3.5 py-3 text-[13px] leading-relaxed">
        {t("reminderPrivate")}
      </p>

      <button
        type="button"
        role="switch"
        aria-checked={schedule.enabled}
        data-testid="reminder-toggle"
        disabled={pending}
        onClick={() => toggle(!schedule.enabled)}
        className="flex min-h-14 items-center gap-3.5 text-left disabled:opacity-60"
      >
        <span className={`meta flex-1 ${schedule.enabled ? "text-ember-ink" : "text-ink-3"}`}>
          {schedule.enabled
            ? t("reminderOn", { day: dayName(dow), time: hourName(hour) })
            : t("reminderOff")}
        </span>
        <span
          aria-hidden
          className={
            "relative h-8 w-14 shrink-0 rounded-full transition-colors duration-200 " +
            (schedule.enabled ? "bg-ember" : "bg-line")
          }
        >
          <motion.span
            className="absolute top-[3px] size-[26px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.18)]"
            animate={{ left: schedule.enabled ? 27 : 3 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.18 }}
          />
        </span>
      </button>

      {schedule.enabled && (
        <div className="flex gap-2.5">
          <label className="flex flex-1 flex-col gap-1.5">
            <span className="meta text-ink-3">{t("reminderDay")}</span>
            <select
              value={dow}
              disabled={pending}
              onChange={(event) => reschedule({ dow: Number(event.target.value) })}
              className="border-line bg-surface min-h-14 rounded-md border px-3 text-base"
            >
              {[0, 1, 2, 3, 4, 5, 6].map((value) => (
                <option key={value} value={value}>
                  {dayName(value)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-1 flex-col gap-1.5">
            <span className="meta text-ink-3">{t("reminderHour")}</span>
            <select
              value={hour}
              disabled={pending}
              onChange={(event) => reschedule({ hour: Number(event.target.value) })}
              className="border-line bg-surface min-h-14 rounded-md border px-3 text-base"
            >
              {HOURS.map((value) => (
                <option key={value} value={value}>
                  {hourName(value)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {schedule.enabled && !notice && (
        <p className="meta text-ink-3">{t("reminderDevices", { count: devices })}</p>
      )}

      {notice && (
        <p role="status" className="text-ink-2 text-[13px] leading-relaxed">
          {notice === "denied" && t("reminderDenied")}
          {notice === "unsupported" && t("reminderUnsupported")}
          {notice === "unavailable" && t("reminderUnavailable")}
        </p>
      )}
    </div>
  );
}
