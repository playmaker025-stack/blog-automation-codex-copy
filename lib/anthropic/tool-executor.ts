import type { MessageParam, ToolResultBlockParam, ContentBlock } from "@anthropic-ai/sdk/resources/messages";
import { APIConnectionError, APIUserAbortError, InternalServerError, RateLimitError } from "@anthropic-ai/sdk";
import { getAnthropicClient } from "./client";
import { recordUsage, recordApiFailure } from "./usage-recorder";
import type { ToolUseLoopOptions } from "@/lib/types/agent";

const DEFAULT_MAX_ITERATIONS = 10;
const SKILL_TIMEOUT_MS = 30_000;
const NETWORK_RETRY_ATTEMPTS = 3;
const NETWORK_RETRY_BASE_DELAY_MS = 2_000;
// 2026-07-06 실측: 최종 전략 JSON을 쓰는 마지막 iteration이 4096 토큰으로 잘려
// stop_reason=max_tokens가 났다(도구 호출은 iteration 1~3에서 정상 완료, iteration 4가
// 최종 출력 생성 중 중단). outline 여러 섹션 + AEO/인간지문 지시문을 담은 JSON은
// 4096으로 빠듯할 수 있어 여유를 둔다.
const MAX_OUTPUT_TOKENS = 8192;

// INITIAL: 첫 스트림 이벤트 수신 전 허용 지연 (Anthropic 큐잉 + 첫 토큰까지).
// STALL: 첫 이벤트 수신 후 연속 무응답 허용 시간.
// HARD_DEADLINE: stall 타이머가 실패해도 HTTP 연결 자체를 강제 종료하는 최종 백업.
const INITIAL_TIMEOUT_MS = 150_000;
const STALL_TIMEOUT_MS = 90_000;
const HARD_DEADLINE_MS = 160_000;

// stall 타이머가 발동시키는 에러를 name으로 구분해 재시도 대상으로 분류한다
// (연결이 살아있는지조차 확인 안 되는 "멎음"도 premature close와 같은 부류의 실패).
class StallTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StallTimeoutError";
  }
}

// client.ts는 maxRetries:0으로 SDK 내부 재시도를 꺼둔다. non-streaming
// client.messages.create()는 응답이 다 만들어질 때까지 바이트가 전혀 흐르지 않아
// "Premature close"(응답 완료 전 연결 종료) 오류에 구조적으로 취약했다 — 재시도 3회를
// 붙여도 매 시도가 같은 방식으로 끊겨 계속 실패했다(2026-07-02~07-03 반복 재현).
// client.messages.stream()으로 전환해 SSE 이벤트가 계속 흐르게 하면 중간 유휴
// 연결로 오인되어 끊기는 문제 자체가 줄어든다(master-writer.ts와 동일 패턴).
// 그래도 연결이 아예 안 열리거나 도중에 멎는 등 진짜 일시적 문제는 여전히 재시도한다.
//
// 2026-07-03 실측: Railway 환경에서 "400 Invalid response body ... Premature
// close"가 반복 재현됐는데, 로컬에서 동일 요청을 재현해보니 실제 원인은
// Anthropic 크레딧 소진(진짜 응답은 BadRequestError, status=400, credit
// balance too low)이었다 — Railway 쪽에서만 그 에러 본문을 읽는 것 자체가
// 실패해 "Premature close"로 가려진 것. status가 명확한 4xx로 찍혀 있으면
// 서버가 이미 요청을 거부한 것이므로, 동일 요청을 재시도해도 똑같이 거부된다.
// 단, 이 SDK(core.js shouldRetry)가 원래 재시도 대상으로 보는 408(요청
// 타임아웃)/409(락 타임아웃)/429(rate limit)/5xx는 여전히 재시도한다 —
// client.ts가 maxRetries:0으로 SDK 자체 재시도를 꺼둔 만큼 여기서 그 역할을
// 대신해야 한다(codex-rescue 리뷰로 408/409 누락을 확인, 2026-07-03).
const NON_RETRYABLE_4XX = new Set([400, 401, 403, 404, 422]);
function isRetryableConnectionError(error: unknown): boolean {
  if (error instanceof RateLimitError) return true;
  if (error instanceof InternalServerError) return true;
  if (error instanceof StallTimeoutError) return true;
  if (error instanceof APIUserAbortError) return true;

  const status = (error as { status?: number } | null)?.status;
  if (typeof status === "number" && NON_RETRYABLE_4XX.has(status)) {
    return false;
  }

  if (error instanceof APIConnectionError) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("premature close") ||
    message.includes("econnreset") ||
    message.includes("socket hang up") ||
    message.includes("fetch failed") ||
    message.includes("aborterror")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SKILL_LABELS: Record<string, string> = {
  user_profile_loader: "사용자 프로필 로드",
  user_corpus_retriever: "코퍼스 분석",
  topic_feasibility_judge: "주제 가능성 점검",
  naver_keyword_research: "네이버 키워드 리서치",
  naver_content_fetcher: "상위 블로그 본문 분석",
  review_record_audit: "과거 발행 패턴 분석",
  source_resolver: "참조 URL 검증",
};

export async function runToolUseLoop(options: ToolUseLoopOptions): Promise<string> {
  const {
    model,
    system,
    tools,
    toolRegistry,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    onProgress,
    signal: pipelineSignal,
  } = options;

  const client = getAnthropicClient();
  const messages: MessageParam[] = [...options.messages];
  let iterations = 0;
  // 루프를 빠져나온 진짜 이유를 구분하기 위해 마지막 stop_reason을 기록해 둔다.
  // 2026-07-06 실측: max_tokens로 응답이 잘려 tool_use 없이 while 루프를 조기
  // 탈출(break)한 경우에도 "N회 반복 한계 도달"이라는 같은 메시지가 떠서
  // 실제 원인(토큰 초과)이 완전히 가려졌었다.
  let lastStopReason: string | null = null;

  while (iterations < maxIterations) {
    iterations += 1;

    let finalContent: ContentBlock[] | null = null;
    let finalStopReason: string | null = null;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= NETWORK_RETRY_ATTEMPTS; attempt++) {
      let stallTimer: ReturnType<typeof setTimeout> | null = null;
      let stallReject: ((err: Error) => void) | null = null;
      let firstEventReceived = false;
      let firstEventAt: number | null = null;
      let finalizingStartedAt: number | null = null;
      // 실패 시점의 대략적인 단계 표시. "pre_first_event"는 이 SDK의 stream()
      // 이벤트를 아직 하나도 못 받았다는 뜻일 뿐이며, "TCP/TLS 연결이 아예 안
      // 열렸다"거나 "응답 바이트를 한 바이트도 못 받았다"를 보장하지는 않는다
      // (HTTP 헤더까지 받고 첫 SSE 이벤트 전에 끊기는 경우도 여기 포함됨) —
      // codex-rescue 리뷰가 phase="connecting"이라는 이름이 실제 신뢰 수준보다
      // 과장돼 보인다고 지적해 이름과 주석을 정정했다(2026-07-06). stale 소켓
      // 재사용 여부를 확정하려면 이 파일보다 낮은 레벨(fetch/undici dispatcher)
      // 계측이 추가로 필요하다.
      let phase: "pre_first_event" | "streaming" | "finalizing" = "pre_first_event";
      // 이 시도 전용 AbortController — stall/hard-deadline이 뜨면 실제 스트림도
      // 강제로 끊어서, 버려진 이전 시도가 나중에 조용히 완료되며 finalContent를
      // 덮어쓰는 레이스를 막는다. attemptContent/attemptStopReason도 시도별로
      // 분리해 두어, Promise.race가 성공으로 끝난 경우에만 바깥 변수에 반영한다.
      const attemptAbort = new AbortController();

      const resetStallTimer = () => {
        if (stallTimer) clearTimeout(stallTimer);
        if (!stallReject) return;
        const ms = firstEventReceived ? STALL_TIMEOUT_MS : INITIAL_TIMEOUT_MS;
        stallTimer = setTimeout(() => {
          attemptAbort.abort();
          stallReject!(
            new StallTimeoutError(
              firstEventReceived
                ? `AI 응답 스트림 타임아웃 — ${ms / 1000}초 이상 토큰 없음 (iter=${iterations})`
                : `AI 응답 초기 타임아웃 — ${ms / 1000}초 이내 첫 토큰 없음 (iter=${iterations})`
            )
          );
        }, ms);
      };

      const attemptStartedAt = Date.now();
      try {
        onProgress?.(
          attempt === 1
            ? `AI 분석 중... (${iterations}/${maxIterations})`
            : `AI 분석 재시도 중... (${iterations}/${maxIterations}, ${attempt}회차)`
        );
        console.log(`[tool-executor] iteration ${iterations} stream start (attempt ${attempt}/${NETWORK_RETRY_ATTEMPTS})`);

        const stallPromise = new Promise<never>((_, reject) => {
          stallReject = reject;
          resetStallTimer();
        });

        const hardDeadline = AbortSignal.timeout(HARD_DEADLINE_MS);
        const signals = [attemptAbort.signal, hardDeadline];
        if (pipelineSignal) signals.push(pipelineSignal);
        const callSignal = AbortSignal.any(signals);

        let attemptContent: ContentBlock[] | null = null;
        let attemptStopReason: string | null = null;

        await Promise.race([
          (async () => {
            const stream = client.messages.stream(
              { model, system, messages, tools, max_tokens: MAX_OUTPUT_TOKENS },
              { signal: callSignal }
            );

            for await (const event of stream) {
              if (!firstEventReceived) {
                firstEventReceived = true;
                firstEventAt = Date.now();
                phase = "streaming";
              }
              resetStallTimer();
              if (event.type === "message_stop") attemptStopReason = "end_turn";
            }

            phase = "finalizing";
            finalizingStartedAt = Date.now();
            const finalMsg = await stream.finalMessage();
            attemptStopReason = finalMsg.stop_reason ?? attemptStopReason;
            attemptContent = finalMsg.content;
            // 사용량 집계. 실패해도 던지지 않으므로 파이프라인에 영향 없다.
            recordUsage(finalMsg.model ?? model, finalMsg.usage, "tool-executor");
          })(),
          stallPromise,
        ]);

        // 여기 도달했다는 건 이 시도(attempt)가 stall/abort 없이 끝까지 완료됐다는
        // 뜻이므로만 바깥 상태를 갱신한다 — 버려진 이전 시도는 절대 여기 도달 못 함.
        finalContent = attemptContent;
        finalStopReason = attemptStopReason;
        console.log(`[tool-executor] iteration ${iterations} stream done - stop_reason=${finalStopReason}`);
        lastError = null;
        break;
      } catch (error) {
        attemptAbort.abort();
        lastError = error;
        recordApiFailure(error, "tool-executor");
        const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
        // cause가 Error 인스턴스가 아닌 순수 객체(undici/fetch 내부 에러 등)로 올 때도
        // code/errno를 놓치지 않도록 완화 — instanceof Error로만 좁히면 정작 중요한
        // 구조화 필드가 조용히 undefined로 빠질 수 있었다(codex-rescue 리뷰, 2026-07-06).
        const causeObj =
          cause && typeof cause === "object"
            ? (cause as { code?: unknown; errno?: unknown; name?: unknown; message?: unknown })
            : null;
        console.error("[tool-executor] Anthropic API 오류:", {
          attempt,
          phase,
          elapsedMs: Date.now() - attemptStartedAt,
          firstEventReceived,
          timeToFirstEventMs: firstEventAt ? firstEventAt - attemptStartedAt : null,
          timeInFinalizingMs: finalizingStartedAt ? Date.now() - finalizingStartedAt : null,
          name: error instanceof Error ? error.constructor.name : "UnknownError",
          message: error instanceof Error ? error.message : String(error),
          status: (error as { status?: number }).status,
          cause,
          causeName: causeObj?.name,
          causeMessage: causeObj?.message,
          causeCode: causeObj?.code,
          causeErrno: causeObj?.errno,
          code: error instanceof Error ? (error as { code?: string }).code : undefined,
        });

        const canRetry = attempt < NETWORK_RETRY_ATTEMPTS && isRetryableConnectionError(error) && !pipelineSignal?.aborted;
        if (!canRetry) throw error;

        const delayMs = NETWORK_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
        onProgress?.(`AI 연결이 불안정해 ${Math.round(delayMs / 1000)}초 후 재시도합니다... (${attempt}/${NETWORK_RETRY_ATTEMPTS})`);
        await sleep(delayMs);
      } finally {
        if (stallTimer) clearTimeout(stallTimer);
      }
    }

    if (!finalContent) {
      throw lastError ?? new Error("Anthropic API 호출이 재시도 후에도 실패했습니다.");
    }

    const content = finalContent as ContentBlock[];
    messages.push({ role: "assistant", content });
    lastStopReason = finalStopReason;

    if (finalStopReason === "end_turn") {
      const textBlock = content.find((block) => block.type === "text");
      return textBlock && "text" in textBlock ? textBlock.text : "";
    }

    const toolUseBlocks = content.filter((block) => block.type === "tool_use");
    if (toolUseBlocks.length > 0) {
      const toolResults: ToolResultBlockParam[] = [];

      for (const block of toolUseBlocks) {
        const skillFn = toolRegistry[block.name];
        if (!skillFn) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            is_error: true,
            content: `등록되지 않은 도구입니다: "${block.name}"`,
          });
          continue;
        }

        try {
          onProgress?.(`${SKILL_LABELS[block.name] ?? block.name} 진행 중...`);
          console.log(`[tool-executor] skill "${block.name}" start`);
          const result = await Promise.race([
            skillFn(block.input),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error(`도구 실행 시간 초과: "${block.name}" (${SKILL_TIMEOUT_MS / 1000}초)`)),
                SKILL_TIMEOUT_MS
              )
            ),
          ]);
          console.log(`[tool-executor] skill "${block.name}" done`);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "도구 실행 오류";
          console.error(`[tool-executor] skill "${block.name}" error:`, message);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            is_error: true,
            content: message,
          });
        }
      }

      messages.push({ role: "user", content: toolResults });
      continue;
    }

    break;
  }

  // iterations가 maxIterations에 도달해서 while 조건으로 자연 종료된 경우에만
  // "반복 한계 도달"이 맞는 설명이다. 그 외(예: max_tokens로 잘려 tool_use 없이
  // break한 경우)에는 실제 stop_reason을 그대로 알려준다.
  if (iterations >= maxIterations) {
    throw new Error(`tool-use 루프가 ${maxIterations}회 반복 한계에 도달했습니다.`);
  }
  throw new Error(
    `AI 응답이 예상치 못한 사유(stop_reason=${lastStopReason ?? "unknown"})로 중단되었습니다. (iteration ${iterations}/${maxIterations})`
  );
}
