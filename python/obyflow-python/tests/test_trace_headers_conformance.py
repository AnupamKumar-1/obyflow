import json
from pathlib import Path

import pytest

from obyflow.tracing_headers import extract_inbound_trace_headers

FIXTURE_PATH = Path(__file__).resolve().parents[3] / "fixtures" / "parity" / "trace_headers.json"


def _load_fixture():
    return json.loads(FIXTURE_PATH.read_text())


_FIXTURE = _load_fixture()


@pytest.mark.parametrize("case", _FIXTURE["cases"], ids=lambda c: c["name"])
def test_trace_header_assignment_matches_shared_fixture(case):
    sentinel = _FIXTURE["generatedIdSentinel"]
    trace_id, parent_span_id = extract_inbound_trace_headers(
        case["headers"], lambda: sentinel
    )
    expected_trace_id = (
        sentinel if case["expectedTraceId"] == "GENERATED" else case["expectedTraceId"]
    )
    assert trace_id == expected_trace_id
    assert parent_span_id == case["expectedParentSpanId"]
