"""Clinical-claims guard (spec Section 10, principle 4)."""

from __future__ import annotations

from typing import Any

from app.config import DISCLAIMER

# Case-insensitive substrings that may never appear in an outgoing response —
# not in a value, not in a field name (spec 10).
FORBIDDEN_TERMS: tuple[str, ...] = (
    "diagnose",
    "diagnosis",
    "diagnostic",
    "depression detected",
    "predicts suicide",
    "suicidal",
    "suicide",
    "mental illness",
    "disorder",
    "patient",
    "psychiatric",
    "clinically",
)

# The one sanctioned use of otherwise-forbidden wording: the disclaimer itself
# contains "diagnosis". It is allowed verbatim and only verbatim.
_ALLOWED_EXACT: frozenset[str] = frozenset({DISCLAIMER})

# Spec 10: the vocabulary that IS approved, for reference at call sites.
APPROVED_TERMS: tuple[str, ...] = (
    "welfare-risk indicator",
    "elevated risk band",
    "for human review",
    "welfare support",
)


class ClinicalClaimError(AssertionError):
    """Raised when an outgoing payload would overclaim."""

    def __init__(self, term: str, location: str) -> None:
        super().__init__(
            f"forbidden clinical term {term!r} at {location}; "
            "SENTINEL surfaces welfare-risk indicators for human review only"
        )
        self.term = term
        self.location = location


def _scan_string(value: str, location: str) -> None:
    if value in _ALLOWED_EXACT:
        return
    lowered = value.lower()
    for term in FORBIDDEN_TERMS:
        if term in lowered:
            raise ClinicalClaimError(term, location)


def assert_no_clinical_claims(payload: Any, location: str = "$") -> None:
    """Recursively scan a payload for clinical language.

    Field names are scanned as well as values: a key called `diagnosis_score`
    is exactly as much of a violation as the sentence would be.
    """
    if isinstance(payload, str):
        _scan_string(payload, location)
    elif isinstance(payload, dict):
        for key, value in payload.items():
            if isinstance(key, str):
                _scan_string(key, f"{location}.{key} (key)")
            assert_no_clinical_claims(value, f"{location}.{key}")
    elif isinstance(payload, (list, tuple)):
        for i, item in enumerate(payload):
            assert_no_clinical_claims(item, f"{location}[{i}]")
    # Numbers, bools and None cannot carry a claim.


def assert_disclaimer_present(payload: dict[str, Any]) -> None:
    """Every fusion response must carry the disclaimer verbatim (spec 5.4)."""
    if payload.get("disclaimer") != DISCLAIMER:
        raise ClinicalClaimError("<missing disclaimer>", "$.disclaimer")
