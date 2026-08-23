from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from obyflow.client import SqliteStore
from obyflow.context import TraceContext, reset_trace_context, set_trace_context
from obyflow.instrumentation.asgi import ObyflowASGIMiddleware
from obyflow.instrumentation.langchain import (
    FrameworkInstrumentationContext,
    ObyflowLangChainCallbackHandler,
)
from obyflow.instrumentation.outbound_http import (
    _reset_outbound_http_instrumentation_for_tests,
    instrument_outbound_http,
)
from obyflow.instrumentation.vectordb import (
    VectorDbInstrumentationContext,
    instrument_pinecone_index,
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


def _break_insert(store: SqliteStore) -> None:
    def _boom(_event):
        raise RuntimeError("disk full")

    store.insert = _boom


def test_sqlite_store_records_and_lists_telemetry_failures(tmp_path: Path):
    store = SqliteStore(tmp_path / "obyflow.db")
    try:
        assert store.get_telemetry_failure_count() == 0
        store.record_telemetry_failure(
            operation="test.op", reason="boom", service="checkout"
        )
        store.record_telemetry_failure(
            operation="test.op", reason="boom again", service="billing"
        )

        assert store.get_telemetry_failure_count() == 2
        assert store.get_telemetry_failure_count(service="checkout") == 1

        failures = store.get_telemetry_failures(service="checkout")
        assert len(failures) == 1
        assert failures[0]["operation"] == "test.op"
        assert failures[0]["reason"] == "boom"
    finally:
        store.close()


def test_record_telemetry_failure_never_raises(tmp_path: Path):
    store = SqliteStore(tmp_path / "obyflow.db")
    try:
        store.close()
        store.record_telemetry_failure(operation="test.op", reason="boom")
    finally:
        pass


def test_asgi_middleware_records_telemetry_failure_instead_of_swallowing(
    tmp_path: Path,
):
    store = SqliteStore(tmp_path / "obyflow.db")
    try:
        _break_insert(store)
        app = FastAPI()

        @app.get("/health")
        def health():
            return {"ok": True}

        app.add_middleware(
            ObyflowASGIMiddleware, service="checkout", store=store, deployment_id=None
        )
        client = TestClient(app)
        response = client.get("/health")
        assert response.status_code == 200

        failures = store.get_telemetry_failures(service="checkout")
        assert len(failures) == 1
        assert failures[0]["operation"] == "asgi.trace_event"
        assert "disk full" in failures[0]["reason"]
    finally:
        store.close()


def test_outbound_http_records_telemetry_failure_instead_of_swallowing(
    tmp_path: Path,
):
    store = SqliteStore(tmp_path / "obyflow.db")
    try:
        _break_insert(store)
        instrument_outbound_http("checkout", store, None)
        import requests

        with pytest.raises(Exception):
            requests.get("http://127.0.0.1:1", timeout=0.2)

        failures = store.get_telemetry_failures(service="checkout")
        assert len(failures) == 1
        assert failures[0]["operation"] == "outbound_http.trace_event"
    finally:
        _reset_outbound_http_instrumentation_for_tests()
        store.close()


def test_vectordb_records_telemetry_failure_instead_of_swallowing(tmp_path: Path):
    store = SqliteStore(tmp_path / "obyflow.db")
    try:
        _break_insert(store)
        ctx = VectorDbInstrumentationContext(service="search-svc", store=store)
        index = instrument_pinecone_index(FakePineconeIndex(), ctx, collection="docs")

        token = set_trace_context(TraceContext(trace_id="trace-1", request_id="req-1"))
        try:
            index.query(top_k=1)
        finally:
            reset_trace_context(token)

        failures = store.get_telemetry_failures(service="search-svc")
        assert len(failures) == 1
        assert failures[0]["operation"] == "vectordb.insert"
    finally:
        store.close()


def test_langchain_records_telemetry_failure_instead_of_swallowing(tmp_path: Path):
    store = SqliteStore(tmp_path / "obyflow.db")
    try:
        _break_insert(store)
        ctx = FrameworkInstrumentationContext(service="rag-svc", store=store)
        handler = ObyflowLangChainCallbackHandler(ctx)

        token = set_trace_context(TraceContext(trace_id="trace-1", request_id="req-1"))
        try:
            handler.on_chain_start(
                {"name": "RetrievalQAChain"}, {"question": "hi"}, run_id="run-1"
            )
            handler.on_chain_end({"answer": "hello"}, run_id="run-1")
        finally:
            reset_trace_context(token)

        failures = store.get_telemetry_failures(service="rag-svc")
        assert len(failures) >= 1
        assert failures[0]["operation"] == "langchain.insert"
    finally:
        store.close()
