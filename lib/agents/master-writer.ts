import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { getAnthropicClient, MODELS } from "@/lib/anthropic/client";
import { userCorpusRetriever } from "@/lib/skills/user-corpus-retriever";
import { expansionPlanner } from "@/lib/skills/expansion-planner";
import { sourceResolver } from "@/lib/skills/source-resolver";
import { writeFile, readFile, fileExists } from "@/lib/github/repository";
import { Paths } from "@/lib/github/paths";
import { hasOpenAIKey, requestOpenAIText } from "@/lib/openai/responses";
import { randomUUID } from "crypto";
import type { ContentTopologyPlan, StrategyPlanResult, WriterResult } from "./types";
import type { CorpusSummaryArtifact } from "./corpus-selector";
import { buildPolicyPromptSection, SEO_PASS_THRESHOLD } from "./blog-workflow-policy";
import { naverLogicAgent } from "./naver-logic-agent";

// ============================================================
// 발행용 본문은 이 에이전트만 작성한다 — 핵심 원칙
// ============================================================

// 네이버 블로그 줄바꿈 규칙: 1줄 최대 25자
// 빈 줄, 구분선(---), 마크다운 헤더(#)만 유지, 나머지 전부 25자 래핑
function wrapTo25Chars(text: string): string {
  const MAX = 25;
  const lines = text.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trimStart();

    // 빈 줄 또는 구분선 → 그대로
    if (trimmed === "" || /^-{3,}$/.test(trimmed)) {
      result.push(line);
      continue;
    }

    // 마크다운 헤더(#) → 그대로 (구조적 포맷)
    if (trimmed.startsWith("#")) {
      result.push(line);
      continue;
    }

    // 25자 이하 → 그대로
    if (line.length <= MAX) {
      result.push(line);
      continue;
    }

    // 25자 초과 → 25자 단위로 줄바꿈
    let remaining = line;
    while (remaining.length > MAX) {
      result.push(remaining.slice(0, MAX));
      remaining = remaining.slice(MAX);
    }
    if (remaining) result.push(remaining);
  }

  return result.join("\n");
}

function buildCorpusSummarySection(corpus: CorpusSummaryArtifact): string {
  const { styleProfile, exemplarExcerpts } = corpus;
  return `
## 사용자 스타일 프로필 (corpus summary)
- 주요 어투: ${styleProfile.dominantTone}
- 평균 글자수: ${styleProfile.avgWordCount}자
- 서두 패턴: ${styleProfile.openingPattern}
- 구조 패턴: ${styleProfile.structurePattern}
- 시그니처 표현: ${styleProfile.signatureExpressions.join(", ") || "없음"}

## 예시 글 발췌 (${exemplarExcerpts.length}개)
${exemplarExcerpts
  .map(
    (e, i) =>
      `### 예시 ${i + 1}: ${e.title}\n스타일 메모: ${e.styleNotes}\n발췌: ${e.excerpt}`
  )
  .join("\n\n")}`;
}

function buildContentTopologySection(topology: ContentTopologyPlan | undefined): string {
  if (!topology) {
    return `
콘텐츠 구조 판단: 미지정
- 본문 작성 전에 주제가 넓은 허브글인지, 좁은 리프글인지 판단한 뒤 구조에 반영하세요.
- 허브글이면 전체 기준과 하위 주제 안내를 넣고, 리프글이면 상위 주제와의 관계와 구체 사례를 넣으세요.`;
  }

  const kindLabel = topology.kind === "hub" ? "허브글" : "리프글";
  const requiredSections = topology.requiredSections
    .map((section) => `- ${section}`)
    .join("\n");
  const linkTargets = topology.internalLinkTargets.length
    ? topology.internalLinkTargets
        .map((target) => {
          const url = target.url ? ` (${target.url})` : "";
          return `- ${target.title}${url}: ${target.reason}`;
        })
        .join("\n")
    : "- 아직 확정된 내부 링크 후보가 없으므로, 실제 URL을 지어내지 말고 관련 주제 안내 문장만 자연스럽게 넣으세요.";

  return `
콘텐츠 구조 판단: ${kindLabel}
- 판단 근거: ${topology.reason}
- 검색 의도: ${topology.searchIntent}
- 본문 반영 위치: ${topology.bodyPlacement}

본문에 반드시 반영할 구조 요소:
${requiredSections}

내부 연결 후보:
${linkTargets}

작성 규칙:
- 본문 안에서 허브/리프 역할이 독자가 느낄 수 있게 구성하세요.
- 단, "이 글은 허브글입니다", "이 글은 리프글입니다" 같은 메타 문장은 쓰지 마세요.
- 허브글은 넓은 기준 정리, 하위 주제 안내, 다음에 볼 글 흐름을 넣으세요.
- 리프글은 상위 주제와의 관계를 짧게 짚고, 구체 상황/선택 기준/사례 중심으로 깊게 쓰세요.
- 내부 링크 URL이 있으면 마무리 근처에 자연스럽게 넣고, URL이 없으면 제목만 지어내지 말고 관련 주제 안내로 처리하세요.`;
}

const buildSystemPrompt = (
  userId: string,
  corpus: CorpusSummaryArtifact | null,
  harnessBriefing?: string
) => {
  const corpusSection =
    corpus
      ? buildCorpusSummarySection(corpus)
      : `사용자 "${userId}"의 예시 글을 user_corpus_retriever로 로드하여 스타일을 분석하세요.`;

  const step1 = corpus
    ? "1. 아래 코퍼스 summary를 바탕으로 스타일 분석 (별도 로드 불필요)"
    : `1. user_corpus_retriever로 사용자 "${userId}"의 예시 글 로드 후 스타일 분석`;

  return `당신은 네이버 블로그 본문 작성 전문가입니다.
이 에이전트만이 발행 가능한 본문을 작성할 수 있습니다.

## 작업 순서
${step1}
2. expansion_planner로 아웃라인 상세 확장
3. (필요 시) source_resolver로 참조 URL 내용 확인
4. 코퍼스 스타일을 완전히 재현한 한국어 본문 작성

## 글쓰기 원칙
- 코퍼스 스타일 완전 모방: 예시 글의 문체, 어투, 개인 표현 그대로 사용
- 한국어 전용: 영어 단어는 해당 한국어가 없을 때만 사용
- 금지 표현 절대 사용 금지
- 자연스러운 키워드 삽입 (억지 삽입 금지)
- 독자 관점에서 실제 유용한 내용 중심
- 전략에 포함된 콘텐츠 구조 판단이 허브글인지 리프글인지 확인하고 본문 구조에 반드시 반영

## 출력 형식
전략에 따른 마크다운 본문 전체를 출력한다. 설명·메타 정보 없이 본문만 출력한다.

${corpusSection}

${harnessBriefing ?? ""}`;
};

const CORPUS_TOOL: Tool = {
  name: "user_corpus_retriever",
  description: "사용자 예시 글 코퍼스를 로드합니다.",
  input_schema: {
    type: "object" as const,
    properties: {
      userId: { type: "string" },
      limit: { type: "number" },
      category: { type: "string" },
    },
    required: ["userId"],
  },
};

const BASE_TOOLS: Tool[] = [
  {
    name: "expansion_planner",
    description: "아웃라인을 받아 섹션별 상세 작성 방향을 계획합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        outline: { type: "array", description: "OutlineSection 배열" },
        targetLength: { type: "number", description: "목표 글자수" },
        tone: { type: "string" },
        keywords: { type: "array", items: { type: "string" } },
      },
      required: ["outline", "targetLength", "tone", "keywords"],
    },
  },
  {
    name: "source_resolver",
    description: "참조 URL 내용을 확인합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        urls: { type: "array", items: { type: "string" } },
      },
      required: ["urls"],
    },
  },
];

function formatOpenAICorpus(corpus: CorpusSummaryArtifact | undefined): string {
  if (!corpus) {
    return [
      "Corpus summary is unavailable.",
      "Do not state that the profile could not be loaded in the draft.",
      "Use a warm, practical Korean Naver Blog tone and keep the content specific.",
    ].join("\n");
  }

  return [
    `Dominant tone: ${corpus.styleProfile.dominantTone}`,
    `Average length reference: ${corpus.styleProfile.avgWordCount}`,
    `Opening pattern: ${corpus.styleProfile.openingPattern}`,
    `Structure pattern: ${corpus.styleProfile.structurePattern}`,
    `Signature expressions: ${corpus.styleProfile.signatureExpressions.join(", ") || "none"}`,
    "",
    "Reference excerpts:",
    ...corpus.exemplarExcerpts.slice(0, 4).map((item, index) =>
      `${index + 1}. ${item.title}\nStyle notes: ${item.styleNotes}\nExcerpt: ${item.excerpt}`
    ),
  ].join("\n");
}

function formatOpenAITopology(topology: ContentTopologyPlan | undefined): string {
  if (!topology) {
    return [
      "Content topology: unknown.",
      "Decide whether this should behave as a broad hub post or a concrete leaf post.",
      "If it is hub-like, organize criteria and lead readers toward related subtopics.",
      "If it is leaf-like, make the situation, choice criteria, and examples concrete.",
    ].join("\n");
  }

  const links = topology.internalLinkTargets.length
    ? topology.internalLinkTargets
        .map((target) => `- ${target.title}${target.url ? ` (${target.url})` : ""}: ${target.reason}`)
        .join("\n")
    : "- No confirmed internal links. Mention related topic directions naturally, without fake URLs.";

  return [
    `Content topology: ${topology.kind}`,
    `Reason: ${topology.reason}`,
    `Search intent: ${topology.searchIntent}`,
    `Body placement: ${topology.bodyPlacement}`,
    "Required sections:",
    ...topology.requiredSections.map((section) => `- ${section}`),
    "Internal link candidates:",
    links,
  ].join("\n");
}

function formatOpenAINaverSignals(strategy: StrategyPlanResult): string {
  const signals = strategy.naverSignals;
  if (!signals) {
    return [
      "Naver research signals: unavailable.",
      "Do not invent market demand or repeated questions without support.",
    ].join("\n");
  }

  const cafeTitles = signals.cafeTopItems?.slice(0, 3).map((item) => item.title).filter(Boolean) ?? [];
  const kinTitles = signals.kinTopItems?.slice(0, 3).map((item) => item.title).filter(Boolean) ?? [];

  return [
    `Research keyword: ${signals.keyword}`,
    `Cafe demand summary: ${signals.cafeDemandSummary || "none"}`,
    `KnowledgeIn problem summary: ${signals.kinProblemSummary || "none"}`,
    `Cafe examples: ${cafeTitles.join(" / ") || "none"}`,
    `KnowledgeIn examples: ${kinTitles.join(" / ") || "none"}`,
  ].join("\n");
}

function formatOpenAIExpandedOutline(strategy: StrategyPlanResult): string {
  const expanded = expansionPlanner({
    outline: strategy.outline,
    targetLength: strategy.estimatedLength,
    tone: strategy.tone,
    keywords: strategy.keywords,
  });

  return expanded.expandedOutline.map((section, index) => [
    `${index + 1}. ${section.heading}`,
    `Direction: ${section.contentDirection}`,
    `Sub-points: ${section.subPoints.join(" / ") || "none"}`,
    `Paragraph target: ${section.estimatedParagraphs}`,
    `Keywords: ${section.keywordsToInclude.join(", ") || "none"}`,
    `Notes: ${section.expandedNotes.join(" / ")}`,
  ].join("\n")).join("\n\n");
}

function buildOpenAIWriterSystemPrompt(): string {
  return [
    "You are a senior Korean Naver Blog writer and SEO editor.",
    "Write only the publishable Korean markdown body. Do not include meta notes, score explanations, or placeholders.",
    `Target an internal harness score of at least ${SEO_PASS_THRESHOLD} before returning the final draft.`,
    "The harness priorities are: SEO 45%, Naver logic 35%, then style_match 8%, structure 7%, and the rest as minor checks.",
    "Before finalizing, silently revise the draft if any dimension would score below 75.",
    "Never say that the user profile, corpus, or examples could not be loaded.",
    "Avoid keyword stuffing, exaggerated guarantees, unsupported best/only claims, and generic filler.",
    "For Naver Blog, prioritize clear search intent, short readable paragraphs, concrete selection criteria, natural keyword placement, and a closing that helps the reader decide.",
    buildPolicyPromptSection(),
    "When Naver community demand or KnowledgeIn problem signals are provided, make them visible through the article's angle, subheadings, examples, and decision criteria.",
  ].join("\n");
}

function buildOpenAIWriterUserPrompt(params: {
  strategy: StrategyPlanResult;
  userId: string;
  corpusSummary?: CorpusSummaryArtifact;
  harnessBriefing?: string;
  revisionInstructions?: string;
}): string {
  const { strategy, userId, corpusSummary, harnessBriefing, revisionInstructions } = params;
  return [
    `User id: ${userId.trim().toLowerCase()}`,
    `Title: ${strategy.title}`,
    `Target length: ${strategy.estimatedLength} Korean characters`,
    `Tone: ${strategy.tone}`,
    `Keywords: ${strategy.keywords.join(", ") || "none"}`,
    `Key points: ${strategy.keyPoints.join(" / ") || "none"}`,
    `Suggested sources: ${strategy.suggestedSources.join(", ") || "none"}`,
    "",
    "Content topology:",
    formatOpenAITopology(strategy.contentTopology),
    "",
    "Naver logic pre-check:",
    naverLogicAgent.buildWriterBrief(strategy.naverLogic),
    "Naver research signals:",
    formatOpenAINaverSignals(strategy),
    "",
    "Expanded outline:",
    formatOpenAIExpandedOutline(strategy),
    "",
    "Corpus/style reference:",
    formatOpenAICorpus(corpusSummary),
    "",
    "Pre-write harness briefing:",
    harnessBriefing || "No extra harness briefing.",
    "",
    revisionInstructions
      ? `Revision instructions from the failed evaluator:\n${revisionInstructions}`
      : "First draft instructions: write a strong first draft that should pass the evaluator without needing repair.",
    "",
    "Required writing behavior:",
    "- Start with the reader's likely situation or question, not a generic definition.",
    "- Put the main keyword naturally in the first 2 paragraphs.",
    "- If Naver signals are present, answer the repeated community questions and demand patterns directly in the body.",
    "- Make the hub/leaf role visible through structure, not by announcing the words hub or leaf.",
    "- Include practical criteria, examples, and decision points instead of broad advice.",
    "- Keep paragraph rhythm suitable for Naver Blog mobile reading.",
    "- Use markdown headings, but do not over-fragment into tiny bullet lists.",
    "- End with a useful summary or next-step guide that matches the search intent.",
    "- Output only the final body markdown.",
  ].join("\n");
}

async function runOpenAIMasterWriter(params: {
  strategy: StrategyPlanResult;
  userId: string;
  topicId: string;
  postId?: string;
  corpusSummary?: CorpusSummaryArtifact;
  harnessBriefing?: string;
  revisionInstructions?: string;
  onToken?: (token: string) => void;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}): Promise<WriterResult> {
  const {
    strategy,
    userId,
    topicId,
    postId,
    corpusSummary,
    harnessBriefing,
    revisionInstructions,
    onToken,
    onProgress,
    signal,
  } = params;

  const model = process.env.OPENAI_WRITER_MODEL ?? "gpt-4.1";
  const callSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(420_000)])
    : AbortSignal.timeout(420_000);

  onProgress?.("Master Writer가 OpenAI로 하네스 기준 초안을 작성합니다.");
  const firstDraft = await requestOpenAIText({
    model,
    input: [
      { role: "system", content: buildOpenAIWriterSystemPrompt() },
      { role: "user", content: buildOpenAIWriterUserPrompt({ strategy, userId, corpusSummary, harnessBriefing, revisionInstructions }) },
    ],
    maxOutputTokens: 6500,
    temperature: 0.55,
    signal: callSignal,
  });

  onProgress?.("초안 내부 검수 및 SEO 보강 중...");
  const finalDraft = await requestOpenAIText({
    model,
    input: [
      { role: "system", content: buildOpenAIWriterSystemPrompt() },
      {
        role: "user",
        content: [
          "Revise the draft below into the final version.",
          "Silently check it against the harness rubric and Naver Blog SEO.",
          "If SEO fit or Naver logic would be weak, rewrite the weak parts before finalizing.",
          "Keep the user's facts and intent. Do not add disclaimers or meta commentary.",
          "Output only the final Korean markdown body.",
          "",
          "Strategy and constraints:",
          buildOpenAIWriterUserPrompt({ strategy, userId, corpusSummary, harnessBriefing, revisionInstructions }),
          "",
          "Draft to improve:",
          firstDraft,
        ].join("\n"),
      },
    ],
    maxOutputTokens: 6500,
    temperature: 0.35,
    signal: callSignal,
  });

  const bodyText = wrapTo25Chars(finalDraft);
  onToken?.(bodyText);
  onProgress?.("본문 생성 완료 - GitHub에 저장 중...");

  return saveWriterResult({
    topicId,
    postId,
    title: strategy.title,
    content: bodyText,
    overwrite: Boolean(revisionInstructions),
  });
}

export async function runMasterWriter(params: {
  strategy: StrategyPlanResult;
  userId: string;
  topicId: string;
  postId?: string;
  corpusSummary?: CorpusSummaryArtifact;
  harnessBriefing?: string;
  revisionInstructions?: string;
  onToken?: (token: string) => void;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}): Promise<WriterResult> {
  const {
    strategy,
    userId,
    topicId,
    postId,
    corpusSummary,
    harnessBriefing,
    revisionInstructions,
    onToken,
    onProgress,
    signal,
  } = params;

  onProgress?.(corpusSummary ? "Master Writer 시작 — corpus summary 적용 중..." : "Master Writer 시작 — 코퍼스 로드 중...");

  if (hasOpenAIKey()) {
    return runOpenAIMasterWriter(params);
  }

  const client = getAnthropicClient();
  const TOOLS = corpusSummary ? BASE_TOOLS : [CORPUS_TOOL, ...BASE_TOOLS];
  const toolRegistry = {
    user_corpus_retriever: (input: unknown) =>
      userCorpusRetriever(input as Parameters<typeof userCorpusRetriever>[0]),
    expansion_planner: (input: unknown) => {
      const i = input as Parameters<typeof expansionPlanner>[0];
      return Promise.resolve(expansionPlanner(i));
    },
    source_resolver: (input: unknown) =>
      sourceResolver(input as Parameters<typeof sourceResolver>[0]),
  };

  const revisionSection = revisionInstructions
    ? `\n\n${revisionInstructions}\n\n위 자동 보강 지시를 최우선으로 반영해 전체 본문을 다시 작성해주세요.`
    : "";

  const userMessage = `다음 전략에 따라 네이버 블로그 본문을 작성해주세요.

제목: ${strategy.title}
목표 글자수: ${strategy.estimatedLength}자
톤: ${strategy.tone}
키워드: ${strategy.keywords.join(", ")}
핵심 포인트: ${strategy.keyPoints.join(" / ")}

${buildContentTopologySection(strategy.contentTopology)}

Naver logic pre-check:
${naverLogicAgent.buildWriterBrief(strategy.naverLogic)}

아웃라인:
${strategy.outline
  .map(
    (s, i) =>
      `${i + 1}. ${s.heading}\n   - ${s.subPoints.join("\n   - ")}\n   방향: ${s.contentDirection}`
  )
  .join("\n\n")}

${
    corpusSummary
      ? "시스템 프롬프트의 코퍼스 summary를 바탕으로 스타일을 분석한 후,"
      : `먼저 user_corpus_retriever로 사용자 "${userId}"의 예시 글을 로드하여 스타일을 분석한 후,`
  }
expansion_planner로 아웃라인을 확장하고, 본문을 마크다운으로 작성해주세요.${revisionSection}`;

  // 1단계: tool-use loop (corpus retrieval + expansion planning)
  const messages: import("@anthropic-ai/sdk/resources/messages").MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  let iterCount = 0;
  const maxIter = 4;

  while (iterCount < maxIter) {
    iterCount++;
    if (signal?.aborted) throw new Error("파이프라인이 중단되었습니다.");

    console.log(`[master-writer] iteration ${iterCount} start — messages=${messages.length}, topicId=${topicId}`);
    if (iterCount > 1) {
      onProgress?.(`본문 생성 중... (단계 ${iterCount})`);
    }

    // 스트리밍 모드로 API 호출 — 토큰 단위 수신으로 타임아웃 감지 신뢰성 향상
    // INITIAL: 첫 이벤트까지 150초 (블로그 본문 생성 시작이 느릴 수 있음)
    // STALL: 이후 연속 무응답 90초
    const INITIAL_TIMEOUT_MS = 150_000;
    const STALL_TIMEOUT_MS = 90_000;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    let stallReject: ((err: Error) => void) | null = null;
    let firstEventReceived = false;

    const resetStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      if (!stallReject) return;
      const ms = firstEventReceived ? STALL_TIMEOUT_MS : INITIAL_TIMEOUT_MS;
      stallTimer = setTimeout(
        () => stallReject!(new Error(firstEventReceived
          ? `Master Writer 스트림 타임아웃 — ${ms / 1000}초 이상 응답 없음 (iter=${iterCount})`
          : `Master Writer 초기 응답 타임아웃 — ${ms / 1000}초 이내 응답 없음 (iter=${iterCount})`)),
        ms
      );
    };

    const stallPromise = new Promise<never>((_, reject) => {
      stallReject = reject;
      resetStallTimer();
    });

    // AbortSignal: 외부 signal + 하드 데드라인(160초) 조합
    // stall timer(120/90초)의 백업 — HTTP 연결 수준에서도 강제 취소
    const hardDeadline = AbortSignal.timeout(160_000);
    const callSignal = signal
      ? AbortSignal.any([signal, hardDeadline])
      : hardDeadline;

    let rawText = "";
    let finalStopReason: string | null = null;
    const toolUseBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

    try {
      await Promise.race([
        (async () => {
          const stream = client.messages.stream({
            model: MODELS.sonnet,
            system: buildSystemPrompt(userId, corpusSummary ?? null, harnessBriefing),
            messages,
            tools: TOOLS,
            max_tokens: 4096,
          }, { signal: callSignal });

          for await (const event of stream) {
            if (!firstEventReceived) { firstEventReceived = true; }
            resetStallTimer();
            if (event.type === "content_block_delta") {
              if (event.delta.type === "text_delta") {
                rawText += event.delta.text;
                onToken?.(event.delta.text);
              }
            } else if (event.type === "message_stop") {
              finalStopReason = "end_turn"; // stream 완료
            }
          }

          // 최종 메시지에서 tool_use 블록 추출
          const finalMsg = await stream.finalMessage();
          finalStopReason = finalMsg.stop_reason ?? "end_turn";
          for (const block of finalMsg.content) {
            if (block.type === "tool_use") {
              toolUseBlocks.push({
                id: block.id,
                name: block.name,
                input: block.input as Record<string, unknown>,
              });
            }
            if (block.type === "text" && !rawText) {
              rawText = block.text;
            }
          }
          messages.push({ role: "assistant", content: finalMsg.content });
        })(),
        stallPromise,
      ]);
    } finally {
      if (stallTimer) clearTimeout(stallTimer);
    }

    console.log(`[master-writer] iteration ${iterCount} done — stopReason=${finalStopReason}, tools=${toolUseBlocks.map((b) => b.name).join(",") || "none"}, textLen=${rawText.length}`);

    if (finalStopReason === "end_turn" && toolUseBlocks.length === 0) {
      // 본문 생성 완료
      const bodyText = wrapTo25Chars(rawText);
      onProgress?.("본문 생성 완료 — GitHub에 저장 중...");
      return await saveWriterResult({
        topicId,
        postId,
        title: strategy.title,
        content: bodyText,
        overwrite: Boolean(revisionInstructions),
      });
    }

    if (toolUseBlocks.length > 0) {
      const toolLabels: Record<string, string> = {
        user_corpus_retriever: "코퍼스 로드 중...",
        expansion_planner: "아웃라인 확장 중...",
        source_resolver: "참조 URL 확인 중...",
      };
      const toolResults: import("@anthropic-ai/sdk/resources/messages").ToolResultBlockParam[] = [];

      for (const block of toolUseBlocks) {
        onProgress?.(toolLabels[block.name] ?? `${block.name} 실행 중...`);
        const fn = toolRegistry[block.name as keyof typeof toolRegistry];
        if (!fn) {
          toolResults.push({ type: "tool_result", tool_use_id: block.id, is_error: true, content: `알 수 없는 도구: ${block.name}` });
          continue;
        }
        try {
          const result = await fn(block.input);
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
        } catch (err) {
          toolResults.push({ type: "tool_result", tool_use_id: block.id, is_error: true, content: String(err) });
        }
      }
      onProgress?.(`본문 생성 중... (단계 ${iterCount + 1})`);
      messages.push({ role: "user", content: toolResults });
      continue;
    }
    break;
  }

  throw new Error(`Master Writer가 ${maxIter}회 반복 한계에 도달했습니다.`);
}

async function saveWriterResult(params: {
  topicId: string;
  postId?: string;
  title: string;
  content: string;
  overwrite?: boolean;
}): Promise<WriterResult> {
  const postId = params.postId ?? `post-${randomUUID().slice(0, 8)}`;
  const contentPath = Paths.postContent(postId);
  const wordCount = params.content.replace(/\s+/g, "").length;
  const generatedAt = new Date().toISOString();

  // GitHub에 본문 저장 (파일이 없을 때만 — sha null)
  const exists = await fileExists(contentPath);
  if (!exists || params.overwrite) {
    const sha = exists ? (await readFile(contentPath)).sha : null;
    await writeFile(
      contentPath,
      params.content,
      `feat: master-writer generated post ${postId}`,
      sha
    );
  }

  return {
    postId,
    title: params.title,
    content: params.content,
    wordCount,
    generatedAt,
  };
}
