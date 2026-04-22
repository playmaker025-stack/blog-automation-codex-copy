/**
 * AI 글목록 자동 생성 에이전트.
 *
 * 발행 완료 글을 분석해 다음 계획 토픽 5개를 만든다.
 * 생성 주제는 기존 발행 글과 중복되지 않아야 하며, 허브/리프 구조의 빈틈을 메운다.
 */

import { getAnthropicClient, MODELS } from "@/lib/anthropic/client";
import { naverKeywordResearch } from "@/lib/skills/naver-keyword-research";
import { hasOpenAIKey, requestOpenAIJson } from "@/lib/openai/responses";
import type { PostingRecord, Topic } from "@/lib/types/github-data";

export interface TopicGeneratorInput {
  userId: string;
  publishedTopics: Topic[];
  publishedPosts?: PostingRecord[];
  onProgress?: (msg: string) => void;
}

export interface GeneratedTopic {
  title: string;
  description: string;
  category: string;
  tags: string[];
  contentKind?: "hub" | "leaf";
  rationale: string;
}

export interface TopicGeneratorOutput {
  generatedTopics: GeneratedTopic[];
  researchKeyword: string;
  competitionInfo: string;
}

function postToTopic(post: PostingRecord): Topic {
  return {
    topicId: post.topicId || post.postId,
    title: post.title,
    description: "",
    category: post.userId,
    tags: [],
    feasibility: null,
    relatedSources: post.naverPostUrl ? [post.naverPostUrl] : [],
    status: "published",
    assignedUserId: post.userId,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

function extractMainCategory(topics: Topic[]): string {
  const counts = new Map<string, number>();
  for (const topic of topics) {
    if (topic.category) counts.set(topic.category, (counts.get(topic.category) ?? 0) + 1);
  }
  if (counts.size === 0) return "general";
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function extractRepresentativeKeyword(topics: Topic[]): string {
  const counts = new Map<string, number>();
  for (const topic of topics) {
    for (const tag of topic.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    const firstWord = topic.title.split(/\s+/)[0];
    if (firstWord.length >= 2) {
      counts.set(firstWord, (counts.get(firstWord) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return topics[0]?.title.split(" ")[0] ?? "블로그";
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function parseGeneratedTopics(text: string): GeneratedTopic[] {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
  const raw = jsonMatch?.[1] ?? text;
  try {
    const parsed = JSON.parse(raw.trim()) as unknown;
    if (Array.isArray(parsed)) return parsed as GeneratedTopic[];
    const obj = parsed as { topics?: GeneratedTopic[] };
    if (Array.isArray(obj.topics)) return obj.topics;
  } catch {
    // Return an empty list; the caller decides how to surface generation failure.
  }
  return [];
}

function normalizeGeneratedTopic(topic: GeneratedTopic, fallbackCategory: string): GeneratedTopic {
  return {
    title: topic.title?.trim() ?? "",
    description: topic.description?.trim() ?? "",
    category: topic.category?.trim() || fallbackCategory,
    tags: Array.isArray(topic.tags) ? topic.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 6) : [],
    contentKind: topic.contentKind === "hub" || topic.contentKind === "leaf" ? topic.contentKind : undefined,
    rationale: topic.rationale?.trim() ?? "",
  };
}

const OPENAI_TOPIC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    topics: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          category: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          contentKind: { type: "string", enum: ["hub", "leaf"] },
          rationale: { type: "string" },
        },
        required: ["title", "description", "category", "tags", "contentKind", "rationale"],
      },
    },
  },
  required: ["topics"],
} as const;

export async function runTopicGenerator(input: TopicGeneratorInput): Promise<TopicGeneratorOutput> {
  const { userId, onProgress } = input;
  const publishedTopics = input.publishedTopics.length > 0
    ? input.publishedTopics
    : (input.publishedPosts ?? []).map(postToTopic);

  onProgress?.(`${publishedTopics.length}개 기존 발행 글 분석 중...`);

  const representativeKeyword = extractRepresentativeKeyword(publishedTopics);
  const mainCategory = extractMainCategory(publishedTopics);

  onProgress?.(`네이버 키워드 리서치: "${representativeKeyword}"`);
  const research = await naverKeywordResearch({ keyword: representativeKeyword, display: 20 });

  const competitionInfo = research.error
    ? "네이버 리서치 불가"
    : `경쟁도 ${research.blog.competition} (${research.blog.total.toLocaleString()}건 / 롱테일: ${research.longtailSuggestions.slice(0, 3).join(", ")})`;

  onProgress?.("신규 토픽 5개 생성 중...");

  const publishedTitles = publishedTopics
    .map((topic) => `- ${topic.title}${topic.contentKind ? ` [${topic.contentKind}]` : ""}`)
    .join("\n");
  const longtailHints = research.longtailSuggestions.slice(0, 5).join(", ");
  const relatedWords = research.relatedKeywords
    .slice(0, 8)
    .map((item) => item.word)
    .join(", ");

  if (hasOpenAIKey()) {
    const model = process.env.OPENAI_TOPIC_MODEL ?? "gpt-4.1-mini";
    const result = await requestOpenAIJson<{ topics: GeneratedTopic[] }>({
      model,
      input: [
        {
          role: "system",
          content: [
            "You generate Korean Naver Blog posting plans.",
            "Return Korean topics only.",
            "Avoid duplicate titles and avoid topics already covered.",
            "Balance hub and leaf topics based on gaps in the published list.",
            "Use Naver search-intent friendly longtail wording.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `User id: ${userId.trim().toLowerCase()}`,
            "Published posts:",
            publishedTitles || "- none",
            "",
            `Main category: ${mainCategory}`,
            `Research keyword: ${representativeKeyword}`,
            `Competition: ${research.blog.competition}`,
            `Related keywords: ${relatedWords || "none"}`,
            `Longtail hints: ${longtailHints || "none"}`,
            "",
            "Generate exactly 5 next posting topics.",
            "Each topic must include contentKind hub or leaf.",
            "Prefer missing hub/leaf coverage over small keyword variations.",
            "Title length should be within 50 Korean characters.",
          ].join("\n"),
        },
      ],
      schemaName: "next_posting_topics",
      schema: OPENAI_TOPIC_SCHEMA,
      maxOutputTokens: 2200,
      temperature: 0.45,
      signal: AbortSignal.timeout(90_000),
    });

    const generatedTopics = result.topics
      .map((topic) => normalizeGeneratedTopic(topic, mainCategory))
      .filter((topic) => topic.title)
      .slice(0, 5);

    onProgress?.(`신규 토픽 ${generatedTopics.length}개 생성 완료`);
    return { generatedTopics, researchKeyword: representativeKeyword, competitionInfo };
  }

  const client = getAnthropicClient();
  const response = await client.messages.create(
    {
      model: MODELS.sonnet,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: `사용자(${userId})의 발행 완료 글 목록입니다.
아래 목록과 네이버 리서치 결과를 참고해서 다음에 쓸 신규 글목록 5개를 추천해주세요.

## 기존 발행 글 목록
${publishedTitles}

## 주력 카테고리
${mainCategory}

## 네이버 리서치 결과 (키워드: "${representativeKeyword}")
- 경쟁도: ${research.blog.competition}
- 연관 키워드: ${relatedWords}
- 롱테일 제안: ${longtailHints}

## 요구사항
1. 기존 발행 글과 겹치지 않으면서 자연스럽게 이어지는 주제
2. 이미 발행한 허브글이 있으면 세부 리프글을 보강하고, 리프글만 많으면 상위 허브글을 제안
3. 5개 안에 hub와 leaf를 균형 있게 섞되, 현재 목록의 빈틈을 우선
4. 네이버 검색 유입을 노릴 수 있는 롱테일 키워드 포함
5. category는 "${mainCategory}" 계열 유지
6. contentKind는 반드시 "hub" 또는 "leaf" 중 하나로 지정

## 출력 형식 (JSON 코드블록)
\`\`\`json
[
  {
    "title": "포스팅 제목 (50자 이내)",
    "description": "이 글에서 다룰 핵심 내용 (2~3문장)",
    "category": "${mainCategory}",
    "tags": ["태그1", "태그2", "태그3"],
    "contentKind": "hub",
    "rationale": "왜 이 주제를 추천하는지와 기존 글/허브·리프 구조상 필요한 이유"
  }
]
\`\`\`

반드시 5개를 출력하세요.`,
        },
      ],
    },
    { signal: AbortSignal.timeout(60_000) }
  );

  const text = response.content.find((block) => block.type === "text");
  const rawText = text?.type === "text" ? text.text : "";
  const generatedTopics = parseGeneratedTopics(rawText)
    .map((topic) => normalizeGeneratedTopic(topic, mainCategory))
    .filter((topic) => topic.title)
    .slice(0, 5);

  onProgress?.(`신규 토픽 ${generatedTopics.length}개 생성 완료`);

  return { generatedTopics, researchKeyword: representativeKeyword, competitionInfo };
}
