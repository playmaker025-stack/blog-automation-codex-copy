import type { EvalResult, WriterResult } from "./types.ts";
import { shouldReviseForCitation } from "./citation-readiness.ts";

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
  // AI 인용 가능성이 부족하면 점수와 무관하게 재작성한다.
  // 목표가 네이버 AI탭 노출이라 인용 가능성은 통과 조건이 아니라 최대화 대상이다.
  const citationGap = shouldReviseForCitation(writerResult.citationReadiness);
  if (evalResult.pass && getFinalDraftBlockingCount(writerResult) === 0 && !citationGap) return false;

  const keywordReport = evalResult.seoEvaluation?.keywordReport;
  const overallRisk = keywordReport?.overallRisk ?? "low";
  const dangerCount = getKeywordDangerCount(evalResult);
  const paragraphWarningCount = keywordReport?.paragraphWarnings.length ?? 0;
  const seoScore = getSeoScore(evalResult);
  const naverScore = getNaverScore(evalResult);
  const finalDraftBlockingCount = getFinalDraftBlockingCount(writerResult);

  return (
    citationGap ||
    finalDraftBlockingCount > 0 ||
    evalResult.aggregateScore < 72 ||
    seoScore < 72 ||
    naverScore < 70 ||
    dangerCount >= 2 ||
    overallRisk === "high" ||
    paragraphWarningCount >= 2
  );
}
