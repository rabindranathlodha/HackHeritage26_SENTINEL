"use client";

import { HandHeart, ShieldCheck, UserCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const principles = [
  {
    icon: UserCheck,
    title: "Your choice",
    body: "Taking part in a self-assessment is voluntary. You can skip a week, or every week.",
  },
  {
    icon: HandHeart,
    title: "Your data",
    body: "You can see what you share, what stays on your device, and who has looked at what.",
  },
  {
    icon: ShieldCheck,
    title: "Your privacy",
    body: "Your reflections are not shown to anyone as a personal wellness score.",
  },
];

export interface PrivacyIndicatorProps {
  className?: string;
  compact?: boolean;
}

export function PrivacyIndicator({ className, compact = false }: PrivacyIndicatorProps) {
  return (
    <Dialog>
      <DialogTrigger
        aria-label="Private by design — read how your privacy works"
        className={cn(
          "inline-flex items-center gap-2 rounded-full border border-emerald/25 bg-mint px-3 py-1.5 text-xs font-medium text-mint-foreground transition-colors hover:bg-accent",
          className,
        )}
      >
        <ShieldCheck aria-hidden="true" className="size-3.5 text-emerald" />
        {compact ? "Private" : "Private by design"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="text-left">
          <DialogTitle className="text-2xl">Your information is yours.</DialogTitle>
          <DialogDescription>
            SENTINEL is built to support you, not to watch you. Here is what that means in practice.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-3">
          {principles.map((principle) => (
            <li
              key={principle.title}
              className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-mint text-primary">
                <principle.icon aria-hidden="true" className="size-4.5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">{principle.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{principle.body}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Support services can work without your optional self-assessment. Choosing not to check in
          never counts against you.
        </p>
      </DialogContent>
    </Dialog>
  );
}
