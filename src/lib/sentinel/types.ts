export type LikertValue = 0 | 1 | 2 | 3 | 4;

export interface LikertOption {
  value: LikertValue;
  label: string;
}

export interface AssessmentQuestion {
  id: string;
  prompt: string;
  helper?: string;
}

export interface CheckInAnswer {
  questionId: string;
  value: LikertValue;
}

export interface CheckInSubmission {
  answers: CheckInAnswer[];
  reflection?: string | undefined;
  voiceNoteAttached?: boolean;
  submittedAt: string;
}

export type SubmissionState = "idle" | "submitting" | "queued" | "synced" | "error";

export interface WellbeingPoint {
  /** Short label, e.g. "W1" or "Mon" */
  label: string;
  /** Self-reported balance indicator, 0-100. Higher is steadier. */
  balance: number;
  /** Reflections written that week */
  reflections: number;
  checkedIn: boolean;
}

export interface AccessEvent {
  id: string;
  title: string;
  actor: string;
  when: string;
  scope: string;
}

export interface PrivacyPreferences {
  selfAssessment: boolean;
  voiceNotes: boolean;
  journal: boolean;
  transparencyAlerts: boolean;
}
