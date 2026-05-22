import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { MODELS } from "@/lib/anthropic/client";
import { runToolUseLoop } from "@/lib/anthropic/tool-executor";
import { userCorpusRetriever } from "@/lib/skills/user-corpus-retriever";
import { reviewRecordAudit } from "@/lib/skills/review-record-audit";
import { writeJsonFile, fileExists, readJsonFile } from "@/lib/github/repository";
import { Paths } from "@/lib/github/paths";
import { hasOpenAIKey, requestOpenAIJson } from "@/lib/openai/responses";
import { randomUUID } from "crypto";
import type { EvalResult, StrategyPlanResult, WriterResult } from "./types";
import { HARNESS_PASS_THRESHOLD } from "./harness-guidance";
import { evaluateSeoCompleteness } from "./seo-metrics";
import { naverLogicAgent } from "./naver-logic-agent";

const SYSTEM_PROMPT = `당신은 네이버 블로그 글쓰기 품질을 검수하는 Harness Evaluator입니다.

평가 기준:
- originality: 실제 사례, 구체성, 반복 없는 관점
- style_match: 사용자 코퍼스와 말투/문장 리듬/구성 습관의 일치
- structure: 검색 의도, 허브/리프 역할, 도입-본문-마무리 구조
- engagement: 독자가 계속 읽고 선택할 수 있게 만드는 실용성
- forbidden_check: 금지 표현, 과장, 근거 없는 단정, 위험한 문구

반드시 확인할 항목:
1. user_corpus_retriever로 사용자 문체를 확인한다.
2. review_record_audit로 과거 실패/개선 패턴을 확인한다.
3. 키워드 과반복, 약한 도입, 실체 없는 조언, 근거 없는 최고/유일 표현을 감점한다.
4. 네이버 검색 의도와 D.I.A/C-Rank 관점에서 실사용 정보와 문제 해결성이 충분한지 본다.
5. 발행 본문에 키워드빌드업, 선행포스팅, 메인포스팅, 시리즈 설계, SEO 점수, evaluator, harness, corpus, profile, strategy 같은 내부 작업 용어가 나오면 forbidden_check와 engagement를 강하게 감점한다.
6. 결과는 JSON만 반환한다. 설명 문장은 JSON 밖에 쓰지 않는다.

JSON 형식:
{
  "scores": {
    "originality": 85,
    "style_match": 90,
    "structure": 78,
    "engagement": 82,
    "forbidden_check": 100
  },
  "aggregateScore": 87,
  "reasoning": {
    "originality": "평가 근거",
    "style_match": "평가 근거",
    "structure": "평가 근거",
    "engagement": "평가 근거",
    "forbidden_check": "평가 근거"
  },
  "recommendations": ["수정 권장 사항 1", "수정 권장 사항 2"]
}`;

const TOOLS: Tool[] = [
  {
    name: "user_corpus_retriever",
    description: "사용자별 코퍼스 요약과 대표 샘플을 불러와 문체 일치도를 판단합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        userId: { type: "string" },
        limit: { type: "number" },
      },
      required: ["userId"],
    },
  },
  {
    name: "review_record_audit",
    description: "과거 글쓰기 평가 기록과 실패 패턴을 확인합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        userId: { type: "string" },
        limit: { type: "number" },
      },
      required: ["userId"],
    },
  },
];

const SUB_WEIGHTS = {
  originality: 0.03,
  style_match: 0.08,
  structure: 0.07,
  engagement: 0.04,
  forbidden_check: 0.03,
} as const;

function parseEvalFromText(text: string): Omit<EvalResult, "runId" | "pass"> {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (jsonMatch?.[1]) {
    try {
      return JSON.parse(jsonMatch[1]) as Omit<EvalResult, "runId" | "pass">;
    } catch {
      // fall through
    }
  }
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0]) as Omit<EvalResult, "runId" | "pass">;
    } catch {
      // fall through
    }
  }
  return {
    scores: { originality: 0, style_match: 0, structure: 0, engagement: 0, forbidden_check: 0 },
    aggregateScore: 0,
    reasoning: { error: "평가 결과를 JSON으로 파싱하지 못했습니다." },
    recommendations: ["평가를 다시 실행해 주세요."],
  };
}

function computeAggregate(scores: EvalResult["scores"]): number {
  return Math.round(
    Object.entries(SUB_WEIGHTS).reduce(
      (sum, [dim, weight]) => sum + (scores[dim as keyof typeof SUB_WEIGHTS] ?? 0) * weight,
      0
    )
  );
}

const OPENAI_EVAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    scores: {
      type: "object",
      additionalProperties: false,
      properties: {
        originality: { type: "number" },
        style_match: { type: "number" },
        structure: { type: "number" },
        engagement: { type: "number" },
        forbidden_check: { type: "number" },
      },
      required: ["originality", "style_match", "structure", "engagement", "forbidden_check"],
    },
    reasoning: {
      type: "object",
      additionalProperties: false,
      properties: {
        originality: { type: "string" },
        style_match: { type: "string" },
        structure: { type: "string" },
        engagement: { type: "string" },
        forbidden_check: { type: "string" },
      },
      required: ["originality", "style_match", "structure", "engagement", "forbidden_check"],
    },
    recommendations: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["scores", "reasoning", "recommendations"],
} as const;

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function buildTopologyText(strategy: StrategyPlanResult): string {
  const topology = strategy.contentTopology;
  if (!topology) return "No topology plan.";

  return [
    `kind: ${topology.kind}`,
    `reason: ${topology.reason}`,
    `searchIntent: ${topology.searchIntent}`,
    `requiredSections: ${topology.requiredSections.join(" / ")}`,
  ].join("\n");
}

function buildNaverSignalsText(strategy: StrategyPlanResult): string {
  if (!strategy.naverSignals) return "No Naver community signals.";

  return [
    `keyword: ${strategy.naverSignals.keyword}`,
    `cafeDemand: ${strategy.naverSignals.cafeDemandSummary || "none"}`,
    `kinProblems: ${strategy.naverSignals.kinProblemSummary || "none"}`,
  ].join("\n");
}

function finalizeEval(params: {
  provisionalEval: EvalResult;
  writerResult: WriterResult;
  strategy: StrategyPlanResult;
  parsedReasoning: EvalResult["reasoning"];
  parsedRecommendations: string[];
}): EvalResult {
  const { provisionalEval, writerResult, strategy, parsedReasoning, parsedRecommendations } = params;
  const seoEvaluation = evaluateSeoCompleteness({
    title: writerResult.title,
    body: writerResult.content,
    keywords: strategy.keywords,
    targetSearchCombinations: strategy.targetSearchCombinations,
    seriesRole: strategy.seriesRole,
    targetMainKeyword: strategy.targetMainKeyword,
  });
  const naverLogicEvaluation = naverLogicAgent.auditAfterWriting({
    strategy,
    writerResult,
    evalResult: provisionalEval,
  });
  const aggregateScore = Math.round(
    seoEvaluation.score * 0.45 +
    naverLogicEvaluation.completenessScore * 0.35 +
    provisionalEval.scores.style_match * 0.08 +
    provisionalEval.scores.structure * 0.07 +
    provisionalEval.scores.engagement * 0.03 +
    provisionalEval.scores.originality * 0.01 +
    provisionalEval.scores.forbidden_check * 0.01
  );

  return {
    ...provisionalEval,
    aggregateScore,
    reasoning: {
      ...parsedReasoning,
      seo: `SEO \uC810\uC218 ${seoEvaluation.score}\uC810. ${seoEvaluation.evidence[0] ?? "\uD0A4\uC6CC\uB4DC \uBC30\uCE58\uC640 \uBCF8\uBB38 \uAD6C\uC870\uB97C \uAE30\uC900\uC73C\uB85C \uD3C9\uAC00\uD588\uC2B5\uB2C8\uB2E4."}`,
      naver_logic: `\uB124\uC774\uBC84 \uB85C\uC9C1 \uC810\uC218 ${naverLogicEvaluation.completenessScore}\uC810. ${naverLogicEvaluation.evidence[0] ?? "\uAC80\uC0C9 \uC758\uB3C4\uC640 \uBB38\uC11C \uC5ED\uD560\uC744 \uAE30\uC900\uC73C\uB85C \uD3C9\uAC00\uD588\uC2B5\uB2C8\uB2E4."}`,
    },
    recommendations: [
      ...seoEvaluation.improvements,
      ...naverLogicEvaluation.improvements,
      ...parsedRecommendations,
    ].filter((value, index, array) => value && array.indexOf(value) === index).slice(0, 6),
    pass: aggregateScore >= HARNESS_PASS_THRESHOLD,
    seoEvaluation,
    naverLogicEvaluation,
  };
}

async function runOpenAIHarnessEvaluator(params: {
  writerResult: WriterResult;
  strategy: StrategyPlanResult;
  userId: string;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}): Promise<EvalResult> {
  const { writerResult, strategy, userId, onProgress, signal } = params;
  const model = process.env.OPENAI_EVAL_MODEL ?? "gpt-4.1-mini";
  const callSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(180_000)])
    : AbortSignal.timeout(180_000);

  onProgress?.("Harness Evaluator가 OpenAI 평가를 준비합니다.");
  const [corpus, audit] = await Promise.all([
    userCorpusRetriever({ userId: userId.trim().toLowerCase(), limit: 5 }),
    reviewRecordAudit({ userId: userId.trim().toLowerCase(), limit: 8 }),
  ]);

  onProgress?.("초안 품질과 SEO 기준을 평가합니다.");
  const parsed = await requestOpenAIJson<Omit<EvalResult, "runId" | "aggregateScore" | "pass">>({
    model,
    input: [
      {
        role: "system",
        content: [
          "You are a strict Korean Naver Blog content harness evaluator.",
          "Return Korean reasoning and recommendations.",
          "Score realistically. A publishable but generic draft should not exceed 70.",
          "Use this rubric for sub scores only: originality, style_match, structure, engagement, forbidden_check.",
          "Final evaluation must prioritize SEO fit and Naver logic completeness over the sub scores.",
          "Penalize keyword stuffing, weak search intent, vague examples, unsupported claims, and missing topology role.",
          "Strongly penalize visible internal SEO/workflow terms in the draft, such as keyword buildup, prelude posting, main posting, series design, SEO score, evaluator, harness, corpus, profile, or strategy.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Title: ${writerResult.title}`,
          `User id: ${userId.trim().toLowerCase()}`,
          `Target tone: ${strategy.tone}`,
          `Keywords: ${strategy.keywords.join(", ") || "none"}`,
          `Key points: ${strategy.keyPoints.join(" / ") || "none"}`,
          "",
          "Content topology:",
          buildTopologyText(strategy),
          "",
          "Naver research signals:",
          buildNaverSignalsText(strategy),
          "",
          "Corpus/style evidence:",
          JSON.stringify(corpus).slice(0, 5000),
          "",
          "Past review/failure evidence:",
          JSON.stringify(audit).slice(0, 3000),
          "",
          "Draft body:",
          writerResult.content.slice(0, 9000),
          "",
          "Return scores, reasoning, and 1-4 concrete recommendations.",
        ].join("\n"),
      },
    ],
    schemaName: "naver_blog_harness_eval",
    schema: OPENAI_EVAL_SCHEMA,
    maxOutputTokens: 2200,
    temperature: 0.1,
    signal: callSignal,
  });

  const scores: EvalResult["scores"] = {
    originality: clampScore(parsed.scores.originality),
    style_match: clampScore(parsed.scores.style_match),
    structure: clampScore(parsed.scores.structure),
    engagement: clampScore(parsed.scores.engagement),
    forbidden_check: clampScore(parsed.scores.forbidden_check),
  };
  const subScore = computeAggregate(scores);
  const provisionalEval: EvalResult = {
    runId: `eval-${randomUUID().slice(0, 8)}`,
    scores,
    aggregateScore: subScore,
    reasoning: parsed.reasoning,
    recommendations: parsed.recommendations,
    pass: subScore >= HARNESS_PASS_THRESHOLD,
  };
  const evalResult = finalizeEval({
    provisionalEval,
    writerResult,
    strategy,
    parsedReasoning: parsed.reasoning,
    parsedRecommendations: parsed.recommendations,
  });

  await saveEvalRun(evalResult, writerResult.postId);
  onProgress?.(`초안 평가 완료: ${evalResult.aggregateScore}점(${evalResult.pass ? "통과" : "보강 필요"})`);
  return evalResult;
}

export async function runHarnessEvaluator(params: {
  writerResult: WriterResult;
  strategy: StrategyPlanResult;
  userId: string;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}): Promise<EvalResult> {
  const { writerResult, strategy, userId, onProgress, signal } = params;

  onProgress?.("Harness Evaluator 시작...");

  if (hasOpenAIKey()) {
    return runOpenAIHarnessEvaluator(params);
  }

  const toolRegistry = {
    user_corpus_retriever: (input: unknown) =>
      userCorpusRetriever(input as Parameters<typeof userCorpusRetriever>[0]),
    review_record_audit: (input: unknown) =>
      reviewRecordAudit(input as Parameters<typeof reviewRecordAudit>[0]),
  };

  const topologySection = strategy.contentTopology
    ? [
        "콘텐츠 구조 계획:",
        `- 역할: ${strategy.contentTopology.kind === "hub" ? "허브" : "리프"}`,
        `- 이유: ${strategy.contentTopology.reason}`,
        `- 검색 의도: ${strategy.contentTopology.searchIntent}`,
        `- 필수 섹션: ${strategy.contentTopology.requiredSections.join(" / ")}`,
      ].join("\n")
    : "";

  const userMessage = [
    "다음 네이버 블로그 초안을 평가해 주세요.",
    "",
    `제목: ${writerResult.title}`,
    `본문 글자수: ${writerResult.wordCount}자`,
    `목표 톤: ${strategy.tone}`,
    `핵심 키워드: ${strategy.keywords.join(", ")}`,
    `사용자 ID: ${userId}`,
    topologySection,
    "",
    "--- 본문 시작 ---",
    `${writerResult.content.slice(0, 1500)}${writerResult.content.length > 1500 ? "\n...(본문 일부 생략)..." : ""}`,
    "--- 본문 끝 ---",
    "",
    "user_corpus_retriever와 review_record_audit를 사용한 뒤 JSON만 반환해 주세요.",
  ].join("\n");

  onProgress?.("초안 평가 도구를 실행합니다.");
  const resultText = await runToolUseLoop({
    model: MODELS.sonnet,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
    tools: TOOLS,
    toolRegistry,
    maxIterations: 4,
    onProgress,
    signal,
  });

  onProgress?.("평가 결과를 정리합니다.");
  const parsed = parseEvalFromText(resultText);
  const subScore = computeAggregate(parsed.scores);
  const provisionalEval: EvalResult = {
    runId: `eval-${randomUUID().slice(0, 8)}`,
    scores: parsed.scores,
    aggregateScore: subScore,
    reasoning: parsed.reasoning,
    recommendations: parsed.recommendations,
    pass: subScore >= HARNESS_PASS_THRESHOLD,
  };
  const evalResult = finalizeEval({
    provisionalEval,
    writerResult,
    strategy,
    parsedReasoning: parsed.reasoning,
    parsedRecommendations: parsed.recommendations,
  });

  await saveEvalRun(evalResult, writerResult.postId);
  onProgress?.(`초안 평가 완료: ${evalResult.aggregateScore}점(${evalResult.pass ? "통과" : "보강 필요"})`);

  return evalResult;
}

async function saveEvalRun(evalResult: EvalResult, postId: string): Promise<void> {
  const runPath = Paths.evalRun(evalResult.runId);
  const exists = await fileExists(runPath);
  if (exists) return;

  await writeJsonFile(
    runPath,
    { ...evalResult, postId, savedAt: new Date().toISOString() },
    `feat: eval run ${evalResult.runId} for post ${postId}`,
    null
  );
}

export async function compareWithBaseline(
  evalResult: EvalResult,
  caseId: string
): Promise<number | null> {
  try {
    const { data: baselines } = await readJsonFile<{
      results: Array<{ caseId: string; aggregateScore: number }>;
    }>(Paths.evalBaselines());
    const baseline = baselines.results.find((r) => r.caseId === caseId);
    if (!baseline) return null;
    return evalResult.aggregateScore - baseline.aggregateScore;
  } catch {
    return null;
  }
}
