"use client";

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, ShieldCheck } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PrivacyBadge } from "./PrivacyBadge";
import { updateSentinelState, useSentinelState } from "@/lib/sentinel/store";

const explainers = [
  {
    q: "What is collected?",
    a: "Your answers to a short weekly check-in. A written reflection or voice note only if you choose to add one.",
  },
  {
    q: "Why is it collected?",
    a: "So you can see your own patterns over time, and so welfare support can be offered earlier when a unit needs it.",
  },
  {
    q: "What happens on this device?",
    a: "Your reflection is summarised on your device into a simple signal before anything is transmitted. In this MVP build that step is simulated.",
  },
  {
    q: "What leaves this device?",
    a: "Your check-in responses and a derived wellbeing signal. Not a transcript presented as your personal score.",
  },
  {
    q: "Who can see what?",
    a: "You see your full history. Welfare support sees aggregated signals. Commanders are never shown an individual wellness score.",
  },
  {
    q: "Can I use SENTINEL without this?",
    a: "Yes. The self-assessment is optional and support remains available either way.",
  },
];

export interface ConsentDialogProps {
  /** Where to continue after consent is given. */
  continueTo?: string;
  onContinue?: () => void;
}

export function ConsentDialog({ continueTo = "/checkin", onContinue }: ConsentDialogProps) {
  const { preferences } = useSentinelState();
  const [understood, setUnderstood] = useState(false);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <PrivacyBadge>Voluntary</PrivacyBadge>
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          You&rsquo;re in control.
        </h1>
        <p className="max-w-xl text-base leading-relaxed text-muted-foreground">
          This check-in is voluntary. You choose what you share and how your information is used.
        </p>
      </div>

      <div className="rounded-3xl border border-border bg-card p-5 shadow-soft sm:p-6">
        <Accordion type="single" collapsible className="w-full">
          {explainers.map((item) => (
            <AccordionItem key={item.q} value={item.q}>
              <AccordionTrigger className="text-left text-sm font-semibold">
                {item.q}
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                {item.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>

      <div className="space-y-4 rounded-3xl border border-border bg-gradient-mint p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-foreground">Optional extras</h2>
        <div className="flex items-start justify-between gap-4">
          <Label htmlFor="consent-journal" className="text-sm font-normal text-muted-foreground">
            Allow me to add a written reflection
          </Label>
          <Switch
            id="consent-journal"
            checked={preferences.journal}
            onCheckedChange={(checked) =>
              updateSentinelState({ preferences: { ...preferences, journal: checked } })
            }
          />
        </div>
        <div className="flex items-start justify-between gap-4">
          <Label htmlFor="consent-voice" className="text-sm font-normal text-muted-foreground">
            Allow me to add a voice note
          </Label>
          <Switch
            id="consent-voice"
            checked={preferences.voiceNotes}
            onCheckedChange={(checked) =>
              updateSentinelState({ preferences: { ...preferences, voiceNotes: checked } })
            }
          />
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4">
        <Checkbox
          id="consent-understood"
          checked={understood}
          onCheckedChange={(checked) => setUnderstood(checked === true)}
          className="mt-0.5"
        />
        <Label
          htmlFor="consent-understood"
          className="text-sm font-normal leading-relaxed text-muted-foreground"
        >
          I&rsquo;ve read how my information is used and I&rsquo;d like to continue.
        </Label>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          asChild={understood}
          size="lg"
          disabled={!understood}
          className="min-h-12 flex-1"
          onClick={onContinue}
        >
          {understood ? (
            <Link to={continueTo}>
              <Check aria-hidden="true" /> Continue with check-in
            </Link>
          ) : (
            <span>
              <Check aria-hidden="true" /> Continue with check-in
            </span>
          )}
        </Button>
        <Button asChild variant="outline" size="lg" className="min-h-12 flex-1">
          <Link to="/dashboard">Skip for now</Link>
        </Button>
      </div>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck aria-hidden="true" className="size-3.5 text-emerald" />
        Skipping is a normal choice. Nothing is recorded when you skip.
      </p>
    </div>
  );
}
