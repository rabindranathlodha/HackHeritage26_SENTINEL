"use client";

import { useTranslation } from "react-i18next";
import type { LikertOption, LikertValue } from "@/lib/sentinel/types";

interface LikertScaleProps { options: LikertOption[]; value?: LikertValue | undefined; onChange: (value: LikertValue) => void; }

export function LikertScale({ options, value, onChange }: LikertScaleProps) {
  const { t } = useTranslation();
  return <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label={t("checkin.howOften")}>
    {options.map((option) => <button key={option.value} type="button" role="radio" aria-checked={value === option.value} onClick={() => onChange(option.value)} className={`flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl border px-1 text-center text-[11px] font-medium leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-xs ${value === option.value ? "border-primary bg-primary text-primary-foreground shadow-soft" : "border-border bg-background text-muted-foreground hover:border-emerald/50 hover:bg-mint"}`}><span className={`flex size-7 items-center justify-center rounded-full text-sm font-bold ${value === option.value ? "bg-primary-foreground/15" : "bg-secondary text-primary"}`}>{option.value + 1}</span>{option.label}</button>)}
  </div>;
}
