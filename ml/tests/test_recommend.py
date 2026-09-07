"""RAG recommendation engine tests (spec Section 11, step 3.11)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import rag

client = TestClient(app)

requires_index = pytest.mark.skipif(
    not rag.is_available(), reason="run training/build_policy_index.py first"
)

pytestmark = requires_index

CATEGORIES = {
    "deployment_load": 0.264, "leave_pattern": 0.264, "duty_irregularity": 0.163,
    "transfer_frequency": 0.005, "training_load": 0.023, "incident_proximity": 0.281,
}


def post(band: str = "ELEVATED", categories: dict | None = None):
    return client.post(
        "/recommend",
        json={"band": band, "shap_categories": categories or CATEGORIES},
    )


# The privacy guarantee: category-level context only


def test_the_request_cannot_carry_a_persons_identity():
    """Spec 11: category-level context ONLY.

    Enforced by the schema rather than by convention, and rejected rather than
    silently dropped — a caller who thinks they sent an id should be told.
    """
    response = client.post(
        "/recommend",
        json={"band": "ELEVATED", "shap_categories": CATEGORIES, "user_id": "syn-000034"},
    )

    assert response.status_code == 422


@pytest.mark.parametrize("field", ["user_id", "name", "unit_id", "text", "date"])
def test_no_identifying_field_is_accepted(field):
    response = client.post(
        "/recommend",
        json={"band": "ELEVATED", "shap_categories": CATEGORIES, field: "anything"},
    )

    assert response.status_code == 422


def test_the_response_contains_no_identifying_detail():
    body = post().json()

    serialised = str(body).lower()
    assert "syn-" not in serialised
    assert "user_id" not in serialised


# Traceability


def test_every_response_carries_source_citations():
    """Spec 11: every suggestion traceable to a source chunk."""
    body = post().json()

    assert body["sources"], "a suggestion with no sources is untraceable"
    for source in body["sources"]:
        assert source["citation"]
        assert "#chunk" in source["citation"]
        assert source["publisher"]


def test_the_suggestion_is_assembled_from_the_retrieved_passages():
    """The extractive path means the text IS the sources, not a paraphrase."""
    body = post().json()

    for source in body["sources"]:
        assert source["citation"] in body["suggestion"], (
            f"{source['citation']} is cited but its text does not appear"
        )


def test_retrieval_responds_to_the_categories_it_is_given():
    """Different drivers must retrieve different guidance, or the SHAP input is decoration."""
    incident = post(categories={"incident_proximity": 1.0}).json()
    leave = post(categories={"leave_pattern": 1.0}).json()

    assert {s["citation"] for s in incident["sources"]} != {
        s["citation"] for s in leave["sources"]
    }


def test_unrecognised_categories_are_refused_rather_than_guessed():
    response = post(categories={"vibes": 1.0})

    assert response.status_code == 422


# Provenance honesty


def test_a_non_authoritative_corpus_is_declared_not_hidden():
    """The shipped corpus is a labelled placeholder, and the API says so.

    A plausible paragraph presented as force policy would be worse than no
    answer, because the officer would have no way to tell the difference.
    """
    body = post().json()

    if not all(s["authoritative"] for s in body["sources"]):
        assert body["authoritative"] is False
        assert body["warning"] is not None
        assert "NON-AUTHORITATIVE" in body["warning"]


def test_the_manifest_records_provenance_for_every_document():
    manifest = rag.load_manifest()

    assert manifest["documents"]
    for entry in manifest["documents"]:
        for field in ("id", "title", "publisher", "source_url", "authoritative", "file"):
            assert field in entry, f"{entry.get('id')} is missing {field}"


# Human-in-the-loop


def test_the_response_states_that_nothing_was_sent():
    """Spec 11: the recommendation is for the officer and never auto-sent."""
    body = post().json()

    assert body["action_taken"] == "none"
    assert body["for"] == "welfare_officer_review"


def test_the_suggestion_defers_to_the_officers_judgement():
    body = post().json()

    assert "overrule" in body["suggestion"].lower()


def test_the_recommendation_contains_no_clinical_language():
    """The claims middleware guards this endpoint like every other."""
    assert post().status_code == 200
    assert post("PRIORITY_REVIEW").status_code == 200
