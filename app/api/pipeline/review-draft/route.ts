import { NextRequest, NextResponse } from "next/server";
import { reviewActualDraft } from "@/lib/agents/draft-review";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface ReviewDraftRequest {
  originalTitle?: string;
  title: string;
  body: string;
}

interface OpenAIReviewResult {
  revisedTitle: string;
  revisedBody: string;
  changes: string[];
  seoNotes: string[];
  naverLogicNotes: string[];
}

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    revisedTitle: { type: "string" },
    revisedBody: { type: "string" },
    changes: {
      type: "array",
      items: { type: "string" },
    },
    seoNotes: {
      type: "array",
      items: { type: "string" },
    },
    naverLogicNotes: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["revisedTitle", "revisedBody", "changes", "seoNotes", "naverLogicNotes"],
} as const;

function extractOutputText(response: unknown): string {
  const direct = (response as { output_text?: unknown }).output_text;
  if (typeof direct === "string") return direct;

  const output = (response as { output?: Array<{ content?: Array<{ text?: unknown }> }> }).output;
  if (!Array.isArray(output)) return "";
  return output
    .flatMap((item) => item.content ?? [])
    .map((content) => content.text)
    .filter((text): text is string => typeof text === "string")
    .join("\n")
    .trim();
}

async function requestOpenAIReview(input: ReviewDraftRequest): Promise<OpenAIReviewResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY 환경 변수가 설정되어 있지 않습니다.");
  }

  const model = process.env.OPENAI_REVIEW_MODEL ?? "gpt-4.1-mini";
  const localReview = reviewActualDraft(input);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content:
            "너는 네이버 블로그 SEO 편집자다. 사용자의 실제 작성본 전체를 검사하고, 발행 가능한 수정본을 작성한다. " +
            "성인 안내나 미성년자 주의 문구는 새로 추가하지 않는다. " +
            "제목 SEO를 개선하되 과장 표현, 보장 표현, 낚시성 표현은 피한다. " +
            "본문은 원문의 의도와 사실관계를 유지하면서 오탈자, 어색한 문장, 문단 흐름, 네이버 블로그 가독성, 키워드 자연 삽입을 개선한다. " +
            "출력은 반드시 JSON 스키마를 따른다.",
        },
        {
          role: "user",
          content: `원래 초안 제목: ${input.originalTitle ?? ""}
실제 발행 제목: ${input.title}

로컬 검토 결과:
${localReview.issues.map((issue) => `- [${issue.severity}] ${issue.message}`).join("\n")}

검토 기준:
- 제목은 검색 의도와 핵심 키워드가 앞쪽에 오도록 다듬는다.
- 네이버 블로그 본문은 도입, 문제/상황 설명, 선택 기준, 구체 예시, 마무리 흐름이 자연스러워야 한다.
- 키워드는 반복 삽입이 아니라 문맥상 자연스럽게 배치한다.
- 과장/단정/보장/최고 표현은 완화한다.
- 성인 안내 또는 미성년자 주의 문구는 추가하지 않는다.
- 수정한 내용을 changes에 구체적으로 요약한다.
- seoNotes에는 제목/키워드/검색 의도 관련 검수 내용을 적는다.
- naverLogicNotes에는 문단, 체류시간, 가독성, 정보 흐름 관점의 검수 내용을 적는다.

실제 작성 본문:
${input.body}`,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "naver_blog_review_revision",
          strict: true,
          schema: REVIEW_SCHEMA,
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI review failed: ${response.status} ${errorText.slice(0, 500)}`);
  }

  const json = await response.json() as unknown;
  const outputText = extractOutputText(json);
  if (!outputText) throw new Error("OpenAI review response did not include output text.");

  return JSON.parse(outputText) as OpenAIReviewResult;
}

export async function POST(request: NextRequest) {
  let body: ReviewDraftRequest;
  try {
    body = await request.json() as ReviewDraftRequest;
  } catch {
    return NextResponse.json({ error: "요청 본문을 읽지 못했습니다." }, { status: 400 });
  }

  if (!body.title?.trim() || !body.body?.trim()) {
    return NextResponse.json({ error: "제목과 본문이 필요합니다." }, { status: 400 });
  }

  const localReview = reviewActualDraft(body);
  if (!localReview.passed) {
    return NextResponse.json({
      ...localReview,
      error: "차단 항목을 먼저 수정한 뒤 다시 검토해 주세요.",
    }, { status: 422 });
  }

  try {
    const aiReview = await requestOpenAIReview(body);
    const finalReview = reviewActualDraft({
      originalTitle: body.originalTitle,
      title: aiReview.revisedTitle,
      body: aiReview.revisedBody,
    });

    return NextResponse.json({
      ...finalReview,
      revisedTitle: aiReview.revisedTitle,
      revisedBody: aiReview.revisedBody,
      changes: aiReview.changes,
      seoNotes: aiReview.seoNotes,
      naverLogicNotes: aiReview.naverLogicNotes,
    });
  } catch (error) {
    console.error("[POST /api/pipeline/review-draft]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "OpenAI 검토에 실패했습니다." },
      { status: 500 }
    );
  }
}
