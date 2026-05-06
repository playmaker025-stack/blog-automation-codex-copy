import { SEO_PASS_THRESHOLD } from "./blog-workflow-policy";
import type {
  EvalResult,
  NaverLogicEvaluation,
  NaverLogicPlan,
  NaverLogicType,
  StrategyPlanResult,
  WriterResult,
} from "./types";

const DIA_SIGNALS = [
  "해결",
  "방법",
  "고르는",
  "선택",
  "비교",
  "추천",
  "입문",
  "증상",
  "원인",
  "체크",
  "불편",
  "실수",
  "오류",
  "문제",
  "가이드",
];

const C_RANK_SIGNALS = [
  "인천",
  "부평",
  "구월",
  "만수",
  "송도",
  "청라",
  "전자담배",
  "액상",
  "기기",
  "코일",
  "매장",
  "전문",
  "허브",
  "리프",
];

const DIA_DEEP_CHECKS = [
  "검색 의도와 첫 응답 문단이 정확히 이어지는가",
  "작성자 경험이나 실제 상담 맥락이 보이는가",
  "문제 해결 순서와 예외 조건이 구체적인가",
  "독자가 다음 행동을 결정할 수 있는가",
];

const C_RANK_DEEP_CHECKS = [
  "블로그의 기존 주제권과 이어지는가",
  "지역/제품/전문성 신호가 자연스럽게 연결되는가",
  "허브/리프 구조가 내부 링크와 함께 보이는가",
  "실제 상담/방문/비교 경험이 보이는가",
];

function countSignals(text: string, signals: string[]): number {
  return signals.reduce((score, signal) => score + (text.includes(signal) ? 1 : 0), 0);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildStrategyText(strategy: StrategyPlanResult): string {
  return [
    strategy.title,
    strategy.rationale,
    strategy.keywords.join(" "),
    strategy.contentTopology?.kind ?? "",
    strategy.contentTopology?.searchIntent ?? "",
    strategy.contentTopology?.requiredSections.join(" ") ?? "",
    ...strategy.outline.flatMap((section) => [
      section.heading,
      section.contentDirection,
      section.subPoints.join(" "),
    ]),
  ].join(" ");
}

function labelForLogic(type: NaverLogicType): string {
  if (type === "dia") return "D.I.A. 중심";
  if (type === "c-rank") return "C-Rank 중심";
  return "D.I.A. + C-Rank 혼합";
}

export function formatNaverLogicLabel(type: NaverLogicType): string {
  return labelForLogic(type);
}

export function planNaverLogicForStrategy(strategy: StrategyPlanResult): NaverLogicPlan {
  const text = buildStrategyText(strategy);
  const diaScore = countSignals(text, DIA_SIGNALS);
  const cRankScore =
    countSignals(text, C_RANK_SIGNALS) +
    (strategy.contentTopology?.internalLinkTargets.length ? 2 : 0) +
    (strategy.contentTopology?.kind === "hub" ? 2 : 0);

  let primary: NaverLogicType = "hybrid";
  if (diaScore >= cRankScore + 3) primary = "dia";
  if (cRankScore >= diaScore + 3) primary = "c-rank";

  const label = labelForLogic(primary);
  const reason =
    primary === "dia"
      ? "이 주제는 검색자가 바로 해결책이나 선택 기준을 원하는 성격이 강해 D.I.A.식 문제 해결 흐름이 중요합니다."
      : primary === "c-rank"
        ? "이 주제는 블로그의 지역/제품 전문성 누적과 내부 연결성이 중요해 C-Rank식 주제권 강화가 중요합니다."
        : "이 주제는 문제 해결성과 블로그 주제권 신호가 모두 중요해 D.I.A.와 C-Rank를 함께 맞춰야 합니다.";

  const writingFocus = [
    "검색자가 왜 이 글을 찾았는지 첫 두 문단 안에서 바로 받아준다.",
    "상황, 기준, 예외, 체크포인트를 구체적으로 쓴다.",
    "기존 주제권과 연결되는 표현과 내부 링크 흐름을 자연스럽게 보여준다.",
    "허브/리프 역할이 구조로 드러나게 한다.",
    primary === "c-rank"
      ? "지역/제품/상담 경험 같은 전문성 신호를 제목과 본문에 분산시킨다."
      : "독자가 실제로 선택하거나 해결할 수 있는 판단 기준을 본문 중반 전에 준다.",
  ];

  const checklist = [
    "D.I.A.: 검색 의도, 선택 기준, 문제 해결 순서, 독자 만족 결론이 보이는가",
    "C-Rank: 블로그 주제권, 지역/제품 전문성, 내부 링크 연결이 보이는가",
    "유사문서 방지: 제목/목차/결론/앵글이 기존 글과 충분히 다른가",
    "네이버 SEO: 메인 키워드가 제목/도입/소제목에 자연스럽게 분산되는가",
    ...DIA_DEEP_CHECKS.map((item) => `D.I.A. 상세: ${item}`),
    ...C_RANK_DEEP_CHECKS.map((item) => `C-Rank 상세: ${item}`),
  ];

  return {
    primary,
    label,
    reason,
    writingFocus,
    checklist,
    completenessTarget: SEO_PASS_THRESHOLD,
  };
}

function includesAny(text: string, signals: string[]): boolean {
  return signals.some((signal) => text.includes(signal));
}

function hasExactLinkedReference(content: string, title: string, url?: string | null): boolean {
  if (!title || !url) return false;
  const exactLinkPattern = new RegExp(`\\[${escapeRegExp(title)}\\]\\(${escapeRegExp(url)}\\)`, "u");
  return exactLinkPattern.test(content);
}

export function formatNaverLogicPlan(plan: NaverLogicPlan | undefined): string {
  if (!plan) {
    return [
      "Naver logic: not classified.",
      "Before writing, decide whether this topic is D.I.A., C-Rank, or hybrid.",
      "Apply the matching checklist and target at least 90 completeness.",
    ].join("\n");
  }

  return [
    `Naver logic: ${plan.label}`,
    `Reason: ${plan.reason}`,
    `Completeness target: ${plan.completenessTarget}`,
    "Writing focus:",
    ...plan.writingFocus.map((item) => `- ${item}`),
    "Checklist:",
    ...plan.checklist.map((item) => `- ${item}`),
  ].join("\n");
}

export function evaluateNaverLogicCompleteness(params: {
  strategy: StrategyPlanResult;
  writerResult: WriterResult;
  evalResult: EvalResult;
}): NaverLogicEvaluation {
  const { strategy, writerResult, evalResult } = params;
  const plan = strategy.naverLogic ?? planNaverLogicForStrategy(strategy);
  const content = writerResult.content;
  const joined = `${strategy.title} ${content}`;

  let score = evalResult.aggregateScore;
  const evidence: string[] = [];
  const improvements: string[] = [];

  if (includesAny(joined, ["상황", "고민", "처음", "방문", "찾는", "상담", "실제로"])) {
    score += 3;
    evidence.push("검색자 상황을 초반에 다루는 구조가 반영되었습니다.");
  } else {
    score -= 4;
    improvements.push("도입부에서 검색자가 왜 이 글을 찾는지 더 직접적으로 받아 주세요.");
  }

  if (includesAny(joined, ["기준", "체크", "확인", "구분", "선택", "예외", "주의"])) {
    score += 4;
    evidence.push("선택 기준과 체크포인트가 포함되었습니다.");
  } else {
    score -= 5;
    improvements.push("선택 기준, 체크포인트, 구분 기준을 더 명확하게 넣어 주세요.");
  }

  if (strategy.contentTopology?.internalLinkTargets.length) {
    score += 3;
    evidence.push("기존 글과 연결 가능한 내부 링크 맥락이 설계되었습니다.");
  } else {
    improvements.push("기존 내부 링크 후보가 부족해 C-Rank 연결성이 제한적입니다.");
  }

  const hubReference = strategy.contentTopology?.hubReference ?? null;
  const leafReference = strategy.contentTopology?.leafReference ?? null;
  if (hubReference?.url) {
    if (hasExactLinkedReference(content, hubReference.title, hubReference.url)) {
      evidence.push("허브 참조 링크가 제목-URL 쌍 그대로 반영되었습니다.");
    } else {
      score -= 6;
      improvements.push(`허브 참조 링크는 '${hubReference.title}' 제목과 ${hubReference.url} URL을 정확히 같은 쌍으로 써야 합니다.`);
    }
  }
  if (leafReference?.url) {
    if (hasExactLinkedReference(content, leafReference.title, leafReference.url)) {
      evidence.push("리프 참조 링크가 제목-URL 쌍 그대로 반영되었습니다.");
    } else {
      score -= 6;
      improvements.push(`리프 참조 링크는 '${leafReference.title}' 제목과 ${leafReference.url} URL을 정확히 같은 쌍으로 써야 합니다.`);
    }
  }

  if (includesAny(joined, ["인천", "부평", "구월", "만수", "지역", "매장"])) {
    score += 3;
    evidence.push("지역/매장 맥락이 포함되어 블로그 주제권 연결에 도움이 됩니다.");
  }

  if (includesAny(joined, ["경험", "실사용", "후기", "상담", "방문", "느낀"])) {
    score += 4;
    evidence.push("작성자 경험/상담 맥락이 보여 D.I.A. 경험성 기준을 보강합니다.");
  } else {
    improvements.push("작성자 경험, 실제 상담 질문, 실사용 비교를 더 넣으면 D.I.A. 완성도가 올라갑니다.");
  }

  if (includesAny(joined, ["내부 링크", "관련 글", "이어서", "함께 보면", "기존 글"])) {
    score += 3;
    evidence.push("관련 글로 이어지는 소비 흐름이 있어 C-Rank 연결성을 보강합니다.");
  }

  if (includesAny(joined, ["관리만 하면", "좋은 제품", "잘 고르면", "개인차"])) {
    score -= 5;
    improvements.push("일반론 표현을 구체적인 확인 방법이나 예외 조건으로 바꾸는 편이 좋습니다.");
  }

  if (plan.primary === "dia" && !includesAny(joined, ["해결", "방법", "원인", "체크"])) {
    score -= 6;
    improvements.push("D.I.A. 중심 주제인데 해결 순서나 원인 분류가 약합니다.");
  }

  if (plan.primary === "c-rank" && !includesAny(joined, ["전문", "기존", "연결", "지역", "매장"])) {
    score -= 6;
    improvements.push("C-Rank 중심 주제인데 블로그의 전문성/연결성 신호가 약합니다.");
  }

  if (plan.primary === "hybrid" && evidence.length >= 3) {
    score += 2;
  }

  return {
    primary: plan.primary,
    label: plan.label,
    completenessScore: clampScore(score),
    reason: plan.reason,
    evidence: evidence.length ? evidence : ["전략 단계에서 네이버 로직 기준은 적용했지만 본문 근거는 더 보강할 수 있습니다."],
    improvements: improvements.slice(0, 4),
  };
}

export class NaverLogicAgent {
  planBeforeWriting(strategy: StrategyPlanResult): NaverLogicPlan {
    return planNaverLogicForStrategy(strategy);
  }

  buildWriterBrief(plan: NaverLogicPlan | undefined): string {
    return formatNaverLogicPlan(plan);
  }

  auditAfterWriting(params: {
    strategy: StrategyPlanResult;
    writerResult: WriterResult;
    evalResult: EvalResult;
  }): NaverLogicEvaluation {
    return evaluateNaverLogicCompleteness(params);
  }

  formatLabel(type: NaverLogicType): string {
    return formatNaverLogicLabel(type);
  }
}

export const naverLogicAgent = new NaverLogicAgent();
