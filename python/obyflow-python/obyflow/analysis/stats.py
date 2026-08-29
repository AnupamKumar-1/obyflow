"""Plain mean/stddev z-score baselining for the Python SDK's own use.

This is a Python-only convenience toolkit, not a port of the TypeScript
core anomaly engine (`packages/core/src/anomaly/baseline.ts`), which also
supports median/MAD "robust" baselining, rolling time-windowed buckets,
and deployment-aware bucketing. See the "Anomaly detection: Node vs
Python" section of the root README for the full comparison.
"""

from __future__ import annotations

from typing import List, Optional, TypedDict


class BaselineStats(TypedDict):
    mean: float
    stddev: float
    count: int


DeviationSeverity = str

ZERO_STDDEV_Z_SCORE = 10.0


def mean(values: List[float]) -> float:
    if not values:
        return 0.0
    return sum(values) / len(values)


def stddev(values: List[float], mean_value: Optional[float] = None) -> float:
    if not values:
        return 0.0
    m = mean_value if mean_value is not None else mean(values)
    variance = sum((v - m) ** 2 for v in values) / len(values)
    return variance**0.5


def compute_baseline_stats(values: List[float]) -> BaselineStats:
    m = mean(values)
    return {"mean": m, "stddev": stddev(values, m), "count": len(values)}


def z_score_of(value: float, baseline: BaselineStats) -> float:
    if baseline["stddev"] == 0:
        if value == baseline["mean"]:
            return 0.0
        return ZERO_STDDEV_Z_SCORE if value > baseline["mean"] else -ZERO_STDDEV_Z_SCORE
    return (value - baseline["mean"]) / baseline["stddev"]


def classify_severity(z_score: float) -> DeviationSeverity:
    abs_z = abs(z_score)
    if abs_z < 1:
        return "none"
    if abs_z < 2:
        return "low"
    if abs_z < 3:
        return "medium"
    return "high"
