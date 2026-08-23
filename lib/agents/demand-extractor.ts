/**
 * demand-extractor — 네이버 커뮤니티에서 실제 수요와 제품명을 추출한다.
 *
 * 왜 필요한가:
 * 이 앱의 원래 설계는 네이버 카페/지식인/블로그에서 실제 관심사와 질문을 긁어
 * 주제를 정하는 것이었다. 그런데 긁는 방식이 extractRelatedWords의 단어 빈도 세기
 * (bag-of-words)라서, 다주제 마케팅 블로그의 스미스머신/공기업 주식 단어가 상위에
 * 올라오고 그게 주제 재료가 됐다.
 *
 * 오염의 원인은 "네이버를 본 것"이 아니라 "보는 방식"이었다. 단어 빈도 대신
 * LLM 개체 추출로 바꾸면 실제 수요는 살리고 무관한 소재는 추출 단계에서 걸린다.
 *
 * 프롬프트 구성과 파싱은 demand-signals.ts에 있다. 여기는 LLM 호출만 한다.
 */

import { getAnthropicClient, MODELS } from "@/lib/anthropic/client";
import type { DomainContract } from "./domain-contract";
import {
  buildExtractionPrompt,
  parseExtraction,
  EMPTY_DEMAND,
  type ExtractedDemand,
} from "./demand-signals";

interface SourceItem {
  title?: string;
  description?: string;
}

export async function extractDemand(params: {
  items: SourceItem[];
  contract: DomainContract;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}): Promise<ExtractedDemand> {
  const { items, contract, signal, onProgress } = params;
  if (items.length === 0) return { ...EMPTY_DEMAND, failed: false };

  onProgress?.("네이버 커뮤니티에서 실제 수요와 제품명을 추출합니다.");

  // 추출은 단순 작업이라 haiku로 충분하다. 토픽 생성마다 호출되므로 비용과 지연을 낮게 둔다.
  const client = getAnthropicClient();
  const hardDeadline = AbortSignal.timeout(60_000);
  const callSignal = signal ? AbortSignal.any([signal, hardDeadline]) : hardDeadline;

  try {
    const response = await client.messages.create(
      {
        model: MODELS.haiku,
        max_tokens: 2048,
        messages: [{ role: "user", content: buildExtractionPrompt({ items, contract }) }],
      },
      { signal: callSignal }
    );

    const block = response.content.find((item) => item.type === "text");
    const parsed = block?.type === "text" ? parseExtraction(block.text) : null;
    if (!parsed) {
      onProgress?.("수요 추출 결과를 해석하지 못해 이번 회차는 건너뜁니다.");
      return EMPTY_DEMAND;
    }

    onProgress?.(
      `실제 질문 ${parsed.questions.length}건, 제품명 ${parsed.products.length}건을 추출했습니다. 업종 무관 ${parsed.discardedCount}건은 버렸습니다.`
    );
    return parsed;
  } catch (error) {
    // 추출 실패가 파이프라인을 막으면 안 된다. 신호 없이 계속 진행한다.
    console.warn("[demand-extractor] 추출 실패, 신호 없이 진행:", String(error));
    onProgress?.("수요 추출에 실패해 이번 회차는 신호 없이 진행합니다.");
    return EMPTY_DEMAND;
  }
}
