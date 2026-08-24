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
from .resource_attributes import ResourceAttributesInput

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS events (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL,
  trace_id      TEXT,
  span_id       TEXT,
  parent_span_id TEXT,
  request_id    TEXT,
  service       TEXT NOT NULL,
  host          TEXT,
  container     TEXT,
  deployment_id TEXT,
  timestamp     TEXT NOT NULL,
  duration_ms   REAL,
  attributes    TEXT NOT NULL,
  resource_attributes TEXT,
  severity      TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_trace_id   ON events(trace_id);
CREATE INDEX IF NOT EXISTS idx_events_span_id    ON events(span_id);
CREATE INDEX IF NOT EXISTS idx_events_service    ON events(service);
CREATE INDEX IF NOT EXISTS idx_events_timestamp  ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_deployment ON events(deployment_id);
CREATE INDEX IF NOT EXISTS idx_events_type       ON events(type);

CREATE TABLE IF NOT EXISTS telemetry_failures (
  id         TEXT PRIMARY KEY,
  timestamp  TEXT NOT NULL,
  service    TEXT,
  operation  TEXT NOT NULL,
  reason     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telemetry_failures_timestamp ON telemetry_failures(timestamp);
CREATE INDEX IF NOT EXISTS idx_telemetry_failures_service   ON telemetry_failures(service);
"""

_INSERT_SQL = """
INSERT INTO events (
  id, type, trace_id, span_id, parent_span_id, request_id, service, host, container,
  deployment_id, timestamp, duration_ms, attributes, resource_attributes, severity
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""


def _event_to_row_params(event: Event) -> tuple:
    return (
        event.id,
        event.type,
        event.trace_id,
        event.span_id,
        event.parent_span_id,
        event.request_id,
        event.service,
        event.host,
        event.container,
        event.deployment_id,
        event.timestamp,
        event.duration_ms,
        json.dumps(event.attributes),
        json.dumps(event.resource_attributes)
        if event.resource_attributes is not None
        else None,
        event.severity,
    )


def row_to_event(row: sqlite3.Row) -> Event:
    row_keys = row.keys()
    resource_attributes_raw = (
        row["resource_attributes"] if "resource_attributes" in row_keys else None
    )
    return Event(
        id=row["id"],
        type=row["type"],
        trace_id=row["trace_id"],
        span_id=row["span_id"] if "span_id" in row_keys else None,
        parent_span_id=row["parent_span_id"] if "parent_span_id" in row_keys else None,
        request_id=row["request_id"],
        service=row["service"],
        host=row["host"],
        container=row["container"],
        deployment_id=row["deployment_id"],
        timestamp=row["timestamp"],
        duration_ms=row["duration_ms"],
        attributes=json.loads(row["attributes"]),
        resource_attributes=json.loads(resource_attributes_raw)
        if resource_attributes_raw
        else None,
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
        self._migrate_schema()
        self._redaction = redaction

    def _migrate_schema(self) -> None:
        existing = {
            row[1] for row in self._conn.execute("PRAGMA table_info(events)").fetchall()
        }
        migrations = {
            "span_id": "ALTER TABLE events ADD COLUMN span_id TEXT",
            "parent_span_id": "ALTER TABLE events ADD COLUMN parent_span_id TEXT",
            "resource_attributes": "ALTER TABLE events ADD COLUMN resource_attributes TEXT",
        }
        for column, statement in migrations.items():
            if column not in existing:
                self._conn.execute(statement)
        self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_events_span_id ON events(span_id)"
        )
        self._conn.commit()

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

    def record_telemetry_failure(
        self,
        operation: str,
        reason: str,
        service: Optional[str] = None,
        timestamp: Optional[str] = None,
    ) -> None:
        try:
            self._conn.execute(
                "INSERT INTO telemetry_failures (id, timestamp, service, operation, reason) "
                "VALUES (?, ?, ?, ?, ?)",
                (
                    str(uuid.uuid4()),
                    timestamp or datetime.now(timezone.utc).isoformat(),
                    service,
                    operation,
                    reason,
                ),
            )
            self._conn.commit()
        except Exception:
            pass

    def get_telemetry_failure_count(
        self,
        service: Optional[str] = None,
        since_iso: Optional[str] = None,
        until_iso: Optional[str] = None,
    ) -> int:
        conditions, params = self._build_telemetry_failure_filter(
            service, since_iso, until_iso
        )
        where = " WHERE " + " AND ".join(conditions) if conditions else ""
        row = self._conn.execute(
            f"SELECT COUNT(*) as c FROM telemetry_failures{where}", params
        ).fetchone()
        return row["c"]

    def get_telemetry_failures(
        self,
        service: Optional[str] = None,
        since_iso: Optional[str] = None,
        until_iso: Optional[str] = None,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        conditions, params = self._build_telemetry_failure_filter(
            service, since_iso, until_iso
        )
        where = " WHERE " + " AND ".join(conditions) if conditions else ""
        rows = self._conn.execute(
            f"SELECT * FROM telemetry_failures{where} ORDER BY timestamp DESC LIMIT ?",
            (*params, limit),
        ).fetchall()
        return [dict(r) for r in rows]

    def _build_telemetry_failure_filter(
        self,
        service: Optional[str],
        since_iso: Optional[str],
        until_iso: Optional[str],
    ) -> tuple:
        conditions: List[str] = []
        params: List[Any] = []
        if service:
            conditions.append("service = ?")
            params.append(service)
        if since_iso:
            conditions.append("timestamp >= ?")
            params.append(since_iso)
        if until_iso:
            conditions.append("timestamp <= ?")
            params.append(until_iso)
        return conditions, params

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
    resource_attributes: Optional[ResourceAttributesInput] = None,
) -> ObyflowHandle:
    from .instrumentation.outbound_http import instrument_outbound_http

    resolved_redaction = _load_redaction_config(redaction)
    store = SqliteStore(db_path, resolved_redaction)
    instrument_outbound_http(service, store, deployment_id, resource_attributes)

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
