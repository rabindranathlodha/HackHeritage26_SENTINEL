/**
 * Isolated mock service layer.
 *
 * Every value returned here is SYNTHETIC DEMO DATA — it is not real personnel
 * information. Replace the function bodies with calls to the SENTINEL service
 * layer (via the app's own server functions) when the backend is available.
 */
import type {
  AccessEvent,
  AssessmentQuestion,
  CheckInSubmission,
  LikertOption,
  WellbeingPoint,
} from "./types";

export const IS_DEMO_MODE = true;

export const likertOptions: LikertOption[] = [
  { value: 0, label: "Never" },
  { value: 1, label: "Rarely" },
  { value: 2, label: "Sometimes" },
  { value: 3, label: "Often" },
  { value: 4, label: "Very often" },
];

export const assessmentQuestions: AssessmentQuestion[] = [
  {
    id: "q1",
    prompt: "Over the past week, how often have you felt overwhelmed by your responsibilities?",
  },
  {
    id: "q2",
    prompt: "How often did you find it hard to switch off and rest?",
    helper: "Rest can look different for everyone — this is just about how it felt for you.",
  },
  { id: "q3", prompt: "How often did you sleep well enough to feel recovered?" },
  { id: "q4", prompt: "How often did small things feel more irritating than usual?" },
  { id: "q5", prompt: "How often did you feel supported by the people around you?" },
  { id: "q6", prompt: "How often did you find it difficult to concentrate on tasks?" },
  { id: "q7", prompt: "How often did you make time for something you enjoy?" },
  { id: "q8", prompt: "How often have you felt steady and in control of your week?" },
];

const wellbeingSeries: WellbeingPoint[] = [
  { label: "W1", balance: 74, reflections: 2, checkedIn: true },
  { label: "W2", balance: 71, reflections: 1, checkedIn: true },
  { label: "W3", balance: 66, reflections: 3, checkedIn: true },
  { label: "W4", balance: 69, reflections: 0, checkedIn: true },
  { label: "W5", balance: 61, reflections: 2, checkedIn: true },
  { label: "W6", balance: 58, reflections: 1, checkedIn: true },
  { label: "W7", balance: 64, reflections: 2, checkedIn: true },
  { label: "W8", balance: 68, reflections: 3, checkedIn: true },
];

const accessHistory: AccessEvent[] = [
  {
    id: "a1",
    title: "Wellbeing information accessed",
    actor: "Welfare support system",
    when: "Today · 18:24",
    scope: "Aggregated trend signal only",
  },
  {
    id: "a2",
    title: "Check-in participation confirmed",
    actor: "Unit wellbeing summary",
    when: "Yesterday · 09:10",
    scope: "Participation status, no responses",
  },
  {
    id: "a3",
    title: "Privacy preferences updated by you",
    actor: "You",
    when: "3 days ago · 21:02",
    scope: "Voice notes turned off",
  },
];

function delay<T>(value: T, ms = 420): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export function getAssessmentQuestions(): Promise<AssessmentQuestion[]> {
  return delay(assessmentQuestions, 150);
}

export function getWellbeingSeries(): Promise<WellbeingPoint[]> {
  return delay(wellbeingSeries);
}

export function getAccessHistory(): Promise<AccessEvent[]> {
  return delay(accessHistory);
}

export interface SubmitResult {
  status: "synced" | "queued";
  message: string;
}

/**
 * Demo submission. When the device is offline, the submission is held locally
 * and reported as queued so the offline flow can be demonstrated honestly.
 */
export async function submitCheckIn(submission: CheckInSubmission): Promise<SubmitResult> {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  await delay(null, 900);

  if (offline) {
    return {
      status: "queued",
      message: "Saved on this device. We'll sync when you're back online.",
    };
  }

  if (submission.answers.length === 0) {
    throw new Error("No responses to send.");
  }

  return { status: "synced", message: "Your wellbeing snapshot has been updated." };
}

/** Supportive, non-clinical summary. Never a risk score. */
export function describePattern(series: WellbeingPoint[]): string {
  if (series.length < 2) return "You're just getting started — one check-in is already a good step.";
  const recent = series.slice(-3).reduce((a, p) => a + p.balance, 0) / 3;
  const earlier = series.slice(0, -3);
  const base = earlier.length
    ? earlier.reduce((a, p) => a + p.balance, 0) / earlier.length
    : recent;

  if (recent < base - 4) {
    return "Your recent check-ins show some changes worth paying attention to.";
  }
  if (recent > base + 4) {
    return "Your recent check-ins look a little steadier than before.";
  }
  return "Your recent check-ins look fairly consistent week to week.";
}

export function describePatternKey(series: WellbeingPoint[]): string {
  if (series.length < 2) return "wellbeing.pattern.consistent";
  const recent = series.slice(-3).reduce((a, p) => a + p.balance, 0) / 3;
  const earlier = series.slice(0, -3);
  const base = earlier.length
    ? earlier.reduce((a, p) => a + p.balance, 0) / earlier.length
    : recent;

  if (recent < base - 4) return "wellbeing.pattern.changes";
  if (recent > base + 4) return "wellbeing.pattern.steadier";
  return "wellbeing.pattern.consistent";
}
