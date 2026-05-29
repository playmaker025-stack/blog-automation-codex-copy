type OpenAIRole = "system" | "user" | "assistant";

export interface OpenAIInputMessage {
  role: OpenAIRole;
  content: string;
}

export interface OpenAITextRequest {
  model: string;
  input: OpenAIInputMessage[];
  maxOutputTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  onRetry?: (info: OpenAIRetryInfo) => void;
}

export interface OpenAIJsonRequest extends OpenAITextRequest {
  schemaName: string;
  schema: Record<string, unknown>;
}

export interface OpenAIRetryInfo {
  status: number;
  attempt: number;
  delayMs: number;
  reason: "rate_limit";
}

export function hasOpenAIKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function extractOpenAIOutputText(response: unknown): string {
  const direct = (response as { output_text?: unknown }).output_text;
  if (typeof direct === "string") return direct.trim();

  const output = (response as { output?: Array<{ content?: Array<{ text?: unknown }> }> }).output;
  if (!Array.isArray(output)) return "";

  return output
    .flatMap((item) => item.content ?? [])
    .map((content) => content.text)
    .filter((text): text is string => typeof text === "string")
    .join("\n")
    .trim();
}

export function parseRateLimitDelayMs(errorText: string, retryAfterHeader: string | null, attempt: number): number {
  const retryAfterSeconds = Number(retryAfterHeader ?? "");
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(Math.ceil(retryAfterSeconds * 1000), 30_000);
  }

  const explicitWait = errorText.match(/Please try again in\s+([\d.]+)s/i);
  if (explicitWait) {
    return Math.min(Math.ceil(Number(explicitWait[1]) * 1000) + 500, 30_000);
  }

  return Math.min(4_500 + attempt * 2_000, 30_000);
}

export function parseOpenAIRateLimitWaitMs(errorText: string): number | null {
  const explicitWait = errorText.match(/Please try again in\s+([\d.]+)s/i);
  if (!explicitWait) return null;
  const seconds = Number(explicitWait[1]);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : null;
}

export function isOpenAIRateLimitErrorText(errorText: string): boolean {
  return /rate limit reached|rate_limit_exceeded|tokens per min|TPM/i.test(errorText);
}

export function formatOpenAIRateLimitUserMessage(errorText: string, retryAfterHeader: string | null): string {
  const waitMs =
    parseOpenAIRateLimitWaitMs(errorText) ??
    (Number.isFinite(Number(retryAfterHeader ?? "")) ? Math.ceil(Number(retryAfterHeader ?? "") * 1000) : null);

  if (waitMs) {
    const waitSeconds = Math.max(1, Math.ceil(waitMs / 1000));
    return `AI 요청량 제한에 걸렸습니다. 약 ${waitSeconds}초 후 다시 시도해 주세요.`;
  }

  return "AI 요청량 제한에 걸렸습니다. 잠시 후 다시 시도해 주세요.";
}

async function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("OpenAI request aborted.");
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("OpenAI request aborted."));
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function requestOpenAIResponse(
  params: OpenAITextRequest & { text?: Record<string, unknown> }
): Promise<unknown> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: params.model,
        input: params.input,
        max_output_tokens: params.maxOutputTokens,
        temperature: params.temperature,
        text: params.text,
      }),
      signal: params.signal,
    });

    if (response.ok) {
      return response.json() as Promise<unknown>;
    }

    const errorText = await response.text();
    if (response.status === 429 && attempt < 3) {
      const delayMs = parseRateLimitDelayMs(errorText, response.headers.get("retry-after"), attempt);
      params.onRetry?.({
        status: 429,
        attempt: attempt + 1,
        delayMs,
        reason: "rate_limit",
      });
      await sleepWithSignal(delayMs, params.signal);
      continue;
    }

    if (response.status === 429 && isOpenAIRateLimitErrorText(errorText)) {
      throw new Error(formatOpenAIRateLimitUserMessage(errorText, response.headers.get("retry-after")));
    }

    throw new Error(`OpenAI request failed: ${response.status} ${errorText.slice(0, 700)}`);
  }
  throw new Error("AI 요청량 제한이 반복되고 있습니다. 잠시 후 다시 시도해 주세요.");
}

export async function requestOpenAIText(params: OpenAITextRequest): Promise<string> {
  const json = await requestOpenAIResponse(params);
  const text = extractOpenAIOutputText(json);
  if (!text) {
    throw new Error("OpenAI response did not include output text.");
  }
  return text;
}

export async function requestOpenAIJson<T>(params: OpenAIJsonRequest): Promise<T> {
  const json = await requestOpenAIResponse({
    ...params,
    text: {
      format: {
        type: "json_schema",
        name: params.schemaName,
        strict: true,
        schema: params.schema,
      },
    },
  });
  const text = extractOpenAIOutputText(json);
  if (!text) {
    throw new Error("OpenAI JSON response did not include output text.");
  }
  return JSON.parse(text) as T;
}
