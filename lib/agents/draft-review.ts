import type { KeywordContract, KeywordUsageReport, SeoEvaluation } from "./types";
import { evaluateSeoCompleteness } from "./seo-metrics";

export type DraftReviewSeverity = "info" | "warning" | "blocker";

export interface DraftReviewIssue {
  severity: DraftReviewSeverity;
  message: string;
}

export interface DraftReviewCheck {
  label: string;
  passed: boolean;
  detail: string;
}

export interface DraftReviewChange {
  before: string;
  after: string;
  reason: string;
}

export interface DraftReviewInput {
  originalTitle?: string;
  title: string;
  body: string;
  revisionRequest?: string;
  keywordContract?: KeywordContract;
  seoKeywordSource?: {
    mainKeyword?: string;
    subKeywords?: string[];
  };
}

export interface DraftReviewResult {
  issues: DraftReviewIssue[];
  checks: DraftReviewCheck[];
  passed: boolean;
  normalizedTitle: string;
  revisedTitle: string;
  revisedBody: string;
  changes: string[];
  changeDetails: DraftReviewChange[];
  seoNotes: string[];
  naverLogicNotes: string[];
  keywordReport: KeywordUsageReport;
  seoEvaluation: SeoEvaluation;
}

const MOJIBAKE_PATTERN = /[�ÃÂ][^\s]{0,3}|[\uFFFD]/u;
const EXCESSIVE_CLAIM_PATTERN = /(무조건|100%|최고|보장|최저가|무료|완벽|반드시)/u;
const CLOSING_PATTERN = /(정리하자면|결론적으로|마지막으로|확인 포인트|체크포인트)/u;
const SECTION_PATTERN = /(^|\n)(#{2,}|\*\*[^*\n]+\*\*|\d+[.)]\s+)/;

function addIssue(issues: DraftReviewIssue[], severity: DraftReviewSeverity, message: string): void {
  issues.push({ severity, message });
}

function normalizeTitle(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeBody(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function applyCommonCorrections(value: string): string {
  return value
    .replace(/[!?]{3,}/g, "!")
    .replace(/~{3,}/g, "~")
    .replace(/\s+입니다\./g, "입니다.")
    .replace(/\s+합니다\./g, "합니다.");
}

function titleKeywords(title: string): string[] {
  return normalizeTitle(title)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2)
    .slice(0, 6);
}

function keywordCoverage(title: string, body: string): number {
  const keywords = titleKeywords(title);
  if (keywords.length === 0) return 1;
  const normalizedBody = body.toLowerCase();
  const matched = keywords.filter((keyword) => normalizedBody.includes(keyword.toLowerCase())).length;
  return matched / keywords.length;
}

function buildChecks(title: string, body: string): DraftReviewCheck[] {
  const coverage = keywordCoverage(title, body);
  const bodyLength = body.replace(/\s+/g, "").length;

  return [
    {
      label: "깨진 문자 점검",
      passed: !MOJIBAKE_PATTERN.test(`${title}\n${body}`),
      detail: "깨진 문자나 복사 인코딩 흔적이 없는지 확인합니다.",
    },
    {
      label: "SEO 제목 길이",
      passed: title.length <= 45,
      detail: "모바일 검색 결과에서 제목이 과하게 잘리지 않는지 확인합니다.",
    },
    {
      label: "제목 키워드 본문 반영",
      passed: coverage >= 0.5,
      detail: `제목 핵심어 반영률 ${Math.round(coverage * 100)}%`,
    },
    {
      label: "네이버 블로그 문단 구성",
      passed: SECTION_PATTERN.test(body) || body.split("\n\n").length >= 4,
      detail: "문단 구분, 번호, 소제목 흐름이 충분한지 확인합니다.",
    },
    {
      label: "본문 충실도",
      passed: bodyLength >= 600,
      detail: `공백 제외 ${bodyLength.toLocaleString()}자`,
    },
  ];
}

function buildRevisedBody(title: string, body: string, issues: DraftReviewIssue[]): string {
  let revised = applyCommonCorrections(normalizeBody(body));
  const keywords = titleKeywords(title);

  if (keywords.length > 0 && keywordCoverage(title, revised) < 0.5) {
    revised = `${title}\n\n${keywords.slice(0, 3).join(", ")} 기준으로 실제 선택 전에 확인해야 할 부분부터 정리해보겠습니다.\n\n${revised}`;
  }

  if (revised && !CLOSING_PATTERN.test(revised)) {
    revised += "\n\n정리하자면, 제품명만 보고 고르기보다 사용 목적, 유지비, 관리 편의성, 실제 방문 전 체크 포인트를 함께 보는 편이 훨씬 안정적입니다.";
  }

  if (issues.some((issue) => issue.message.includes("짧습니다"))) {
    revised += "\n\n방문 전에는 현재 사용 중인 제품, 원하는 흡입감, 관리에서 불편했던 부분을 먼저 정리해 두면 상담과 비교가 훨씬 빨라집니다.";
  }

  return revised;
}

export function reviewActualDraft(input: DraftReviewInput): DraftReviewResult {
  const normalizedTitle = normalizeTitle(input.title);
  const body = normalizeBody(input.body);
  const combined = `${normalizedTitle}\n${body}`;
  const issues: DraftReviewIssue[] = [];

  if (!normalizedTitle) {
    addIssue(issues, "blocker", "제목이 비어 있습니다. 실제 발행 제목을 입력해 주세요.");
  }

  if (!body) {
    addIssue(issues, "blocker", "실제 작성 본문이 비어 있습니다. 네이버에 올릴 본문을 붙여 넣어 주세요.");
  }

  if (normalizedTitle.length > 45) {
    addIssue(issues, "warning", "제목이 긴 편입니다. 모바일 검색 결과에서 핵심 키워드가 앞쪽에 보이도록 줄이는 편이 좋습니다.");
  }

  if (MOJIBAKE_PATTERN.test(combined)) {
    addIssue(issues, "blocker", "깨진 문자로 보이는 부분이 있습니다. 복사 과정의 인코딩 문제를 먼저 정리해 주세요.");
  }

  if (body.replace(/\s+/g, "").length < 600) {
    addIssue(issues, "warning", "본문이 짧습니다. 실제 경험, 선택 기준, 구체 예시, 마무리 문단을 보강해 주세요.");
  }

  if (/[!?]{3,}|[~]{3,}/.test(combined)) {
    addIssue(issues, "warning", "과한 강조 부호가 있어 광고성 문장처럼 보일 수 있습니다. 기호 사용을 줄여 주세요.");
  }

  if (EXCESSIVE_CLAIM_PATTERN.test(body)) {
    addIssue(issues, "warning", "과장되거나 단정적인 표현이 있습니다. 근거가 없다면 완화 표현으로 바꾸는 편이 안전합니다.");
  }

  if (keywordCoverage(normalizedTitle, body) < 0.5) {
    addIssue(issues, "warning", "제목 핵심어가 본문에 충분히 반영되지 않았습니다. 도입부와 핵심 문단에 자연스럽게 보강해 주세요.");
  }

  if (!SECTION_PATTERN.test(body) && body.split("\n\n").length < 4) {
    addIssue(issues, "info", "네이버 블로그 가독성을 위해 소제목이나 문단 구분을 조금 더 분명하게 잡는 편이 좋습니다.");
  }

  if (body && !CLOSING_PATTERN.test(body)) {
    addIssue(issues, "info", "마무리 문단이 약해 보입니다. 마지막에 선택 기준이나 확인 포인트를 한 번 더 정리해 주세요.");
  }

  if (input.originalTitle && normalizedTitle !== input.originalTitle.trim()) {
    addIssue(issues, "info", "제목이 초안과 달라졌습니다. 최종 발행 시 이 제목이 실제 제목으로 반영됩니다.");
  }

  if (issues.length === 0) {
    addIssue(issues, "info", "큰 차단 요소는 보이지 않습니다. 현재 구조를 유지한 상태로 발행해도 됩니다.");
  }

  const checks = buildChecks(normalizedTitle, body);
  const revisedTitle = normalizedTitle;
  const revisedBody = buildRevisedBody(revisedTitle, body, issues);
  const seoEvaluation = evaluateSeoCompleteness({
    title: normalizedTitle,
    body,
    keywordContract: input.keywordContract,
    seoKeywordSource: input.seoKeywordSource,
  });

  return {
    issues,
    checks,
    passed: !issues.some((issue) => issue.severity === "blocker"),
    normalizedTitle,
    revisedTitle,
    revisedBody,
    changes: [],
    changeDetails: [],
    seoNotes: [...seoEvaluation.evidence, ...seoEvaluation.improvements].slice(0, 6),
    naverLogicNotes: [],
    keywordReport: seoEvaluation.keywordReport,
    seoEvaluation,
  };
}
