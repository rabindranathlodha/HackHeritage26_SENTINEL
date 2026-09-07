"""Fusion layer (spec 7.5). REAL implementation, step 3.8."""

from __future__ import annotations

from app.config import (
    BAND_ORDER,
    BAND_THRESHOLDS,
    DISCLAIMER,
    RiskBand,
    band_for_score,
    settings,
)

IS_STUB = False

# Spec 7.5: a self-report above this level raises the band regardless of what
# the behavioural model saw. Defined once, here.
SELF_REPORT_OVERRIDE_THRESHOLD = 0.75

# Half-width of the confidence interval on the 0-100 scale, before disagreement
# is added. Fewer signals means more uncertainty, not less — a single signal
# has nothing to disagree with, and reporting that as perfect confidence would
# invert the meaning of the interval.
_BASE_HALF_WIDTH = {1: 12.0, 2: 9.0, 3: 6.0}
_MAX_HALF_WIDTH = 25.0

_BAND_FLOOR = {band: low for band, low, _ in BAND_THRESHOLDS}


def _next_band_up(band: RiskBand) -> RiskBand:
    index = BAND_ORDER.index(band)
    return BAND_ORDER[min(index + 1, len(BAND_ORDER) - 1)]


def fuse(
    score_a: float,
    score_b: float | None,
    score_c: float | None,
    shap_categories: dict[str, float],
) -> dict:
    """Combine the available signals into a SENTINEL score, band and confidence."""
    weights = {
        "a": settings.fusion_weight_a,
        "b": settings.fusion_weight_b,
        "c": settings.fusion_weight_c,
    }
    scores = {"a": score_a, "b": score_b, "c": score_c}
    available = {k: v for k, v in scores.items() if v is not None}

    # --- 1. Weighted base over available signals only (spec 7.5) ----------
    # Renormalising means a person who has not consented to biometrics, or has
    # not submitted a self-report, is scored on what exists rather than being
    # penalised for the gap.
    total_weight = sum(weights[k] for k in available)
    base = sum(weights[k] / total_weight * v for k, v in available.items())

    # Non-dilution floor. Averaging in a weak signal drags high-risk people
    # down: score_a 0.90 with a typical score_c 0.20 fell out of
    # PRIORITY_REVIEW, so consenting to biometrics lowered your score.
    # Corroborating signals may raise the fused score, never lower it.
    fused = max(base, score_a)
    diluted = fused > base  # recorded for the audit trail below

    sentinel_score = round(fused * 100.0, 2)
    band = band_for_score(sentinel_score)

    # Self-report override (spec 7.5). Someone who says they are struggling
    # must not be filed low-risk because their duty record looks tidy.
    override_fired = False
    if (
        score_b is not None
        and score_b > SELF_REPORT_OVERRIDE_THRESHOLD
        and BAND_ORDER.index(band) < BAND_ORDER.index(RiskBand.ELEVATED)
    ):
        band = _next_band_up(band)
        # Keep the score consistent with the band it now carries: lift it to the
        # new band's floor. Leaving the score below its own band would make the
        # two disagree, and the dashboard reads both.
        sentinel_score = max(sentinel_score, _BAND_FLOOR[band])
        override_fired = True

    # --- 4. Confidence from agreement AND signal count --------------------
    # Spread is the disagreement between the signals actually available. Wide
    # when they conflict, narrow when they corroborate — plus a floor that
    # widens as the number of signals falls.
    spread = max(available.values()) - min(available.values())
    half_width = _BASE_HALF_WIDTH[len(available)] + 50.0 * spread
    half_width = min(half_width, _MAX_HALF_WIDTH)

    confidence = {
        "low": round(max(0.0, sentinel_score - half_width), 2),
        "high": round(min(100.0, sentinel_score + half_width), 2),
    }

    return {
        "sentinel_score": sentinel_score,
        "band": band,
        "confidence": confidence,
        "override_fired": override_fired,
        "shap_categories": shap_categories,
        "disclaimer": DISCLAIMER,
        # Not part of the spec 5.4 contract; useful for the evaluation suite and
        # for explaining a score to an officer.
        "_explain": {
            "signals_used": sorted(available),
            "weighted_base": round(base * 100.0, 2),
            "non_dilution_floor_applied": diluted,
            "spread": round(spread, 4),
        },
    }


__all__ = ["fuse", "IS_STUB", "SELF_REPORT_OVERRIDE_THRESHOLD"]
