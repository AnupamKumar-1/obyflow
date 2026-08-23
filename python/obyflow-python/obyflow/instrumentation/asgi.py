from __future__ import annotations

import os
import platform
import socket
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from ..client import SqliteStore
from ..context import TraceContext, reset_trace_context, set_trace_context
from ..events import validate_event


def _resource_attributes() -> Dict[str, Any]:
    return {
        "hostname": socket.gethostname(),
        "pid": os.getpid(),
        "python_version": platform.python_version(),
    }


class ObyflowASGIMiddleware:
    def __init__(
        self, app, service: str, store: SqliteStore, deployment_id: Optional[str] = None
    ):
        self.app = app
        self.service = service
        self.store = store
        self.deployment_id = deployment_id

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = {
            k.decode("latin-1").lower(): v.decode("latin-1")
            for k, v in scope.get("headers", [])
        }
        trace_id = headers.get("x-obyflow-trace-id") or str(uuid.uuid4())
        request_id = str(uuid.uuid4())
        span_id = str(uuid.uuid4())
        parent_span_id = headers.get("x-obyflow-parent-span-id")
        started_at = time.monotonic()
        timestamp = datetime.now(timezone.utc).isoformat()
        status_code_holder = {"code": None}

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                status_code_holder["code"] = message["status"]
            await send(message)

        token = set_trace_context(
            TraceContext(
                trace_id=trace_id,
                request_id=request_id,
                span_id=span_id,
                parent_span_id=parent_span_id,
            )
        )
        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            status_code_holder["code"] = 500
            raise
        finally:
            reset_trace_context(token)
            duration_ms = (time.monotonic() - started_at) * 1000
            status_code = status_code_holder["code"] or 0
            try:
                event = validate_event(
                    {
                        "id": str(uuid.uuid4()),
                        "type": "trace",
                        "trace_id": trace_id,
                        "span_id": span_id,
                        "parent_span_id": parent_span_id,
                        "request_id": request_id,
                        "service": self.service,
                        "host": None,
                        "container": None,
                        "deployment_id": self.deployment_id,
                        "timestamp": timestamp,
                        "duration_ms": duration_ms,
                        "attributes": {
                            "method": scope.get("method"),
                            "url": scope.get("path"),
                            "status_code": status_code,
                        },
                        "resource_attributes": _resource_attributes(),
                        "severity": "error" if status_code >= 500 else "info",
                    }
                )
                self.store.insert(event)
            except Exception as exc:
                self.store.record_telemetry_failure(
                    operation="asgi.trace_event",
                    service=self.service,
                    reason=str(exc),
                )
