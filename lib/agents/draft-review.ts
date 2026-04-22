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

export interface DraftReviewInput {
  originalTitle?: string;
  title: string;
  body: string;
}

export interface DraftReviewResult {
  issues: DraftReviewIssue[];
  checks: DraftReviewCheck[];
  passed: boolean;
  normalizedTitle: string;
  revisedTitle: string;
  revisedBody: string;
  changes: string[];
  seoNotes: string[];
  naverLogicNotes: string[];
}

const MOJIBAKE_PATTERN = /[占�袁꾥퉪疫꿱쳸椰揶甕]{2,}|�/u;
const EXCESSIVE_CLAIM_PATTERN = /(무조건|100%|최고|보장|최저가|무료|완벽|반드시)/;
const CLOSING_PATTERN = /(마무리|정리|결론|요약|선택 기준|체크리스트|방문 전|확인)/;
const SECTION_PATTERN = /(^|\n)(#{2,}|\*\*[^*\n]+\*\*|\d+[.)]\s+)/;

function addIssue(
  issues: DraftReviewIssue[],
  severity: DraftReviewSeverity,
  message: string
): void {
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
    .replace(/전자\s+담배/g, "전자담배")
    .replace(/할수/g, "할 수")
    .replace(/될수/g, "될 수")
    .replace(/볼수/g, "볼 수")
    .replace(/쓸수/g, "쓸 수")
    .replace(/알아야할/g, "알아야 할")
    .replace(/사용해야할/g, "사용해야 할")
    .replace(/선택해야할/g, "선택해야 할")
    .replace(/체크해야할/g, "체크해야 할")
    .replace(/입문자라면은/g, "입문자라면")
    .replace(/초보자라면은/g, "초보자라면")
    .replace(/[!?]{3,}/g, "!")
    .replace(/~{3,}/g, "~");
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
      label: "오탈자/문자 깨짐",
      passed: !MOJIBAKE_PATTERN.test(`${title}\n${body}`),
      detail: "깨진 문자와 과한 기호를 확인합니다.",
    },
    {
      label: "SEO 제목 길이",
      passed: title.length <= 45,
      detail: "모바일 검색 결과에서 제목이 과하게 잘리지 않도록 확인합니다.",
    },
    {
      label: "제목 키워드 본문 반영",
      passed: coverage >= 0.5,
      detail: `제목 핵심어 반영률 ${Math.round(coverage * 100)}%`,
    },
    {
      label: "네이버 블로그 가독성",
      passed: SECTION_PATTERN.test(body) || body.split("\n\n").length >= 4,
      detail: "문단 구분, 소제목, 번호형 흐름이 있는지 확인합니다.",
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
    revised = `${title}\n\n${keywords.slice(0, 3).join(", ")} 기준으로 실제 선택할 때 확인할 부분을 먼저 정리해보겠습니다.\n\n${revised}`;
  }

  if (revised && !CLOSING_PATTERN.test(revised)) {
    revised += "\n\n정리하면, 제품을 고를 때는 맛이나 가격만 보기보다 사용 습관, 관리 편의성, 교체 주기, 실제 방문 전 확인할 기준을 함께 보는 편이 좋습니다.";
  }

  if (issues.some((issue) => issue.message.includes("짧습니다"))) {
    revised += "\n\n방문 전에는 현재 사용 중인 기기나 선호하는 맛, 원하는 흡입감, 관리가 어려웠던 부분을 함께 정리해 가면 상담이 훨씬 정확해집니다.";
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
    addIssue(issues, "warning", "본문이 짧습니다. 실제 경험, 선택 기준, 주의사항, 마무리 문단을 보강해 주세요.");
  }

  if (/[!?]{3,}|[~]{3,}/.test(combined)) {
    addIssue(issues, "warning", "과한 감탄부호나 물결표는 광고성 문장처럼 보일 수 있어 줄이는 편이 좋습니다.");
  }

  if (EXCESSIVE_CLAIM_PATTERN.test(body)) {
    addIssue(issues, "warning", "단정적이거나 과장된 표현이 있습니다. 근거가 없다면 완화 표현으로 바꾸는 편이 안전합니다.");
  }

  if (keywordCoverage(normalizedTitle, body) < 0.5) {
    addIssue(issues, "warning", "제목의 핵심 키워드가 본문에 충분히 반영되지 않았습니다. 도입부와 중간 문단에 자연스럽게 보강해 주세요.");
  }

  if (!SECTION_PATTERN.test(body) && body.split("\n\n").length < 4) {
    addIssue(issues, "info", "네이버 블로그 가독성을 위해 소제목이나 문단 구분을 조금 더 분명하게 만드는 편이 좋습니다.");
  }

  if (body && !CLOSING_PATTERN.test(body)) {
    addIssue(issues, "info", "마무리 문단이 약해 보입니다. 마지막에 선택 기준이나 방문 전 체크포인트를 정리해 주세요.");
  }

  if (input.originalTitle && normalizedTitle !== input.originalTitle.trim()) {
    addIssue(issues, "info", "제목이 초안과 달라졌습니다. 사용자가 확정한 제목을 최종 제목으로 반영합니다.");
  }

  if (issues.length === 0) {
    addIssue(issues, "info", "큰 차단 요소는 보이지 않습니다. SEO 흐름과 문단 구분을 유지한 상태로 발행하면 됩니다.");
  }

  const checks = buildChecks(normalizedTitle, body);
  const revisedTitle = normalizedTitle;
  const revisedBody = buildRevisedBody(revisedTitle, body, issues);

  return {
    issues,
    checks,
    passed: !issues.some((issue) => issue.severity === "blocker"),
    normalizedTitle,
    revisedTitle,
    revisedBody,
    changes: [],
    seoNotes: [],
    naverLogicNotes: [],
  };
}
