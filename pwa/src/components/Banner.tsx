// The two banner tones the design allows, and no third one.
//
// "quiet" is for a state the person did not choose and need not act on —
// offline, most of all. "ember" is for something the app is doing on their
// behalf right now. Neither is an error style, because none of the states this
// app can be in are the person's fault, and there is deliberately no red
// variant here for someone to reach for later.
type Tone = "quiet" | "ember";

export function Banner({
  tone = "quiet",
  busy = false,
  children,
}: {
  tone?: Tone;
  /** Renders the marker as the slow sync rotation rather than a still dot. */
  busy?: boolean;
  children: React.ReactNode;
}) {
  const ember = tone === "ember";

  return (
    <div
      className={`flex items-center gap-3 rounded-md px-4 py-3.5 text-[15px] ${
        ember ? "bg-ember-soft text-ember-ink" : "bg-sunk text-ink-2"
      }`}
    >
      {busy ? (
        <span
          aria-hidden
          // Border-top transparent is what makes a ring read as rotating. At
          // 2.4s it is a slow sweep rather than a spinner burst.
          className={`spin-soft size-3.5 shrink-0 rounded-full border-2 border-t-transparent ${
            ember ? "border-ember" : "border-ink-3"
          }`}
        />
      ) : (
        <span
          aria-hidden
          className={`size-2 shrink-0 rounded-full ${ember ? "bg-ember" : "bg-ink-3"}`}
        />
      )}
      <span>{children}</span>
    </div>
  );
}
