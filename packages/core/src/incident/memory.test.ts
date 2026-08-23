import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteStore } from "../storage/sqlite-store.js";
import {
  computeFingerprint,
  fingerprintToTokens,
  jaccardSimilarity,
  findSimilarIncidents,
  recordIncidentFingerprint,
  shouldRecordIncident,
} from "./memory.js";
import type { EvidenceObject } from "../evidence/build-evidence.js";

function makeEvidence(overrides: Partial<EvidenceObject> = {}): EvidenceObject {
  return {
    trace_id: overrides.trace_id ?? "t1",
    generated_at: new Date().toISOString(),
    summary: overrides.summary ?? {
      services: ["checkout-service"],
      deployment_ids: [],
      window: { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T00:05:00.000Z" },
      event_count: 0,
      error_count: 0,
      chain_count: 0,
      tool_call_count: 0,
      llm_call_count: 0,
      embedding_count: 0,
      vector_op_count: 0,
    },
    anomalies: overrides.anomalies ?? [],
    evidence: overrides.evidence ?? [],
    redaction_applied: false,
    retrieval_diagnosis: { detected: false, layer: "retrieval", signals: [], summary: null },
    chain_step_diagnosis: {
      detected: false,
      layer: "chain_step",
      signals: [],
      step_tree: [],
      summary: null,
    },
    evidence_graph: { nodes: [], edges: [] },
    telemetry_health: { dropped_event_count: 0, recent_failures: [], gaps: [] },
    what_changed: overrides.what_changed ?? [],
    similar_historical_incidents: [],
  };
}

describe("computeFingerprint", () => {
  it("produces sorted, deduplicated tokens across services/anomalies/changes/errors", () => {
    const evidence = makeEvidence({
      summary: {
        services: ["b-service", "a-service"],
        deployment_ids: [],
        window: { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T00:05:00.000Z" },
        event_count: 2,
        error_count: 1,
        chain_count: 0,
        tool_call_count: 0,
        llm_call_count: 0,
        embedding_count: 0,
        vector_op_count: 0,
      },
      anomalies: [
        {
          service: "a-service",
          metric: "error_rate",
          is_anomalous: true,
        } as unknown as EvidenceObject["anomalies"][number],
      ],
      evidence: [
        {
          id: "e1",
          type: "error",
          service: "a-service",
          timestamp: "2026-01-01T00:01:00.000Z",
          duration_ms: null,
          severity: "error",
          relevance_score: 90,
          reason: "boom",
          attributes: {},
        },
      ],
    });
    const fingerprint = computeFingerprint(evidence);
    expect(fingerprint.services).toEqual(["a-service", "b-service"]);
    expect(fingerprint.anomaly_types).toEqual(["a-service:error_rate"]);
    expect(fingerprint.error_signatures).toEqual(["a-service:error:boom"]);
  });
});

describe("jaccardSimilarity", () => {
  it("returns 1 for identical token sets", () => {
    expect(jaccardSimilarity(["a", "b"], ["b", "a"])).toBe(1);
  });

  it("returns 0 for disjoint token sets", () => {
    expect(jaccardSimilarity(["a"], ["b"])).toBe(0);
  });

  it("returns a partial score for partially overlapping sets", () => {
    const score = jaccardSimilarity(["a", "b", "c"], ["a", "d"]);
    expect(score).toBeCloseTo(1 / 4);
  });
});

describe("findSimilarIncidents", () => {
  let store: SqliteStore;

  beforeEach(() => {
    store = new SqliteStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("finds a previously recorded incident with overlapping fingerprint tokens", () => {
    const past = makeEvidence({
      trace_id: "past-1",
      summary: {
        services: ["checkout-service"],
        deployment_ids: [],
        window: { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T00:05:00.000Z" },
        event_count: 1,
        error_count: 1,
        chain_count: 0,
        tool_call_count: 0,
        llm_call_count: 0,
        embedding_count: 0,
        vector_op_count: 0,
      },
      evidence: [
        {
          id: "e1",
          type: "error",
          service: "checkout-service",
          timestamp: "2026-01-01T00:01:00.000Z",
          duration_ms: null,
          severity: "error",
          relevance_score: 90,
          reason: "timeout calling payment gateway",
          attributes: {},
        },
      ],
    });
    const pastFingerprint = computeFingerprint(past);
    recordIncidentFingerprint(
      store,
      "past-1",
      past.summary.window,
      pastFingerprint,
      "checkout-service: 1 error(s)",
    );

    const current = makeEvidence({
      trace_id: "current-1",
      summary: {
        services: ["checkout-service"],
        deployment_ids: [],
        window: { start: "2026-02-01T00:00:00.000Z", end: "2026-02-01T00:05:00.000Z" },
        event_count: 1,
        error_count: 1,
        chain_count: 0,
        tool_call_count: 0,
        llm_call_count: 0,
        embedding_count: 0,
        vector_op_count: 0,
      },
      evidence: [
        {
          id: "e2",
          type: "error",
          service: "checkout-service",
          timestamp: "2026-02-01T00:01:00.000Z",
          duration_ms: null,
          severity: "error",
          relevance_score: 90,
          reason: "timeout calling payment gateway",
          attributes: {},
        },
      ],
    });
    const currentFingerprint = computeFingerprint(current);
    const similar = findSimilarIncidents(store, currentFingerprint, "current-1");
    expect(similar.length).toBe(1);
    expect(similar[0].trace_id).toBe("past-1");
    expect(similar[0].similarity).toBeGreaterThan(0);
  });

  it("excludes the incident's own trace_id from its own similarity results", () => {
    const evidence = makeEvidence({ trace_id: "self-1" });
    const fingerprint = computeFingerprint(evidence);
    recordIncidentFingerprint(store, "self-1", evidence.summary.window, fingerprint, "self");
    const similar = findSimilarIncidents(store, fingerprint, "self-1");
    expect(similar.length).toBe(0);
  });

  it("does not match incidents below the minimum similarity threshold", () => {
    const unrelated = makeEvidence({
      trace_id: "unrelated-1",
      summary: {
        services: ["totally-different-service"],
        deployment_ids: [],
        window: { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T00:05:00.000Z" },
        event_count: 0,
        error_count: 0,
        chain_count: 0,
        tool_call_count: 0,
        llm_call_count: 0,
        embedding_count: 0,
        vector_op_count: 0,
      },
    });
    recordIncidentFingerprint(
      store,
      "unrelated-1",
      unrelated.summary.window,
      computeFingerprint(unrelated),
      "unrelated",
    );

    const current = makeEvidence({ trace_id: "current-2" });
    const similar = findSimilarIncidents(store, computeFingerprint(current), "current-2");
    expect(similar.length).toBe(0);
  });
});

describe("shouldRecordIncident", () => {
  it("returns false for a clean trace with no errors, anomalies, or changes", () => {
    expect(shouldRecordIncident(makeEvidence())).toBe(false);
  });

  it("returns true when there is at least one error", () => {
    const evidence = makeEvidence({
      summary: {
        services: ["checkout-service"],
        deployment_ids: [],
        window: { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T00:05:00.000Z" },
        event_count: 1,
        error_count: 1,
        chain_count: 0,
        tool_call_count: 0,
        llm_call_count: 0,
        embedding_count: 0,
        vector_op_count: 0,
      },
    });
    expect(shouldRecordIncident(evidence)).toBe(true);
  });
});

describe("fingerprintToTokens", () => {
  it("prefixes each fingerprint category distinctly", () => {
    const tokens = fingerprintToTokens({
      services: ["svcA"],
      anomaly_types: ["svcA:error_rate"],
      change_types: ["svcA:deployment"],
      error_signatures: ["svcA:error:boom"],
    });
    expect(tokens).toEqual([
      "svc:svcA",
      "anom:svcA:error_rate",
      "chg:svcA:deployment",
      "err:svcA:error:boom",
    ]);
  });
});
