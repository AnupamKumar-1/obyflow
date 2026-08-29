import json
from pathlib import Path

import pytest

from obyflow.redaction import redact_attributes

FIXTURE_PATH = Path(__file__).resolve().parents[3] / "fixtures" / "parity" / "redaction.json"


def _load_cases():
    data = json.loads(FIXTURE_PATH.read_text())
    return data["attributeCases"]


@pytest.mark.parametrize("case", _load_cases(), ids=lambda c: c["name"])
def test_redaction_matches_shared_fixture(case):
    result = redact_attributes(case["attributes"])
    assert result == case["expected"]
