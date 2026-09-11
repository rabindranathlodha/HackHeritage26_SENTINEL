import { Lock, ShieldCheck, Smartphone, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type PrivacyBadgeTone = "private" | "optional" | "device" | "demo";

const toneStyles: Record<PrivacyBadgeTone, string> = {
  private: "bg-mint text-mint-foreground border-emerald/25",
  optional: "bg-secondary text-secondary-foreground border-border",
  device: "bg-primary-soft text-primary border-primary/20",
  demo: "bg-attention-soft text-attention border-attention/25",
};

const toneIcons: Record<PrivacyBadgeTone, ReactNode> = {
  private: <ShieldCheck aria-hidden="true" className="size-3.5" />,
  optional: <Sparkles aria-hidden="true" className="size-3.5" />,
  device: <Smartphone aria-hidden="true" className="size-3.5" />,
  demo: <Lock aria-hidden="true" className="size-3.5" />,
};

export interface PrivacyBadgeProps {
  children: ReactNode;
  tone?: PrivacyBadgeTone;
  className?: string;
  showIcon?: boolean;
}

export function PrivacyBadge({
  children,
  tone = "private",
  className,
  showIcon = true,
}: PrivacyBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium tracking-tight",
        toneStyles[tone],
        className,
      )}
    >
      {showIcon ? toneIcons[tone] : null}
      {children}
    </span>
  );
}
