// The transparency screen's claims, each tied to what makes it true.
//
// This screen is the trust centrepiece, which means every sentence on it is a
// promise the system has to keep. The failure mode is not a bug — it is a
// well-meant sentence that reads beautifully and is not quite true, written
// months after the code it describes.
//
// So a claim cannot be rendered unless it appears here with a mechanism and the
// evidence that the mechanism holds. Adding a comforting line to the message
// file is not enough; a test fails until this file explains why it is true.
//
// `evidence` names a test or an enforced constraint, never "reviewed by hand".

export type Claim = {
  /** Key under `transparency` in the message files. */
  id: string;
  /** What in the system makes this true. */
  mechanism: string;
  /** Where that is proven, so the claim can be re-checked rather than trusted. */
  evidence: string;
};

export const CLAIMS: readonly Claim[] = [
  {
    id: "collectedBody",
    mechanism:
      "The journal is scored by onnxruntime-web in the browser. The submission " +
      "contract carries `nlpContribution` and has no text field at all, so raw " +
      "words cannot be sent even by mistake.",
    evidence:
      "scripts/verify-ondevice.mjs — every request body is captured and searched " +
      "for the journal text; the payload keys are asserted.",
  },
  {
    id: "collectedWearable",
    mechanism:
      "`User.biometricConsent` defaults to false, and no wearable integration " +
      "exists in this build — nothing collects physiological readings.",
    evidence:
      "Prisma schema default; scripts/verify-consent.mjs asserts no submission " +
      "carries signals, baseline or physioContribution.",
  },
  {
    id: "onDeviceBody",
    mechanism:
      "Voice is transcribed by the on-device Web Speech path with " +
      "`processLocally = true`, never the remote one, and no MediaRecorder " +
      "creates an audio copy. Kept entries live in this browser's IndexedDB.",
    evidence:
      "tests/speech.test.ts (on-device flag, and no fallback to remote); " +
      "scripts/verify-voice.mjs (no audio or words in any request).",
  },
  {
    id: "teamBody",
    mechanism:
      "A welfare officer's row policy admits an assigned person only while an " +
      "alert is active. Alerts are created PENDING_REVIEW by a database trigger " +
      "— a human decides what follows.",
    evidence:
      "ml/tests/test_privacy.py (officer sees only assigned users with an active " +
      "alert); ml/tests/test_escalation.py (the database rejects an alert that " +
      "does not start pending).",
  },
  {
    id: "teamAudit",
    mechanism:
      "Individual access goes through an audited accessor that writes an " +
      "append-only AuditLog row; access without an identity is refused rather " +
      "than recorded anonymously.",
    evidence:
      "ml/tests/test_privacy.py — individual access writes an audit row, the " +
      "trail is append-only, and unattributed access is refused.",
  },
  {
    id: "commanderBody",
    mechanism:
      "A commander has no row-level read on any welfare table. Cohort figures " +
      "come from a SECURITY DEFINER function that refuses any group below the " +
      "k-anonymity threshold, with no parameter that disables it.",
    evidence:
      "ml/tests/test_privacy.py (commander cannot select individual welfare " +
      "rows); ml/tests/test_escalation.py (sub-threshold cohorts return a " +
      "refusal, and suppression cannot be bypassed by calling the SQL directly).",
  },
  {
    id: "controlsBody",
    mechanism:
      "Consent is stored on the person's own row, updatable by them through a " +
      "column-scoped grant, and read by the scoring pipeline from that flag — " +
      "never from a request body — so withdrawal takes effect on the next " +
      "assessment without any client cooperating.",
    evidence:
      "scripts/verify-consent.mjs (persists across reload, reversible, app fully " +
      "functional with it off); ml/tests/test_privacy.py (the grant cannot be " +
      "used to change a role or anyone else's consent).",
  },
  {
    id: "controlsContact",
    mechanism:
      "There is no outbound communication machinery in the serving tree. " +
      "Escalation's only effect is a queue entry a welfare officer opens.",
    evidence:
      "ml/tests/test_escalation.py — an AST scan of the serving tree finds no " +
      "outbound-communication call, plus a test proving the scan would catch one.",
  },
];

/**
 * Lines that make no claim about how the system behaves.
 *
 * A narrow, explicit exemption rather than a general one. The guard exists so
 * nobody can add a comforting sentence about what the system does without
 * saying what makes it true — so the escape hatch is kept small, has to be
 * justified in writing, and is checked to contain no behavioural claim.
 */
export const SIGNPOSTS: readonly { id: string; why: string }[] = [
  {
    id: "questionsBody",
    why:
      "Points the person at a human to ask. Says nothing about what the system " +
      "collects, keeps, sends or shows, so there is no mechanism to cite.",
  },
];

/**
 * Words that would turn a signpost into a claim. If one of these appears in a
 * signpost, it is describing system behaviour and belongs in CLAIMS instead.
 */
export const BEHAVIOURAL_WORDS = [
  "never",
  "only",
  "stays",
  "sent",
  "stored",
  "kept",
  "deleted",
  "collected",
  "shows",
  "sees",
];

/**
 * Claims about erasing history are forbidden here until a deployment implements
 * the retention policy.
 *
 * docs/DATA_RETENTION.md sets erasure-within-72-hours as the default on
 * withdrawal, flagged for privacy-counsel review. No code implements it, because
 * this build holds no raw physiological history to erase. Saying otherwise on
 * this screen would turn the one page that must be exactly true into the place
 * the system overclaims most.
 */
export const FORBIDDEN_PROMISES = [
  "deleted from our servers",
  "we delete",
  "will be deleted",
  "erased",
  "erase your",
  "wiped",
  "removed from the server",
];
