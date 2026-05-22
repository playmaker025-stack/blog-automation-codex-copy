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
    .map(([dimension, score]) => `${dimension} ${score}\uC810 - ${entry.reasoning[dimension] ?? "\uD3C9\uAC00 \uADFC\uAC70 \uC5C6\uC74C"}`);
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
    .map(([dimension, score]) => `- ${dimension}: ${score}\uC810 / ${params.evalResult.reasoning[dimension] ?? "\uD3C9\uAC00 \uADFC\uAC70 \uC5C6\uC74C"}`)
    .join("\n");

  const keywordItems = params.evalResult.seoEvaluation?.keywordReport.items ?? [];
  const seoNotes = keywordItems
    .filter((item) => item.status !== "ok")
    .map((item) => `- 키워드 '${item.keyword}': 현재 ${item.count}회, 권장 ${item.targetMin}~${item.targetMax}회, 상태 ${item.status}. ${item.recommendation}`);

  const dangerKeywords = keywordItems
    .filter((item) => item.status === "danger")
    .map((item) => `${item.keyword}(${item.count}회)`);

  const underKeywords = keywordItems
    .filter((item) => item.status === "under")
    .map((item) => `${item.keyword}(${item.count}회)`);

  const paragraphWarnings =
    params.evalResult.seoEvaluation?.keywordReport.paragraphWarnings.map((warning) => `- ${warning.message}`) ?? [];

  const seoScore = params.evalResult.seoEvaluation?.score ?? params.evalResult.aggregateScore;
  const risk = params.evalResult.seoEvaluation?.keywordReport.overallRisk ?? "unknown";

  return `## 자동 보강 지시
이전 초안은 통과 기준 ${HARNESS_PASS_THRESHOLD}점에 도달하지 못했습니다. 아래 문제를 반영해 본문 전체를 다시 작성하세요. 기존 문장을 덧붙이지 말고, 과한 반복을 줄이면서 부족한 정보와 구조를 보강해야 합니다.

현재 점수
- 종합: ${params.evalResult.aggregateScore}점
- SEO: ${seoScore}점
- 키워드 반복 위험도: ${risk}

낮은 평가 항목
${lowDimensions || "- 세부 점수는 통과권이지만 SEO/키워드/네이버 로직 보정이 필요합니다."}

키워드 직접 수정 지시
${seoNotes.join("\n") || "- 키워드 반복 수는 큰 문제 없음. 구조와 정보 충실도를 중심으로 보강하세요."}
${paragraphWarnings.join("\n") || ""}

반드시 줄일 표현
- 과반복 키워드: ${dangerKeywords.join(", ") || "없음"}
- 위 키워드는 같은 문단에서 반복하지 말고, 일부를 선택 기준, 상황 설명, 제품/액상 예시, 비교 문장으로 치환하세요.

반드시 보강할 표현
- 부족 키워드: ${underKeywords.join(", ") || "없음"}
- 부족 키워드는 억지로 나열하지 말고 검색자가 실제로 묻는 질문에 답하는 문단 안에 넣으세요.

보강본 채택 조건
- 키워드 danger 개수가 이전보다 줄어야 합니다.
- SEO 점수 또는 네이버 로직 점수가 이전보다 올라야 합니다.
- 메인 키워드는 본문 4~7회, 서브 키워드는 각 1~3회를 목표로 합니다.
- 선행 글의 targetMainKeyword는 본문 1~3회만 자연 노출합니다.

기존 브리핑
${params.briefing}`;
}
