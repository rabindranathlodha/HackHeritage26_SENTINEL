import { randomUUID } from "node:crypto";

import withSerwistInit from "@serwist/next";
import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

// next-pwa is unmaintained (last release 2022, peer `next: >=9`) and does not
// support the App Router. Serwist is the maintained Workbox successor and keeps
// the spec's intent: a real Workbox service worker, precached app shell.
const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // A service worker in dev caches stale bundles and makes every change look
  // like it did not take. Production builds always get one.
  disable: process.env.NODE_ENV === "development",
  reloadOnOnline: false,
  // The generated manifest contains only _next/static assets — no rendered
  // documents. Naming /offline as a fallback in the worker is therefore not
  // enough on its own: without this entry the fallback points at a URL that was
  // never cached, and an uncached route offline silently serves whatever the
  // runtime cache happens to match instead. Evaluated once per build, so the
  // revision changes when the page does.
  additionalPrecacheEntries: [{ url: "/offline", revision: randomUUID() }],
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withSerwist(withNextIntl(nextConfig));
