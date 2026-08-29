from __future__ import annotations

import contextvars
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Iterator, Optional


@dataclass
class TraceContext:
    trace_id: str
    request_id: str
    span_id: Optional[str] = None
    parent_span_id: Optional[str] = None


_trace_context: contextvars.ContextVar[Optional[TraceContext]] = contextvars.ContextVar(
    "obyflow_trace_context", default=None
)


def set_trace_context(context: TraceContext) -> contextvars.Token:
    return _trace_context.set(context)


def reset_trace_context(token: contextvars.Token) -> None:
    _trace_context.reset(token)


@contextmanager
def with_trace_context(context: TraceContext) -> Iterator[TraceContext]:
    token = set_trace_context(context)
    try:
        yield context
    finally:
        reset_trace_context(token)


def get_active_trace_context() -> Optional[TraceContext]:
    return _trace_context.get()


def get_active_trace_id() -> Optional[str]:
    context = _trace_context.get()
    return context.trace_id if context else None


def get_active_request_id() -> Optional[str]:
    context = _trace_context.get()
    return context.request_id if context else None


def get_active_span_id() -> Optional[str]:
    context = _trace_context.get()
    return context.span_id if context else None


def get_active_parent_span_id() -> Optional[str]:
    context = _trace_context.get()
    return context.parent_span_id if context else None
