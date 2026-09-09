// The one ambient element in the product, and it is on Home only.
//
// The design's own words: "below the fold of attention". A 12-second breathe on
// a single radial glow, which is slow enough that you notice it has moved
// rather than watching it move.
//
// Three deliberate constraints:
//  - It is CSS, not Framer Motion. Nothing about it depends on React state, so
//    it should not cost a hydration boundary or main-thread work on a phone
//    that is also running an on-device model.
//  - It animates transform and opacity only, so it stays on the compositor and
//    never triggers layout — which is what keeps it inside the performance
//    budget rather than eating it.
//  - It is aria-hidden. It carries no state and means nothing; describing it
//    would only put noise in front of a screen reader user.
//
// The global prefers-reduced-motion rule in globals.css stops it dead.
export function Ambient() {
  return (
    <div
      aria-hidden
      className="ambient-glow pointer-events-none absolute -top-24 -right-20 size-70 rounded-full"
    />
  );
}
