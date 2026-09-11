"use client";

import { ArrowLeft, ArrowRight, Loader2, Send } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { assessmentQuestions, getAssessmentQuestions, likertOptions, submitCheckIn, type SubmitResult } from "@/lib/sentinel/mock-service";
import type { AssessmentQuestion, CheckInAnswer, LikertValue } from "@/lib/sentinel/types";
import { updateSentinelState } from "@/lib/sentinel/store";
import { CompletionCard } from "./CompletionCard";
import { JournalInput } from "@/components/assessment/JournalInput";
import { ProgressIndicator } from "@/components/assessment/ProgressIndicator";
import { QuestionCard } from "@/components/assessment/QuestionCard";
import { VoiceNoteButton } from "@/components/assessment/VoiceNoteButton";

export function CheckInCard() {
  const [questions] = useState<AssessmentQuestion[]>(assessmentQuestions);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<CheckInAnswer[]>([]);
  const [reflection, setReflection] = useState("");
  const [voiceNoteAttached, setVoiceNoteAttached] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const question = questions[step];
  const isReflectionStep = step === questions.length;
  const currentAnswer = question ? answers.find((answer) => answer.questionId === question.id)?.value : undefined;

  const chooseAnswer = (value: LikertValue) => setAnswers((previous) => [...previous.filter((answer) => answer.questionId !== question?.id), { questionId: question?.id ?? "", value }]);
  const submit = async () => {
    setSubmitting(true); setError(null);
    try {
      const next = await submitCheckIn({ answers, reflection: reflection || undefined, voiceNoteAttached, submittedAt: new Date().toISOString() });
      updateSentinelState({ lastCheckInAt: new Date().toISOString(), lastCheckInQueued: next.status === "queued" }); setResult(next);
    } catch (submissionError) { setError(submissionError instanceof Error ? submissionError.message : "We couldn’t save this check-in."); } finally { setSubmitting(false); }
  };

  if (result) return <CompletionCard result={result} />;
  if (!isReflectionStep && !question) return null;

  return <div className="mx-auto max-w-3xl space-y-5"><ProgressIndicator current={isReflectionStep ? questions.length + 1 : step + 1} total={questions.length + 1} />{isReflectionStep ? <section className="rounded-[2rem] border border-border bg-card p-5 shadow-soft sm:p-8"><div className="space-y-2"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald">Last step</p><h2 className="text-2xl font-bold text-foreground sm:text-3xl">Add context, if it would help.</h2><p className="leading-relaxed text-muted-foreground">A reflection is optional. You can submit with nothing extra.</p></div><div className="mt-8 space-y-7"><JournalInput value={reflection} onChange={setReflection} /><VoiceNoteButton attached={voiceNoteAttached} onChange={setVoiceNoteAttached} /></div></section> : <QuestionCard question={question!} number={step + 1} total={questions.length} options={likertOptions} value={currentAnswer} onChange={chooseAnswer} />}{error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}<div className="flex items-center justify-between gap-3"><Button type="button" variant="ghost" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0 || submitting}><ArrowLeft aria-hidden="true" />Back</Button>{isReflectionStep ? <Button type="button" onClick={submit} disabled={submitting} className="min-h-11 px-5">{submitting ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Send aria-hidden="true" />}{submitting ? "Saving…" : "Save check-in"}</Button> : <Button type="button" onClick={() => setStep((current) => current + 1)} disabled={currentAnswer === undefined}><span>{step === questions.length - 1 ? "Continue" : "Next"}</span><ArrowRight aria-hidden="true" /></Button>}</div></div>;
}