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
  "문제",
  "증상",
  "해결",
  "해결방법",
  "왜",
  "원인",
  "실수",
  "주의",
  "체크",
  "체크포인트",
  "비교",
  "구분",
  "선택",
  "기준",
  "고르는 법",
];

const C_RANK_SIGNALS = [
  "지역",
  "인천",
  "부평",
  "만수동",
  "부천",
  "상동",
  "청라",
  "매장",
  "방문",
  "후기",
  "실사용",
  "브랜드",
  "허브",
  "리프",
  "내부링크",
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
      ? "이 주제는 사용자의 문제 해결과 선택 기준 설명이 중심이라 D.I.A. 관점이 더 중요합니다."
      : primary === "c-rank"
        ? "이 주제는 지역성, 실사용 맥락, 내부링크 연결이 중요해서 C-Rank 관점이 더 강합니다."
        : "이 주제는 문제 해결 흐름과 주제권 연결이 모두 중요해서 D.I.A.와 C-Rank를 함께 맞추는 편이 좋습니다.";

  const writingFocus = [
    "도입부에서 검색자의 상황과 고민을 바로 연결합니다.",
    "문제, 선택 기준, 비교 포인트, 결론 순서로 흐름을 잡습니다.",
    "내부링크 대상이 있으면 실제 제목과 URL 쌍을 정확히 맞춥니다.",
    "지역/매장/실사용 맥락이 있으면 본문 문맥 안에서 자연스럽게 반영합니다.",
    primary === "c-rank"
      ? "허브 글이라면 지역성과 연결 글 구조를 분명히 보여줍니다."
      : "리프 글이라면 하나의 문제를 분명히 해결하는 방향으로 마무리합니다.",
  ];

  const checklist = [
    "D.I.A.: 문제 제기, 독자 질문, 해결 흐름, 선택 기준이 본문에 드러나는지 확인",
    "C-Rank: 지역/주제권/내부링크/실사용 신호가 실제로 살아 있는지 확인",
    "내부링크: 실제 발행된 글만 제목-URL 쌍으로 연결",
    "본문 구조: 제목, 도입부, 소제목, 결론 흐름이 자연스러운지 확인",
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

  if (includesAny(joined, ["문제", "왜", "원인", "실수", "증상", "체크포인트", "선택 기준"])) {
    score += 3;
    evidence.push("문제 상황과 선택 기준이 본문에 드러나 검색 의도 연결이 자연스럽습니다.");
  } else {
    score -= 4;
    improvements.push("도입부나 본문 초반에 검색자가 왜 이 글을 찾는지 드러나는 문제 상황을 더 분명히 넣어주세요.");
  }

  if (includesAny(joined, ["비교", "차이", "구분", "장단점", "기준", "선택"])) {
    score += 4;
    evidence.push("비교와 선택 기준 요소가 살아 있어 실전 검색 의도에 잘 맞습니다.");
  } else {
    score -= 5;
    improvements.push("비교 포인트나 선택 기준 문장을 보강해 정보형 글의 실용성을 더 높여주세요.");
  }

  if (strategy.contentTopology?.internalLinkTargets.length) {
    score += 3;
    evidence.push("내부링크 설계 대상이 있어 주제권 확장 관점이 살아 있습니다.");
  } else {
    improvements.push("연결할 실존 글이 있다면 내부링크를 함께 설계해 주제권 연결을 보강해 주세요.");
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

  if (includesAny(joined, ["인천", "부평", "만수동", "부천", "상동", "청라"])) {
    score += 3;
    evidence.push("지역성과 실사용 맥락이 보여 C-Rank 관점의 주제권 연결이 자연스럽습니다.");
  }

  if (includesAny(joined, ["실사용", "방문", "후기", "고민", "체크", "질문"])) {
    score += 4;
    evidence.push("실사용 맥락과 검색자 질문이 보여 D.I.A. 관점의 설득력이 있습니다.");
  } else {
    improvements.push("실사용 상황, 자주 나오는 질문, 선택 전 고민 포인트를 더 넣어 D.I.A. 신호를 보강해 주세요.");
  }

  if (includesAny(joined, ["내부링크", "관련 글", "함께 보면", "참고 링크"])) {
    score += 3;
    evidence.push("관련 글 연결 신호가 보여 C-Rank 흐름 보강에 도움이 됩니다.");
  }

  if (includesAny(joined, ["과도한 반복", "키워드만", "억지"])) {
    score -= 5;
    improvements.push("문맥보다 키워드 반복이 먼저 보이는 구간은 표현을 풀어 자연스럽게 정리해 주세요.");
  }

  if (plan.primary === "dia" && !includesAny(joined, ["문제", "해결", "기준", "체크"])) {
    score -= 6;
    improvements.push("D.I.A. 중심 글이라면 문제 제기와 해결 흐름이 더 또렷하게 드러나야 합니다.");
  }

  if (plan.primary === "c-rank" && !includesAny(joined, ["지역", "매장", "실사용", "관련 글", "내부링크"])) {
    score -= 6;
    improvements.push("C-Rank 중심 글이라면 지역성, 실사용, 내부링크 흐름을 조금 더 분명히 보여주는 편이 좋습니다.");
  }

  if (plan.primary === "hybrid" && evidence.length >= 3) {
    score += 2;
  }

  return {
    primary: plan.primary,
    label: plan.label,
    completenessScore: clampScore(score),
    reason: plan.reason,
    evidence: evidence.length ? evidence : ["문제 해결 흐름과 주제권 연결 신호를 함께 보강할 여지가 있습니다."],
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
