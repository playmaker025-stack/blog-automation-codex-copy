/**
 * demand-signals — 수요 추출의 순수 로직.
 *
 * I/O(LLM 호출)는 demand-extractor.ts가 담당한다. 프롬프트 구성과 파싱은
 * 외부 의존이 없어야 테스트할 수 있어서 분리했다.
 */

import type { DomainContract } from "./domain-contract";

export interface DemandQuestion {
  /** 검색자가 실제로 궁금해하는 것 */
  question: string;
  /** 어떤 소재에 대한 질문인지 */
  subject: string;
}

export interface ProductEntity {
  name: string;
  /** 어느 글 제목에서 뽑았는지. 오탐 추적용. */
  evidence: string;
}

export interface ExtractedDemand {
  questions: DemandQuestion[];
  products: ProductEntity[];
  /** 업종과 무관해서 버린 항목 수 */
  discardedCount: number;
  /** 추출에 실패하면 true. 파이프라인은 계속 진행한다. */
  failed: boolean;
}

export const EMPTY_DEMAND: ExtractedDemand = {
  questions: [],
  products: [],
  discardedCount: 0,
  failed: true,
};

interface SourceItem {
  title?: string;
  description?: string;
}

export function cleanText(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildExtractionPrompt(params: {
  items: SourceItem[];
  contract: DomainContract;
}): string {
  const { items, contract } = params;
  const lines = items
    .map((item, index) => {
      const title = cleanText(item.title ?? "");
      const description = cleanText(item.description ?? "").slice(0, 120);
      return `${index + 1}. ${title}${description ? ` — ${description}` : ""}`;
    })
    .filter((line) => line.length > 4);

  return `아래는 네이버 카페와 지식인에서 수집한 글 목록입니다.
업종은 "${contract.label}"입니다.

## 할 일
1. 이 업종의 실제 검색자가 궁금해하는 질문/고민을 뽑으세요.
2. 이 업종의 제품명(기기, 액상, 브랜드)을 뽑으세요.
3. 업종과 무관한 항목은 버리고 개수만 세세요.

## 판단 기준
- 다주제 마케팅 블로그가 섞여 있습니다. 헬스기구, 금융상품, 부동산, 항공 마일리지,
  반려동물 같은 항목이 나오면 전부 버리세요.
- 제품명은 이 업종의 실제 제품만 뽑으세요. 지역명, 상호, 일반명사는 제품명이 아닙니다.
- 이미 아는 제품명도 그대로 뽑으세요. 중복은 나중에 걸러집니다.
- 확실하지 않으면 뽑지 마세요. 적게 뽑는 편이 낫습니다.

## 이미 등록된 제품명 (참고용, 여기 없는 것도 뽑으세요)
${contract.brands.join(", ")}

## 수집된 글
${lines.join("\n")}

## 출력 (JSON만, 설명 없이)
\`\`\`json
{
  "questions": [{ "question": "검색자 질문을 한 문장으로", "subject": "관련 소재" }],
  "products": [{ "name": "제품명", "evidence": "이 제품명이 나온 글 제목" }],
  "discardedCount": 0
}
\`\`\``;
}

export function parseExtraction(raw: string): ExtractedDemand | null {
  const match = raw.match(/```json\s*([\s\S]*?)```/);
  const text = match?.[1] ?? raw;
  try {
    const parsed = JSON.parse(text.trim()) as Partial<ExtractedDemand>;
    return {
      questions: Array.isArray(parsed.questions)
        ? parsed.questions
            .filter((item) => typeof item?.question === "string" && item.question.trim().length > 4)
            .map((item) => ({
              question: item.question.trim(),
              subject: typeof item.subject === "string" ? item.subject.trim() : "",
            }))
            .slice(0, 12)
        : [],
      products: Array.isArray(parsed.products)
        ? parsed.products
            .filter((item) => typeof item?.name === "string" && item.name.trim().length >= 2)
            .map((item) => ({
              name: item.name.trim(),
              evidence: typeof item.evidence === "string" ? item.evidence.trim().slice(0, 120) : "",
            }))
            .slice(0, 20)
        : [],
      discardedCount: typeof parsed.discardedCount === "number" ? parsed.discardedCount : 0,
      failed: false,
    };
  } catch {
    return null;
  }
}

export function formatDemandSignals(demand: ExtractedDemand): string {
  if (demand.failed || demand.questions.length === 0) {
    return [
      "## 실제 검색 수요",
      "이번 회차에는 추출된 질문이 없습니다. 미개척 조합과 기존 발행 글의 빈틈에서 주제를 만드세요.",
      "없는 자료를 있다고 가정하고 지어내지 마세요.",
    ].join("\n");
  }

  return [
    "## 실제 검색 수요 (네이버 카페/지식인에서 추출)",
    "실제 사람들이 올린 질문입니다. 업종과 무관한 항목은 추출 단계에서 걸러냈습니다.",
    "이 질문에 답하는 주제를 우선하세요.",
    "",
    ...demand.questions.map((item) => `- ${item.question}${item.subject ? ` (${item.subject})` : ""}`),
  ].join("\n");
}
