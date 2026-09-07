"""Central configuration for the SENTINEL ML service.

Single source of truth for:
  * environment-driven settings (pydantic-settings, no hardcoded secrets)
  * risk-band thresholds (spec 7.4 — defined ONCE here, never duplicated)
  * the required clinical-claims disclaimer (spec 10)
"""

from __future__ import annotations

from enum import StrEnum

from pydantic_settings import BaseSettings, SettingsConfigDict


class RiskBand(StrEnum):
    """Probabilistic risk bands. Never a raw binary label (spec 0.3)."""

    LOW = "LOW"
    MODERATE = "MODERATE"
    ELEVATED = "ELEVATED"
    PRIORITY_REVIEW = "PRIORITY_REVIEW"


# Spec 7.4 — inclusive lower/upper bounds on the 0-100 SENTINEL score.
# Defined once. All models, the fusion layer and the escalation engine read
# these; nothing may redefine them.
BAND_THRESHOLDS: tuple[tuple[RiskBand, float, float], ...] = (
    (RiskBand.LOW, 0.0, 25.0),
    (RiskBand.MODERATE, 26.0, 55.0),
    (RiskBand.ELEVATED, 56.0, 80.0),
    (RiskBand.PRIORITY_REVIEW, 81.0, 100.0),
)

# Ordinal rank, used by the self-report override to raise a band by one tier.
BAND_ORDER: tuple[RiskBand, ...] = tuple(band for band, _, _ in BAND_THRESHOLDS)

# Same order as plain strings, for model class labels and artifact metadata.
BANDS_ORDERED: tuple[str, ...] = tuple(band.value for band in BAND_ORDER)

# Midpoint of each band on the 0-100 scale. Used to collapse a probability
# distribution over the four ordinal bands into one severity score, which keeps
# the ordering information that "probability of the top class" would discard.
BAND_MIDPOINTS: dict[str, float] = {
    band.value: (low + high) / 2.0 for band, low, high in BAND_THRESHOLDS
}

# Spec 10 — required on every fusion response, verbatim.
DISCLAIMER = (
    "Surfaces elevated welfare-risk indicators for human review. "
    "Not a clinical diagnosis."
)


# Expected severity regresses toward the middle, so few people cross 81 on it
# alone. Without this, only 33% of true PRIORITY_REVIEW cases raised an alert;
# at 0.30 that becomes 64%, for roughly 61 more alerts per 3000 people.
TOP_BAND_TRIGGER_TAU = 0.30


def apply_top_band_trigger(severity_0_1: float, p_priority: float) -> tuple[float, bool]:
    """Lift a score into PRIORITY_REVIEW when the model is confident enough.

    Returns (possibly lifted score, whether the trigger fired). Lifting the
    SCORE rather than overriding the band keeps score and band consistent —
    the same pattern the self-report override uses in the fusion layer.
    """
    if p_priority >= TOP_BAND_TRIGGER_TAU:
        floor = BAND_THRESHOLDS[-1][1] / 100.0  # PRIORITY_REVIEW lower bound
        if severity_0_1 < floor:
            return floor, True
    return severity_0_1, False


def band_for_score(score_0_100: float) -> RiskBand:
    """Map a 0-100 SENTINEL score onto its band using the shared thresholds."""
    if score_0_100 < 0 or score_0_100 > 100:
        raise ValueError(f"score must be within 0-100, got {score_0_100}")
    for band, low, high in BAND_THRESHOLDS:
        if low <= score_0_100 <= high:
            return band
    # Covers the fractional gaps between band boundaries (e.g. 25.4): fall back
    # to the band whose lower bound is the greatest one not above the score.
    return max(
        (b for b, low, _ in BAND_THRESHOLDS if score_0_100 >= low),
        key=lambda b: BAND_ORDER.index(b),
    )


class Settings(BaseSettings):
    """Environment configuration. Secrets come from env only."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    service_name: str = "sentinel-ml"
    database_url: str = "postgresql://sentinel:sentinel@localhost:5432/sentinel"
    redis_url: str = "redis://localhost:6379"

    # Spec 9.1 — k-anonymity threshold for every cohort/aggregate query.
    k_anonymity_threshold: int = 10

    # Spec 7.5 — default fusion weights, renormalized over available signals.
    fusion_weight_a: float = 0.5
    fusion_weight_b: float = 0.3
    fusion_weight_c: float = 0.2

    artifacts_dir: str = "artifacts"


settings = Settings()
