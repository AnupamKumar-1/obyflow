# pylint: disable=redefined-outer-name
import threading
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from obyflow.client import SqliteStore
from obyflow.context import TraceContext, reset_trace_context, set_trace_context
from obyflow.events import validate_event
from obyflow.instrumentation.asgi import ObyflowASGIMiddleware
from obyflow.instrumentation.outbound_http import (
    _reset_outbound_http_instrumentation_for_tests,
    instrument_outbound_http,
)


class _EchoHandler(BaseHTTPRequestHandler):
    captured_headers: dict = {}

    def do_GET(self):  # pylint: disable=invalid-name
        _EchoHandler.captured_headers = dict(self.headers.items())
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *args):
        pass


@pytest.fixture
def local_server():
    server = HTTPServer(("127.0.0.1", 0), _EchoHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server
    server.shutdown()
    thread.join()


def _build_app(store: SqliteStore, service: str) -> FastAPI:
    app = FastAPI()

    @app.get("/health")
    def health():
        return {"ok": True}

    app.add_middleware(
        ObyflowASGIMiddleware, service=service, store=store, deployment_id=None
    )
    return app


def test_asgi_middleware_assigns_span_id_and_resource_attributes(tmp_path: Path):
    store = SqliteStore(tmp_path / "obyflow.db")
    try:
        client = TestClient(_build_app(store, "svc-a"))
        response = client.get("/health")
        assert response.status_code == 200

        rows = store.get_by_service("svc-a")
        assert len(rows) == 1
        assert rows[0].span_id
        assert rows[0].parent_span_id is None
        assert rows[0].resource_attributes is not None
        assert "hostname" in rows[0].resource_attributes
        assert "pid" in rows[0].resource_attributes
    finally:
        store.close()


def test_asgi_middleware_uses_incoming_parent_span_id_header(tmp_path: Path):
    store = SqliteStore(tmp_path / "obyflow.db")
    try:
        incoming_parent = str(uuid.uuid4())
        client = TestClient(_build_app(store, "svc-b"))
        response = client.get(
            "/health", headers={"x-obyflow-parent-span-id": incoming_parent}
        )
        assert response.status_code == 200

        rows = store.get_by_service("svc-b")
        assert len(rows) == 1
        assert rows[0].parent_span_id == incoming_parent
    finally:
        store.close()


def test_event_accepts_span_and_resource_fields():
    event = validate_event(
        {
            "id": str(uuid.uuid4()),
            "type": "trace",
            "trace_id": "t1",
            "span_id": "s1",
            "parent_span_id": "p1",
            "request_id": "r1",
            "service": "svc",
            "timestamp": "2026-01-01T00:00:00Z",
            "attributes": {},
            "resource_attributes": {"hostname": "h", "pid": 1},
        }
    )
    assert event.span_id == "s1"
    assert event.parent_span_id == "p1"
    assert event.resource_attributes == {"hostname": "h", "pid": 1}


def test_sqlite_store_round_trips_span_fields(tmp_path: Path):
    store = SqliteStore(tmp_path / "obyflow.db")
    try:
        event = validate_event(
            {
                "id": str(uuid.uuid4()),
                "type": "trace",
                "trace_id": "trace-1",
                "span_id": "span-1",
                "parent_span_id": "span-0",
                "request_id": "req-1",
                "service": "svc",
                "timestamp": "2026-01-01T00:00:00Z",
                "attributes": {},
                "resource_attributes": {"hostname": "h", "pid": 1},
            }
        )
        store.insert(event)
        rows = store.get_by_trace_id("trace-1")
        assert len(rows) == 1
        assert rows[0].span_id == "span-1"
        assert rows[0].parent_span_id == "span-0"
        assert rows[0].resource_attributes == {"hostname": "h", "pid": 1}
    finally:
        store.close()


def test_outbound_http_injects_headers_and_links_spans(
    tmp_path: Path, local_server: HTTPServer
):
    store = SqliteStore(tmp_path / "obyflow.db")
    _reset_outbound_http_instrumentation_for_tests()
    instrument_outbound_http("svc-c", store, deployment_id=None)

    trace_id = str(uuid.uuid4())
    request_id = str(uuid.uuid4())
    inbound_span_id = str(uuid.uuid4())
    token = set_trace_context(
        TraceContext(
            trace_id=trace_id,
            request_id=request_id,
            span_id=inbound_span_id,
            parent_span_id=None,
        )
    )
    try:
        port = local_server.server_address[1]
        with httpx.Client() as client:
            response = client.get(f"http://127.0.0.1:{port}/", timeout=5)
        assert response.status_code == 200

        received = _EchoHandler.captured_headers
        assert received.get("x-obyflow-trace-id") == trace_id
        injected_span_id = received.get("x-obyflow-parent-span-id")
        assert injected_span_id is not None
        assert injected_span_id != inbound_span_id

        events = store.get_by_service("svc-c")
        assert len(events) == 1
        outbound_event = events[0]
        assert outbound_event.trace_id == trace_id
        assert outbound_event.parent_span_id == inbound_span_id
        assert outbound_event.span_id == injected_span_id
        assert outbound_event.resource_attributes is not None
    finally:
        reset_trace_context(token)
        _reset_outbound_http_instrumentation_for_tests()
        store.close()
