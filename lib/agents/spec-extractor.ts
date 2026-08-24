/**
 * spec-extractor — 발행글에서 제품 사양 후보를 뽑는다 (LLM 호출 담당).
 *
 * 이번 세션에 제가 손으로 한 일을 자동화하는 것이다. 사장님 글을 열어
 * "35000퍼프에 액상 용량이 22ml"를 찾아 원장에 옮겼는데, 앞으로는 글이
 * 들어올 때마다 시스템이 후보를 뽑아 대기함에 넣는다.
 *
 * 절대 지키는 것: 추출 결과는 대기함까지만 간다. 승인 전에는 프롬프트에
 * 들어가지 않는다. 자동 추출이 조용히 사실로 승격되면 이 기능이 막으려던
 * 문제를 그대로 다시 만든다.
 *
 * 실패해도 발행을 막지 않는다. 다음 글에서 다시 시도된다.
 */

import { randomUUID } from "crypto";
import { getAnthropicClient, MODELS } from "@/lib/anthropic/client";
import { createOrRecord, recordUsage } from "@/lib/anthropic/usage-recorder";
import { hasOpenAIKey, requestOpenAIText } from "@/lib/openai/responses";
import { loadProductSpecs } from "./product-spec-store";
import { loadSpecCandidates, saveSpecCandidates } from "./spec-candidate-store";
import {
  buildSpecExtractionPrompt,
  mergeCandidates,
  parseSpecExtraction,
  type SpecCandidate,
} from "./spec-candidates";

const EXTRACTION_TIMEOUT_MS = 90_000;
/** 네이버 본문은 UI 잡음이 섞여 있어 넉넉히 자른다. */
const MAX_CONTENT = 12_000;

export interface SpecExtractionResult {
  ok: boolean;
  added: number;
  skipped: number;
  productCount: number;
  provider: "openai" | "anthropic" | null;
  error?: string;
}

/**
 * 글 한 편에서 사양 후보를 뽑아 대기함에 넣는다.
 *
 * 공급자는 글쓰기와 같은 규칙을 따른다 — OPENAI_API_KEY가 있으면 OpenAI가
 * 1순위다. 추출은 정형 작업이라 저렴한 모델로 충분하다.
 */
export async function extractSpecCandidatesFromPost(params: {
  postId: string;
  title: string;
  content: string;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}): Promise<SpecExtractionResult> {
  const { postId, title, content, onProgress } = params;

  try {
    const { data: registry } = await loadProductSpecs();
    const knownProducts = registry.products.map((p) => p.name);
    const prompt = buildSpecExtractionPrompt({
      title,
      content: content.slice(0, MAX_CONTENT),
      knownProducts,
    });

    // 이름을 callSignal로 두는 건 취향이 아니라 규칙이다. check-patterns의
    // RULE-001은 "signal:"을 찾는데 { signal } 축약 표기는 걸리지 않는다.
    const callSignal = params.signal
      ? AbortSignal.any([params.signal, AbortSignal.timeout(EXTRACTION_TIMEOUT_MS)])
      : AbortSignal.timeout(EXTRACTION_TIMEOUT_MS);

    let text: string;
    let provider: "openai" | "anthropic";

    if (hasOpenAIKey()) {
      provider = "openai";
      text = await requestOpenAIText({
        model: process.env.OPENAI_SPEC_MODEL ?? "gpt-4.1-mini",
        label: "spec-extractor",
        maxOutputTokens: 4000,
        input: [
          {
            role: "system",
            content:
              "You extract product specifications that are explicitly written in Korean vape shop blog posts. Never infer. Output JSON only.",
          },
          { role: "user", content: prompt },
        ],
        signal: callSignal,
      });
    } else {
      provider = "anthropic";
      const client = getAnthropicClient();
      const response = await createOrRecord(
        () =>
          client.messages.create(
            {
              model: MODELS.haiku,
              max_tokens: 4000,
              messages: [{ role: "user", content: prompt }],
            },
            { signal: callSignal }
          ),
        "spec-extractor"
      );
      recordUsage(response.model ?? MODELS.haiku, response.usage, "spec-extractor");
      const block = response.content.find((b) => b.type === "text");
      text = block?.type === "text" ? block.text : "";
    }

    const products = parseSpecExtraction(text);
    if (products.length === 0) {
      onProgress?.("사양 후보를 찾지 못했습니다.");
      return { ok: true, added: 0, skipped: 0, productCount: 0, provider };
    }

    const now = new Date().toISOString();
    const incoming: SpecCandidate[] = products.flatMap((p) =>
      p.facts.map((f) => ({
        id: `cand-${randomUUID().slice(0, 8)}`,
        product: p.name,
        field: f.field,
        value: f.value,
        evidence: f.evidence,
        postId,
        postTitle: title,
        extractedAt: now,
        status: "대기" as const,
      }))
    );

    const { data: store, sha } = await loadSpecCandidates();
    const merged = mergeCandidates(store, incoming, registry);

    if (merged.added > 0) {
      await saveSpecCandidates(
        merged.store,
        sha,
        `chore(specs): ${postId}에서 사양 후보 ${merged.added}건 추출`
      );
    }

    onProgress?.(
      merged.added > 0
        ? `사양 후보 ${merged.added}건을 확인 대기함에 넣었습니다. (중복·기존값 ${merged.skipped}건 제외)`
        : "새로 확인할 사양 후보는 없었습니다."
    );

    return {
      ok: true,
      added: merged.added,
      skipped: merged.skipped,
      productCount: products.length,
      provider,
    };
  } catch (error) {
    // 추출 실패가 발행을 막으면 안 된다.
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[spec-extractor] 추출 실패:", message);
    return { ok: false, added: 0, skipped: 0, productCount: 0, provider: null, error: message };
  }
}
