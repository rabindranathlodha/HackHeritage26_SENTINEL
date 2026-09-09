// "Privacy is drawn, not disclaimed."
//
// The design puts this chip on every surface where a person puts words down,
// rather than stating the promise once on a page nobody re-reads. It is the
// same shape in both languages and both themes, so it becomes a mark the
// person recognises rather than a sentence they have to parse again.
export function PrivacyChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="border-ember text-ember-ink meta inline-flex items-center gap-2 rounded-full border px-3.5 py-2">
      <span aria-hidden className="bg-ember size-[7px] shrink-0 rounded-full" />
      {children}
    </span>
  );
}
