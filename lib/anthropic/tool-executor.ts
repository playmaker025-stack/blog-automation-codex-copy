import type { MessageParam, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { APIConnectionError, InternalServerError, RateLimitError } from "@anthropic-ai/sdk";
import { getAnthropicClient } from "./client";
import type { ToolUseLoopOptions } from "@/lib/types/agent";

const DEFAULT_MAX_ITERATIONS = 10;
const CALL_TIMEOUT_MS = 90_000;
const SKILL_TIMEOUT_MS = 30_000;
const NETWORK_RETRY_ATTEMPTS = 3;
const NETWORK_RETRY_BASE_DELAY_MS = 2_000;

// client.ts는 maxRetries:0으로 SDK 내부 재시도를 꺼둔다 (조용한 대기가 아니라
// 여기서 명시적으로 backoff 로그를 남기며 재시도하기 위해서). "Premature close" 같은
// 연결 레벨 오류는 크레딧/스키마 문제가 아니라 순수 네트워크 불안정이므로 재시도가 맞다.
function isRetryableConnectionError(error: unknown): boolean {
  if (error instanceof APIConnectionError) return true;
  if (error instanceof RateLimitError) return true;
  if (error instanceof InternalServerError) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("premature close") ||
    message.includes("econnreset") ||
    message.includes("socket hang up") ||
    message.includes("fetch failed")
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

  while (iterations < maxIterations) {
    iterations += 1;

    let response: Awaited<ReturnType<typeof client.messages.create>> | null = null;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= NETWORK_RETRY_ATTEMPTS; attempt++) {
      try {
        const callTimeoutSignal = AbortSignal.timeout(CALL_TIMEOUT_MS);
        const callSignal = pipelineSignal
          ? AbortSignal.any([callTimeoutSignal, pipelineSignal])
          : callTimeoutSignal;

        onProgress?.(
          attempt === 1
            ? `AI 분석 중... (${iterations}/${maxIterations})`
            : `AI 분석 재시도 중... (${iterations}/${maxIterations}, ${attempt}회차)`
        );
        console.log(`[tool-executor] iteration ${iterations} API call start (attempt ${attempt}/${NETWORK_RETRY_ATTEMPTS})`);
        response = await client.messages.create(
          {
            model,
            system,
            messages,
            tools,
            max_tokens: 4096,
          },
          { signal: callSignal }
        );
        console.log(`[tool-executor] iteration ${iterations} API call done - stop_reason=${response.stop_reason}`);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        console.error("[tool-executor] Anthropic API 오류:", {
          attempt,
          name: error instanceof Error ? error.constructor.name : "UnknownError",
          message: error instanceof Error ? error.message : String(error),
          status: (error as { status?: number }).status,
          cause: error instanceof Error ? (error as { cause?: unknown }).cause : undefined,
          code: error instanceof Error ? (error as { code?: string }).code : undefined,
        });

        const canRetry = attempt < NETWORK_RETRY_ATTEMPTS && isRetryableConnectionError(error) && !pipelineSignal?.aborted;
        if (!canRetry) throw error;

        const delayMs = NETWORK_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
        onProgress?.(`AI 연결이 불안정해 ${Math.round(delayMs / 1000)}초 후 재시도합니다... (${attempt}/${NETWORK_RETRY_ATTEMPTS})`);
        await sleep(delayMs);
      }
    }

    if (!response) {
      throw lastError ?? new Error("Anthropic API 호출이 재시도 후에도 실패했습니다.");
    }

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find((block) => block.type === "text");
      return textBlock && "text" in textBlock ? textBlock.text : "";
    }

    if (response.stop_reason === "tool_use") {
      const toolResults: ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== "tool_use") continue;

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

  throw new Error(`tool-use 루프가 ${maxIterations}회 반복 한계에 도달했습니다.`);
}
