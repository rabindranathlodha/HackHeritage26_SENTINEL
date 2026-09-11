"use client";

import { ArrowDown, Cpu, ServerCog, ShieldCheck, Smartphone } from "lucide-react";
import type { ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { PrivacyBadge } from "./PrivacyBadge";

const pipeline = [
  {
    icon: Smartphone,
    title: "Your device",
    body: "You answer the check-in and, if you want, write a reflection.",
  },
  {
    icon: Cpu,
    title: "Private processing",
    body: "Your words are summarised into a simple signal before anything is sent.",
  },
  {
    icon: ShieldCheck,
    title: "Derived signal",
    body: "Only that summarised signal travels — not a transcript of your thoughts.",
  },
  {
    icon: ServerCog,
    title: "Secure service",
    body: "The signal joins your own longitudinal picture, protected and access-logged.",
  },
];

export interface DataUsageSheetProps {
  children: ReactNode;
}

export function DataUsageSheet({ children }: DataUsageSheetProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader className="text-left">
          <SheetTitle className="text-xl">How your information travels</SheetTitle>
          <SheetDescription>
            Plain language, no legal jargon. This is what happens after you tap submit.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-3 px-4 pb-8">
          <PrivacyBadge tone="demo">Demo build · pipeline shown for illustration</PrivacyBadge>
          <ol className="space-y-1">
            {pipeline.map((step, index) => (
              <li key={step.title}>
                <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-mint text-primary">
                    <step.icon aria-hidden="true" className="size-4.5" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{step.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
                  </div>
                </div>
                {index < pipeline.length - 1 ? (
                  <div className="flex justify-center py-1" aria-hidden="true">
                    <ArrowDown className="size-4 text-emerald" />
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
          <p className="pt-2 text-xs leading-relaxed text-muted-foreground">
            In this MVP build the on-device summarising step is simulated so the flow can be
            demonstrated. It is labelled here rather than presented as a completed guarantee.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
