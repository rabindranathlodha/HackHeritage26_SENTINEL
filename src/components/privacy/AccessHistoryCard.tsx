import { Eye } from "lucide-react";
import type { AccessEvent } from "@/lib/sentinel/types";
import { cn } from "@/lib/utils";

export interface AccessHistoryCardProps {
  events: AccessEvent[];
  className?: string;
  isLoading?: boolean;
}

export function AccessHistoryCard({ events, className, isLoading }: AccessHistoryCardProps) {
  return (
    <div className={cn("rounded-3xl border border-border bg-card p-5 shadow-soft sm:p-6", className)}>
      <h3 className="text-base font-semibold text-foreground">Access history</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Every time your wellbeing information is looked at, it shows up here.
      </p>

      {isLoading ? (
        <ul className="mt-4 space-y-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-16 animate-pulse rounded-2xl bg-muted" />
          ))}
        </ul>
      ) : events.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          Nothing has been accessed yet.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {events.map((event) => (
            <li
              key={event.id}
              className="flex items-start gap-3 rounded-2xl border border-border bg-background p-4"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-mint text-primary">
                <Eye aria-hidden="true" className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{event.title}</p>
                <p className="text-sm text-muted-foreground">
                  {event.when} · {event.actor}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{event.scope}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
