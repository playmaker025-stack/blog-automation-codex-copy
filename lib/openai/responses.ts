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

async function requestOpenAI(params: OpenAITextRequest & { text?: Record<string, unknown> }): Promise<unknown> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

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

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${errorText.slice(0, 700)}`);
  }

  return response.json() as Promise<unknown>;
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
