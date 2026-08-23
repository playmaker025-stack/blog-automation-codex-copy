/**
 * citation-readiness — 네이버 AI탭/AI 브리핑 인용 가능성 검수
 *
 * 구현 근거: references/agent-review-qa.md LAYER 6
 *
 * writer-engine이 인용 레이어를 프롬프트로 요구하지만, 프롬프트만으로는 지시에 그친다.
 * 초안이 실제로 인용 가능한 형태인지 여기서 확인하고, 부족하면 재작성 지시로 넘긴다.
 *
 * 순수 함수다. LLM 호출도 네트워크 호출도 없다.
 */

export interface CitationReadiness {
  /** 0-100. 4개 축을 25점씩. */
  score: number;
  /** 첫 3문단에 인용 가능한 완결 문장이 충분한가 */
  hasLeadAnswer: boolean;
  /** 첫 3문단에 숫자/가격/기간 같은 구체값이 있는가 */
  hasConcreteValue: boolean;
  /** 목록, 단계, 표 중 하나라도 있어 AI가 파싱할 수 있는가 */
  hasParsableStructure: boolean;
  /** FAQ가 검색 질문 형태로 있는가 */
  hasFaq: boolean;
  faqCount: number;
  findings: string[];
}

/** 이 점수 미만이면 발행을 막고 재작성 라운드로 보낸다. 4개 축 중 2개 이상 빠진 상태. */
export const CITATION_BLOCKING_THRESHOLD = 50;

const FAQ_HEADING = /(FAQ|자주\s*묻는|자주\s*하는\s*질문|많이\s*묻는|자주\s*받는\s*질문)/iu;

function splitParagraphs(content: string): string[] {
  return content
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .filter((block) => !/^#{1,6}\s+\S+$/u.test(block));
}

/**
 * 완결 문장 개수를 센다.
 * 네이버 블로그 글은 마침표 없이 줄바꿈으로 문장을 끊는 경우가 많아
 * 마침표뿐 아니라 줄바꿈도 문장 경계로 본다.
 */
function countCompleteSentences(text: string): number {
  return text
    .split(/[.!?。！？\n]+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 12).length;
}

function hasNumericValue(text: string): boolean {
  return /\d/u.test(text);
}

function hasParsableStructure(content: string): boolean {
  if (/^\s*(?:[-*]|\d+\.)\s+\S/mu.test(content)) return true;
  if (/^\s*\|.*\|\s*$/mu.test(content)) return true;
  return false;
}

function countFaqQuestions(content: string): number {
  const lines = content.split("\n").map((line) => line.trim());
  const headingIndex = lines.findIndex((line) => /^#{1,6}\s/.test(line) && FAQ_HEADING.test(line));

  // FAQ 제목이 있으면 그 아래에서만 센다. 없으면 글 후반부에서 찾는다.
  const scope = headingIndex >= 0 ? lines.slice(headingIndex + 1) : lines.slice(Math.floor(lines.length * 0.6));
  return scope.filter((line) => /[?？]\s*$/u.test(line) && line.length >= 6).length;
}

export function evaluateCitationReadiness(content: string): CitationReadiness {
  const paragraphs = splitParagraphs(content);
  const lead = paragraphs.slice(0, 3).join("\n");

  const hasLeadAnswer = countCompleteSentences(lead) >= 3;
  const hasConcreteValue = hasNumericValue(lead);
  const parsable = hasParsableStructure(content);
  const faqCount = countFaqQuestions(content);
  const hasFaq = faqCount >= 2;

  const findings: string[] = [];
  if (!hasLeadAnswer) {
    findings.push(
      "첫 3문단에 그 자체로 인용 가능한 완결 문장이 부족합니다. 직접 답변 / 판단 기준 / 예외 조건을 각각 독립 문장으로 넣으세요."
    );
  }
  if (!hasConcreteValue) {
    findings.push(
      "첫 3문단에 숫자, 가격, 기간, 날짜 같은 구체값이 없습니다. 확인 가능한 값을 최소 하나 넣으세요. 지어내지는 마세요."
    );
  }
  if (!parsable) {
    findings.push("목록, 단계, 표가 없어 AI가 파싱하기 어렵습니다. 본문에 최소 하나를 넣으세요.");
  }
  if (!hasFaq) {
    findings.push(
      `FAQ가 ${faqCount}개입니다. 실제 검색 질문 형태로 2~3개를 하단에 넣으세요. 질문은 사람이 검색창에 칠 법한 문장이어야 합니다.`
    );
  }

  const score =
    (hasLeadAnswer ? 25 : 0) +
    (hasConcreteValue ? 25 : 0) +
    (parsable ? 25 : 0) +
    (hasFaq ? 25 : 0);

  return {
    score,
    hasLeadAnswer,
    hasConcreteValue,
    hasParsableStructure: parsable,
    hasFaq,
    faqCount,
    findings,
  };
}

/**
 * 발행 차단 판정 — 계약 검사와 분리한다.
 *
 * 인용 가능성은 계약 위반이 아니라 품질 축이다. 여기서 발행을 영구히 막으면
 * 재작성 라운드를 다 쓴 뒤 정상적인 초안까지 승인 불가로 남는다.
 * 그래서 차단이 아니라 `shouldReviseForCitation`으로 재작성 압력만 준다.
 */
export function isCitationBlocking(readiness: CitationReadiness): boolean {
  return readiness.score < CITATION_BLOCKING_THRESHOLD;
}

/**
 * 재작성 트리거.
 *
 * FAQ는 점수와 별개로 항상 요구한다. 실측 결과 기존 발행 글 163건 중 FAQ 보유는 9건(6%)뿐이었는데,
 * FAQ는 AI 브리핑과 AI탭이 인용하는 1차 표면이다. 만점이 아니면 계속 끌어올린다.
 */
export function shouldReviseForCitation(readiness: CitationReadiness | undefined): boolean {
  if (!readiness) return false;
  return !readiness.hasFaq || readiness.score < 100;
}

export function buildCitationRevisionInstructions(readiness: CitationReadiness): string[] {
  if (readiness.findings.length === 0) return [];
  return [
    `AI 인용 가능성 ${readiness.score}점. 네이버 AI탭 노출이 목표이므로 아래를 본문 재작성으로 해결하세요.`,
    ...readiness.findings,
    "인용될 답변을 넣되 결정적 정보(실제 가격, 재고, 시연 결과, 상담 기준)는 본문에만 남겨 클릭할 이유를 지키세요.",
  ];
}
