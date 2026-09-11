"use client";

import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Logo } from "./Logo";
import { PrivacyBadge } from "@/components/privacy/PrivacyBadge";

export function Footer() {
  const { t } = useTranslation();

  return (
    <footer className="border-t border-border bg-secondary/40">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="space-y-4">
          <Logo />
          <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">{t("footer.tagline")}</p>
          <PrivacyBadge tone="demo">{t("footer.demo")}</PrivacyBadge>
        </div>

        <nav aria-label="Product" className="space-y-3 text-sm">
          <p className="font-semibold text-foreground">{t("footer.product")}</p>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <Link to="/dashboard" className="hover:text-foreground">
                {t("footer.dashboard")}
              </Link>
            </li>
            <li>
              <Link to="/checkin" className="hover:text-foreground">
                {t("footer.checkin")}
              </Link>
            </li>
            <li>
              <Link to="/wellbeing" className="hover:text-foreground">
                {t("footer.wellbeing")}
              </Link>
            </li>
          </ul>
        </nav>

        <nav aria-label="Trust" className="space-y-3 text-sm">
          <p className="font-semibold text-foreground">{t("footer.trust")}</p>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <Link to="/privacy" className="hover:text-foreground">
                {t("footer.privacyCenter")}
              </Link>
            </li>
            <li>
              <Link to="/privacy" hash="data-usage" className="hover:text-foreground">
                {t("footer.dataUsage")}
              </Link>
            </li>
            <li>
              <Link to="/privacy" hash="support" className="hover:text-foreground">
                {t("footer.support")}
              </Link>
            </li>
            <li>
              <Link to="/" hash="about" className="hover:text-foreground">
                {t("footer.about")}
              </Link>
            </li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-border/70 px-4 py-5 text-center text-xs text-muted-foreground sm:px-6">
        {t("footer.legal")}
      </div>
    </footer>
  );
}
