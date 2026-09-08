"use client";

import { SerwistProvider } from "@serwist/next/react";
import type { ReactNode } from "react";

// @serwist/next does not register the worker for you — it only builds it.
// Without this the app serves a valid manifest and a valid /sw.js and still is
// not installable, which looks like success until you check.
export function ServiceWorker({ children }: { children: ReactNode }) {
  return (
    <SerwistProvider
      swUrl="/sw.js"
      register
      // Precaching the shell is the offline story; re-fetching on every client
      // navigation would spend a remote posting's bandwidth for nothing.
      cacheOnNavigation={false}
      reloadOnOnline={false}
      disable={process.env.NODE_ENV === "development"}
    >
      {children}
    </SerwistProvider>
  );
}
