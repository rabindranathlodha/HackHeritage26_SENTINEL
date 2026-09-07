"""Clinical-claims guard tests (spec Section 10, principle 4)."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from app.config import DISCLAIMER
from app.main import ClinicalClaimsMiddleware, app
from app.privacy.claims import (
    ClinicalClaimError,
    assert_disclaimer_present,
    assert_no_clinical_claims,
)

client = TestClient(app)


# The scanner


@pytest.mark.parametrize(
    "payload",
    [
        {"message": "This is a diagnosis of the condition"},
        {"summary": "depression detected in responses"},
        {"note": "the model predicts suicide risk"},
        {"detail": "personnel shows signs of mental illness"},
        {"nested": {"deep": ["fine", "possible disorder"]}},
        {"text": "refer the patient to counselling"},
        {"assessment": "clinically significant"},
    ],
)
def test_forbidden_terms_are_rejected_anywhere_in_the_payload(payload):
    with pytest.raises(ClinicalClaimError):
        assert_no_clinical_claims(payload)


def test_forbidden_terms_are_rejected_in_field_names_too():
    """A key called `diagnosis` is as much a violation as the sentence."""
    with pytest.raises(ClinicalClaimError) as exc:
        assert_no_clinical_claims({"diagnosis_score": 0.8})

    assert "key" in str(exc.value)


def test_scanner_is_case_insensitive():
    with pytest.raises(ClinicalClaimError):
        assert_no_clinical_claims({"m": "DIAGNOSIS complete"})


@pytest.mark.parametrize(
    "payload",
    [
        {"band": "ELEVATED", "note": "elevated welfare-risk indicator"},
        {"action": "flagged for human review"},
        {"suggestion": "offer welfare support"},
        {"sentinel_score": 62.5, "override_fired": False, "confidence": {"low": 0.5}},
        {"disclaimer": DISCLAIMER},
    ],
)
def test_approved_language_passes(payload):
    assert_no_clinical_claims(payload)


def test_disclaimer_is_the_only_sanctioned_use_of_the_word():
    """The disclaimer contains "diagnosis" and is allowed — but only verbatim."""
    assert_no_clinical_claims({"disclaimer": DISCLAIMER})

    with pytest.raises(ClinicalClaimError):
        assert_no_clinical_claims({"disclaimer": DISCLAIMER + " Probably."})


def test_numbers_and_nulls_cannot_carry_a_claim():
    assert_no_clinical_claims({"a": 1, "b": None, "c": True, "d": [1.5, 2]})


# The middleware


def test_middleware_blocks_a_response_containing_a_forbidden_term():
    """A crafted overclaiming response must never reach the caller."""
    leaky = FastAPI()
    leaky.add_middleware(ClinicalClaimsMiddleware)

    @leaky.get("/leak")
    def leak():
        return JSONResponse({"message": "diagnosis: severe"})

    response = TestClient(leaky, raise_server_exceptions=False).get("/leak")

    assert response.status_code == 500
    assert response.json()["error"] == "response_blocked_by_claims_guard"
    assert "diagnosis" not in response.text.lower()


def test_middleware_lets_a_compliant_response_through_unchanged():
    ok = FastAPI()
    ok.add_middleware(ClinicalClaimsMiddleware)

    @ok.get("/ok")
    def fine():
        return JSONResponse({"band": "ELEVATED", "note": "for human review"})

    response = TestClient(ok).get("/ok")

    assert response.status_code == 200
    assert response.json() == {"band": "ELEVATED", "note": "for human review"}


def test_middleware_is_active_on_the_real_service():
    assert any(
        m.cls is ClinicalClaimsMiddleware for m in app.user_middleware
    ), "the claims guard must be registered on the production app"


# The disclaimer on fusion responses


def test_every_fusion_response_carries_the_disclaimer():
    response = client.post(
        "/predict/fusion",
        json={"user_id": "u1", "score_a": 0.4, "score_b": None, "score_c": None},
    )

    assert response.status_code == 200
    assert_disclaimer_present(response.json())


def test_disclaimer_check_rejects_a_missing_or_altered_disclaimer():
    with pytest.raises(ClinicalClaimError):
        assert_disclaimer_present({"sentinel_score": 40.0})

    with pytest.raises(ClinicalClaimError):
        assert_disclaimer_present({"disclaimer": "Trust the score."})
