from __future__ import annotations

from typing import Callable, Dict, Optional, Tuple


def _normalize_headers(headers: Dict[str, str]) -> Dict[str, str]:
    return {key.lower(): value for key, value in headers.items()}


def extract_inbound_trace_headers(
    headers: Dict[str, str],
    generate_id: Callable[[], str],
) -> Tuple[str, Optional[str]]:
    normalized = _normalize_headers(headers)
    trace_id = normalized.get("x-obyflow-trace-id") or generate_id()
    parent_span_id = normalized.get("x-obyflow-parent-span-id")
    return trace_id, parent_span_id
