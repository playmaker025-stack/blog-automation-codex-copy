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
}

export interface OpenAIJsonRequest extends OpenAITextRequest {
  schemaName: string;
  schema: Record<string, unknown>;
}

export function hasOpenAIKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function extractOutputText(response: unknown): string {
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

function parseRateLimitDelayMs(errorText: string, retryAfterHeader: string | null, attempt: number): number {
  const retryAfterSeconds = Number(retryAfterHeader ?? "");
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(Math.ceil(retryAfterSeconds * 1000), 12_000);
  }

  const explicitWait = errorText.match(/Please try again in\s+([\d.]+)s/i);
  if (explicitWait) {
    return Math.min(Math.ceil(Number(explicitWait[1]) * 1000) + 250, 12_000);
  }

  return Math.min(4_500 + attempt * 1_000, 12_000);
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

async function requestOpenAI(params: OpenAITextRequest & { text?: Record<string, unknown> }): Promise<unknown> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
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
    if (response.status === 429 && attempt < 2) {
      const delayMs = parseRateLimitDelayMs(errorText, response.headers.get("retry-after"), attempt);
      await sleepWithSignal(delayMs, params.signal);
      continue;
    }

    throw new Error(`OpenAI request failed: ${response.status} ${errorText.slice(0, 700)}`);
  }
  throw new Error("OpenAI request failed after retries.");
}

export async function requestOpenAIText(params: OpenAITextRequest): Promise<string> {
  const json = await requestOpenAI(params);
  const text = extractOutputText(json);
  if (!text) {
    throw new Error("OpenAI response did not include output text.");
  }
  return text;
}

export async function requestOpenAIJson<T>(params: OpenAIJsonRequest): Promise<T> {
  const json = await requestOpenAI({
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
  const text = extractOutputText(json);
  if (!text) {
    throw new Error("OpenAI JSON response did not include output text.");
  }
  return JSON.parse(text) as T;
}
