/**
 * writer-engine — serpModule별 글 구조 선택
 *
 * 구현 근거: references/agent-writer-engine.md
 *
 * seo-analyst-agent가 판정한 serpModule / aiBriefingCitationType / placeSubtype을 받아
 * 이 글이 따라야 할 구조를 고른다. writer는 자체적으로 SERP 모듈을 추론하지 않는다.
 *
 * 이 계층이 있기 전에는 모듈과 무관하게 모든 글이 같은 템플릿으로 나왔다.
 * 구조를 모듈별로 실제로 다르게 만드는 것이 이 파일의 존재 이유다.
 */

import type {
  ArticlePlan,
  PlaceSubtype,
  SerpAnalysis,
  SerpModule,
  WriterStructurePlan,
} from "./types";

const MODULE_LABEL: Record<SerpModule, string> = {
  ai_briefing: "AI 브리핑형",
  clip: "클립 보조형",
  place: "플레이스 보조형",
  shopping: "구매 판단 보조형",
  blog_view: "블로그/뷰 롱폼형",
};

const PLACE_SUBTYPE_FOCUS: Record<PlaceSubtype, string> = {
  place_city: "지역 허브 관점에서 매장 선택 기준을 정리하세요.",
  place_dong: "동 단위 생활권과 가까운 방문 맥락을 중심으로 쓰세요.",
  place_station: "역세권 동선, 퇴근길/이동 중 방문 팁을 중심으로 쓰세요.",
  place_visit_check: "방문 전 체크리스트와 상담 준비물을 중심으로 쓰세요.",
  place_review: "실제 방문/상담 경험 서술을 중심으로 쓰세요.",
};

// ============================================================
// 모듈별 구조
// ============================================================

function buildAiBriefingPlan(analysis: SerpAnalysis): WriterStructurePlan {
  const seoRequired = analysis.aiBriefingCitationType === "seo_required";

  return {
    serpModule: "ai_briefing",
    label: MODULE_LABEL.ai_briefing,
    goal: "AI 브리핑 출처로 인용될 수 있는 명확한 답변 구조를 만든다.",
    requiredSections: [
      "첫 문단: 검색 질문에 대한 직접 답변",
      "두 번째 문단: 비교 또는 판단 기준",
      "세 번째 문단: 예외 조건 또는 주의점",
      "본문 중간: 단계 설명, 목록, 표 중 하나",
      "하단: FAQ 2~3개",
    ],
    requiredElements: [
      "첫 3문단 안에 그 자체로 인용 가능한 독립 문장 3개를 넣으세요. (1) 질문에 대한 직접 답변 1문장 (2) 비교/판단 기준 1문장 (3) 예외/주의/선택 조건 1문장.",
      "각 문장은 앞뒤 문맥 없이 읽어도 뜻이 통해야 합니다.",
      "AI 브리핑이 본문을 그대로 대체하지 못하도록 실제 상담 맥락과 판단 기준을 함께 넣으세요.",
      seoRequired
        ? "비교/추천형이므로 제목, 도입, 본문 충실도, 내부링크, 실제 사용 경험 서술을 함께 강화하세요."
        : "정보/방법형이므로 답변 명확성과 문단 구조를 최우선으로 두세요.",
    ],
    forbiddenMoves: [
      "정의형 제목만으로 끝내지 마세요.",
      "출처 없는 수치를 단정하지 마세요.",
      "확인하지 않은 제품 스펙을 단정하지 마세요.",
      "'~란 무엇인가', '완벽 정리', '총정리' 같은 정의형 제목은 피하세요.",
    ],
    qaChecklist: [
      "첫 문단에 직접 답변이 있는가 (필수)",
      "FAQ 2~3개가 있는가 (필수)",
      "정의형 제목을 피했는가 (필수)",
    ],
    briefingNote:
      analysis.serpModuleConfidence === "low"
        ? "첫 화면을 직접 확인하지 않은 예측값입니다. AI 브리핑 인용 구조를 적용하되, 블로그 롱폼으로서의 완결성도 함께 유지하세요."
        : "AI 브리핑 인용 구조를 우선 적용하세요.",
  };
}

function buildClipPlan(): WriterStructurePlan {
  return {
    serpModule: "clip",
    label: MODULE_LABEL.clip,
    goal: "클립/숏폼 콘텐츠를 보조하는 텍스트를 만든다.",
    requiredSections: [
      "영상에서 보여줄 핵심 장면",
      "실제로 느낀 체감 포인트",
      "블로그에서 보충할 설명",
      "클립 링크 또는 촬영 가이드",
    ],
    requiredElements: [
      "체감, 후기, 사용 장면, 비교 포인트를 짧고 명확하게 정리하세요.",
      "영상으로 보여줄 것과 글로 설명할 것을 분리하세요.",
    ],
    forbiddenMoves: [
      "블로그 단독 상위노출을 목표로 잡지 마세요.",
      "영상 없이 체감을 단정하는 서술은 피하세요.",
    ],
    qaChecklist: ["클립 링크 또는 촬영 가이드가 있는가 (필수)"],
    briefingNote: "이 글은 영상 보조 텍스트입니다. 길이를 억지로 늘리지 마세요.",
  };
}

function buildPlacePlan(analysis: SerpAnalysis): WriterStructurePlan {
  const subtype = analysis.placeSubtype ?? "place_city";

  return {
    serpModule: "place",
    label: `${MODULE_LABEL.place} (${subtype})`,
    goal: "스마트플레이스 보조 문서이자 방문 전 안내 글을 만든다.",
    requiredSections: [
      "지역/동선 상황",
      "어떤 매장인지",
      "방문 전 확인할 것",
      "상담 시 물어볼 질문",
      "스마트플레이스 연결",
    ],
    requiredElements: [
      PLACE_SUBTYPE_FOCUS[subtype],
      "매장 위치, 주차, 영업시간, 방문 전 확인 사항을 실제 정보로 넣으세요.",
      "확인되지 않은 영업 정보는 쓰지 말고, 확인 가능한 범위만 쓰세요.",
    ],
    forbiddenMoves: [
      "블로그 단독 상위노출만을 목표로 잡지 마세요. 플레이스 보조 문서 노출이 우선입니다.",
      "지역명을 문장마다 반복해 넣지 마세요.",
    ],
    qaChecklist: [
      "매장 정보가 있는가 (필수)",
      "스마트플레이스 연결이 있는가 (필수)",
      "FAQ는 불필요 — 억지로 붙이지 말 것",
    ],
    briefingNote: "방문 직전 독자가 필요한 정보를 우선하세요.",
  };
}

function buildShoppingPlan(): WriterStructurePlan {
  return {
    serpModule: "shopping",
    label: MODULE_LABEL.shopping,
    goal: "구매 전 판단을 보조한다. 쇼핑/스토어가 우선임을 전제로 한다.",
    requiredSections: [
      "구매 전 확인 기준",
      "비교 기준",
      "과장 없는 장단점",
      "매장 상담 또는 스토어 연결",
    ],
    requiredElements: [
      "가격을 쓸 때는 확인 시점을 함께 밝히세요.",
      "장점만 나열하지 말고 맞지 않는 경우도 함께 쓰세요.",
    ],
    forbiddenMoves: [
      "단정적인 최저가 표현은 피하세요.",
      "확인되지 않은 재고나 할인 조건을 단정하지 마세요.",
    ],
    qaChecklist: ["과장 없는 장단점이 함께 있는가"],
    briefingNote: "이 글의 역할은 구매 결정을 돕는 보조 문서입니다.",
  };
}

function buildBlogViewPlan(analysis: SerpAnalysis): WriterStructurePlan {
  const isProblemSolving = analysis.primarySearchIntent === "문제해결형";

  return {
    serpModule: "blog_view",
    label: `${MODULE_LABEL.blog_view} (${isProblemSolving ? "문제해결형" : "사용법형"})`,
    goal: isProblemSolving
      ? "증상에서 해결까지 독자가 따라올 수 있는 문제 해결 글을 만든다."
      : "상황에서 단계별 방법까지 이어지는 사용법 글을 만든다.",
    requiredSections: isProblemSolving
      ? ["증상", "원인", "직접 점검", "해결 방법", "매장 상담이 필요한 경우"]
      : ["상황", "준비물/조건", "단계별 방법", "실수 방지", "관련 글 연결"],
    requiredElements: [
      isProblemSolving
        ? "증상 → 원인 → 해결 3단계 흐름을 유지하세요. 원인 없이 해결만 쓰지 마세요."
        : "설정, 교체, 관리 기준을 단계별로 쓰세요. 단계를 건너뛰지 마세요.",
      "실제 경험과 내부링크 구조를 함께 적용하세요.",
    ],
    forbiddenMoves: [
      "증상만 나열하고 해결을 다음 글로 미루지 마세요.",
      "일반론으로만 끝내지 말고 구체적인 조건과 수치를 넣으세요.",
    ],
    qaChecklist: isProblemSolving
      ? ["증상/원인/해결 구조가 있는가 (필수)"]
      : ["단계별 순서가 실제로 따라할 수 있게 쓰였는가"],
    briefingNote: "D.I.A./C-Rank 기준이 그대로 적용되는 유형입니다.",
  };
}

// ============================================================
// 진입점
// ============================================================

export function buildWriterStructurePlan(analysis: SerpAnalysis): WriterStructurePlan {
  switch (analysis.serpModule) {
    case "ai_briefing":
      return buildAiBriefingPlan(analysis);
    case "clip":
      return buildClipPlan();
    case "place":
      return buildPlacePlan(analysis);
    case "shopping":
      return buildShoppingPlan();
    case "blog_view":
    default:
      return buildBlogViewPlan(analysis);
  }
}

/**
 * 사용자 요구사항 우선 원칙 (references/agent-writer-engine.md).
 * ArticlePlan의 lockedRequirements / requiredEntities / requiredSections는 SERP 전략보다 우선한다.
 */
function buildUserRequirementOverride(articlePlan?: ArticlePlan): string[] {
  if (!articlePlan) return [];

  const lines: string[] = [];
  if (articlePlan.requiredEntities.length > 0) {
    lines.push(
      `사용자 고정 요구사항이 SERP 구조보다 우선합니다. 다음 항목은 모두 본문에 넣고 각각 추천 이유와 추천 대상을 쓰세요: ${articlePlan.requiredEntities.join(", ")}.`
    );
  }
  if (articlePlan.lockedRequirements.length > 0) {
    lines.push(`고정 조건: ${articlePlan.lockedRequirements.join(" / ")}`);
  }
  if (articlePlan.requiredSections.length > 0) {
    lines.push(`고정 섹션: ${articlePlan.requiredSections.join(" / ")}`);
  }
  return lines;
}

export function formatWriterStructureBrief(params: {
  analysis?: SerpAnalysis;
  plan?: WriterStructurePlan;
  articlePlan?: ArticlePlan;
}): string {
  const { analysis, plan, articlePlan } = params;

  if (!analysis || !plan) {
    return [
      "SERP 모듈 미판정.",
      "검색 첫 화면에서 어떤 모듈이 먼저 보일지 스스로 단정하지 말고, 검색 의도를 본문에서 완결하는 데 집중하세요.",
    ].join("\n");
  }

  const userOverride = buildUserRequirementOverride(articlePlan);

  return [
    "[Writer Engine — SERP 모듈별 글 구조]",
    `SERP 모듈: ${plan.label}`,
    `판정 근거: ${analysis.serpModuleReason}`,
    `신뢰도: ${analysis.serpModuleConfidence} (실측 ${analysis.observedSerpModule ?? "없음"} / 예측 ${analysis.predictedSerpModule})`,
    `검색 의도: ${analysis.primarySearchIntent}`,
    `배정 블로그 역할: ${analysis.recommendedBlogRole}`,
    analysis.aiBriefingCitationType
      ? `AI 브리핑 인용 타입: ${analysis.aiBriefingCitationType} — ${analysis.aiBriefingCitationNote ?? ""}`
      : null,
    "",
    `이 글의 목표: ${plan.goal}`,
    "",
    "반드시 이 순서의 구조로 쓰세요:",
    ...plan.requiredSections.map((section, index) => `${index + 1}. ${section}`),
    "",
    "필수 반영 사항:",
    ...plan.requiredElements.map((item) => `- ${item}`),
    "",
    "이 모듈에서 하지 말 것:",
    ...plan.forbiddenMoves.map((item) => `- ${item}`),
    "",
    "발행 전 자가 점검:",
    ...plan.qaChecklist.map((item) => `- ${item}`),
    "",
    `참고: ${plan.briefingNote}`,
    "- 위 구조는 독자가 읽으면서 자연스럽게 느끼도록 녹여 쓰세요. 'SERP 모듈', 'AI 브리핑', '인용 타입' 같은 작업용 용어를 본문에 쓰지 마세요.",
    ...(userOverride.length ? ["", "사용자 요구사항 우선 (SERP 구조보다 앞섭니다):", ...userOverride.map((item) => `- ${item}`)] : []),
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export class WriterEngine {
  planStructure(analysis: SerpAnalysis): WriterStructurePlan {
    return buildWriterStructurePlan(analysis);
  }

  buildWriterBrief(params: {
    analysis?: SerpAnalysis;
    plan?: WriterStructurePlan;
    articlePlan?: ArticlePlan;
  }): string {
    return formatWriterStructureBrief(params);
  }
}

export const writerEngine = new WriterEngine();
