from __future__ import annotations

import pytest

from obyflow.client import start
from obyflow.context import (
    TraceContext,
    get_active_trace_context,
    with_trace_context,
)


class FakeMatch:
    def __init__(self, score: float):
        self.score = score


class FakeQueryResult:
    def __init__(self, matches):
        self.matches = matches


class FakePineconeIndex:
    def query(self, **kwargs):
        return FakeQueryResult([FakeMatch(0.9)])


def test_handle_instrument_pinecone_is_pre_bound_to_service_and_store(tmp_path):
    handle = start(service="checkout", db_path=tmp_path / "obyflow.db")
    try:
        index = handle.instrument.pinecone(FakePineconeIndex(), collection="docs")

        with with_trace_context(TraceContext(trace_id="trace-1", request_id="req-1")):
            index.query(top_k=1)

        rows = handle.store.get_by_trace_id("trace-1")
        assert len(rows) == 1
        assert rows[0].service == "checkout"
        assert rows[0].type == "vector_op"
    finally:
        handle.stop()


def test_with_trace_context_sets_and_restores_active_context(tmp_path):
    assert get_active_trace_context() is None

    with with_trace_context(TraceContext(trace_id="trace-2", request_id="req-2")):
        active = get_active_trace_context()
        assert active is not None
        assert active.trace_id == "trace-2"

    assert get_active_trace_context() is None


def test_with_trace_context_restores_context_when_block_raises(tmp_path):
    assert get_active_trace_context() is None

    with pytest.raises(RuntimeError):
        with with_trace_context(TraceContext(trace_id="trace-3", request_id="req-3")):
            assert get_active_trace_context() is not None
            raise RuntimeError("boom")

    assert get_active_trace_context() is None
