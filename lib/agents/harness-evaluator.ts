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

const SYSTEM_PROMPT = `당신은 네이버 블로그 콘텐츠 품질 평가 전문가입니다.

## 평가 차원 (각 0-100점)
- originality (0.25): 독창적 관점, 표절 없음, 고유한 인사이트
- style_match (0.30): 사용자 코퍼스 글쓰기 스타일 일치도
- structure (0.20): 논리적 흐름, 섹션 구성, 가독성, 전략의 허브글/리프글 역할 반영
- engagement (0.15): 독자 관심 유도, 유용성
- forbidden_check (0.10): 금지 표현 미포함 여부 (포함 시 0점)

## 작업 순서
1. user_corpus_retriever로 예시 글 로드 (style_match 기준)
2. review_record_audit으로 과거 포스팅 패턴 확인
3. 각 차원별 점수와 근거 작성
4. SEO 적합도와 네이버 로직 충실도를 가장 중요하게 평가
5. 나머지 점수는 보조 품질 지표로만 반영
6. 개선 권고사항 1-3개 제시

## 출력 형식 (반드시 JSON 코드블록)
\`\`\`json
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
    "originality": "근거",
    "style_match": "근거",
    "structure": "근거",
    "engagement": "근거",
    "forbidden_check": "금지 표현 없음"
  },
  "recommendations": ["권고사항 1", "권고사항 2"]
}
\`\`\``;

const TOOLS: Tool[] = [
  {
    name: "user_corpus_retriever",
    description: "사용자 예시 글 코퍼스를 로드합니다 (style_match 기준).",
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
    description: "과거 포스팅 패턴을 분석합니다.",
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
      // fallthrough
    }
  }
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0]) as Omit<EvalResult, "runId" | "pass">;
    } catch {
      // fallthrough
    }
  }
  // 파싱 실패 시 기본값 반환
  return {
    scores: { originality: 0, style_match: 0, structure: 0, engagement: 0, forbidden_check: 0 },
    aggregateScore: 0,
    reasoning: { error: "평가 결과 파싱 실패" },
    recommendations: ["평가를 다시 실행해주세요."],
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

  onProgress?.("Harness Evaluator가 OpenAI로 코퍼스와 실패 패턴을 확인합니다.");
  const [corpus, audit] = await Promise.all([
    userCorpusRetriever({ userId: userId.trim().toLowerCase(), limit: 5 }),
    reviewRecordAudit({ userId: userId.trim().toLowerCase(), limit: 8 }),
  ]);

  const topology = strategy.contentTopology;
  const topologyText = topology
    ? [
        `kind: ${topology.kind}`,
        `reason: ${topology.reason}`,
        `searchIntent: ${topology.searchIntent}`,
        `requiredSections: ${topology.requiredSections.join(" / ")}`,
      ].join("\n")
    : "No topology plan.";
  const naverSignalsText = strategy.naverSignals
    ? [
        `keyword: ${strategy.naverSignals.keyword}`,
        `cafeDemand: ${strategy.naverSignals.cafeDemandSummary || "none"}`,
        `kinProblems: ${strategy.naverSignals.kinProblemSummary || "none"}`,
      ].join("\n")
    : "No Naver community signals.";

  onProgress?.("평가 기준에 따라 점수 산정 중...");
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
          "Give credit for concrete search-intent fit, corpus style match, hub/leaf structure, mobile readability, and practical decision criteria.",
          "Penalize generic advice, missing user style, weak opening, vague examples, keyword stuffing, unsupported absolute claims, and missing topology role.",
          "When Naver community demand or KnowledgeIn problem signals are provided, penalize drafts that ignore those repeated demand and question patterns.",
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
          topologyText,
          "",
          "Naver research signals:",
          naverSignalsText,
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
  const runId = `eval-${randomUUID().slice(0, 8)}`;
  const provisionalEval: EvalResult = {
    runId,
    scores,
    aggregateScore: subScore,
    reasoning: parsed.reasoning,
    recommendations: parsed.recommendations,
    pass: subScore >= HARNESS_PASS_THRESHOLD,
  };
  const seoEvaluation = evaluateSeoCompleteness({
    title: writerResult.title,
    body: writerResult.content,
    keywords: strategy.keywords,
  });
  const naverLogicEvaluation = naverLogicAgent.auditAfterWriting({
    strategy,
    writerResult,
    evalResult: provisionalEval,
  });
  const aggregateScore = Math.round(
    seoEvaluation.score * 0.45 +
    naverLogicEvaluation.completenessScore * 0.35 +
    scores.style_match * 0.08 +
    scores.structure * 0.07 +
    scores.engagement * 0.03 +
    scores.originality * 0.01 +
    scores.forbidden_check * 0.01
  );
  const evalResult: EvalResult = {
    ...provisionalEval,
    aggregateScore,
    reasoning: {
      ...parsed.reasoning,
      seo: `SEO 점수 ${seoEvaluation.score}점. ${seoEvaluation.evidence[0] ?? "키워드/제목/도입부 배치를 점검했습니다."}`,
      naver_logic: `네이버 로직 점수 ${naverLogicEvaluation.completenessScore}점. ${naverLogicEvaluation.evidence[0] ?? "로직 흐름을 점검했습니다."}`,
    },
    recommendations: [
      ...seoEvaluation.improvements,
      ...naverLogicEvaluation.improvements,
      ...parsed.recommendations,
    ].filter((value, index, array) => value && array.indexOf(value) === index).slice(0, 6),
    pass: aggregateScore >= HARNESS_PASS_THRESHOLD,
  };

  await saveEvalRun(evalResult, writerResult.postId);
  onProgress?.(`평가 완료: ${aggregateScore}점 (${evalResult.pass ? "통과" : "미달"})`);
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

  const topology = strategy.contentTopology;
  const topologySection = topology
    ? `
콘텐츠 구조 판단:
- 유형: ${topology.kind === "hub" ? "허브글" : "리프글"}
- 판단 근거: ${topology.reason}
- 검색 의도: ${topology.searchIntent}
- 본문 반영 요구: ${topology.requiredSections.join(" / ")}
`
    : "";

  const userMessage = `다음 블로그 본문을 평가해주세요.

제목: ${writerResult.title}
글자수: ${writerResult.wordCount}자
전략 톤: ${strategy.tone}
목표 키워드: ${strategy.keywords.join(", ")}
담당 사용자 ID: ${userId}
${topologySection}

--- 본문 시작 ---
${writerResult.content.slice(0, 1500)}${writerResult.content.length > 1500 ? "\n...(이하 생략)..." : ""}
--- 본문 끝 ---

user_corpus_retriever로 코퍼스를 로드하고, review_record_audit으로 패턴을 확인한 후 평가 JSON을 출력해주세요.
structure 점수에는 콘텐츠 구조 판단의 허브글/리프글 역할이 본문에 자연스럽게 반영됐는지 반드시 포함하세요.`;

  onProgress?.("평가 에이전트 실행 중...");

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

  onProgress?.("평가 결과 파싱 중...");
  const parsed = parseEvalFromText(resultText);

  // sub score는 보조 지표이고, 최종 점수는 SEO와 네이버 로직을 우선 반영합니다.
  const subScore = computeAggregate(parsed.scores);

  const runId = `eval-${randomUUID().slice(0, 8)}`;
  const provisionalEval: EvalResult = {
    runId,
    scores: parsed.scores,
    aggregateScore: subScore,
    reasoning: parsed.reasoning,
    recommendations: parsed.recommendations,
    pass: subScore >= HARNESS_PASS_THRESHOLD,
  };
  const seoEvaluation = evaluateSeoCompleteness({
    title: writerResult.title,
    body: writerResult.content,
    keywords: strategy.keywords,
  });
  const naverLogicEvaluation = naverLogicAgent.auditAfterWriting({
    strategy,
    writerResult,
    evalResult: provisionalEval,
  });
  const aggregateScore = Math.round(
    seoEvaluation.score * 0.45 +
    naverLogicEvaluation.completenessScore * 0.35 +
    parsed.scores.style_match * 0.08 +
    parsed.scores.structure * 0.07 +
    parsed.scores.engagement * 0.03 +
    parsed.scores.originality * 0.01 +
    parsed.scores.forbidden_check * 0.01
  );
  const evalResult: EvalResult = {
    ...provisionalEval,
    aggregateScore,
    reasoning: {
      ...parsed.reasoning,
      seo: `SEO 점수 ${seoEvaluation.score}점. ${seoEvaluation.evidence[0] ?? "키워드/제목/도입부 배치를 점검했습니다."}`,
      naver_logic: `네이버 로직 점수 ${naverLogicEvaluation.completenessScore}점. ${naverLogicEvaluation.evidence[0] ?? "로직 흐름을 점검했습니다."}`,
    },
    recommendations: [
      ...seoEvaluation.improvements,
      ...naverLogicEvaluation.improvements,
      ...parsed.recommendations,
    ].filter((value, index, array) => value && array.indexOf(value) === index).slice(0, 6),
    pass: aggregateScore >= HARNESS_PASS_THRESHOLD,
  };

  // GitHub에 eval run 저장
  await saveEvalRun(evalResult, writerResult.postId);

  onProgress?.(
    `평가 완료: ${aggregateScore}점 (${evalResult.pass ? "통과" : "미달"})`
  );

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

// 베이스라인과 비교하여 회귀 여부 확인
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
