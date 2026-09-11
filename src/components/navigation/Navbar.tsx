"use client";

import { Link } from "@tanstack/react-router";
import { Inbox, MessageCircle, Settings, User } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/layout/Logo";
import { PrivacyIndicator } from "@/components/privacy/PrivacyIndicator";
import { VercelIconsMenuWithTooltip } from "@/components/navigation/VercelIconsMenuWithTooltip";
import { ThemeToggle } from "@/components/navigation/ThemeToggle";
import { LanguageToggle } from "@/components/navigation/LanguageToggle";

export interface NavItem {
  label: string;
  to: string;
}

export const navItems: NavItem[] = [
  { label: "Home", to: "/dashboard" },
  { label: "Check-in", to: "/checkin" },
  { label: "My wellbeing", to: "/wellbeing" },
  { label: "Privacy", to: "/privacy" },
];

export interface NavbarProps {
  variant?: "marketing" | "app";
}

export function Navbar({ variant = "app" }: NavbarProps) {
  const { t } = useTranslation();

  const appNavItems = [
    { to: "/dashboard", label: t("nav.home") },
    { to: "/checkin", label: t("nav.checkin") },
    { to: "/wellbeing", label: t("nav.wellbeing") },
    { to: "/privacy", label: t("nav.privacy") },
  ] as const;

  const quickMenuItems = [
    { to: "/messages", label: t("nav.messages"), icon: MessageCircle, shortcut: "M" },
    { to: "/inbox", label: t("nav.inbox"), icon: Inbox, badge: 3 },
    { to: "/settings", label: t("nav.settings"), icon: Settings, shortcut: "⌘ S" },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl">
      <nav
        aria-label="Main"
        className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6"
      >
        <Logo />

        {variant === "app" ? (
          <ul className="hidden items-center gap-1 md:flex">
            {appNavItems.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className="rounded-full px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground data-[status=active]:bg-mint data-[status=active]:text-primary"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="hidden items-center gap-1 md:flex">
            <li>
              <a
                href="#features"
                className="rounded-full px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                {t("nav.features")}
              </a>
            </li>
            <li>
              <a
                href="#how-it-works"
                className="rounded-full px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                {t("nav.howItWorks")}
              </a>
            </li>
            <li>
              <Link
                to="/privacy"
                className="rounded-full px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                {t("nav.privacy")}
              </Link>
            </li>
          </ul>
        )}

        <div className="flex items-center gap-2">
          {variant === "app" ? (
            <VercelIconsMenuWithTooltip items={quickMenuItems} className="hidden sm:inline-flex" />
          ) : null}
          <LanguageToggle />
          <ThemeToggle />
          <PrivacyIndicator className="hidden lg:inline-flex" />
          {variant === "app" ? (
            <Link
              to="/privacy"
              aria-label={t("nav.profile")}
              className="flex size-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
            >
              <User aria-hidden="true" className="size-4" />
            </Link>
          ) : (
            <Button asChild size="sm" className="min-h-9">
              <Link to="/consent">{t("nav.startCheckIn")}</Link>
            </Button>
          )}
        </div>
      </nav>
    </header>
  );
}
