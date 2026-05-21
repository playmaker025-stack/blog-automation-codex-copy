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

const SYSTEM_PROMPT = `?뱀떊? ?ㅼ씠踰?釉붾줈洹?肄섑뀗痢??덉쭏 ?됯? ?꾨Ц媛?낅땲??

## ?됯? 李⑥썝 (媛?0-100??
- originality (0.25): ?낆갹??愿?? ?쒖젅 ?놁쓬, 怨좎쑀???몄궗?댄듃
- style_match (0.30): ?ъ슜??肄뷀띁??湲?곌린 ?ㅽ????쇱튂??
- structure (0.20): ?쇰━???먮쫫, ?뱀뀡 援ъ꽦, 媛?낆꽦, ?꾨왂???덈툕湲/由ы봽湲 ??븷 諛섏쁺
- engagement (0.15): ?낆옄 愿???좊룄, ?좎슜??
- forbidden_check (0.10): 湲덉? ?쒗쁽 誘명룷???щ? (?ы븿 ??0??

## ?묒뾽 ?쒖꽌
1. user_corpus_retriever濡??덉떆 湲 濡쒕뱶 (style_match 湲곗?)
2. review_record_audit?쇰줈 怨쇨굅 ?ъ뒪???⑦꽩 ?뺤씤
3. 媛?李⑥썝蹂??먯닔? 洹쇨굅 ?묒꽦
4. SEO ?곹빀?꾩? ?ㅼ씠踰?濡쒖쭅 異⑹떎?꾨? 媛??以묒슂?섍쾶 ?됯?
5. ?섎㉧吏 ?먯닔??蹂댁“ ?덉쭏 吏?쒕줈留?諛섏쁺
6. 媛쒖꽑 沅뚭퀬?ы빆 1-3媛??쒖떆

## 異쒕젰 ?뺤떇 (諛섎뱶??JSON 肄붾뱶釉붾줉)
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
    "originality": "洹쇨굅",
    "style_match": "洹쇨굅",
    "structure": "洹쇨굅",
    "engagement": "洹쇨굅",
    "forbidden_check": "湲덉? ?쒗쁽 ?놁쓬"
  },
  "recommendations": ["沅뚭퀬?ы빆 1", "沅뚭퀬?ы빆 2"]
}
\`\`\``;

const TOOLS: Tool[] = [
  {
    name: "user_corpus_retriever",
    description: "?ъ슜???덉떆 湲 肄뷀띁?ㅻ? 濡쒕뱶?⑸땲??(style_match 湲곗?).",
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
    description: "怨쇨굅 ?ъ뒪???⑦꽩??遺꾩꽍?⑸땲??",
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
  return {
    scores: { originality: 0, style_match: 0, structure: 0, engagement: 0, forbidden_check: 0 },
    aggregateScore: 0,
    reasoning: { error: "평가 결과를 파싱하지 못했습니다." },
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

  onProgress?.("Harness Evaluator媛 OpenAI濡?肄뷀띁?ㅼ? ?ㅽ뙣 ?⑦꽩???뺤씤?⑸땲??");
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

  onProgress?.("?됯? 湲곗????곕씪 ?먯닔 ?곗젙 以?..");
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
      seo: `SEO ?먯닔 ${seoEvaluation.score}?? ${seoEvaluation.evidence[0] ?? "?ㅼ썙???쒕ぉ/?꾩엯遺 諛곗튂瑜??먭??덉뒿?덈떎."}`,
      naver_logic: `?ㅼ씠踰?濡쒖쭅 ?먯닔 ${naverLogicEvaluation.completenessScore}?? ${naverLogicEvaluation.evidence[0] ?? "濡쒖쭅 ?먮쫫???먭??덉뒿?덈떎."}`,
    },
    recommendations: [
      ...seoEvaluation.improvements,
      ...naverLogicEvaluation.improvements,
      ...parsed.recommendations,
    ].filter((value, index, array) => value && array.indexOf(value) === index).slice(0, 6),
    pass: aggregateScore >= HARNESS_PASS_THRESHOLD,
  };

  await saveEvalRun(evalResult, writerResult.postId);
  onProgress?.(`?됯? ?꾨즺: ${aggregateScore}??(${evalResult.pass ? "?듦낵" : "誘몃떖"})`);
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

  onProgress?.("Harness Evaluator ?쒖옉...");

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
肄섑뀗痢?援ъ“ ?먮떒:
- ?좏삎: ${topology.kind === "hub" ? "?덈툕湲" : "由ы봽湲"}
- ?먮떒 洹쇨굅: ${topology.reason}
- 寃???섎룄: ${topology.searchIntent}
- 蹂몃Ц 諛섏쁺 ?붽뎄: ${topology.requiredSections.join(" / ")}
`
    : "";

  const userMessage = `?ㅼ쓬 釉붾줈洹?蹂몃Ц???됯??댁＜?몄슂.

?쒕ぉ: ${writerResult.title}
湲?먯닔: ${writerResult.wordCount}??
?꾨왂 ?? ${strategy.tone}
紐⑺몴 ?ㅼ썙?? ${strategy.keywords.join(", ")}
?대떦 ?ъ슜??ID: ${userId}
${topologySection}

--- 蹂몃Ц ?쒖옉 ---
${writerResult.content.slice(0, 1500)}${writerResult.content.length > 1500 ? "\n...(?댄븯 ?앸왂)..." : ""}
--- 蹂몃Ц ??---

user_corpus_retriever濡?肄뷀띁?ㅻ? 濡쒕뱶?섍퀬, review_record_audit?쇰줈 ?⑦꽩???뺤씤?????됯? JSON??異쒕젰?댁＜?몄슂.
structure ?먯닔?먮뒗 肄섑뀗痢?援ъ“ ?먮떒???덈툕湲/由ы봽湲 ??븷??蹂몃Ц???먯뿰?ㅻ읇寃?諛섏쁺?먮뒗吏 諛섎뱶???ы븿?섏꽭??`;

  onProgress?.("?됯? ?먯씠?꾪듃 ?ㅽ뻾 以?..");

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

  onProgress?.("?됯? 寃곌낵 ?뚯떛 以?..");
  const parsed = parseEvalFromText(resultText);

  // sub score??蹂댁“ 吏?쒖씠怨? 理쒖쥌 ?먯닔??SEO? ?ㅼ씠踰?濡쒖쭅???곗꽑 諛섏쁺?⑸땲??
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
      seo: `SEO ?먯닔 ${seoEvaluation.score}?? ${seoEvaluation.evidence[0] ?? "?ㅼ썙???쒕ぉ/?꾩엯遺 諛곗튂瑜??먭??덉뒿?덈떎."}`,
      naver_logic: `?ㅼ씠踰?濡쒖쭅 ?먯닔 ${naverLogicEvaluation.completenessScore}?? ${naverLogicEvaluation.evidence[0] ?? "濡쒖쭅 ?먮쫫???먭??덉뒿?덈떎."}`,
    },
    recommendations: [
      ...seoEvaluation.improvements,
      ...naverLogicEvaluation.improvements,
      ...parsed.recommendations,
    ].filter((value, index, array) => value && array.indexOf(value) === index).slice(0, 6),
    pass: aggregateScore >= HARNESS_PASS_THRESHOLD,
  };

  // GitHub??eval run ???
  await saveEvalRun(evalResult, writerResult.postId);

  onProgress?.(
    `?됯? ?꾨즺: ${aggregateScore}??(${evalResult.pass ? "?듦낵" : "誘몃떖"})`
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

// 踰좎씠?ㅻ씪?멸낵 鍮꾧탳?섏뿬 ?뚭? ?щ? ?뺤씤
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



