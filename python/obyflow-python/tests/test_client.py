from pathlib import Path

from obyflow.client import SqliteStore, start


def test_sqlite_store_insert_and_get_by_trace_id(tmp_path: Path):
    from obyflow.events import validate_event

    db_path = tmp_path / "obyflow.db"
    store = SqliteStore(db_path)
    try:
        event = validate_event(
            {
                "id": "evt_1",
                "type": "trace",
                "trace_id": "trace_1",
                "request_id": "req_1",
                "service": "checkout",
                "host": None,
                "container": None,
                "deployment_id": None,
                "timestamp": "2026-01-01T00:00:00+00:00",
                "duration_ms": 5.0,
                "attributes": {},
                "severity": "info",
            }
        )
        store.insert(event)
        rows = store.get_by_trace_id("trace_1")
        assert len(rows) == 1
        assert rows[0].service == "checkout"
    finally:
        store.close()


def test_start_emit_and_get_trace(tmp_path: Path):
    handle = start(service="checkout", db_path=tmp_path / "obyflow.db")
    try:
        event = handle.emit(
            type="log",
            trace_id="trace_1",
            request_id=None,
            service="checkout",
            host=None,
            container=None,
            deployment_id=None,
            duration_ms=None,
            attributes={"message": "hello"},
            severity="info",
        )
        trace_events = handle.get_trace("trace_1")
        assert len(trace_events) == 1
        assert trace_events[0].id == event.id
    finally:
        handle.stop()
