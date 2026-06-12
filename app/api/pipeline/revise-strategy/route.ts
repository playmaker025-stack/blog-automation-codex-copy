import "@anthropic-ai/sdk/shims/node";
import { NextRequest, NextResponse } from "next/server";
import { getAnthropicClient, MODELS } from "@/lib/anthropic/client";
import type { StrategyPlanResult } from "@/lib/agents/types";
import { normalizeUserId } from "@/lib/utils/normalize";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  const editableFields = {
    title: strategy.title,
    outline: strategy.outline,
    rationale: strategy.rationale,
    keyPoints: strategy.keyPoints ?? [],
    articlePlan: strategy.articlePlan
      ? {
          title: strategy.articlePlan.title,
          requiredEntities: strategy.articlePlan.requiredEntities,
          requiredSections: strategy.articlePlan.requiredSections,
          lockedRequirements: strategy.articlePlan.lockedRequirements,
        }
      : undefined,
  };

  const prompt = `당신은 블로그 전략 수정 에이전트입니다.
사용자의 수정 요청을 기존 전략에 정확히 반영하되, 요청에 명시되지 않은 내용은 그대로 유지하세요.

## 기존 전략
\`\`\`json
${JSON.stringify(editableFields, null, 2)}
\`\`\`

## 사용자 수정 요청
${modifications.trim()}

## 반영 규칙
1. 사용자가 특정 제품·기기 이름을 나열하면:
   - outline의 각 섹션을 해당 제품 중심으로 재구성하세요 (각 제품 1개 섹션).
   - articlePlan.requiredEntities에 해당 제품명 목록을 추가하세요.
   - articlePlan.requiredSections를 제품별 섹션으로 업데이트하세요.
2. 제목 변경 요청이 있으면 title을 변경하세요.
3. rationale 끝에 "[수정 반영] {수정 내용 한 줄 요약}" 을 추가하세요.
4. 요청에 없는 내용은 절대 변경하지 마세요.

JSON 형식으로만 반환하세요. 코드블록, 설명 없이 { } 로 시작하고 끝내세요.`;

  try {
    const client = getAnthropicClient();
    const message = await client.messages.create({
      model: MODELS.sonnet,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      message.content[0]?.type === "text" ? message.content[0].text.trim() : "";

    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) {
      return NextResponse.json(
        { error: "전략 수정 응답을 파싱할 수 없습니다." },
        { status: 500 }
      );
    }

    const revised = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as Partial<
      typeof editableFields
    >;

    const revisedStrategy: StrategyPlanResult = {
      ...strategy,
      title: revised.title?.trim() || strategy.title,
      outline:
        Array.isArray(revised.outline) && revised.outline.length > 0
          ? revised.outline
          : strategy.outline,
      rationale: revised.rationale?.trim() || strategy.rationale,
      keyPoints:
        Array.isArray(revised.keyPoints) && revised.keyPoints.length > 0
          ? revised.keyPoints
          : strategy.keyPoints,
      articlePlan:
        strategy.articlePlan && revised.articlePlan
          ? {
              ...strategy.articlePlan,
              requiredEntities: Array.isArray(revised.articlePlan.requiredEntities)
                ? revised.articlePlan.requiredEntities
                : strategy.articlePlan.requiredEntities,
              requiredSections: Array.isArray(revised.articlePlan.requiredSections)
                ? revised.articlePlan.requiredSections
                : strategy.articlePlan.requiredSections,
              lockedRequirements: Array.isArray(revised.articlePlan.lockedRequirements)
                ? revised.articlePlan.lockedRequirements
                : strategy.articlePlan.lockedRequirements,
              planVersion: strategy.articlePlan.planVersion + 1,
              updatedAt: new Date().toISOString(),
            }
          : strategy.articlePlan,
    };

    return NextResponse.json({ strategy: revisedStrategy });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "전략 수정 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}
