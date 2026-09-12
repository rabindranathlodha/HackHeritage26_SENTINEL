// The service worker. Compiled by Serwist at build time into public/sw.js.
//
// Principle 3 (offline-first) lives here: the app shell is precached so the app
// opens instantly with no network, and a document request that cannot be served
// falls back to /offline rather than the browser's error page. Personnel in
// remote postings must never hit a dead end.

import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();

// --- Weekly reminder -------------------------------------------------------
//
// The only push this app ever receives. The payload carries a title and a body
// the app tier already checked against the notification denylist, and this side
// checks again before showing anything: a service worker will display whatever
// it is handed, and the push service is not a trusted author.
//
// If the payload is missing, malformed, or says something it should not, the
// fixed local string is shown instead. `userVisibleOnly` was promised at
// subscribe time, so silently showing nothing would break that contract and can
// cost the app its push permission — the browser may show its own "this site
// was updated in the background" notice, which is worse than ours.

const FALLBACK = { title: "Companion", body: "Time for your weekly check-in." };

/** Mirrors the server guard. Anything on a lock screen must be unremarkable. */
const FORBIDDEN = [
  "diagnos", "depress", "anxiet", "risk", "score", "band", "patient",
  "disorder", "symptom", "mental", "therapy", "treatment", "suicid",
  "welfare", "officer", "commander", "concern", "worried", "alert",
  "urgent", "important", "sentinel",
  "जोखिम", "स्कोर", "कल्याण", "अधिकारी", "चिंता",
];

const safe = (text: unknown): text is string =>
  typeof text === "string" &&
  text.length > 0 &&
  text.length < 120 &&
  !FORBIDDEN.some((term) => text.toLowerCase().includes(term));

self.addEventListener("push", (event) => {
  let payload: { title?: unknown; body?: unknown; url?: unknown } = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    // A push with no readable payload still has to produce a notification.
  }

  const title = safe(payload.title) ? payload.title : FALLBACK.title;
  const body = safe(payload.body) ? payload.body : FALLBACK.body;
  const url = typeof payload.url === "string" && payload.url.startsWith("/")
    ? payload.url
    : "/check-in";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: "weekly-check-in",
      // Replaces rather than stacks: two unread reminders on a lock screen
      // say more about the person than one does.
      renotify: false,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url },
    } as NotificationOptions),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data as { url?: string } | undefined)?.url ?? "/check-in";

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Reuse an open window rather than stacking tabs.
      for (const client of clients) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
