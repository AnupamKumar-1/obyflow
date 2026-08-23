# pylint: disable=invalid-name,global-statement
from __future__ import annotations

import os
import platform
import socket
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from urllib.parse import urlparse

from ..context import get_active_request_id, get_active_span_id, get_active_trace_id
from ..events import validate_event

_patched_requests = False
_patched_httpx_sync = False
_patched_httpx_async = False
_active_options: Optional[Dict[str, Any]] = None
_original_requests_request = None
_original_httpx_send = None
_original_httpx_async_send = None


def _resource_attributes() -> Dict[str, Any]:
    return {
        "hostname": socket.gethostname(),
        "pid": os.getpid(),
        "python_version": platform.python_version(),
    }


def _emit_outbound_event(
    method: Optional[str],
    url: str,
    status_code: Optional[int],
    duration_ms: float,
    error: Optional[BaseException],
    trace_id: Optional[str],
    request_id: Optional[str],
    span_id: Optional[str],
    parent_span_id: Optional[str],
) -> None:
    options = _active_options
    if not options:
        return
    parsed = urlparse(url)
    if error is not None:
        severity = "error"
    elif status_code is not None and status_code >= 500:
        severity = "error"
    elif status_code is not None and status_code >= 400:
        severity = "warn"
    else:
        severity = "info"
    try:
        event = validate_event(
            {
                "id": str(uuid.uuid4()),
                "type": "trace",
                "trace_id": trace_id,
                "span_id": span_id,
                "parent_span_id": parent_span_id,
                "request_id": request_id,
                "service": options["service"],
                "host": parsed.hostname,
                "container": None,
                "deployment_id": options["deployment_id"],
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "duration_ms": duration_ms,
                "attributes": {
                    "method": method,
                    "url": url,
                    "status_code": status_code,
                    "direction": "outbound",
                    "error": str(error) if error else None,
                },
                "resource_attributes": _resource_attributes(),
                "severity": severity,
            }
        )
        options["store"].insert(event)
    except Exception as exc:
        options["store"].record_telemetry_failure(
            operation="outbound_http.trace_event",
            service=options["service"],
            reason=str(exc),
        )


def _instrument_requests() -> None:
    global _patched_requests, _original_requests_request
    if _patched_requests:
        return
    try:
        import requests
    except ImportError:
        return

    original_request = requests.Session.request
    _original_requests_request = original_request

    def wrapped_request(self, method, url, *args: Any, **kwargs: Any):
        started_at = time.monotonic()
        status_code = None
        error = None
        trace_id = get_active_trace_id()
        request_id = get_active_request_id()
        parent_span_id = get_active_span_id()
        span_id = str(uuid.uuid4()) if trace_id else None
        if trace_id and span_id:
            existing_headers = kwargs.get("headers") or {}
            merged_headers = dict(existing_headers)
            merged_headers["x-obyflow-trace-id"] = trace_id
            merged_headers["x-obyflow-parent-span-id"] = span_id
            kwargs["headers"] = merged_headers
        try:
            response = original_request(self, method, url, *args, **kwargs)
            status_code = response.status_code
            return response
        except Exception as exc:
            error = exc
            raise
        finally:
            duration_ms = (time.monotonic() - started_at) * 1000
            _emit_outbound_event(
                method,
                url,
                status_code,
                duration_ms,
                error,
                trace_id,
                request_id,
                span_id,
                parent_span_id,
            )

    requests.Session.request = wrapped_request
    _patched_requests = True


def _instrument_httpx_sync(httpx) -> None:
    global _patched_httpx_sync, _original_httpx_send
    if _patched_httpx_sync:
        return
    original_send = httpx.Client.send
    _original_httpx_send = original_send

    def wrapped_send(self, request, *args: Any, **kwargs: Any):
        started_at = time.monotonic()
        status_code = None
        error = None
        trace_id = get_active_trace_id()
        request_id = get_active_request_id()
        parent_span_id = get_active_span_id()
        span_id = str(uuid.uuid4()) if trace_id else None
        if trace_id and span_id:
            request.headers["x-obyflow-trace-id"] = trace_id
            request.headers["x-obyflow-parent-span-id"] = span_id
        try:
            response = original_send(self, request, *args, **kwargs)
            status_code = response.status_code
            return response
        except Exception as exc:
            error = exc
            raise
        finally:
            duration_ms = (time.monotonic() - started_at) * 1000
            _emit_outbound_event(
                request.method,
                str(request.url),
                status_code,
                duration_ms,
                error,
                trace_id,
                request_id,
                span_id,
                parent_span_id,
            )

    httpx.Client.send = wrapped_send
    _patched_httpx_sync = True


def _instrument_httpx_async(httpx) -> None:
    global _patched_httpx_async, _original_httpx_async_send
    if _patched_httpx_async:
        return
    original_async_send = httpx.AsyncClient.send
    _original_httpx_async_send = original_async_send

    async def wrapped_async_send(self, request, *args: Any, **kwargs: Any):
        started_at = time.monotonic()
        status_code = None
        error = None
        trace_id = get_active_trace_id()
        request_id = get_active_request_id()
        parent_span_id = get_active_span_id()
        span_id = str(uuid.uuid4()) if trace_id else None
        if trace_id and span_id:
            request.headers["x-obyflow-trace-id"] = trace_id
            request.headers["x-obyflow-parent-span-id"] = span_id
        try:
            response = await original_async_send(self, request, *args, **kwargs)
            status_code = response.status_code
            return response
        except Exception as exc:
            error = exc
            raise
        finally:
            duration_ms = (time.monotonic() - started_at) * 1000
            _emit_outbound_event(
                request.method,
                str(request.url),
                status_code,
                duration_ms,
                error,
                trace_id,
                request_id,
                span_id,
                parent_span_id,
            )

    httpx.AsyncClient.send = wrapped_async_send
    _patched_httpx_async = True


def _instrument_httpx() -> None:
    try:
        import httpx
    except ImportError:
        return
    _instrument_httpx_sync(httpx)
    _instrument_httpx_async(httpx)


def instrument_outbound_http(
    service: str, store: Any, deployment_id: Optional[str] = None
) -> None:
    global _active_options
    _active_options = {"service": service, "store": store, "deployment_id": deployment_id}
    _instrument_requests()
    _instrument_httpx()


def _reset_outbound_http_instrumentation_for_tests() -> None:
    global _patched_requests, _patched_httpx_sync, _patched_httpx_async, _active_options
    try:
        import requests

        if _patched_requests and _original_requests_request is not None:
            requests.Session.request = _original_requests_request
    except ImportError:
        pass
    try:
        import httpx

        if _patched_httpx_sync and _original_httpx_send is not None:
            httpx.Client.send = _original_httpx_send
        if _patched_httpx_async and _original_httpx_async_send is not None:
            httpx.AsyncClient.send = _original_httpx_async_send
    except ImportError:
        pass
    _patched_requests = False
    _patched_httpx_sync = False
    _patched_httpx_async = False
    _active_options = None
