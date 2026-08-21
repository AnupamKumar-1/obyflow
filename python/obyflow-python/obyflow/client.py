from __future__ import annotations

import json
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Union

from .events import Event, validate_event
from .redaction import DEFAULT_REDACTION_CONFIG, RedactionConfig, redact_event

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS events (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL,
  trace_id      TEXT,
  request_id    TEXT,
  service       TEXT NOT NULL,
  host          TEXT,
  container     TEXT,
  deployment_id TEXT,
  timestamp     TEXT NOT NULL,
  duration_ms   REAL,
  attributes    TEXT NOT NULL,
  severity      TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_trace_id   ON events(trace_id);
CREATE INDEX IF NOT EXISTS idx_events_service    ON events(service);
CREATE INDEX IF NOT EXISTS idx_events_timestamp  ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_deployment ON events(deployment_id);
CREATE INDEX IF NOT EXISTS idx_events_type       ON events(type);
"""

_INSERT_SQL = """
INSERT INTO events (
  id, type, trace_id, request_id, service, host, container,
  deployment_id, timestamp, duration_ms, attributes, severity
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""


def _event_to_row_params(event: Event) -> tuple:
    return (
        event.id,
        event.type,
        event.trace_id,
        event.request_id,
        event.service,
        event.host,
        event.container,
        event.deployment_id,
        event.timestamp,
        event.duration_ms,
        json.dumps(event.attributes),
        event.severity,
    )


def row_to_event(row: sqlite3.Row) -> Event:
    return Event(
        id=row["id"],
        type=row["type"],
        trace_id=row["trace_id"],
        request_id=row["request_id"],
        service=row["service"],
        host=row["host"],
        container=row["container"],
        deployment_id=row["deployment_id"],
        timestamp=row["timestamp"],
        duration_ms=row["duration_ms"],
        attributes=json.loads(row["attributes"]),
        severity=row["severity"],
    )


class SqliteStore:
    def __init__(
        self,
        db_path: Union[str, Path] = "obyflow.db",
        redaction: RedactionConfig = DEFAULT_REDACTION_CONFIG,
    ):
        self._conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode = WAL")
        self._conn.executescript(_SCHEMA_SQL)
        self._conn.commit()
        self._redaction = redaction

    def _apply_ingestion_redaction(self, event: Event) -> Event:
        if not self._redaction.enabled or self._redaction.applied_at != "ingestion":
            return event
        return redact_event(event, self._redaction)

    def insert(self, event: Event) -> None:
        event = self._apply_ingestion_redaction(event)
        self._conn.execute(_INSERT_SQL, _event_to_row_params(event))
        self._conn.commit()

    def insert_many(self, events: List[Event]) -> None:
        events = [self._apply_ingestion_redaction(e) for e in events]
        self._conn.executemany(_INSERT_SQL, [_event_to_row_params(e) for e in events])
        self._conn.commit()

    def get_by_trace_id(self, trace_id: str) -> List[Event]:
        rows = self._conn.execute(
            "SELECT * FROM events WHERE trace_id = ? ORDER BY timestamp ASC",
            (trace_id,),
        ).fetchall()
        return [row_to_event(r) for r in rows]

    def get_by_service(
        self, service: str, since_iso: Optional[str] = None
    ) -> List[Event]:
        if since_iso:
            rows = self._conn.execute(
                "SELECT * FROM events WHERE service = ? AND timestamp >= ? ORDER BY timestamp ASC",
                (service, since_iso),
            ).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM events WHERE service = ? ORDER BY timestamp ASC",
                (service,),
            ).fetchall()
        return [row_to_event(r) for r in rows]

    def get_by_service_window(
        self, service: str, start_iso: str, end_iso: str
    ) -> List[Event]:
        rows = self._conn.execute(
            "SELECT * FROM events WHERE service = ? AND timestamp >= ? AND timestamp <= ? "
            "ORDER BY timestamp ASC",
            (service, start_iso, end_iso),
        ).fetchall()
        return [row_to_event(r) for r in rows]

    def get_services(self) -> List[Dict[str, Any]]:
        rows = self._conn.execute(
            """SELECT
                 service,
                 COUNT(*) as event_count,
                 MAX(timestamp) as last_seen,
                 SUM(CASE WHEN severity IN ('error', 'critical') THEN 1 ELSE 0 END) as error_count
               FROM events
               GROUP BY service
               ORDER BY last_seen DESC"""
        ).fetchall()
        return [dict(r) for r in rows]

    def close(self) -> None:
        self._conn.close()


@dataclass
class ObyflowHandle:
    store: SqliteStore
    emit: Callable[..., Event]
    get_trace: Callable[[str], List[Event]]
    stop: Callable[[], None]


def _load_redaction_config(explicit: Optional[RedactionConfig]) -> RedactionConfig:
    if explicit is not None:
        return explicit
    config_path = Path.cwd() / "obyflow.config.json"
    if config_path.exists():
        try:
            data = json.loads(config_path.read_text())
            redaction = data.get("redaction", {})
            return RedactionConfig(
                enabled=redaction.get("enabled", True),
                fields=redaction.get("fields", DEFAULT_REDACTION_CONFIG.fields),
                applied_at=redaction.get("applied_at", "ingestion"),
            )
        except Exception:
            pass
    return DEFAULT_REDACTION_CONFIG


def start(
    service: str,
    db_path: Union[str, Path] = "obyflow.db",
    deployment_id: Optional[str] = None,
    redaction: Optional[RedactionConfig] = None,
) -> ObyflowHandle:
    from .instrumentation.outbound_http import instrument_outbound_http

    resolved_redaction = _load_redaction_config(redaction)
    store = SqliteStore(db_path, resolved_redaction)
    instrument_outbound_http(service, store, deployment_id)

    def emit(**partial: Any) -> Event:
        candidate = {
            "id": partial.pop("id", None) or str(uuid.uuid4()),
            "timestamp": partial.pop("timestamp", None)
            or datetime.now(timezone.utc).isoformat(),
            **partial,
        }
        event = validate_event(candidate)
        store.insert(event)
        return event

    def get_trace(trace_id: str) -> List[Event]:
        return store.get_by_trace_id(trace_id)

    def stop() -> None:
        store.close()

    return ObyflowHandle(store=store, emit=emit, get_trace=get_trace, stop=stop)
