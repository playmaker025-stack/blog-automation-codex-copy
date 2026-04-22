import { NextRequest, NextResponse } from "next/server";
import { reviewActualDraft, type DraftReviewChange } from "@/lib/agents/draft-review";

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
  changeDetails: DraftReviewChange[];
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
    changeDetails: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          before: { type: "string" },
          after: { type: "string" },
          reason: { type: "string" },
        },
        required: ["before", "after", "reason"],
      },
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
  required: ["revisedTitle", "revisedBody", "changes", "changeDetails", "seoNotes", "naverLogicNotes"],
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

const FORBIDDEN_SAFETY_PATTERN =
  /(성인|미성년|청소년|19세|니코틴\s*주의|안전\s*(문구|안내|주의)|주의\s*(문구|안내)|건강\s*(경고|주의)|법적\s*(고지|주의)|흡연은|금연|유해|위험성)/;

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeForSimilarity(value: string): string {
  return value.replace(/\s+/g, "").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
}

function similarity(a: string, b: string): number {
  const left = normalizeForSimilarity(a);
  const right = normalizeForSimilarity(b);
  if (!left && !right) return 1;
  if (!left || !right) return 0;
  const grams = (value: string) => {
    const set = new Set<string>();
    for (let index = 0; index < value.length - 1; index += 1) set.add(value.slice(index, index + 2));
    return set;
  };
  const leftGrams = grams(left);
  const rightGrams = grams(right);
  if (leftGrams.size === 0 || rightGrams.size === 0) return left === right ? 1 : 0;
  let overlap = 0;
  leftGrams.forEach((gram) => {
    if (rightGrams.has(gram)) overlap += 1;
  });
  return overlap / Math.max(leftGrams.size, rightGrams.size);
}

function removeForbiddenAddedParagraphs(originalBody: string, revisedBody: string): string {
  const originalHasForbidden = FORBIDDEN_SAFETY_PATTERN.test(originalBody);
  if (originalHasForbidden) return revisedBody;

  return revisedBody
    .split(/\n{2,}/)
    .filter((paragraph) => !FORBIDDEN_SAFETY_PATTERN.test(paragraph))
    .join("\n\n")
    .trim();
}

function sanitizeReview(input: ReviewDraftRequest, review: OpenAIReviewResult): OpenAIReviewResult {
  const revisedBody = removeForbiddenAddedParagraphs(input.body, review.revisedBody);
  const safeText = (value: string) => !FORBIDDEN_SAFETY_PATTERN.test(value);
  const changeDetails = (review.changeDetails ?? []).filter(
    (item) => safeText(`${item.before} ${item.after} ${item.reason}`) && compact(item.before) !== compact(item.after)
  );

  return {
    revisedTitle: compact(review.revisedTitle),
    revisedBody,
    changes: (review.changes ?? []).filter(safeText),
    changeDetails,
    seoNotes: (review.seoNotes ?? []).filter(safeText),
    naverLogicNotes: (review.naverLogicNotes ?? []).filter(safeText),
  };
}

function validateReview(input: ReviewDraftRequest, review: OpenAIReviewResult): string | null {
  if (!review.revisedTitle.trim() || !review.revisedBody.trim()) {
    return "OpenAI가 수정본 제목 또는 본문을 비워서 반환했습니다.";
  }
  if (review.revisedTitle.length > 45) {
    return "OpenAI가 모바일 검색 결과에 너무 긴 제목을 반환했습니다.";
  }
  if (similarity(input.body, review.revisedBody) > 0.985 && compact(input.title) === compact(review.revisedTitle)) {
    return "OpenAI가 원문을 거의 그대로 반환했습니다.";
  }
  if (review.changeDetails.length === 0) {
    return "OpenAI가 수정 전/후 변경 근거를 반환하지 않았습니다.";
  }
  if (!review.seoNotes.length || !review.naverLogicNotes.length) {
    return "OpenAI가 SEO 또는 네이버 로직 검수 내용을 충분히 반환하지 않았습니다.";
  }
  if (!input.body.match(FORBIDDEN_SAFETY_PATTERN) && FORBIDDEN_SAFETY_PATTERN.test(review.revisedBody)) {
    return "OpenAI가 요청하지 않은 안전/성인/주의 문구를 추가했습니다.";
  }
  return null;
}

async function requestOpenAIReview(input: ReviewDraftRequest, repairReason?: string): Promise<OpenAIReviewResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const model = process.env.OPENAI_REVIEW_MODEL ?? "gpt-4.1-mini";
  const localReview = reviewActualDraft(input);
  const repairInstruction = repairReason
    ? `\nPrevious attempt was rejected because: ${repairReason}\nFix that issue in this attempt.`
    : "";

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
            "You are a Korean Naver Blog SEO editor. Return every user-facing field in Korean. " +
            "Revise the user's actual final draft, not a placeholder and not a mere review memo. " +
            "Improve the SEO title, typo/spacing, sentence flow, paragraph structure, search intent fit, " +
            "keyword placement, readability, and Naver Blog retention flow while preserving the user's facts and intent. " +
            "Keep the revisedTitle concise: 28 to 45 Korean characters, with the main keyword near the front. " +
            "Do not add adult guidance, minor warnings, legal disclaimers, health warnings, safety notices, " +
            "nicotine cautions, or e-cigarette safety copy unless that exact idea already exists in the source text. " +
            "Do not recommend adding those notices in changes, seoNotes, or naverLogicNotes. " +
            "The revisedBody must be a complete publishable full draft and must contain concrete edits from the original. " +
            "For changeDetails, include exact before/after snippets and the reason for each meaningful edit. " +
            "Avoid exaggerated, guaranteed, clickbait, or absolute claims. Follow the JSON schema exactly.",
        },
        {
          role: "user",
          content: `Original app draft title: ${input.originalTitle ?? ""}
User's final title to improve: ${input.title}

Local pre-checks:
${localReview.issues.map((issue) => `- [${issue.severity}] ${issue.message}`).join("\n")}

Required work:
- Create a better Korean SEO title. Put the main search keyword and place/product intent near the front.
- Keep revisedTitle within 28 to 45 Korean characters.
- Rewrite the full body in Korean as a polished Naver Blog publish draft.
- Keep the user's meaning, order of facts, shop/location/product claims, and personal intent.
- Improve paragraph rhythm: short intro, problem/situation, selection criteria, practical examples, and closing.
- Use keywords naturally. Do not stuff repeated keywords.
- Remove or soften exaggerated claims, unsupported guarantees, and clickbait.
- Fix Korean spacing, typo, and awkward phrasing.
- Do not add adult/minor/legal/health/safety/e-cigarette warning copy unless it already appears in the source.
- Provide at least 3 concrete changeDetails with before, after, and reason.
- changes must summarize actual edits, not generic advice.
- seoNotes must explain title/search-intent/keyword decisions.
- naverLogicNotes must explain paragraph flow, readability, retention, and information order.
${repairInstruction}

Actual body:
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
    let aiReview = sanitizeReview(body, await requestOpenAIReview(body));
    const rejection = validateReview(body, aiReview);
    if (rejection) {
      aiReview = sanitizeReview(body, await requestOpenAIReview(body, rejection));
    }

    const finalRejection = validateReview(body, aiReview);
    if (finalRejection) {
      throw new Error(`OpenAI 수정본 검증 실패: ${finalRejection}`);
    }

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
      changeDetails: aiReview.changeDetails,
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
