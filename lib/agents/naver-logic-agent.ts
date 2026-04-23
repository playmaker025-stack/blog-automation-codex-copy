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
  "누수",
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
  "팟",
  "코일",
  "허브",
  "리프",
  "매장",
  "전문",
];

const DIA_DEEP_CHECKS = [
  "검색 의도와 첫 답변이 일치하는가",
  "작성자 경험 또는 실제 상담/사용 맥락이 보이는가",
  "기존 글과 다른 고유한 판단 기준이나 사례가 있는가",
  "문제 해결 순서와 예외 조건이 충분히 구체적인가",
  "본문만 읽고 독자가 다음 행동을 결정할 수 있는가",
];

const C_RANK_DEEP_CHECKS = [
  "블로그가 반복해서 다루는 지역/제품 주제군과 맞는가",
  "제목, 태그, 카테고리, 내부링크가 같은 전문 영역으로 연결되는가",
  "허브/리프 구조 안에서 이 글의 역할이 분명한가",
  "작성자 관점과 상담 경험이 누적 전문성으로 보이는가",
  "관련 글로 이어지는 독자 소비 흐름이 자연스러운가",
];

function countSignals(text: string, signals: string[]): number {
  return signals.reduce((score, signal) => score + (text.includes(signal) ? 1 : 0), 0);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
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
  const cRankScore = countSignals(text, C_RANK_SIGNALS)
    + (strategy.contentTopology?.internalLinkTargets.length ? 2 : 0)
    + (strategy.contentTopology?.kind === "hub" ? 2 : 0);

  let primary: NaverLogicType = "hybrid";
  if (diaScore >= cRankScore + 3) primary = "dia";
  if (cRankScore >= diaScore + 3) primary = "c-rank";

  const label = labelForLogic(primary);
  const reason =
    primary === "dia"
      ? "이 주제는 검색자가 당장 고르거나 해결해야 하는 질문이 강해서, 검색 의도 충족과 문제 해결 밀도를 우선합니다."
      : primary === "c-rank"
        ? "이 주제는 블로그의 지역/제품 전문성과 누적 주제 일관성이 중요해서, 카테고리 권위와 내부 연결을 우선합니다."
        : "이 주제는 선택/해결 의도와 지역/제품 전문성이 함께 필요해서, D.I.A.와 C-Rank 기준을 동시에 적용합니다.";

  const writingFocus = [
    "검색자가 글을 클릭한 이유를 서론 2문단 안에서 바로 다룬다.",
    "상황, 기준, 예외, 체크포인트를 구체적으로 나눠 일반론을 줄인다.",
    "블로그의 기존 주제군과 이어지는 표현, 내부링크, 전문 용어를 자연스럽게 반영한다.",
    "허브/리프 역할에 맞춰 다음에 읽을 글 또는 현재 글의 결론 방향을 명확히 한다.",
    primary === "c-rank"
      ? "작성자의 지역/제품 전문성이 축적된 블로그라는 신호를 제목, 소제목, 사례, 내부 연결에 분산한다."
      : "독자가 검색한 질문에 바로 답하고, 실제 선택/해결 기준을 본문 중반 전에 제시한다.",
  ];

  const checklist = [
    "D.I.A.: 검색 의도, 선택 기준, 문제 해결 순서, 독자 만족 결론이 보이는가",
    "C-Rank: 블로그 역할, 지역/제품 전문성, 기존 글과의 연결, 일관된 작성자 관점이 보이는가",
    "유사문서 방지: 기존 제목/목차와 다른 각도, 사례, 결론을 갖는가",
    "네이버 SEO: 메인 키워드가 자연스럽고 과반복 없이 제목/서론/소제목에 분산되는가",
    ...DIA_DEEP_CHECKS.map((item) => `D.I.A. 세부: ${item}`),
    ...C_RANK_DEEP_CHECKS.map((item) => `C-Rank 세부: ${item}`),
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
    improvements.push("서론에서 검색자가 왜 이 글을 찾았는지 더 직접적으로 잡아야 합니다.");
  }

  if (includesAny(joined, ["기준", "체크", "확인", "구분", "선택", "예외", "주의"])) {
    score += 4;
    evidence.push("선택 기준과 체크포인트가 포함되었습니다.");
  } else {
    score -= 5;
    improvements.push("선택 기준, 체크포인트, 구분 기준을 더 명확히 넣어야 합니다.");
  }

  if (strategy.contentTopology?.internalLinkTargets.length) {
    score += 3;
    evidence.push("기존 글과 연결 가능한 내부링크 맥락이 설계되었습니다.");
  } else {
    improvements.push("실존 내부링크 후보가 부족해 C-Rank 연결성은 제한적입니다.");
  }

  if (includesAny(joined, ["인천", "부평", "구월", "만수", "지역", "매장"])) {
    score += 3;
    evidence.push("지역/매장 맥락이 포함되어 블로그 주제 일관성에 도움이 됩니다.");
  }

  if (includesAny(joined, ["경험", "실사용", "후기", "상담", "방문자", "손님"])) {
    score += 4;
    evidence.push("작성자 경험/상담 맥락이 보여 D.I.A.의 경험성 기준을 보강합니다.");
  } else {
    improvements.push("작성자 경험, 실제 상담 질문, 실사용 사례를 더 넣으면 D.I.A. 완성도가 올라갑니다.");
  }

  if (includesAny(joined, ["내부링크", "관련 글", "이어서", "함께 보면", "기존 글"])) {
    score += 3;
    evidence.push("관련 글로 이어지는 소비 흐름이 있어 C-Rank 연결성을 보강합니다.");
  }

  if (includesAny(joined, ["관리 잘하면", "좋은 제품", "잘 고르면", "개인차"])) {
    score -= 5;
    improvements.push("일반론 표현은 구체적인 확인 방법이나 예외 조건으로 바꾸는 편이 좋습니다.");
  }

  if (plan.primary === "dia" && !includesAny(joined, ["해결", "방법", "원인", "체크"])) {
    score -= 6;
    improvements.push("D.I.A. 중심 주제인데 해결 순서나 원인 분류가 약합니다.");
  }

  if (plan.primary === "c-rank" && !includesAny(joined, ["전문", "기존", "연결", "지역", "매장"])) {
    score -= 6;
    improvements.push("C-Rank 중심 주제인데 블로그의 전문성/일관성 신호가 약합니다.");
  }

  if (plan.primary === "hybrid" && evidence.length >= 3) {
    score += 2;
  }

  return {
    primary: plan.primary,
    label: plan.label,
    completenessScore: clampScore(score),
    reason: plan.reason,
    evidence: evidence.length ? evidence : ["전략 단계에서 네이버 로직 기준은 적용되었지만 본문 근거는 더 보강할 수 있습니다."],
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
