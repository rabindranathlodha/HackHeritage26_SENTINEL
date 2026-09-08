import withSerwistInit from "@serwist/next";
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
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default withSerwist(nextConfig);
