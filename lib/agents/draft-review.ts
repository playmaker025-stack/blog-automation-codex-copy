export type DraftReviewSeverity = "info" | "warning" | "blocker";

export interface DraftReviewIssue {
  severity: DraftReviewSeverity;
  message: string;
}

export interface DraftReviewInput {
  originalTitle?: string;
  title: string;
  body: string;
}

export interface DraftReviewResult {
  issues: DraftReviewIssue[];
  passed: boolean;
  normalizedTitle: string;
}

const MOJIBAKE_PATTERN = /�|[?][꾀-힣]|[肄蹂湲諛嫄吏媛濡踰]/u;
const EXCESSIVE_CLAIM_PATTERN = /(무조건|100%|최고|보장|최저가|무료|완벽|절대|반드시)/;
const E_CIG_PATTERN = /(전자담배|액상|팟|카트리지|니코틴|입호흡|폐호흡|기기)/;
const AGE_NOTICE_PATTERN = /(성인|미성년|청소년|법적|주의|19세|만\s*19세)/;
const CLOSING_PATTERN = /(마무리|정리|결론|요약|선택 기준|체크리스트|방문 전)/;

function addIssue(
  issues: DraftReviewIssue[],
  severity: DraftReviewSeverity,
  message: string
): void {
  issues.push({ severity, message });
}

export function reviewActualDraft(input: DraftReviewInput): DraftReviewResult {
  const title = input.title.trim().replace(/\s+/g, " ");
  const body = input.body.trim();
  const combined = `${title}\n${body}`;
  const issues: DraftReviewIssue[] = [];

  if (!title) {
    addIssue(issues, "blocker", "제목이 비어 있습니다. 실제 발행 제목을 입력해 주세요.");
  }

  if (title.length > 45) {
    addIssue(issues, "warning", "제목이 긴 편입니다. 모바일 검색 결과에서 잘릴 수 있으니 핵심 키워드를 앞쪽에 두세요.");
  }

  if (MOJIBAKE_PATTERN.test(combined)) {
    addIssue(issues, "blocker", "깨진 문자로 보이는 부분이 있습니다. 복사 과정의 인코딩 문제를 먼저 정리해 주세요.");
  }

  if (body.length < 600) {
    addIssue(issues, "warning", "본문이 짧습니다. 경험 설명, 선택 기준, 주의점, 마무리 문단을 보강해 주세요.");
  }

  if (/[!?]{3,}|[~]{3,}/.test(combined)) {
    addIssue(issues, "warning", "과한 감탄부호나 물결표는 광고성 문장처럼 보일 수 있습니다.");
  }

  if (EXCESSIVE_CLAIM_PATTERN.test(body)) {
    addIssue(issues, "warning", "단정적이거나 과장된 표현이 있습니다. 실제 근거가 없다면 완화 표현으로 바꾸는 편이 안전합니다.");
  }

  if (E_CIG_PATTERN.test(body) && !AGE_NOTICE_PATTERN.test(body)) {
    addIssue(issues, "warning", "전자담배 관련 글에는 성인 대상 안내나 미성년자 주의 문구를 넣는 편이 안전합니다.");
  }

  if (body.includes("  ")) {
    addIssue(issues, "info", "본문에 연속 공백이 있습니다. 발행 전에 문단 간격을 한번 정리해 주세요.");
  }

  if (body && !CLOSING_PATTERN.test(body)) {
    addIssue(issues, "info", "마무리 문단이 약해 보입니다. 마지막에 선택 기준이나 핵심 요약을 다시 정리해 주세요.");
  }

  if (input.originalTitle && title !== input.originalTitle.trim()) {
    addIssue(issues, "info", "제목이 초안과 달라졌습니다. 사용자가 확정한 제목으로 글 목록에 반영합니다.");
  }

  if (issues.length === 0) {
    addIssue(issues, "info", "큰 위험 요소는 보이지 않습니다. 제목과 본문 흐름을 유지해도 좋습니다.");
  }

  return {
    issues,
    passed: !issues.some((issue) => issue.severity === "blocker"),
    normalizedTitle: title,
  };
}
