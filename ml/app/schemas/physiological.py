"""Schemas for POST /predict/physiological (spec 5.3).

Consent-gated. Without consent or signals the response is a clean null and the
fusion layer proceeds without this signal — never an error (spec principle 7).
"""

from __future__ import annotations

from pydantic import BaseModel


class PhysiologicalSignals(BaseModel):
    resting_hr: float
    hrv_ms: float
    sleep_hours: float
    sleep_efficiency: float


class PhysiologicalBaselinePayload(BaseModel):
    """A person's own rolling baseline — summary statistics only.

    Supplied by the on-device layer, which holds the person's history locally.
    Never raw daily readings, and the server discards it with the request.
    """

    resting_hr_mean: float
    resting_hr_sd: float
    hrv_ms_mean: float
    hrv_ms_sd: float
    sleep_hours_mean: float
    sleep_hours_sd: float
    sleep_efficiency_mean: float
    sleep_efficiency_sd: float


class PhysiologicalRequest(BaseModel):
    user_id: str
    consent: bool = False
    signals: PhysiologicalSignals | None = None
    # Additive to the spec 5.3 contract. Without it Model C declines to score:
    # population-referenced scoring measured at chance (see models/model_c.py).
    baseline: PhysiologicalBaselinePayload | None = None


class PhysiologicalResponse(BaseModel):
    score_c: float | None = None
    used: bool = False
