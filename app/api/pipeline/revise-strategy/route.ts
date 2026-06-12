import { NextRequest, NextResponse } from "next/server";
import type { StrategyPlanResult } from "@/lib/agents/types";
import { normalizeUserId } from "@/lib/utils/normalize";

export const dynamic = "force-dynamic";

/** 수정 텍스트에서 제품/기기명 추출 (쉼표·줄바꿈 구분) */
function extractProducts(text: string): string[] {
  const parts = text.split(/[,，\n\r]+/);
  const results: string[] = [];

  for (const part of parts) {
    // 한국어 조사·접두어 제거: "비교할 제품5종은 " 등
    const cleaned = part
      .trim()
      .replace(/^[^A-Za-z0-9가-힣]*/, "")          // 앞쪽 특수문자 제거
      .replace(/^.*?[은는이가의을를로]\s+/u, "")     // 조사까지 제거
      .replace(/^\d+[.)]\s*/, "")                   // 번호 목록 제거
      .trim();

    if (!cleaned || cleaned.length < 2 || cleaned.length > 50) continue;
    // 영문자·숫자가 포함돼야 제품명으로 인정 (순수 한국어는 일반 단어일 가능성)
    if (/[A-Za-z0-9]/.test(cleaned)) {
      results.push(cleaned);
    }
  }

  return [...new Set(results)];
}

/** 제목 변경 요청 파싱 ("제목:" 또는 "title:" 패턴) */
function extractRequestedTitle(text: string): string | null {
  const match = text.match(/(?:제목|title)\s*[:：]\s*(.+)/iu);
  return match ? match[1].trim() : null;
}

/** 제품 목록을 반영해 outline 재구성 */
function rebuildOutline(
  original: StrategyPlanResult["outline"],
  products: string[]
): StrategyPlanResult["outline"] {
  const productItems = products.map((p) => ({
    heading: `${p} 추천 이유와 추천 대상`,
    subPoints: [] as string[],
    contentDirection: `${p}의 특징, 장단점, 추천 대상을 구체적으로 설명`,
    estimatedParagraphs: 3,
  }));

  if (!original || original.length === 0) return productItems;

  const first = original[0];
  const last = original[original.length - 1];

  if (original.length === 1) return [first, ...productItems];
  return [first, ...productItems, last];
}

export async function POST(request: NextRequest) {
  let body: {
    topicId: string;
    userId: string;
    strategy: StrategyPlanResult;
    modifications: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "요청 본문 파싱 실패" }, { status: 400 });
  }

  const { strategy, modifications, topicId } = body;
  const userId = normalizeUserId(body.userId);

  if (!strategy || !modifications?.trim() || !topicId || !userId) {
    return NextResponse.json(
      { error: "strategy, modifications, topicId, userId가 필요합니다." },
      { status: 400 }
    );
  }

  const mod = modifications.trim();
  const products = extractProducts(mod);
  const requestedTitle = extractRequestedTitle(mod);

  const newEntities =
    products.length > 0
      ? [...new Set([...(strategy.articlePlan?.requiredEntities ?? []), ...products])]
      : strategy.articlePlan?.requiredEntities ?? [];

  const revisedStrategy: StrategyPlanResult = {
    ...strategy,
    title: requestedTitle ?? strategy.title,
    outline:
      products.length > 0
        ? rebuildOutline(strategy.outline, products)
        : strategy.outline,
    rationale: `${strategy.rationale}\n\n[수정 반영] ${mod}`,
    keyPoints: [
      ...(strategy.keyPoints ?? []),
      `수정사항 반영: ${mod}`,
    ],
    articlePlan: strategy.articlePlan
      ? {
          ...strategy.articlePlan,
          title: requestedTitle ?? strategy.articlePlan.title,
          requiredEntities: newEntities,
          requiredSections:
            products.length > 0
              ? [
                  ...strategy.articlePlan.requiredSections.filter(
                    (s) => !s.includes("추천 이유와 추천 대상")
                  ),
                  ...products.map((p) => `${p} 추천 이유와 추천 대상`),
                ]
              : strategy.articlePlan.requiredSections,
          lockedRequirements: [
            ...strategy.articlePlan.lockedRequirements,
            `사용자 수정사항 반영: ${mod}`,
            ...(products.length > 0
              ? [
                  `본문에 추천 대상 ${products.length}개를 모두 포함한다.`,
                  "각 대상을 H2 또는 H3 소제목으로 분리한다.",
                  "각 대상마다 추천 이유와 추천 대상을 작성한다.",
                ]
              : []),
          ],
          planVersion: strategy.articlePlan.planVersion + 1,
          updatedAt: new Date().toISOString(),
        }
      : strategy.articlePlan,
  };

  return NextResponse.json({ strategy: revisedStrategy });
}
