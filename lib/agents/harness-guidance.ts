import { fileExists, readJsonFile, writeJsonFile } from "@/lib/github/repository";
import type { EvalResult, StrategyPlanResult } from "./types";
import type { CorpusSummaryArtifact } from "./corpus-selector";

import { SEO_PASS_THRESHOLD } from "./blog-workflow-policy";

export const HARNESS_PASS_THRESHOLD = SEO_PASS_THRESHOLD;

const LEDGER_PATH = "data/harness-engineering/writing-failure-ledger.json";
const MAX_LEDGER_ENTRIES = 300;

interface WritingFailureEntry {
  id: string;
  at: string;
  pipelineId: string;
  topicId: string;
  userId: string;
  title: string;
  aggregateScore: number;
  scores: EvalResult["scores"];
  reasoning: EvalResult["reasoning"];
  recommendations: string[];
  phase: "preliminary" | "final";
  guardrail: string;
}

interface WritingFailureLedger {
  schemaVersion: 1;
  entries: WritingFailureEntry[];
  lastUpdated: string;
}

async function loadLedger(): Promise<{ data: WritingFailureLedger; sha: string | null }> {
  if (!(await fileExists(LEDGER_PATH))) {
    return {
      data: { schemaVersion: 1, entries: [], lastUpdated: new Date().toISOString() },
      sha: null,
    };
  }
  return readJsonFile<WritingFailureLedger>(LEDGER_PATH);
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = value.trim().replace(/\s+/g, " ");
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function lowScoreReasons(entry: WritingFailureEntry): string[] {
  return Object.entries(entry.scores)
    .filter(([, score]) => score < HARNESS_PASS_THRESHOLD)
    .sort((a, b) => a[1] - b[1])
    .map(([dimension, score]) => `${dimension} ${score}점: ${entry.reasoning[dimension] ?? "근거 없음"}`);
}

export async function getRecentHarnessFailureGuidance(params: {
  userId: string;
  limit?: number;
}): Promise<string[]> {
  try {
    const { data } = await loadLedger();
    const entries = data.entries
      .filter((entry) => entry.userId === params.userId)
      .slice(-(params.limit ?? 5))
      .reverse();

    return unique(
      entries.flatMap((entry) => [
        ...lowScoreReasons(entry),
        ...entry.recommendations,
      ])
    ).slice(0, 8);
  } catch {
    return [];
  }
}

export async function appendWritingFailure(params: {
  pipelineId: string;
  topicId: string;
  userId: string;
  title: string;
  evalResult: EvalResult;
  phase: "preliminary" | "final";
}): Promise<void> {
  try {
    const { data, sha } = await loadLedger();
    const now = new Date().toISOString();
    const entry: WritingFailureEntry = {
      id: `${now}-${params.pipelineId}-${params.phase}`,
      at: now,
      pipelineId: params.pipelineId,
      topicId: params.topicId,
      userId: params.userId,
      title: params.title,
      aggregateScore: params.evalResult.aggregateScore,
      scores: params.evalResult.scores,
      reasoning: params.evalResult.reasoning,
      recommendations: params.evalResult.recommendations,
      phase: params.phase,
      guardrail: "다음 글쓰기 전 pre-write harness briefing에 반영해서 같은 감점 사유를 반복하지 않는다.",
    };

    await writeJsonFile<WritingFailureLedger>(
      LEDGER_PATH,
      {
        schemaVersion: 1,
        entries: [...data.entries, entry].slice(-MAX_LEDGER_ENTRIES),
        lastUpdated: now,
      },
      `log: writing harness failure ${params.pipelineId} ${params.phase}`,
      sha
    );
  } catch {
    // Failure logging should never break the writing pipeline.
  }
}

export function buildPreWriteHarnessBriefing(params: {
  strategy: StrategyPlanResult;
  corpusSummary: CorpusSummaryArtifact;
  recentFailures: string[];
}): string {
  const { strategy, corpusSummary, recentFailures } = params;
  const targetLength = corpusSummary.styleProfile.avgWordCount > 0
    ? corpusSummary.styleProfile.avgWordCount
    : strategy.estimatedLength;

  const failureSection = recentFailures.length > 0
    ? recentFailures.map((item) => `- ${item}`).join("\n")
    : "- 최근 반복 실패 사유 없음. 기본 루브릭을 우선 적용.";

  return `## Pre-write Harness Briefing
목표: 최종 Harness Evaluator에서 ${HARNESS_PASS_THRESHOLD}점 이상을 목표로 초안을 작성한다.

평가 루브릭:
- SEO 45%: 메인 키워드의 제목/도입부/중간 문단 반영, 검색 의도 정합성, 과다 반복 방지
- 네이버 로직 35%: D.I.A./C-Rank 흐름, 상황-기준-해결 순서, 허브/리프 역할, 블로그 주제 연결성
- style_match 8%: 사용자 코퍼스의 톤, 문장 흐름, 시작 방식, 마무리 방식을 따른다.
- structure 7%: 도입-핵심 기준-상황별 설명-정리 흐름이 분명해야 한다.
- engagement/originality/forbidden_check 5%: 보조 품질과 금지 표현 여부를 확인한다.

현재 주제 감점 위험:
- 제목: ${strategy.title}
- 목표 키워드: ${strategy.keywords.join(", ") || "없음"}
- 코퍼스 톤: ${corpusSummary.styleProfile.dominantTone}
- 권장 분량 기준: ${targetLength}자 안팎
- 구조 패턴: ${corpusSummary.styleProfile.structurePattern}
- 시작 패턴: ${corpusSummary.styleProfile.openingPattern}

최근 실패 사유 재발 방지:
${failureSection}

작성 지시:
- 위 루브릭을 본문에 노골적으로 설명하지 말고, 자연스러운 글 품질 기준으로 반영한다.
- 첫 초안부터 ${HARNESS_PASS_THRESHOLD}점 이상을 목표로 하며, 특히 SEO와 네이버 로직 감점을 먼저 피한다.`;
}

export function buildRevisionInstruction(params: {
  evalResult: EvalResult;
  briefing: string;
}): string {
  const lowDimensions = Object.entries(params.evalResult.scores)
    .filter(([, score]) => score < HARNESS_PASS_THRESHOLD)
    .sort((a, b) => a[1] - b[1])
    .map(([dimension, score]) => `- ${dimension}: ${score}점, ${params.evalResult.reasoning[dimension] ?? "근거 없음"}`)
    .join("\n");

  return `## 자동 보강 지시
현재 초안은 Harness 기준 ${HARNESS_PASS_THRESHOLD}점 미만(${params.evalResult.aggregateScore}점)으로 예상된다.

낮은 항목:
${lowDimensions || "- 세부 항목 없음"}

개선 권고:
${params.evalResult.recommendations.map((item) => `- ${item}`).join("\n") || "- 권고 없음"}

${params.briefing}

위 내용을 반영해 본문 전체를 다시 작성한다. 기존 장점은 유지하되, 일반론을 줄이고 구체 기준/상황 설명/자연스러운 마무리를 보강한다.`;
}
