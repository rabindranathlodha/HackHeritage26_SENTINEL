// Browser-side Web Push registration.
//
// Every step here can fail for a reason that is nobody's fault — an old
// handset, a browser without push, a person who said no to the permission
// prompt, a locked-down device policy. None of those are errors to report; they
// are a fallback to take. The settings screen offers the in-app banner instead
// and says so, rather than showing a toggle that silently does nothing.
//
// The permission prompt is only ever raised from a click. Asking on page load
// is how an app gets permanently blocked, and a person who is denied once
// cannot be asked again by anybody.

export type PushOutcome =
  | { state: "subscribed"; endpoint: string }
  /** The browser or device cannot do push at all. */
  | { state: "unsupported" }
  /** The person declined, or had declined previously. */
  | { state: "denied" }
  /** Configured without a VAPID key, or the push service refused. */
  | { state: "unavailable"; reason: string };

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/** True when this browser could subscribe, before asking for anything. */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    VAPID.length > 0
  );
}

/** The permission the browser already holds, without prompting. */
export function pushPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

/** base64url → Uint8Array, the form PushManager wants for the VAPID key. */
function decodeKey(base64: string): Uint8Array {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/**
 * Asks permission, subscribes, and registers the device with the app tier.
 *
 * Must be called from a user gesture.
 */
export async function subscribeToReminders(locale: string): Promise<PushOutcome> {
  if (!pushSupported()) return { state: "unsupported" };

  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    return { state: "unsupported" };
  }
  if (permission !== "granted") return { state: "denied" };

  try {
    const registration = await navigator.serviceWorker.ready;
    // userVisibleOnly is required by Chrome and is also the honest setting:
    // every push this app sends results in a notification the person sees.
    // There is no silent push path here and there must never be one.
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeKey(VAPID) as BufferSource,
      }));

    const json = subscription.toJSON();
    const res = await fetch("/api/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
        locale,
      }),
    });
    if (!res.ok) return { state: "unavailable", reason: `register ${res.status}` };

    return { state: "subscribed", endpoint: subscription.endpoint };
  } catch (error) {
    return {
      state: "unavailable",
      reason: error instanceof Error ? error.message : "subscribe failed",
    };
  }
}

/**
 * Drops this device.
 *
 * Unsubscribes locally AND tells the app tier, in that order. Leaving a live
 * server-side endpoint after the person turned reminders off would keep sending
 * to a device they have stopped agreeing to hear from.
 */
export async function unsubscribeFromReminders(): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;

    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    await fetch(`/api/push?endpoint=${encodeURIComponent(endpoint)}`, {
      method: "DELETE",
    });
  } catch {
    // Nothing to tell the person: the preference is off either way, and the
    // dispatcher skips anyone whose reminder is disabled regardless of what
    // endpoints remain.
  }
}
