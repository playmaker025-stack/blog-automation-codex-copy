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
    .map(([dimension, score]) => `${dimension} ${score}점 - ${entry.reasoning[dimension] ?? "평가 근거 없음"}`);
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

    return unique(entries.flatMap((entry) => [...lowScoreReasons(entry), ...entry.recommendations])).slice(0, 8);
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
      guardrail: "자동 보강은 점수를 위한 재작성 루프가 아니라, 실제로 낮은 항목을 줄이는 방향으로만 기록하고 재사용합니다.",
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
  const targetLength =
    corpusSummary.styleProfile.avgWordCount > 0 ? corpusSummary.styleProfile.avgWordCount : strategy.estimatedLength;

  const failureSection =
    recentFailures.length > 0
      ? recentFailures.map((item) => `- ${item}`).join("\n")
      : "- 최근 실패 기록 없음. 초안부터 불필요한 키워드 과반복 없이 안정적으로 작성합니다.";

  const naverSignalsSection = strategy.naverSignals
    ? [
        `- 카페 반복 수요: ${strategy.naverSignals.cafeDemandSummary || "없음"}`,
        `- 지식인 반복 질문: ${strategy.naverSignals.kinProblemSummary || "없음"}`,
      ].join("\n")
    : "- 네이버 커뮤니티/지식인 보조 신호 없음";

  return `## Pre-write Harness Briefing
이 초안은 한 번에 발행 가능한 수준으로 쓰는 것을 목표로 합니다.

평가 우선순위
- SEO 45%: 제목/도입부/소제목/결론 키워드 연결, 본문 반복도, 검색 조합 반영
- 네이버 로직 35%: D.I.A / C-Rank 문맥, 검색 의도 충족, 실제 선택 기준과 문제 해결력
- 문체 일치 8%: 사용자 코퍼스의 호흡, 톤, 문단 리듬
- 구조 7%: 문단 연결, 소제목 흐름, 모바일 가독성
- 나머지 5%: 금지 표현, 과장 표현, 근거 부족 여부

현재 전략 요약
- 제목: ${strategy.title}
- 핵심 키워드: ${strategy.keywords.join(", ") || "없음"}
- 목표 길이: 약 ${targetLength}자
- 톤: ${strategy.tone}
- 코퍼스 구조 패턴: ${corpusSummary.styleProfile.structurePattern}
- 코퍼스 도입 패턴: ${corpusSummary.styleProfile.openingPattern}

네이버 보조 신호
${naverSignalsSection}

최근 실패 패턴
${failureSection}

작성 원칙
- 메인 키워드와 서브 키워드는 필요한 위치에만 넣고, 같은 문단에서 과하게 되풀이하지 않습니다.
- 점수를 위해 2차, 3차를 무조건 만드는 방식이 아니라 1차 초안부터 최대한 통과 가능한 품질로 작성합니다.
- 본문 충실도, 실제 선택 기준, 비교 포인트, 사례, 설명 흐름이 먼저이고 키워드 반복은 그 다음입니다.
- 선행 포스팅이라면 메인 키워드를 정면 공격하지 말고, 관련 하위 의도 안에서 자연스럽게 노출합니다.`;
}

export function buildRevisionInstruction(params: {
  evalResult: EvalResult;
  briefing: string;
}): string {
  const lowDimensions = Object.entries(params.evalResult.scores)
    .filter(([, score]) => score < HARNESS_PASS_THRESHOLD)
    .sort((a, b) => a[1] - b[1])
    .map(([dimension, score]) => `- ${dimension}: ${score}점 / ${params.evalResult.reasoning[dimension] ?? "평가 근거 없음"}`)
    .join("\n");

  const seoNotes =
    params.evalResult.seoEvaluation?.keywordReport.items
      .filter((item) => item.status !== "ok")
      .map((item) => `- 키워드 '${item.keyword}': ${item.recommendation}`) ?? [];

  const paragraphWarnings =
    params.evalResult.seoEvaluation?.keywordReport.paragraphWarnings.map((warning) => `- ${warning.message}`) ?? [];

  const dangerKeywords =
    params.evalResult.seoEvaluation?.keywordReport.items
      .filter((item) => item.status === "danger")
      .map((item) => item.keyword) ?? [];

  const cautionKeywords =
    params.evalResult.seoEvaluation?.keywordReport.items
      .filter((item) => item.status === "caution")
      .map((item) => item.keyword) ?? [];

  return `## 초안 보강 지시
이번 초안은 ${HARNESS_PASS_THRESHOLD}점 기준을 아직 넘지 못했습니다. 아래 문제만 직접 줄이는 방향으로 보강하세요.

낮은 평가 항목
${lowDimensions || "- 명시적으로 낮은 세부 점수는 없습니다."}

평가 요약 권고
${params.evalResult.recommendations.map((item) => `- ${item}`).join("\n") || "- 추가 권고 없음"}

SEO/키워드 보완 포인트
${seoNotes.join("\n") || "- 현재 키워드 상태 기준 별도 보완 없음"}
${paragraphWarnings.join("\n") || ""}

보강 원칙
- 초안 전체를 새로 쓰지 말고, 실제로 점수를 깎은 부분만 줄이거나 보강합니다.
- 키워드가 과하면 같은 단어를 반복하지 말고 기준, 상황, 예시, 비교 포인트로 바꿉니다.
- 내용이 약하면 불필요한 수식어 대신 실제 선택 기준, 사용 상황, 주의점, 구조 설명을 보강합니다.
- 이미 괜찮은 문단은 유지하고, 문제 문단만 최소 범위로 손봅니다.
- 위험 키워드: ${dangerKeywords.join(", ") || "없음"}
- 주의 키워드: ${cautionKeywords.join(", ") || "없음"}

기본 브리핑
${params.briefing}`;
}
