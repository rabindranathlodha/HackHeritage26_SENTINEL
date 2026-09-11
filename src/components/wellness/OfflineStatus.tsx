"use client";

import { Wifi, WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/lib/sentinel/store";

export function OfflineStatus() {
  const online = useOnlineStatus();

  if (online) return null;

  return (
    <div className="border-b border-attention/20 bg-attention-soft px-4 py-2.5 text-center text-sm text-attention">
      <span className="inline-flex items-center gap-2 font-medium">
        <WifiOff aria-hidden="true" className="size-4" />
        You’re offline. Your next check-in will stay on this device until you reconnect.
      </span>
    </div>
  );
}

export function ConnectionPill() {
  const online = useOnlineStatus();

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      {online ? <Wifi aria-hidden="true" className="size-3.5 text-emerald" /> : <WifiOff aria-hidden="true" className="size-3.5 text-attention" />}
      {online ? "Connected" : "Offline mode"}
    </span>
  );
}