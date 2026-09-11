import type { RiskBand } from "@/lib/welfare";

// Shared pieces for the Welfare Console.

const BAND_LABEL: Record<RiskBand, string> = {
  LOW: "Low",
  MODERATE: "Moderate",
  ELEVATED: "Elevated",
  PRIORITY_REVIEW: "Priority review",
};

const BAND_STYLE: Record<RiskBand, string> = {
  LOW: "bg-band-low-soft text-band-low",
  MODERATE: "bg-band-moderate-soft text-band-moderate",
  ELEVATED: "bg-band-elevated-soft text-band-elevated",
  PRIORITY_REVIEW: "bg-band-priority-soft text-band-priority",
};

/**
 * A band, always with its word.
 *
 * Never colour alone. An officer with a red-green deficiency scanning a queue
 * of coloured dots is reading noise, and the one screen where severity must be
 * unambiguous is the one that decides who gets called today.
 */
export function BandChip({ band, size = "md" }: { band: RiskBand; size?: "sm" | "md" }) {
  return (
    <span
      className={`meta inline-flex shrink-0 items-center rounded-sm ${BAND_STYLE[band]} ${
        size === "sm" ? "px-2 py-1" : "px-2.5 py-1.5"
      }`}
    >
      {BAND_LABEL[band]}
    </span>
  );
}

export function bandLabel(band: RiskBand): string {
  return BAND_LABEL[band];
}

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`border-line bg-surface rounded-xl border p-5 ${className}`}
    >
      {children}
    </section>
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="meta text-ink-3">{children}</p>;
}

/**
 * A date rendered identically on the server and the client.
 *
 * toLocaleString() uses the runtime's timezone, so the server string and the
 * hydrated client string differ whenever the two disagree — a hydration
 * mismatch that React papers over by re-rendering, leaving a timestamp that
 * changes after load. Fixed to UTC, and labelled as UTC so nobody reads a
 * shift time wrong.
 */
export function Stamp({ at }: { at: Date }) {
  const iso = new Date(at).toISOString();
  return (
    <time dateTime={iso} className="num">
      {iso.slice(0, 16).replace("T", " ")} UTC
    </time>
  );
}

/** Whole hours since `at`, for "waiting 19 h" in the queue. */
export function hoursSince(at: Date): number {
  return Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 3_600_000));
}
