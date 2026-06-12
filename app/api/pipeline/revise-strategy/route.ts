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

  // LLM에는 단순 문자열 필드만 전달 (복잡한 중첩 객체 제외)
  const editableFields = {
    title: strategy.title,
    outlineHeadings: strategy.outline.map((item) => item.heading),
    rationale: strategy.rationale,
    requiredEntities: strategy.articlePlan?.requiredEntities ?? [],
  };

  const prompt = `블로그 전략 수정 에이전트입니다. 사용자 수정 요청을 아래 전략에 반영하고 수정 결과를 JSON으로만 반환하세요.

현재 전략:
${JSON.stringify(editableFields, null, 2)}

사용자 수정 요청:
${modifications.trim()}

반영 규칙:
1. 제품·기기 이름이 나열되면 outlineHeadings를 해당 제품 중심으로 재구성하고 requiredEntities에 추가하세요.
2. 제목 변경 요청이면 title을 바꾸세요.
3. rationale 끝에 "[수정 반영] {수정 내용 한 줄}" 을 추가하세요.
4. 명시되지 않은 항목은 그대로 유지하세요.

아래 JSON 구조로만 반환하세요 (코드블록 없이):
{"title":"...","outlineHeadings":["..."],"rationale":"...","requiredEntities":["..."]}`;

  try {
    const client = getAnthropicClient();
    const message = await client.messages.create({
      model: MODELS.sonnet,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      message.content[0]?.type === "text" ? message.content[0].text.trim() : "";

    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) {
      return NextResponse.json(
        { error: `LLM 응답을 JSON으로 파싱할 수 없습니다: ${text.slice(0, 200)}` },
        { status: 500 }
      );
    }

    let revised: {
      title?: string;
      outlineHeadings?: string[];
      rationale?: string;
      requiredEntities?: string[];
    };
    try {
      revised = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    } catch {
      return NextResponse.json(
        { error: `JSON 파싱 오류: ${text.slice(0, 200)}` },
        { status: 500 }
      );
    }

    // 수정된 heading을 원본 복잡 객체 구조에 매핑
    const newHeadings = Array.isArray(revised.outlineHeadings) && revised.outlineHeadings.length > 0
      ? revised.outlineHeadings
      : null;

    const revisedOutline = newHeadings
      ? newHeadings.map((heading, i) => ({
          ...(strategy.outline[i] ?? {
            subPoints: [],
            contentDirection: "",
            estimatedParagraphs: 3,
          }),
          heading: typeof heading === "string" ? heading : (strategy.outline[i]?.heading ?? ""),
        }))
      : strategy.outline;

    const newEntities =
      Array.isArray(revised.requiredEntities) && revised.requiredEntities.length > 0
        ? revised.requiredEntities
        : null;

    const revisedStrategy: StrategyPlanResult = {
      ...strategy,
      title: revised.title?.trim() || strategy.title,
      outline: revisedOutline,
      rationale: revised.rationale?.trim() || strategy.rationale,
      articlePlan: strategy.articlePlan
        ? {
            ...strategy.articlePlan,
            ...(newEntities
              ? {
                  requiredEntities: newEntities,
                  requiredSections: newEntities.map((e) => `${e} 추천 이유와 추천 대상`),
                  lockedRequirements: [
                    ...strategy.articlePlan.lockedRequirements,
                    `본문에 추천 대상 ${newEntities.length}개를 모두 포함한다.`,
                    `사용자 수정사항 반영: ${modifications.trim()}`,
                  ],
                  planVersion: strategy.articlePlan.planVersion + 1,
                  updatedAt: new Date().toISOString(),
                }
              : {}),
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
