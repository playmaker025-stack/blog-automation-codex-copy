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
  // 실제 결함일 때만 다시 쓴다.
  //
  // 왜 바뀌었나(2026-08-25): 예전에는 인용 점수가 100점이 아니거나 종합/SEO/네이버
  // 점수가 기준 미만이면 전체를 다시 썼다. 실측 결과 그 기준들이 재작성을 사실상
  // 상시 유발하면서도 글은 나아지지 않았다.
  //   - 사장님이 실제 발행한 글 185편 중 인용 100점은 7편(4%)뿐이었다.
  //   - AI가 쓴 글 66편 중 하네스 통과선 90점을 넘은 건 0편이었다.
  //   - 키워드 반복수는 겹치는 상위 키워드를 중복 집계해 정상 글도 위험으로 찍혔다.
  //   - 게다가 재작성이 인용 점수를 올려도 isMaterialRevisionImprovement가 그걸
  //     보지 않아 결과가 폐기될 수 있었다.
  // 도달 불가능한 기준으로 글을 두 번 더 쓰는 것은 비용만 쓴다. 지금은 "무엇이
  // 잘못됐는지 말할 수 있을 때"만 재작성한다. 나머지는 검토 화면에 경고로 남긴다.
  if (getFinalDraftBlockingCount(writerResult) > 0) return true;

  // 키워드 과다는 겹침 보정 뒤로는 신뢰할 수 있는 신호다.
  return getKeywordDangerCount(evalResult) >= 2 || getSeoScore(evalResult) < 40 || getNaverScore(evalResult) < 40;
}
