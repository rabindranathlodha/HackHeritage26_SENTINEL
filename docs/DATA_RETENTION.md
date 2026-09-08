# Retention and withdrawal of consent

> **Status: real-deployment requirement, not a description of what ships today.**
> `<<requires privacy counsel review>>`
>
> Mirrors §9.4 of `SENTINEL_BUILD_SPEC.md`. Nothing in the current codebase
> retains real physiological data — see [Scope](#scope-in-this-build) — so this
> is a policy decision recorded in advance, deliberately, rather than a
> behaviour to be inferred from the code.

## The principle

**Reversible consent means reversible data, not just a reversible switch.**
Turning the wellness signal off should undo the collection, not merely pause it.

"We stopped using it but kept it" reads like a neutral middle ground. It is not.
It is holding data there is no longer a lawful basis to hold.

## Why the default matters more here than elsewhere

Under India's **DPDP Act 2023**, retention is tied to the purpose the data was
consented for. When a Data Principal withdraws consent, the basis for continued
retention largely evaporates, and §8 carries an explicit erasure duty, subject
to legal-retention exceptions.

The product stakes run the same direction as the legal ones. Physiological
history — HRV, resting heart rate, sleep — belonging to a CAPF constable,
retained after they revoked consent, inside a system connected however
indirectly to their chain of command, is *precisely* the surveillance fear this
system exists to defuse. If it becomes known that turning the signal off does
not delete anything, adoption collapses in the constabulary, who are both the
majority of the force and the group least inclined to trust a system tied to
their command. Retention is not a back-office detail here; it is load-bearing
for the promise the app makes on its first screen.

## The policy

### 1. Erase the raw data, on a clock

On withdrawal, the raw and identifiable physiological rows for that person are
**erased within 72 hours**. Not de-referenced, not marked inactive, not left
behind a `consent = false` flag. Erased.

Model C stops contributing to any future score **immediately**, which the
current pipeline already guarantees structurally: consent is read from the
stored flag at scoring time and never from a request body, so a withdrawal takes
effect on the next assessment without any client having to cooperate.

### 2. Derived values are a different question, and are treated as one

A `physioContribution` already fused into a past `Score` is no longer
physiological data. It is one component of a welfare signal that a human officer
may already have acted on.

The rule, stated plainly rather than fudged:

- **Keep the `Score`.** It is welfare-audit history — a record of what a human
  was shown and when — and that arguably rests on a separate legal basis from
  the biometric collection.
- **Sever it from any raw physiological source.** After erasure the derived
  number has no upstream record to be traced back to.
- **Model C never contributes again** unless consent is given afresh.

This is a compromise and is documented as one. A derived value cannot be cleanly
unwound from a fused score, and pretending otherwise would be a worse answer
than naming the limit.

### 3. Carve-outs are narrow, named, logged and time-boxed

The single exception contemplated: where an **active alert is under review**, a
brief live-safety retention may be justifiable. If used it must be

- a **named** exception, recorded as such,
- **logged** in the audit trail,
- **time-boxed** with an explicit expiry,

and never the default path. An exception that is silent, indefinite, or
automatic is not an exception; it is the policy.

### 4. Prove the deletion

The erasure itself is written to the audit trail: that it happened, when, and
that it was on the person's own request. Being able to *demonstrate* deletion is
its own expectation under the Act, and an erasure nobody can evidence is
indistinguishable from one that never occurred.

## The tension this does not resolve

A real deployment inside a uniformed force will collide with **service-record
retention rules**, and possibly with **national-security carve-outs**, either of
which may compel retention in ways that override the default above. That
conflict — personnel-welfare data protection against mandated record-keeping —
is real, and it is not resolvable by an engineering decision.

**This is not legal advice.** The DPDP Act's implementing Rules are still
settling. A real deployment needs actual privacy counsel and the force's own
data-governance office to sign this off. What is recorded here is the default
this system should take *absent* such a ruling, and the reasoning behind it.

## Scope in this build

Nothing changes in the code as a result of this document, and that is not an
oversight:

- `_physio_signals` is **synthetic, training-only**, and deliberately absent from
  the Prisma schema. There is no generated client method for it, and the ML
  suite asserts that all four application roles are denied access to it.
- In production the raw physiological signal **never lands server-side at all**
  (backend spec §5.3 / §7.3). Only the derived `physioContribution` is persisted.
- So there is currently no raw physiological history to erase. The erasure duty
  attaches to a deployment that collects real wearable data, which this one does
  not.

**A consequence for the Personnel Companion:** the transparency screen must not
promise erasure that the running system does not perform. It should describe
what the app actually does today — the wellness signal is off unless turned on,
it can be turned off at any time, and turning it off stops it being used — and
must not claim deletion of history until a deployment implements the policy
above.

## What was rejected

The prior default, which this replaces: *withdrawal stops future use, prior rows
stay.* It survived only because it is what falls out of flipping a boolean, and
it was recorded at step 3.8 as an open question rather than a decision. It is
the comfortable engineering answer and very likely the non-compliant one.
