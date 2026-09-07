"""Prediction endpoints (spec Section 5).

At step 3.4 every model behind these routes is a stub. The routes, schemas,
validation, consent gate, category-level attribution and clinical-claims
middleware are all real — that is the point of the integration gate.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.db import cohort_connection, load_hr_history
from app.models import fusion as fusion_model
from app.models import model_a, model_b, model_c
from app.models.model_a import ModelNotLoadedError
from app.models.model_b import ModelNotLoadedError as ModelBNotLoadedError
from app.models.model_c import ModelNotLoadedError as ModelCNotLoadedError
from app.privacy.kanon import cohort_summary
from app.schemas.cohort import (
    CohortSummaryRequest,
    EscalationRequest,
    EscalationResponse,
)
from app.schemas.fusion import FusionRequest, FusionResponse
from app.schemas.physiological import PhysiologicalRequest, PhysiologicalResponse
from app.schemas.recommend import RecommendRequest, RecommendResponse
from app.schemas.structured import (
    StructuredFeatures,
    StructuredRequest,
    StructuredResponse,
)
from app.schemas.text import TextRequest, TextResponse
from app.services import escalation, rag
from app.services.feature_pipeline import compute_features
from app.services.physio_features import PhysiologicalBaseline

router = APIRouter(tags=["predict"])


@router.post("/predict/structured", response_model=StructuredResponse)
def predict_structured(request: StructuredRequest) -> StructuredResponse:
    """Model A — structured behavioural risk (spec 5.1)."""
    try:
        score_a, band, shap_categories = model_a.predict(request.features)
    except ModelNotLoadedError as exc:
        # Better an honest 503 than a fabricated score.
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return StructuredResponse(score_a=score_a, band=band, shap_categories=shap_categories)


@router.post("/predict/text", response_model=TextResponse)
def predict_text(request: TextRequest) -> TextResponse:
    """Model B — self-assessment NLP (spec 5.2).

    The request body is not logged and the text is not persisted anywhere.
    """
    try:
        score_b, language_detected = model_b.predict(request.text, request.language)
    except ModelBNotLoadedError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return TextResponse(score_b=score_b, language_detected=language_detected)


@router.post("/predict/physiological", response_model=PhysiologicalResponse)
def predict_physiological(request: PhysiologicalRequest) -> PhysiologicalResponse:
    """Model C — physiological wellness signal (spec 5.3).

    Without consent or signals this returns a clean null and fusion proceeds
    without the signal. That is a normal outcome, never an error.
    """
    baseline = (
        PhysiologicalBaseline(**request.baseline.model_dump())
        if request.baseline is not None
        else None
    )
    try:
        score_c, used = model_c.predict(request.consent, request.signals, baseline)
    except ModelCNotLoadedError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return PhysiologicalResponse(score_c=score_c, used=used)


@router.post("/predict/fusion", response_model=FusionResponse)
def predict_fusion(request: FusionRequest) -> FusionResponse:
    """Fusion — the main endpoint (spec 5.4)."""
    result = fusion_model.fuse(
        score_a=request.score_a,
        score_b=request.score_b,
        score_c=request.score_c,
        shap_categories=request.shap_categories,
    )
    return FusionResponse(**result)


# Internal — NOT part of the spec Section 5 contract


@router.post("/internal/features/structured", response_model=StructuredFeatures)
def build_structured_features(user_id: str) -> StructuredFeatures:
    """Engineer the 12 spec-5.1 features for a person from their HR history."""
    history = load_hr_history(user_id)
    if history.empty:
        raise HTTPException(status_code=404, detail="no signal history for this person")
    return compute_features(history)


@router.post("/cohort/summary")
def cohort_summary_endpoint(request: CohortSummaryRequest) -> dict:
    """Aggregate welfare-risk figures per unit (spec 9.1). NOT in Section 5.

    Runs as `sentinel_commander`, which holds no SELECT on any individual
    welfare table. Everything it can see comes from `sentinel_cohort_summary()`,
    which suppresses any cohort below k inside the database. A cohort under the
    threshold comes back as a refusal object, never as partial or rounded data.
    """
    with cohort_connection() as conn:
        return {"cohorts": cohort_summary(conn, request.unit_id, request.band)}


@router.post("/internal/escalate", response_model=EscalationResponse)
def escalate(request: EscalationRequest) -> EscalationResponse:
    """Decide whether a score warrants human review (spec Section 8).

    The only possible effect is a PENDING_REVIEW alert for the assigned welfare
    officer. Nothing here contacts a person and nothing notifies a commander.
    """
    decision = escalation.evaluate(request.user_id, request.band)
    return EscalationResponse(**decision.to_dict())


@router.post("/recommend", response_model=RecommendResponse)
def recommend(request: RecommendRequest) -> RecommendResponse:
    """Policy-grounded welfare-support guidance for an officer (spec 11)."""
    try:
        result = rag.recommend(request.band.value, request.shap_categories)
    except rag.IndexNotBuiltError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return RecommendResponse(**result)
