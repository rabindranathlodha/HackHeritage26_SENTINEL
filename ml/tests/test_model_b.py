"""Model B tests (spec 7.2, step 3.7).

The properties that matter here are multilingual behaviour, and the guarantee
that raw self-report text does not survive the request.
"""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import model_b

client = TestClient(app)

ARTIFACTS = os.environ.get("ARTIFACTS_DIR", "artifacts")

requires_model_b = pytest.mark.skipif(
    not os.path.isdir(os.path.join(ARTIFACTS, model_b.OUTPUT_DIR, "config.json").rsplit("/", 1)[0])
    or not os.path.exists(os.path.join(ARTIFACTS, model_b.META_FILE)),
    reason="run training/train_model_b.py first",
)

pytestmark = requires_model_b


@pytest.fixture(scope="module", autouse=True)
def loaded():
    model_b.load()
    yield
    model_b.load()


DISTRESSED_EN = (
    "I cannot sleep at all any more. Every day feels heavier than the last and "
    "I have nobody here I can talk to about it. I do not know how much longer "
    "I can keep going like this."
)
NEUTRAL_EN = (
    "The duty roster came out this morning. I am on the early shift this week "
    "and the weather has been fine, so the drill went smoothly."
)
DISTRESSED_HI = (
    "मुझे बिल्कुल नींद नहीं आ रही है। हर दिन पहले से भारी लगता है और यहाँ मेरा "
    "कोई नहीं है जिससे मैं बात कर सकूँ। पता नहीं मैं और कितना सह पाऊँगा।"
)
NEUTRAL_HI = "आज ड्यूटी रोस्टर आया। इस हफ्ते मेरी सुबह की पाली है और मौसम अच्छा है।"
CODE_MIXED = "Sir duty bahut heavy hai aajkal, sleep nahi ho rahi properly."


def post(text: str, language: str = "en") -> dict:
    response = client.post(
        "/predict/text", json={"user_id": "u1", "text": text, "language": language}
    )
    assert response.status_code == 200, response.text
    return response.json()


# Loading


def test_model_loads_and_health_reports_it():
    assert model_b.is_loaded()
    assert client.get("/health").json()["models_loaded"]["b"] is True


def test_missing_artifacts_leave_the_model_unloaded_rather_than_stubbed(tmp_path):
    assert model_b.load(str(tmp_path)) is False
    assert not model_b.is_loaded()

    response = client.post(
        "/predict/text", json={"user_id": "u1", "text": "hello", "language": "en"}
    )
    assert response.status_code == 503

    model_b.load()


# Scoring


@pytest.mark.parametrize(
    ("text", "language"),
    [(DISTRESSED_EN, "en"), (NEUTRAL_EN, "en"),
     (DISTRESSED_HI, "hi"), (NEUTRAL_HI, "hi")],
)
def test_returns_a_probability_for_english_and_hindi(text, language):
    body = post(text, language)

    assert 0.0 <= body["score_b"] <= 1.0
    assert set(body) == {"score_b", "language_detected"}


def test_distress_scores_higher_than_neutral_in_english():
    assert post(DISTRESSED_EN, "en")["score_b"] > post(NEUTRAL_EN, "en")["score_b"]


def test_distress_scores_higher_than_neutral_in_hindi():
    """Cross-lingual transfer: trained on English, must still order Hindi.

    This is the fairness property that motivates a multilingual encoder. An
    English-only model would score both Hindi inputs arbitrarily.
    """
    assert post(DISTRESSED_HI, "hi")["score_b"] > post(NEUTRAL_HI, "hi")["score_b"]


def test_prediction_is_deterministic():
    assert post(DISTRESSED_EN, "en") == post(DISTRESSED_EN, "en")


# The raw text must not survive the request


def test_response_never_echoes_the_submitted_text():
    secret = "a distinctive phrase that must never come back out of this service"

    body = post(secret, "en")

    assert secret not in str(body)
    assert set(body) == {"score_b", "language_detected"}


def test_text_is_not_written_to_logs(caplog):
    """A self-report in a log file is the same disclosure as one in a database."""
    secret = "unmistakable canary string for the logging check"

    with caplog.at_level("DEBUG"):
        post(secret, "en")

    assert secret not in caplog.text


# Language reporting


def test_script_detection_reports_what_it_can_actually_tell():
    assert post(NEUTRAL_EN, "en")["language_detected"] == "en"
    assert post(NEUTRAL_HI, "hi")["language_detected"] == "hi"


def test_devanagari_is_not_claimed_to_be_a_specific_language_it_cannot_identify():
    """Devanagari is shared by Hindi, Marathi and Nepali.

    A request declaring Marathi is taken at its word; one declaring English over
    Devanagari text is not.
    """
    assert model_b.detect_script_language(NEUTRAL_HI, "mr") == "mr"
    assert model_b.detect_script_language(NEUTRAL_HI, "en") == "hi"


def test_code_mixed_text_is_reported_as_mixed_rather_than_forced_into_one_bucket():
    """Code-mixing is the norm in Indian-language self-reports."""
    assert model_b.detect_script_language("ड्यूटी heavy hai aur नींद नहीं आ रही", "hi") == "mixed"


def test_romanised_hindi_is_reported_as_latin_script_a_known_limitation():
    """Documents a real weakness rather than hiding it.

    "Sir duty bahut heavy hai, sleep nahi ho rahi" is Hindi written in Latin
    script — extremely common in the field. Script detection cannot see it and
    reports "en". Fixing that needs a language-ID model, which is not worth a
    dependency when the label is metadata and the SCORE is what drives the
    system. The next test pins the part that actually matters.
    """
    assert model_b.detect_script_language(CODE_MIXED, "hi") == "en"


def test_romanised_hindi_distress_still_scores_as_distress():
    """The label may be imprecise; the risk signal must not be.

    MuRIL was pre-trained on transliterated Indian-language text, so it reads
    this register even though the language tag is wrong.
    """
    distressed_romanised = "Sir duty bahut heavy hai, neend nahi aa rahi, bahut akela lagta hai."
    neutral_romanised = "Aaj roster aaya, subah ki pali hai, mausam theek hai."

    assert post(distressed_romanised, "hi")["score_b"] > post(neutral_romanised, "hi")["score_b"]


# Documented provenance and limitations


def test_metadata_records_the_corpus_and_its_licence():
    corpus = model_b.metadata()["corpus"]

    assert corpus["name"] == "Dreaddit"
    assert "licence" in corpus
    assert corpus["url"].startswith("http")


def test_metadata_records_which_corpora_were_deliberately_not_used():
    """CLPsych and DAIC-WOZ need signed agreements; that must not be glossed over."""
    not_used = model_b.metadata()["corpora_not_used"]

    assert set(not_used) == {"CLPsych", "DAIC-WOZ"}


def test_metadata_reports_english_and_hindi_separately():
    """Averaging the two into one number would hide a fairness gap."""
    metrics = model_b.metadata()["metrics"]

    assert "english" in metrics and "hindi_back_translated" in metrics
    for split in metrics.values():
        assert {"macro_f1", "roc_auc", "n"} <= set(split)


def test_metadata_states_the_models_limitations():
    limitations = model_b.metadata()["limitations"]

    assert len(limitations) >= 2
    assert any("machine translation" in x.lower() or "translations" in x.lower()
               for x in limitations)
