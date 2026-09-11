"use client";

import * as React from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { type LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface VercelMenuItem {
  /** Route path — must exist as a route file for type-safe <Link>. */
  to: string;
  label: string;
  icon: LucideIcon;
  /** Keyboard shortcut shown in the tooltip, e.g. "M" or "⌘ S". */
  shortcut?: string;
  /** Optional unread count; renders a small badge when > 0. */
  badge?: number;
}

export interface VercelIconsMenuWithTooltipProps {
  items: VercelMenuItem[];
  className?: string;
}

/**
 * Vercel-style icon menu: a tight row of ghost icon buttons that each reveal a
 * tooltip (label + keyboard shortcut) on hover/focus, carry an active pill when
 * the current route matches, and optionally show an unread badge. Tuned to
 * SENTINEL's calm wellness palette — green accent, soft glow, rounded corners.
 */
export function VercelIconsMenuWithTooltip({
  items,
  className,
}: VercelIconsMenuWithTooltipProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Global keyboard shortcuts: plain keys ("M") fire on keydown; modifier combos
  // ("⌘ S" / "Ctrl S") fire on the matching combo. Typing inside inputs is ignored.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      for (const item of items) {
        if (!item.shortcut) continue;
        const key = item.shortcut.trim();
        if (key.length === 1) {
          // Single letter — match the exact character (case-insensitive), no modifiers.
          if (
            !e.metaKey &&
            !e.ctrlKey &&
            !e.altKey &&
            e.key.toLowerCase() === key.toLowerCase()
          ) {
            e.preventDefault();
            window.location.assign(item.to);
          }
        } else {
          // Modifier combo, e.g. "⌘ S" or "Ctrl S".
          const letter = key.replace(/^(⌘|Ctrl|Cmd|Control)\s+/i, "").trim().toLowerCase();
          if (
            (e.metaKey || e.ctrlKey) &&
            e.key.toLowerCase() === letter &&
            letter
          ) {
            e.preventDefault();
            window.location.assign(item.to);
          }
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [items]);

  return (
    <TooltipProvider delayDuration={220} skipDelayDuration={120}>
      <nav
        aria-label="Quick menu"
        className={cn(
          "flex items-center gap-0.5 rounded-full border border-border bg-card/70 p-1 backdrop-blur-md shadow-soft",
          className,
        )}
      >
        {items.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
          const unread = item.badge && item.badge > 0 ? item.badge : 0;

          return (
            <Tooltip key={item.to}>
              <TooltipTrigger asChild>
                <Link
                  to={item.to}
                  aria-label={item.label}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex size-9 items-center justify-center rounded-full text-muted-foreground transition-all duration-200 ease-out",
                    "hover:bg-mint hover:text-primary hover:shadow-soft",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                    active &&
                      "bg-mint text-primary shadow-soft ring-1 ring-inset ring-primary/20",
                  )}
                >
                  <Icon aria-hidden="true" className="size-[18px]" strokeWidth={2} />
                  {unread > 0 ? (
                    <span
                      aria-label={`${unread} unread`}
                      className="absolute -right-0.5 -top-0.5 flex min-w-[16px] h-4 items-center justify-center rounded-full bg-attention px-1 text-[10px] font-semibold leading-none text-attention-foreground shadow-soft"
                    >
                      {unread > 9 ? "9+" : unread}
                    </span>
                  ) : null}
                  {active ? (
                    <span className="pointer-events-none absolute inset-0 rounded-full [box-shadow:0_0_0_1px_color-mix(in_oklab,var(--color-primary)_30%,transparent),0_0_18px_-4px_var(--color-emerald)]" />
                  ) : null}
                </Link>
              </TooltipTrigger>
              <TooltipContent
                sideOffset={8}
                className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-card-foreground shadow-soft"
              >
                <span>{item.label}</span>
                {item.shortcut ? (
                  <kbd className="rounded border border-border bg-secondary px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted-foreground">
                    {item.shortcut}
                  </kbd>
                ) : null}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
    </TooltipProvider>
  );
}
