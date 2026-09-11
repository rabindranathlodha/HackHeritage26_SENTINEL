import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PrivacyBadge, type PrivacyBadgeTone } from "./PrivacyBadge";

export interface PrivacyCardProps {
  title: string;
  description: ReactNode;
  icon?: LucideIcon;
  badge?: string;
  badgeTone?: PrivacyBadgeTone;
  className?: string;
  children?: ReactNode;
}

export function PrivacyCard({
  title,
  description,
  icon: Icon,
  badge,
  badgeTone = "private",
  className,
  children,
}: PrivacyCardProps) {
  return (
    <section
      className={cn(
        "rounded-3xl border border-border bg-card p-5 shadow-soft sm:p-6",
        className,
      )}
    >
      <div className="flex items-start gap-4">
        {Icon ? (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-mint text-primary">
            <Icon aria-hidden="true" className="size-5" />
          </span>
        ) : null}
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-foreground">{title}</h3>
            {badge ? <PrivacyBadge tone={badgeTone}>{badge}</PrivacyBadge> : null}
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
          {children}
        </div>
      </div>
    </section>
  );
}
