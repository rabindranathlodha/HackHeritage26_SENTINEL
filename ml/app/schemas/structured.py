"""Schemas for POST /predict/structured (spec 5.1)."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.config import RiskBand


class StructuredFeatures(BaseModel):
    """The 12 engineered features of spec 5.1, in that exact order."""

    leave_deviation_30d: float
    leave_deviation_90d: float
    leave_denied_count_90d: int
    deployment_days: int
    days_since_home_posting: int
    remote_hazardous: bool
    transfers_12mo: int
    shift_irregularity_90d: float
    night_shift_ratio_90d: float
    consecutive_duty_days_max_90d: int
    training_load_trend_90d: float
    days_since_incident: int = 999


class StructuredRequest(BaseModel):
    user_id: str
    features: StructuredFeatures


class ShapCategories(BaseModel):
    """Category-level attribution ONLY.

    Never feature-level SHAP, never a date, never an event detail (spec 5.1).
    """

    deployment_load: float = 0.0
    leave_pattern: float = 0.0
    duty_irregularity: float = 0.0
    transfer_frequency: float = 0.0
    training_load: float = 0.0
    incident_proximity: float = 0.0


class StructuredResponse(BaseModel):
    score_a: float = Field(ge=0.0, le=1.0)
    band: RiskBand
    shap_categories: ShapCategories
