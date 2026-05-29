import type { EvalResult, WriterResult } from "./types.ts";

function getKeywordDangerCount(evalResult: EvalResult): number {
  return evalResult.seoEvaluation?.keywordReport.items.filter((item) => item.status === "danger").length ?? 0;
}

function getSeoScore(evalResult: EvalResult): number {
  return evalResult.seoEvaluation?.score ?? 0;
}

function getNaverScore(evalResult: EvalResult): number {
  return evalResult.naverLogicEvaluation?.completenessScore ?? 0;
}

function getFinalDraftBlockingCount(writerResult: WriterResult): number {
  return writerResult.finalDraftCheck?.blockingReasons.length ?? 0;
}

export function shouldAttemptWriterRevision(evalResult: EvalResult, writerResult: WriterResult): boolean {
  if (evalResult.pass && getFinalDraftBlockingCount(writerResult) === 0) return false;

  const keywordReport = evalResult.seoEvaluation?.keywordReport;
  const overallRisk = keywordReport?.overallRisk ?? "low";
  const dangerCount = getKeywordDangerCount(evalResult);
  const paragraphWarningCount = keywordReport?.paragraphWarnings.length ?? 0;
  const seoScore = getSeoScore(evalResult);
  const naverScore = getNaverScore(evalResult);
  const finalDraftBlockingCount = getFinalDraftBlockingCount(writerResult);

  return (
    finalDraftBlockingCount > 0 ||
    evalResult.aggregateScore < 72 ||
    seoScore < 72 ||
    naverScore < 70 ||
    dangerCount >= 2 ||
    overallRisk === "high" ||
    paragraphWarningCount >= 2
  );
}
