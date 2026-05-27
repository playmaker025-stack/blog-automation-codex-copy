import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildOpenAIWriterPayloadPreview,
} from "../lib/agents/openai-writer-preview.ts";
import { classifySearchCombination } from "../lib/agents/search-combination-utils.ts";
import { sanitizeDirectIntent } from "../lib/agents/direct-intent-utils.ts";
import { wrapForNaverMobile } from "../lib/agents/naver-mobile-wrap.ts";
import {
  extractOpenAIOutputText,
  requestOpenAIResponse,
} from "../lib/openai/responses.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const FIXTURE_PATH = path.join(ROOT, "tests", "fixtures", "pr1-korean-input.json");
const OUTPUT_DIR = path.join(ROOT, "test-results");
const PAYLOAD_PREVIEW_PATH = path.join(OUTPUT_DIR, "pr1-openai-payload.preview.json");
const RAW_RESPONSE_PATH = path.join(OUTPUT_DIR, "pr1-openai-raw-response.json");
const PROCESSED_OUTPUT_PATH = path.join(OUTPUT_DIR, "pr1-openai-draft.processed.json");

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJsonUtf8(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function assertIncludes(haystack, needle, label) {
  if (!haystack.includes(needle)) {
    throw new Error(`${label} 검증 실패: '${needle}' 문자열이 없습니다.`);
  }
}

function assertNoQuestionCorruption(value, label) {
  if (typeof value !== "string") return;
  if (value.includes("??")) {
    throw new Error(`${label} 검증 실패: 한글이 '?'로 손상된 문자열이 포함되었습니다.`);
  }
}

function toParagraphs(markdown) {
  return markdown
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function buildStrategyFromFixture(fixture) {
  const longTailClassification = classifySearchCombination(fixture.rawInputTitle);
  const supportClassification = classifySearchCombination(fixture.subKeywords[0]);

  if (longTailClassification.displayIntent !== fixture.expected.displayIntent) {
    throw new Error(
      `displayIntent 불일치: '${longTailClassification.displayIntent}'`
    );
  }
  if (longTailClassification.exactInsertionAllowed !== fixture.expected.exactInsertionAllowed) {
    throw new Error("exactInsertionAllowed 검증 실패");
  }
  if (longTailClassification.exactBlockReason !== fixture.expected.exactBlockReason) {
    throw new Error(
      `exactBlockReason 불일치: '${longTailClassification.exactBlockReason ?? ""}'`
    );
  }

  return {
    title: "부평 고유가 피해 지원금 사용처, 전자담배 매장 방문 전 확인할 점",
    outline: [
      {
        heading: "방문 전에 가장 많이 묻는 질문부터 확인",
        subPoints: ["지원금 사용처 확인", "매장 결제 가능 여부 확인", "방문 전 문의 포인트"],
        contentDirection: "실제 손님 질문과 방문 상황으로 도입합니다.",
        estimatedParagraphs: 2,
      },
      {
        heading: "지원금 사용처와 결제 가능 여부가 갈리는 이유",
        subPoints: ["지급수단 차이", "가맹점 승인 상태", "전자담배 품목 제한 가능성"],
        contentDirection: "과장 없이 확인 조건을 설명합니다.",
        estimatedParagraphs: 2,
      },
      {
        heading: "매장에 가기 전에 이렇게 확인하면 헷갈림이 줄어듭니다",
        subPoints: ["전화 문의 문장", "현장 확인 순서", "결제 실패 방지 포인트"],
        contentDirection: "검색의도를 이 글 안에서 완결하는 실용 정리로 마무리합니다.",
        estimatedParagraphs: 2,
      },
    ],
    keyPoints: [
      "지원금 사용처 확인 의도와 전자담배 매장 결제 가능 여부를 자연스럽게 연결",
      "일반 글이므로 다음 글로 미루지 않고 이 글 안에서 답변 완결",
      "정책/매장/품목 제한 가능성을 과장 없이 설명",
    ],
    estimatedLength: 1700,
    tone: "friendly",
    keywords: [
      fixture.expected.promptPrimaryKeyword,
      ...fixture.subKeywords,
    ],
    suggestedSources: [],
    rationale: "긴 입력 문구를 exact phrase로 쓰지 않고 사용처 확인과 매장 결제 가능 여부라는 두 의도로 분해한 일반 글 전략입니다.",
    targetSearchCombinations: [
      {
        phrase: fixture.rawInputTitle,
        displayIntent: longTailClassification.displayIntent,
        exactInsertionAllowed: longTailClassification.exactInsertionAllowed,
        exactBlockReason: longTailClassification.exactBlockReason,
        role: "mixed",
        priority: "core",
        rationale: "긴 조합은 exact phrase 대신 의도로만 커버해야 합니다.",
        suggestedPlacement: "도입부 또는 핵심 안내 문단",
      },
      {
        phrase: fixture.subKeywords[0],
        displayIntent: supportClassification.displayIntent,
        exactInsertionAllowed: supportClassification.exactInsertionAllowed,
        exactBlockReason: supportClassification.exactBlockReason,
        role: "local",
        priority: "support",
        rationale: "지역 매장 맥락을 보강하는 보조 키워드입니다.",
        suggestedPlacement: "도입부 또는 지역 맥락 문단",
      },
    ],
    contentTopology: {
      kind: "leaf",
      reason: "현재 검색의도를 이 글 안에서 끝내야 하는 질문형 일반 글입니다.",
      searchIntent: "지원금 사용처 확인과 전자담배 매장 결제 가능 여부를 방문 전에 파악하려는 의도",
      bodyPlacement: "직접 답변 + 상담형 안내",
      requiredSections: [
        "실제 손님 질문/상황",
        "사용처와 결제 가능 여부가 갈리는 이유",
        "방문 전 확인 순서",
        "핵심 요약",
      ],
      internalLinkTargets: [],
    },
    naverLogic: {
      primary: "hybrid",
      label: "질문 완결형",
      reason: "지역성 질문과 실사용 확인 의도를 함께 해결해야 합니다.",
      writingFocus: ["질문 완결", "현장 확인 순서", "과장 없는 상담 흐름"],
      checklist: ["핵심 답변 완결", "광고성 표현 최소화"],
      completenessTarget: 85,
    },
    seriesRole: undefined,
    targetMainKeyword: fixture.expected.promptPrimaryKeyword,
    keywordContract: {
      title: "부평 고유가 피해 지원금 사용처, 전자담배 매장 방문 전 확인할 점",
      articleType: "leaf",
      articleStage: "info_summary",
      searchIntent: "부평 고유가 피해 지원금 사용처 확인과 전자담배 매장 결제 가능 여부를 한 글에서 해결",
      topology: "leaf",
      bodyRole: "질문형 검색의도를 실제 매장 상담 흐름으로 풀어내는 일반 글",
      mainKeyword: fixture.expected.promptPrimaryKeyword,
      subKeywords: fixture.subKeywords,
      bridgeKeywords: [],
      internalLinkAnchors: [],
      forbiddenTerms: ["키워드빌드업", "선행포스팅", "메인포스팅", "SEO 점수", "harness"],
      limitedKeywords: [
        { keyword: fixture.expected.promptPrimaryKeyword, min: 4, max: 7, role: "main" },
        { keyword: fixture.subKeywords[0], min: 1, max: 3, role: "sub" },
        { keyword: fixture.subKeywords[1], min: 1, max: 3, role: "sub" },
      ],
      excludedTopics: ["제품 TOP5 나열", "과장된 매장 홍보"],
      handoffTopics: [],
      differentiationPoints: [
        "지원금 사용처 확인과 매장 결제 가능 여부를 한 흐름으로 설명",
        "정책성 확인과 매장 상담 기준을 함께 제시",
      ],
    },
  };
}

function buildProcessedOutput(text) {
  const wrapped = wrapForNaverMobile(text);
  return {
    finalDraft: text,
    wrapped,
    firstFiveParagraphs: toParagraphs(wrapped).slice(0, 5),
  };
}

async function main() {
  const fixture = readJson(FIXTURE_PATH);
  const sanitized = sanitizeDirectIntent({
    mainKeyword: fixture.mainKeyword,
    subKeywords: fixture.subKeywords,
  });
  const strategy = buildStrategyFromFixture(fixture);
  const payload = buildOpenAIWriterPayloadPreview({
    strategy,
    userId: "mansour-test",
  });

  const previewDocument = {
    testInput: fixture,
    sanitizeDirectIntent: sanitized,
    combinationDebug: classifySearchCombination(fixture.rawInputTitle),
    writerPromptPreview: payload.input[1]?.content ?? "",
    payload,
  };

  writeJsonUtf8(PAYLOAD_PREVIEW_PATH, previewDocument);
  const previewRoundTrip = readFileSync(PAYLOAD_PREVIEW_PATH, "utf8");
  assertIncludes(previewRoundTrip, "부평 고유가 피해 지원금 사용처", "payload preview");
  assertIncludes(previewRoundTrip, "전자담배", "payload preview");
  assertIncludes(previewRoundTrip, "만수르", "payload preview");
  assertNoQuestionCorruption(JSON.stringify(sanitized), "sanitizeDirectIntent");
  assertNoQuestionCorruption(JSON.stringify(strategy.targetSearchCombinations), "targetSearchCombinations");
  assertNoQuestionCorruption(previewDocument.writerPromptPreview, "writer prompt preview");

  if (!process.argv.includes("--call-api")) {
    console.log(
      JSON.stringify(
        {
          payloadPreviewPath: PAYLOAD_PREVIEW_PATH,
          displayIntent: previewDocument.combinationDebug.displayIntent,
          exactInsertionAllowed: previewDocument.combinationDebug.exactInsertionAllowed,
          exactBlockReason: previewDocument.combinationDebug.exactBlockReason,
        },
        null,
        2
      )
    );
    return;
  }

  const rawResponse = await requestOpenAIResponse({
    ...payload,
    signal: AbortSignal.timeout(420_000),
  });
  writeJsonUtf8(RAW_RESPONSE_PATH, rawResponse);

  const responseText = extractOpenAIOutputText(rawResponse);
  if (!responseText) {
    throw new Error("OpenAI raw response에서 output text를 추출하지 못했습니다.");
  }

  const processed = {
    testInput: fixture,
    combinationDebug: previewDocument.combinationDebug,
    keywordDebug: {
      mainKeyword: strategy.keywordContract.mainKeyword,
      subKeywords: strategy.keywordContract.subKeywords,
    },
    ...buildProcessedOutput(responseText),
  };
  writeJsonUtf8(PROCESSED_OUTPUT_PATH, processed);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
