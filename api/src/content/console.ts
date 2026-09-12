// Every word the Welfare Console puts on screen.
//
// Deliberately a typed dictionary rather than next-intl. The Companion uses
// next-intl because it needs plurals, per-locale routing and client components
// that translate themselves; the console is server-rendered, has no plurals,
// and has one cookie to read. Adding a framework here would be a dependency,
// a config change and a middleware interaction — three new failure modes — to
// replace twelve lines.
//
// What matters is the property, not the library: no user-facing string lives in
// a component, and every string exists in both languages. `tests/console-copy`
// enforces both, and would fail on a key present in one language only.
//
// This module is deliberately free of Next imports. Reading the cookie lives in
// lib/consoleLocale.ts instead, so the dictionary can be loaded by a test under
// plain Node — copy that only a running server can inspect is copy nothing
// checks.
//
// The console shares the Companion's clinical-claims boundary, with one
// deliberate difference: an officer MAY see the words "band" and "indicator",
// because triage is their job and hiding the vocabulary from the person doing
// the work helps nobody. What stays forbidden here is diagnostic language —
// this surfaces welfare-risk indicators for human review, and never diagnoses.

export const CONSOLE_LOCALES = ["en", "hi"] as const;
export type ConsoleLocale = (typeof CONSOLE_LOCALES)[number];

export const CONSOLE_LOCALE_COOKIE = "sentinel-console-locale";
export const DEFAULT_CONSOLE_LOCALE: ConsoleLocale = "en";

export const CONSOLE_LOCALE_LABELS: Record<ConsoleLocale, string> = {
  en: "English",
  hi: "हिन्दी",
};

const en = {
  // Shell
  appName: "SENTINEL Console",
  navQueue: "Queue",
  navUnits: "Units",
  signOut: "Sign out",
  language: "Language",

  // Sign-in
  loginTitle: "Welfare Console",
  loginIntro:
    "For assigned welfare officers. Every individual record you open is recorded, with your name and the time.",
  loginId: "Officer ID",
  loginPassword: "Password",
  loginSubmit: "Sign in",
  loginFailed: "That ID and password did not match.",
  loginDisclaimer:
    "This console shows indicators for human review. It is not a clinical assessment and it does not decide anything.",

  // Root
  rootTitle: "App tier",
  rootBody:
    "Route handlers for the Personnel Companion, and the console assigned welfare officers sign in to.",
  rootCta: "Welfare Console",

  // Queue
  queueEyebrow: "Assigned to you",
  queueTitle: "Review queue",
  queueWaitingNone: "Nothing is waiting for review.",
  queueWaitingOne: "1 person is waiting for review. Opening a record is logged.",
  queueWaitingMany: "{count} people are waiting for review. Opening a record is logged.",
  queueEmpty:
    "No active alerts. People you are assigned to appear here only when an alert is raised, and disappear once you mark it actioned — this console cannot browse personnel who are doing fine.",
  colPerson: "Person",
  colBand: "Band",
  colRaised: "Raised",
  colWaiting: "Waiting",
  colContact: "Contact",
  colStatus: "Status",
  colOpen: "Open",
  openRecord: "Open record",
  statusPending: "Pending review",
  statusReviewed: "Reviewed",
  contactAgreed: "Agreed",
  contactHold: "Do not approach",
  contactJudgement: "Not agreed · your call",
  hours: "{count} h",

  // Access log
  accessEyebrow: "Your access log",
  accessBody:
    "What you have opened, as the people you support are told it is recorded. You cannot edit or delete this, and neither can anyone else.",
  accessEmpty: "Nothing recorded yet.",

  // Individual record
  recordEyebrow: "Individual record",
  recordLogged:
    "Opening this record has been recorded against your ID, with the time. The person is told that this log exists and what it contains.",
  recordNoIndicator: "No indicator has been computed for this person yet.",
  indicatorEyebrow: "Indicator",
  indicatorRange: "Plausible range {low}–{high}. Computed {at}.",
  overrideFired:
    "This band was raised by what the person said about themselves, over what the model inferred. Self-report wins here by design.",
  sourcesEyebrow: "Where the indicator came from",
  sourceQuestionnaire: "Questionnaire",
  sourceWritten: "Written",
  sourcePhysiological: "Physiological",
  notShared: "not shared",
  movedEyebrow: "What moved it",
  movedEmpty: "No breakdown recorded.",
  movedNote:
    "Categories only — never the words someone wrote. Written reflections are read on the person's own phone and only a single number ever leaves it.",
  trendEyebrow: "Recent trend",
  trendTooShort: "One measurement so far — not enough for a trend.",
  trendCaption: "{count} measurements · oldest left",
  trendAlt:
    "Indicator over the last {count} measurements, ending at {last} out of 100.",
  checkInsEyebrow: "Check-ins on file",
  checkInsEmpty: "None recorded.",
  checkInsNote:
    "Dates and language only. The answers themselves are encrypted at rest and are not readable from this console.",
  decisionEyebrow: "Your decision",
  decisionNoAlert: "No open alert for this person.",
  decisionNothingSent:
    "Nothing has been sent to this person and nothing will be. This console does not message anyone, and it never notifies a commander. What happens next is a conversation you choose to have.",
  outreachAgreed: "This person has said a welfare officer may contact them.",
  outreachHoldLead: "This person has asked not to be approached.",
  outreachHoldBody:
    "Do not reach out. They can still come to you, and the record of this alert stays with you either way. Their preference is about contact, not about whether anything is noticed.",
  outreachJudgementLead:
    "This person has not agreed to be contacted, and this alert is shown to you anyway.",
  outreachJudgementBody:
    "At this severity the preference does not withhold the alert, because a setting about ordinary contact is not a waiver of a serious one. The judgement is yours. Whatever you decide, note that they had asked not to be approached.",
  markReviewed: "Mark reviewed",
  markActioned: "I have made contact",
  actionedNote:
    "Marking it actioned closes the alert and removes your access to this record until a new one is raised.",
  recordDisclaimer:
    "This is a screening indicator for human review, not a diagnosis and not a measure of fitness or performance. It does not belong in an appraisal and it is not visible to the chain of command.",

  // Refusal
  refusedEyebrow: "Access refused",
  refusedTitle: "You cannot open this record.",
  refusedBody:
    "A welfare officer may open an individual record only where the person is assigned to them and an alert is currently active. That rule is enforced by the database, not by this screen, so it applies to every route into the data.",
  refusedNote:
    "The attempt itself was not recorded as a view, because no view happened.",
  backToQueue: "Back to the queue",

  // Cohort
  cohortEyebrow: "Aggregate view",
  cohortTitle: "Units",
  cohortIntro:
    "Group patterns only. No individual is identified here, and there is no control on this page that opens one — a commander cannot reach a person's record through this console at all.",
  cohortThreshold:
    "Any unit with fewer than {k} people is withheld entirely rather than rounded or blurred. With small numbers, a percentage is a name.",
  cohortNone: "No units have any scored members yet.",
  cohortWithheld: "Withheld",
  cohortWithheldBody:
    "This unit has fewer than {k} scored members, so nothing about it is shown — not the size, not the spread, not an average. That the unit exists is all this row reveals.",
  cohortPeople: "{count} people",
  cohortMean: "mean {value}",
  cohortSuppressedNote:
    "{suppressed} of {total} units are withheld at the current threshold of {k}. Lowering it is a policy decision with a privacy cost, not a display setting.",

  // Bands
  bandLow: "Low",
  bandModerate: "Moderate",
  bandElevated: "Elevated",
  bandPriority: "Priority review",
};

export type ConsoleKey = keyof typeof en;

const hi: Record<ConsoleKey, string> = {
  appName: "सेंटिनल कंसोल",
  navQueue: "सूची",
  navUnits: "यूनिट",
  signOut: "साइन आउट",
  language: "भाषा",

  loginTitle: "कल्याण कंसोल",
  loginIntro:
    "नियुक्त कल्याण अधिकारियों के लिए। आप जो भी व्यक्तिगत रिकॉर्ड खोलते हैं, वह आपके नाम और समय के साथ दर्ज होता है।",
  loginId: "अधिकारी आईडी",
  loginPassword: "पासवर्ड",
  loginSubmit: "साइन इन करें",
  loginFailed: "यह आईडी और पासवर्ड मेल नहीं खाए।",
  loginDisclaimer:
    "यह कंसोल इंसानी समीक्षा के लिए संकेत दिखाता है। यह कोई चिकित्सीय आकलन नहीं है और यह कुछ तय नहीं करता।",

  rootTitle: "ऐप टियर",
  rootBody:
    "पर्सनेल कम्पैनियन के लिए रूट हैंडलर, और वह कंसोल जिसमें नियुक्त कल्याण अधिकारी साइन इन करते हैं।",
  rootCta: "कल्याण कंसोल",

  queueEyebrow: "आपको सौंपे गए",
  queueTitle: "समीक्षा सूची",
  queueWaitingNone: "समीक्षा के लिए कुछ भी लंबित नहीं है।",
  queueWaitingOne: "1 व्यक्ति समीक्षा की प्रतीक्षा में है। रिकॉर्ड खोलना दर्ज होता है।",
  queueWaitingMany: "{count} लोग समीक्षा की प्रतीक्षा में हैं। रिकॉर्ड खोलना दर्ज होता है।",
  queueEmpty:
    "कोई सक्रिय अलर्ट नहीं। आपको सौंपे गए लोग यहाँ तभी दिखते हैं जब कोई अलर्ट उठता है, और कार्रवाई दर्ज करते ही हट जाते हैं — यह कंसोल उन लोगों को नहीं देख सकता जो ठीक हैं।",
  colPerson: "व्यक्ति",
  colBand: "श्रेणी",
  colRaised: "कब उठा",
  colWaiting: "प्रतीक्षा",
  colContact: "संपर्क",
  colStatus: "स्थिति",
  colOpen: "खोलें",
  openRecord: "रिकॉर्ड खोलें",
  statusPending: "समीक्षा लंबित",
  statusReviewed: "समीक्षा हो गई",
  contactAgreed: "सहमति है",
  contactHold: "संपर्क न करें",
  contactJudgement: "सहमति नहीं · आपका निर्णय",
  hours: "{count} घं",

  accessEyebrow: "आपका पहुँच रिकॉर्ड",
  accessBody:
    "आपने क्या खोला, वैसे ही जैसे जिन लोगों का आप साथ देते हैं उन्हें बताया जाता है कि यह दर्ज होता है। न आप इसे बदल सकते हैं, न कोई और।",
  accessEmpty: "अभी कुछ दर्ज नहीं है।",

  recordEyebrow: "व्यक्तिगत रिकॉर्ड",
  recordLogged:
    "इस रिकॉर्ड को खोलना आपकी आईडी और समय के साथ दर्ज हो चुका है। उस व्यक्ति को बताया जाता है कि यह रिकॉर्ड मौजूद है और इसमें क्या होता है।",
  recordNoIndicator: "इस व्यक्ति के लिए अभी कोई संकेत नहीं निकाला गया है।",
  indicatorEyebrow: "संकेत",
  indicatorRange: "संभावित दायरा {low}–{high}। {at} पर निकाला गया।",
  overrideFired:
    "यह श्रेणी इसलिए ऊपर गई क्योंकि व्यक्ति ने अपने बारे में जो कहा, उसे मॉडल के अनुमान से ऊपर रखा गया। यहाँ व्यक्ति की अपनी बात भारी पड़ती है — यह जानबूझकर है।",
  sourcesEyebrow: "संकेत कहाँ से आया",
  sourceQuestionnaire: "प्रश्नावली",
  sourceWritten: "लिखा हुआ",
  sourcePhysiological: "शारीरिक",
  notShared: "साझा नहीं",
  movedEyebrow: "किस बात ने असर डाला",
  movedEmpty: "कोई विवरण दर्ज नहीं।",
  movedNote:
    "सिर्फ़ श्रेणियाँ — कभी वे शब्द नहीं जो किसी ने लिखे। लिखी हुई बातें व्यक्ति के अपने फ़ोन पर ही पढ़ी जाती हैं और उसमें से सिर्फ़ एक संख्या बाहर जाती है।",
  trendEyebrow: "हाल का रुझान",
  trendTooShort: "अब तक एक ही माप — रुझान के लिए पर्याप्त नहीं।",
  trendCaption: "{count} माप · सबसे पुराना बाईं ओर",
  trendAlt: "पिछले {count} मापों का संकेत, अंत में 100 में से {last}।",
  checkInsEyebrow: "दर्ज बातचीत",
  checkInsEmpty: "कुछ दर्ज नहीं।",
  checkInsNote:
    "सिर्फ़ तारीख़ और भाषा। जवाब ख़ुद एन्क्रिप्टेड रहते हैं और इस कंसोल से पढ़े नहीं जा सकते।",
  decisionEyebrow: "आपका निर्णय",
  decisionNoAlert: "इस व्यक्ति के लिए कोई खुला अलर्ट नहीं।",
  decisionNothingSent:
    "इस व्यक्ति को कुछ नहीं भेजा गया है और न भेजा जाएगा। यह कंसोल किसी को संदेश नहीं करता, और कभी कमांडर को सूचित नहीं करता। आगे क्या हो, यह बातचीत आप चुनते हैं।",
  outreachAgreed: "इस व्यक्ति ने कहा है कि कल्याण अधिकारी उनसे संपर्क कर सकते हैं।",
  outreachHoldLead: "इस व्यक्ति ने कहा है कि उनसे पहले संपर्क न किया जाए।",
  outreachHoldBody:
    "संपर्क न करें। वे ख़ुद आपके पास आ सकते हैं, और इस अलर्ट का रिकॉर्ड दोनों हालात में आपके पास रहता है। उनकी पसंद संपर्क के बारे में है, इस बारे में नहीं कि कुछ देखा जाता है या नहीं।",
  outreachJudgementLead:
    "इस व्यक्ति ने संपर्क के लिए सहमति नहीं दी है, फिर भी यह अलर्ट आपको दिखाया जा रहा है।",
  outreachJudgementBody:
    "इस गंभीरता पर उनकी पसंद अलर्ट को रोकती नहीं, क्योंकि सामान्य संपर्क के बारे में दी गई एक सेटिंग किसी गंभीर स्थिति की छूट नहीं है। निर्णय आपका है। आप जो भी तय करें, यह ध्यान रखें कि उन्होंने संपर्क न करने को कहा था।",
  markReviewed: "समीक्षा दर्ज करें",
  markActioned: "मैंने संपर्क कर लिया",
  actionedNote:
    "कार्रवाई दर्ज करने पर अलर्ट बंद हो जाता है और नया अलर्ट उठने तक इस रिकॉर्ड तक आपकी पहुँच हट जाती है।",
  recordDisclaimer:
    "यह इंसानी समीक्षा के लिए एक शुरुआती संकेत है, कोई निदान नहीं और न ही योग्यता या प्रदर्शन का माप। इसका मूल्यांकन में कोई स्थान नहीं है और यह कमान श्रृंखला को नहीं दिखता।",

  refusedEyebrow: "पहुँच अस्वीकृत",
  refusedTitle: "आप यह रिकॉर्ड नहीं खोल सकते।",
  refusedBody:
    "कल्याण अधिकारी किसी व्यक्ति का रिकॉर्ड तभी खोल सकते हैं जब वह व्यक्ति उन्हें सौंपा गया हो और कोई अलर्ट सक्रिय हो। यह नियम इस स्क्रीन से नहीं, डेटाबेस से लागू होता है, इसलिए यह डेटा तक पहुँचने के हर रास्ते पर लागू है।",
  refusedNote: "इस कोशिश को देखे जाने के रूप में दर्ज नहीं किया गया, क्योंकि कुछ देखा ही नहीं गया।",
  backToQueue: "सूची पर वापस",

  cohortEyebrow: "सामूहिक दृश्य",
  cohortTitle: "यूनिट",
  cohortIntro:
    "सिर्फ़ समूह के रुझान। यहाँ किसी एक व्यक्ति की पहचान नहीं होती, और इस पन्ने पर ऐसा कोई नियंत्रण नहीं है जो किसी एक को खोले — कमांडर इस कंसोल से किसी व्यक्ति के रिकॉर्ड तक पहुँच ही नहीं सकते।",
  cohortThreshold:
    "{k} से कम लोगों वाली किसी भी यूनिट को गोल करके या धुँधला करके नहीं, बल्कि पूरी तरह रोक दिया जाता है। छोटी संख्याओं में प्रतिशत ही नाम बन जाता है।",
  cohortNone: "अभी किसी यूनिट में कोई मापा गया सदस्य नहीं है।",
  cohortWithheld: "रोका गया",
  cohortWithheldBody:
    "इस यूनिट में {k} से कम मापे गए सदस्य हैं, इसलिए इसके बारे में कुछ नहीं दिखाया जाता — न आकार, न फैलाव, न औसत। यह पंक्ति सिर्फ़ इतना बताती है कि यह यूनिट मौजूद है।",
  cohortPeople: "{count} लोग",
  cohortMean: "औसत {value}",
  cohortSuppressedNote:
    "{total} में से {suppressed} यूनिट {k} की मौजूदा सीमा पर रोकी गई हैं। इसे घटाना निजता की क़ीमत वाला नीतिगत निर्णय है, कोई प्रदर्शन सेटिंग नहीं।",

  bandLow: "कम",
  bandModerate: "मध्यम",
  bandElevated: "बढ़ा हुआ",
  bandPriority: "प्राथमिक समीक्षा",
};

export const CONSOLE_MESSAGES: Record<ConsoleLocale, Record<ConsoleKey, string>> = {
  en,
  hi,
};

export function isConsoleLocale(value: unknown): value is ConsoleLocale {
  return typeof value === "string" && (CONSOLE_LOCALES as readonly string[]).includes(value);
}

export type Translate = (key: ConsoleKey, values?: Record<string, string | number>) => string;

/**
 * A lookup with `{name}` substitution and nothing else.
 *
 * No plurals, no dates, no nesting: the console has one plural in it
 * (queueWaitingOne / queueWaitingMany) and it is handled by picking the key.
 * A formatter richer than the copy needs is a place for the copy to grow
 * complicated later.
 */
export function translator(locale: ConsoleLocale): Translate {
  const table = CONSOLE_MESSAGES[locale];
  return (key, values) => {
    // Falls back to English rather than rendering the key. An officer seeing
    // "cohortWithheldBody" learns nothing; seeing the English sentence learns
    // everything except which language it is in.
    const text = table[key] ?? CONSOLE_MESSAGES.en[key] ?? "";
    if (!values) return text;
    return text.replace(/\{(\w+)\}/g, (match, name) =>
      name in values ? String(values[name]) : match,
    );
  };
}
