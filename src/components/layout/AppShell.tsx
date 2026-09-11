"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Navbar } from "@/components/navigation/Navbar";
import { MobileNav } from "@/components/navigation/MobileNav";
import { OfflineStatus } from "@/components/wellness/OfflineStatus";

export interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const reduce = useReducedMotion();

  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-x-0 top-0 min-h-full bg-grid-fade opacity-60" aria-hidden="true" />
      <Navbar variant="app" />
      <OfflineStatus />
      <motion.main
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
        className="relative z-10 mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-6 sm:px-6 md:pb-16"
      >
        {children}
      </motion.main>
      <MobileNav />
    </div>
  );
}
