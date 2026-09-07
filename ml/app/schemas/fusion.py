"""Schemas for POST /predict/fusion (spec 5.4) — the main endpoint."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.config import RiskBand


class Confidence(BaseModel):
    low: float
    high: float


class FusionRequest(BaseModel):
    user_id: str
    score_a: float = Field(ge=0.0, le=1.0)
    score_b: float | None = Field(default=None, ge=0.0, le=1.0)
    score_c: float | None = Field(default=None, ge=0.0, le=1.0)
    shap_categories: dict[str, float] = Field(default_factory=dict)


class FusionResponse(BaseModel):
    sentinel_score: float = Field(ge=0.0, le=100.0)
    band: RiskBand
    confidence: Confidence
    override_fired: bool
    shap_categories: dict[str, float]
    # Required on EVERY fusion response (spec 5.4 / Section 10).
    disclaimer: str
