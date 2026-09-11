"use client";

import { HelpCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AssessmentQuestion, LikertOption, LikertValue } from "@/lib/sentinel/types";
import { LikertScale } from "./LikertScale";

interface QuestionCardProps { question: AssessmentQuestion; number: number; total: number; options: LikertOption[]; value?: LikertValue | undefined; onChange: (value: LikertValue) => void; }

export function QuestionCard({ question, number, total, options, value, onChange }: QuestionCardProps) {
  const { t } = useTranslation();
  const prompt = t(`checkin.questions.${question.id}.prompt`, { defaultValue: question.prompt });
  const helper = question.helper
    ? t(`checkin.questions.${question.id}.helper`, { defaultValue: question.helper })
    : undefined;

  return <section className="rounded-[2rem] border border-border bg-card p-5 shadow-soft sm:p-8"><div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground"><span>{t("checkin.question", { number })}</span><span>{t("checkin.total", { number: total })}</span></div><h2 className="mt-7 max-w-2xl text-2xl font-bold leading-tight text-foreground sm:text-3xl">{prompt}</h2>{helper ? <p className="mt-4 flex items-start gap-2 text-sm leading-relaxed text-muted-foreground"><HelpCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-emerald" />{helper}</p> : null}<div className="mt-8"><LikertScale options={options} value={value} onChange={onChange} /></div></section>;
}
