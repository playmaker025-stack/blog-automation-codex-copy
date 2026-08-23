/**
 * demand-error — 추출 실패 분류의 순수 로직.
 *
 * LLM 호출은 demand-extractor.ts가 담당한다. 실패 판정은 외부 의존이 없어야
 * 테스트할 수 있어서 분리했다.
 */

/**
 * 재시도해도 소용없는 실패인지 본다.
 *
 * 실측(2026-08-23): 크레딧 소진 상태에서 haiku가 400으로 거부됐는데 sonnet으로
 * 폴백해 똑같이 거부됐다. 호출만 하나 더 낭비했다. 계정 단위 거부는 모델을 바꿔도
 * 결과가 같다. tool-executor.ts의 NON_RETRYABLE_4XX와 같은 판단이다.
 *
 * CLAUDE.md의 [2026-07-03] 항목: 이 증상이 보이면 코드를 파기 전에
 * https://console.anthropic.com/settings/billing 에서 잔액부터 확인할 것.
 */
export function isAccountLevelFailure(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  if (typeof status === "number" && [400, 401, 403].includes(status)) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("credit balance is too low") ||
    message.includes("insufficient") ||
    message.includes("invalid x-api-key")
  );
}

/** 화면에 그대로 노출되므로 원문 JSON 대신 무엇을 해야 하는지 적는다. */
export function describeExtractionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.toLowerCase().includes("credit balance is too low")) {
    return "Anthropic 크레딧이 소진됐습니다. console.anthropic.com/settings/billing 에서 충전한 뒤 다시 시도하세요.";
  }
  if (message.toLowerCase().includes("invalid x-api-key")) {
    return "Anthropic API 키가 유효하지 않습니다. ANTHROPIC_API_KEY를 확인하세요.";
  }
  return message.slice(0, 300);
}
