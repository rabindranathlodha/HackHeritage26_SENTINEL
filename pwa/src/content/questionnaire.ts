import type { Locale } from "@/i18n/locale";

// The weekly wellness check (PWA spec 4.3).
//
// These are PHQ-9/GAD-7 domains reworded for a non-clinical, uniformed-services
// context. The underlying construct is kept; the clinical register is not. The
// person is asked how a week on duty has gone, not screened for a condition.
//
// TWO DELIBERATE OMISSIONS, both worth stating plainly:
//
//   1. PHQ-9's ninth item asks about thoughts of self-harm. It is not here.
//      Asking that question creates an immediate duty of care, and this system
//      by design never auto-contacts anyone (backend spec principle 6). Asking
//      and then doing nothing in the moment would be worse than not asking. A
//      crisis pathway is a human service, not a form field.
//
//   2. No item asks about anything that would identify a person, an incident,
//      a location or another individual. The check is about how you are, not
//      about what happened or who was involved.
//
// Wording rule (spec 9): never "depressed", "anxious", "disorder", "symptom".
// A copy test enforces this over both languages so a translation cannot
// reintroduce what the English avoids.

export type QuestionnaireItem = {
  /** Stable key. The order of `ITEMS` is the order of `responses[]` sent to the
   *  app tier, so inserting an item mid-list changes the contract. Append. */
  id: string;
  /** The behavioural domain, for our own review. Never shown to the person. */
  domain:
    | "rest"
    | "energy"
    | "engagement"
    | "steadiness"
    | "settledness"
    | "tension"
    | "attention"
    | "appetite"
    | "connection";
  text: Record<Locale, string>;
  /** True when a high answer is a good sign, so scoring can align direction. */
  positive: boolean;
};

export const SCALE_MIN = 1;
export const SCALE_MAX = 5;

export const ITEMS: readonly QuestionnaireItem[] = [
  {
    id: "rest",
    domain: "rest",
    positive: true,
    text: {
      en: "How rested have you felt on duty this week?",
      hi: "इस हफ़्ते ड्यूटी पर आपने ख़ुद को कितना आराम महसूस किया?",
    },
  },
  {
    id: "energy",
    domain: "energy",
    positive: true,
    text: {
      en: "How much energy have you had for what the week asked of you?",
      hi: "इस हफ़्ते जो करना था, उसके लिए आपमें कितनी ऊर्जा रही?",
    },
  },
  {
    id: "engagement",
    domain: "engagement",
    positive: true,
    text: {
      en: "Off duty, how much have you felt like joining in with things?",
      hi: "ड्यूटी के बाद, चीज़ों में शामिल होने का आपका कितना मन हुआ?",
    },
  },
  {
    id: "steadiness",
    domain: "steadiness",
    positive: true,
    text: {
      en: "How steady have you felt in yourself this week?",
      hi: "इस हफ़्ते आपने अपने भीतर ख़ुद को कितना संभला हुआ महसूस किया?",
    },
  },
  {
    id: "settledness",
    domain: "settledness",
    positive: false,
    text: {
      en: "How often has your mind been hard to settle?",
      hi: "कितनी बार आपका मन शांत करना मुश्किल रहा?",
    },
  },
  {
    id: "tension",
    domain: "tension",
    positive: false,
    text: {
      en: "How often have you felt on edge or short-tempered?",
      hi: "कितनी बार आपने ख़ुद को तना हुआ या चिड़चिड़ा महसूस किया?",
    },
  },
  {
    id: "attention",
    domain: "attention",
    positive: true,
    text: {
      en: "How easy has it been to keep your attention on a task?",
      hi: "किसी काम पर ध्यान बनाए रखना आपके लिए कितना आसान रहा?",
    },
  },
  {
    id: "appetite",
    domain: "appetite",
    positive: true,
    text: {
      en: "How has your appetite been this week?",
      hi: "इस हफ़्ते आपकी भूख कैसी रही?",
    },
  },
  {
    id: "connection",
    domain: "connection",
    positive: true,
    text: {
      en: "How connected have you felt to the people around you?",
      hi: "अपने आसपास के लोगों से आपने ख़ुद को कितना जुड़ा हुआ महसूस किया?",
    },
  },
];

export const ITEM_COUNT = ITEMS.length;
