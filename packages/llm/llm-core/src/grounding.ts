import type { EvidenceObject } from "@obyflow/core";

export interface EvidenceGroundingResult {
  grounded_evidence_refs: string[];
  ungrounded_evidence_refs: string[];
  groundedness_ratio: number;
  groundedness_warning: string | null;
}

export function validateEvidenceGrounding(
  evidence: EvidenceObject,
  evidenceRefs: string[],
): EvidenceGroundingResult {
  const validIds = new Set(evidence.evidence.map((item) => item.id));
  const groundedEvidenceRefs = evidenceRefs.filter((ref) => validIds.has(ref));
  const ungroundedEvidenceRefs = evidenceRefs.filter((ref) => !validIds.has(ref));
  const groundednessRatio =
    evidenceRefs.length === 0 ? 0 : groundedEvidenceRefs.length / evidenceRefs.length;

  let groundednessWarning: string | null = null;
  if (evidenceRefs.length === 0) {
    groundednessWarning =
      "The model returned no evidence_refs; this finding is not grounded in any specific evidence item.";
  } else if (ungroundedEvidenceRefs.length > 0) {
    groundednessWarning = `${ungroundedEvidenceRefs.length} of ${evidenceRefs.length} evidence_refs do not match any id in the supplied evidence object and may be hallucinated.`;
  }

  return {
    grounded_evidence_refs: groundedEvidenceRefs,
    ungrounded_evidence_refs: ungroundedEvidenceRefs,
    groundedness_ratio: Math.round(groundednessRatio * 1000) / 1000,
    groundedness_warning: groundednessWarning,
  };
}
