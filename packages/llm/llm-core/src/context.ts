import type { EvidenceObject } from "@obyflow/core";
import { estimateTokenCount } from "./token-usage.js";

export interface ContextTrimSummary {
  trimmed_evidence_items: number;
  trimmed_what_changed: number;
  trimmed_similar_incidents: number;
  estimated_prompt_tokens: number;
}

export interface ContextTrimResult {
  evidence: EvidenceObject;
  trim: ContextTrimSummary;
}

const RESERVED_OUTPUT_TOKENS = 2000;
const PROMPT_OVERHEAD_TOKENS = 500;
const MIN_EVIDENCE_ITEMS = 5;
const MIN_WHAT_CHANGED_ITEMS = 3;

function estimate(evidence: EvidenceObject): number {
  return estimateTokenCount(JSON.stringify(evidence));
}

export function trimEvidenceForContext(
  evidence: EvidenceObject,
  contextLimit: number,
): ContextTrimResult {
  let working: EvidenceObject = evidence;
  let trimmedEvidenceItems = 0;
  let trimmedWhatChanged = 0;
  let trimmedSimilarIncidents = 0;

  const budget = Math.max(contextLimit - RESERVED_OUTPUT_TOKENS - PROMPT_OVERHEAD_TOKENS, 0);
  let currentTokens = estimate(working);

  if (budget === 0 || currentTokens <= budget) {
    return {
      evidence: working,
      trim: {
        trimmed_evidence_items: 0,
        trimmed_what_changed: 0,
        trimmed_similar_incidents: 0,
        estimated_prompt_tokens: currentTokens,
      },
    };
  }

  if (working.similar_historical_incidents.length > 0) {
    const sorted = [...working.similar_historical_incidents].sort(
      (a, b) => b.similarity - a.similarity,
    );
    while (currentTokens > budget && sorted.length > 0) {
      sorted.pop();
      trimmedSimilarIncidents += 1;
      working = { ...working, similar_historical_incidents: sorted.slice() };
      currentTokens = estimate(working);
    }
  }

  if (currentTokens > budget && working.what_changed.length > MIN_WHAT_CHANGED_ITEMS) {
    const sorted = [...working.what_changed].sort((a, b) => b.relevance_score - a.relevance_score);
    while (currentTokens > budget && sorted.length > MIN_WHAT_CHANGED_ITEMS) {
      sorted.pop();
      trimmedWhatChanged += 1;
      working = { ...working, what_changed: sorted.slice() };
      currentTokens = estimate(working);
    }
  }

  if (currentTokens > budget && working.evidence.length > MIN_EVIDENCE_ITEMS) {
    const sorted = [...working.evidence].sort((a, b) => b.relevance_score - a.relevance_score);
    while (currentTokens > budget && sorted.length > MIN_EVIDENCE_ITEMS) {
      sorted.pop();
      trimmedEvidenceItems += 1;
      working = { ...working, evidence: sorted.slice() };
      currentTokens = estimate(working);
    }
  }

  return {
    evidence: working,
    trim: {
      trimmed_evidence_items: trimmedEvidenceItems,
      trimmed_what_changed: trimmedWhatChanged,
      trimmed_similar_incidents: trimmedSimilarIncidents,
      estimated_prompt_tokens: currentTokens,
    },
  };
}
