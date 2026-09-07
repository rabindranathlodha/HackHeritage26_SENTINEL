"""Liveness endpoint (spec 5.5)."""

from __future__ import annotations

from fastapi import APIRouter

from app.models.registry import registry
from app.schemas.health import HealthResponse, ModelsLoaded

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Report service liveness and the true load state of each model."""
    return HealthResponse(status="ok", models_loaded=ModelsLoaded(**registry.status()))
