import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildArticleContract, evaluateStrategyQualityGate } from "../lib/agents/article-contract-utils.ts";
import { sanitizeDirectIntent } from "../lib/agents/direct-intent-utils.ts";
import { wrapForNaverMobile } from "../lib/agents/naver-mobile-wrap.ts";
import { buildOpenAIWriterPayloadPreview } from "../lib/agents/openai-writer-preview.ts";
import { extractOpenAIOutputText, requestOpenAIResponse } from "../lib/openai/responses.ts";
import { classifySearchCombination, sanitizeMainKeywordCandidate } from "../lib/agents/search-combination-utils.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const DEFAULT_FIXTURE_PATH = path.join(ROOT, "tests", "fixtures", "pr2-general-openai-input.json");
const OUTPUT_DIR = path.join(ROOT, "test-results");

function parseArgs(argv) {
  const options = {
    callApi: false,
    fixturePath: DEFAULT_FIXTURE_PATH,
    outputPrefix: "pr2-general-openai",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--call-api") {
      options.callApi = true;
      continue;
    }
    if (arg === "--fixture-path") {
      options.fixturePath = path.resolve(ROOT, argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (arg === "--output-prefix") {
      options.outputPrefix = argv[index + 1] ?? options.outputPrefix;
      index += 1;
    }
  }

  return options;
}

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
    throw new Error(`${label} 검증 실패: '??' 손상 문자가 포함되었습니다.`);
  }
}

function toParagraphs(markdown) {
  return markdown
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function buildOutline(articleRole, mainKeyword) {
  if (articleRole === "problem_solution") {
    return [
      {
        heading: "처음 확인해야 하는 증상과 사용 상황",
        subPoints: ["언제부터 문제가 생겼는지", "같이 바뀐 액상이나 사용 습관이 있는지"],
        contentDirection: "증상이 반복되는 상황을 실제 사용 흐름으로 정리합니다.",
        estimatedParagraphs: 2,
      },
      {
        heading: "원인을 나눠서 보면 더 빨리 좁혀집니다",
        subPoints: ["액상/흡입 습관", "기기 상태", "코일 수명과 보관 상태"],
        contentDirection: `${mainKeyword}의 원인 그룹을 섞지 말고 나눠서 설명합니다.`,
        estimatedParagraphs: 3,
      },
      {
        heading: "지금 바로 점검할 순서와 예방 기준",
        subPoints: ["즉시 점검 항목", "정상/비정상 구분", "다음 교체 시 주의점"],
        contentDirection: "바로 따라 할 수 있는 점검 순서와 예방 기준으로 마무리합니다.",
        estimatedParagraphs: 2,
      },
    ];
  }

  if (articleRole === "prelude") {
    return [
      {
        heading: "방문 전에 가장 먼저 확인해야 할 질문",
        subPoints: ["지원금 사용처 확인", "매장 결제 가능 여부 확인", "현장 문의 전 체크"],
        contentDirection: "현재 글에서 필요한 확인 기준을 먼저 정리합니다.",
        estimatedParagraphs: 2,
      },
      {
        heading: "사용처와 결제 가능 여부가 갈리는 이유",
        subPoints: ["지급수단 차이", "가맹점 상태", "품목 제한 가능성"],
        contentDirection: "과장 없이 결제 가능 여부가 달라지는 조건을 설명합니다.",
        estimatedParagraphs: 2,
      },
      {
        heading: "다음 단계 제품 선택 전에 정리할 기준",
        subPoints: ["방문 전 문의 문장", "현장 확인 순서", "다음 글로 넘길 판단 기준"],
        contentDirection: "현재 글 핵심을 해결한 뒤 다음 메인글로 자연스럽게 handoff합니다.",
        estimatedParagraphs: 2,
      },
    ];
  }

  return [
    {
      heading: "요즘 많이 묻는 질문부터 정리합니다",
      subPoints: ["취향 기준", "기기 궁합", "방문 전 상담 기준"],
      contentDirection: "실제 손님 질문으로 시작하고 왜 기준이 먼저 필요한지 설명합니다.",
      estimatedParagraphs: 2,
    },
    {
      heading: "인기 순위보다 먼저 봐야 할 기준",
      subPoints: ["쿨링감과 단맛", "목넘김과 사용감", "기기와 액상 궁합"],
      contentDirection: `${mainKeyword}을 고를 때 실패를 줄이는 기준을 나눠서 설명합니다.`,
      estimatedParagraphs: 3,
    },
    {
      heading: "방문 전에 이렇게 정리하면 상담이 쉬워집니다",
      subPoints: ["좋아하던 계열", "지금 쓰는 기기", "피하고 싶은 방향"],
      contentDirection: "상담 전에 무엇을 말하면 좋은지 실제 방문 흐름으로 마무리합니다.",
      estimatedParagraphs: 2,
    },
  ];
}

function buildContentTopology(articleRole) {
  if (articleRole === "problem_solution") {
    return {
      kind: "leaf",
      reason: "문제 원인과 점검 순서를 현재 글 안에서 끝내는 문제해결형 글입니다.",
      searchIntent: "문제 원인과 즉시 점검 기준을 빠르게 알고 싶은 상황",
      bodyPlacement: "증상 확인 → 원인 분류 → 즉시 점검 → 예방 기준",
      requiredSections: ["증상 상황", "원인 그룹", "즉시 점검", "예방 기준"],
      internalLinkTargets: [],
    };
  }

  if (articleRole === "prelude") {
    return {
      kind: "leaf",
      reason: "현재 확인 기준을 해결한 뒤 다음 메인글로 넘기는 브릿지 글입니다.",
      searchIntent: "방문 전 확인 기준을 정리하고 다음 단계 제품 선택으로 넘어가려는 상황",
      bodyPlacement: "확인 기준 정리 → 결제 가능 여부 설명 → 다음 단계로 handoff",
      requiredSections: ["실제 질문", "현재 확인 기준", "결제 가능 여부 확인 방법", "handoff 정리"],
      internalLinkTargets: [],
    };
  }

  return {
    kind: "leaf",
    reason: "현재 검색의도를 이 글 안에서 해결하는 일반 글입니다.",
    searchIntent: "방문 전 선택 기준과 상담 기준을 알고 싶은 상황",
    bodyPlacement: "실제 질문 → 선택 기준 → 비교 기준 → 방문 전 상담 기준",
    requiredSections: ["실제 질문", "선택 기준", "기기 궁합", "방문 전 상담 기준"],
    internalLinkTargets: [],
  };
}

function buildNaverLogic(articleRole) {
  if (articleRole === "problem_solution") {
    return {
      primary: "hybrid",
      label: "문제해결형",
      reason: "증상형 검색은 원인과 점검 순서를 동시에 해결해야 만족도가 높습니다.",
      writingFocus: ["원인 구분", "즉시 점검", "예방 기준"],
      checklist: ["주요 원인을 미루지 않기", "과장된 고장 단정 금지"],
      completenessTarget: 88,
    };
  }

  if (articleRole === "prelude") {
    return {
      primary: "hybrid",
      label: "브릿지형",
      reason: "현재 글의 확인 기준을 해결하면서 다음 메인글 주제를 과하게 먹지 않아야 합니다.",
      writingFocus: ["현재 확인 기준 해결", "방문 전 판단 기준", "자연스러운 handoff"],
      checklist: ["다음 글 주제를 과하게 설명하지 않기", "현재 기준 미루지 않기"],
      completenessTarget: 86,
    };
  }

  return {
    primary: "hybrid",
    label: "상담형 일반 글",
    reason: "선택 기준과 상담 흐름을 함께 주는 글이 실제 검색의도와 맞습니다.",
    writingFocus: ["실제 손님 질문", "선택 기준", "기기 궁합", "상담 전 정리"],
    checklist: ["다음 글로 미루지 않기", "인기 순위 나열로 끝내지 않기"],
    completenessTarget: 87,
  };
}

function buildKeywordContract(fixture, sanitized, articleRole) {
  const promptPrimaryKeyword =
    fixture.expected?.promptPrimaryKeyword ||
    sanitized.mainKeyword ||
    sanitizeMainKeywordCandidate(fixture.rawInputTitle) ||
    "";
  const articleStage = articleRole === "prelude" ? "bridge" : articleRole === "problem_solution" ? "problem_resolution" : "info_summary";
  const bodyRole =
    articleRole === "prelude"
      ? "현재 확인 기준을 해결하고 다음 메인글로 자연스럽게 연결하는 브릿지 글"
      : articleRole === "problem_solution"
        ? "문제 원인과 점검 순서를 현재 글 안에서 해결하는 문제해결 글"
        : "현재 검색의도를 상담 흐름으로 끝내는 일반 글";

  return {
    title: fixture.displayTitle,
    articleType: "leaf",
    articleStage,
    searchIntent: fixture.searchIntent,
    topology: "leaf",
    bodyRole,
    mainKeyword: promptPrimaryKeyword,
    subKeywords: sanitized.subKeywords,
    bridgeKeywords: articleRole === "prelude" && fixture.handoffKeyword ? [fixture.handoffKeyword] : [],
    internalLinkAnchors: [],
    forbiddenTerms: ["키워드 계약서", "검색의도", "메인 키워드", "서브 키워드", "SEO 점수", "harness"],
    limitedKeywords: [
      { keyword: promptPrimaryKeyword, min: 3, max: 6, role: "main" },
      ...sanitized.subKeywords.map((keyword) => ({ keyword, min: 1, max: 3, role: "sub" })),
    ],
    excludedTopics: articleRole === "general" ? ["제품 TOP5만 나열", "과장된 매장 홍보"] : [],
    handoffTopics: articleRole === "prelude" && fixture.handoffKeyword ? [fixture.handoffKeyword] : [],
    differentiationPoints: fixture.differentiationPoints ?? [],
  };
}

function buildStrategyFromFixture(fixture) {
  const sanitized = sanitizeDirectIntent({
    mainKeyword: fixture.mainKeyword,
    subKeywords: fixture.subKeywords,
  });
  if (!sanitized) {
    throw new Error("sanitizeDirectIntent 결과가 비어 있습니다.");
  }

  const articleRole = fixture.articleRole ?? (fixture.seriesRole === "prelude" ? "prelude" : "general");
  const title = fixture.displayTitle;
  const longTailClassification = classifySearchCombination(fixture.rawInputTitle);

  if (fixture.expected?.displayIntent && longTailClassification.displayIntent !== fixture.expected.displayIntent) {
    throw new Error(`displayIntent 불일치: '${longTailClassification.displayIntent}'`);
  }
  if (typeof fixture.expected?.exactInsertionAllowed === "boolean" && longTailClassification.exactInsertionAllowed !== fixture.expected.exactInsertionAllowed) {
    throw new Error("exactInsertionAllowed 검증 실패");
  }
  if (fixture.expected?.exactBlockReason && longTailClassification.exactBlockReason !== fixture.expected.exactBlockReason) {
    throw new Error(`exactBlockReason 불일치: '${longTailClassification.exactBlockReason ?? ""}'`);
  }

  const supportClassifications = sanitized.subKeywords.map((keyword) => ({
    phrase: keyword,
    ...classifySearchCombination(keyword),
  }));

  const promptPrimaryKeyword =
    fixture.expected?.promptPrimaryKeyword ||
    sanitized.mainKeyword ||
    sanitizeMainKeywordCandidate(fixture.rawInputTitle) ||
    "";

  const strategy = {
    title,
    outline: buildOutline(articleRole, promptPrimaryKeyword || title),
    keyPoints: fixture.keyPoints ?? [],
    estimatedLength: fixture.estimatedLength ?? 1800,
    tone: fixture.tone ?? "friendly",
    keywords: [promptPrimaryKeyword, ...sanitized.subKeywords].filter(Boolean),
    suggestedSources: [],
    rationale: fixture.rationale,
    targetSearchCombinations: [
      {
        phrase: fixture.rawInputTitle,
        displayIntent: longTailClassification.displayIntent,
        exactInsertionAllowed: longTailClassification.exactInsertionAllowed,
        exactBlockReason: longTailClassification.exactBlockReason,
        role: "mixed",
        priority: "core",
        rationale: "긴 조합은 exact phrase가 아니라 검색의도 신호로만 커버합니다.",
        suggestedPlacement: articleRole === "general" ? "도입부 또는 핵심 설명 문단" : "도입부 또는 확인 기준 문단",
      },
      ...supportClassifications.map((item, index) => ({
        phrase: item.phrase,
        displayIntent: item.displayIntent,
        exactInsertionAllowed: item.exactInsertionAllowed,
        exactBlockReason: item.exactBlockReason,
        role: index === 0 ? "local" : "support",
        priority: "support",
        rationale: "보조 키워드는 질문문이 아니라 설명 문단과 상담 맥락에 분산합니다.",
        suggestedPlacement: "설명 문단 또는 비교 문단",
      })),
    ],
    contentTopology: buildContentTopology(articleRole),
    naverLogic: buildNaverLogic(articleRole),
    seriesRole: fixture.seriesRole ?? undefined,
    targetMainKeyword: promptPrimaryKeyword,
    keywordContract: buildKeywordContract(fixture, sanitized, articleRole),
  };

  const topic = {
    topicId: fixture.topicId ?? "openai-preview-topic",
    title: fixture.rawInputTitle,
    description: fixture.rationale,
    category: fixture.category ?? "전자담배",
    tags: sanitized.subKeywords,
    feasibility: null,
    relatedSources: [],
    status: "draft",
    assignedUserId: fixture.userId ?? "mansour-test",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    seriesRole: fixture.seriesRole ?? undefined,
    targetMainKeyword: fixture.handoffKeyword ?? undefined,
  };

  strategy.articleContract = buildArticleContract({ topic, plan: strategy });
  strategy.strategyQualityGate = evaluateStrategyQualityGate(strategy);

  return { sanitized, strategy };
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
  const options = parseArgs(process.argv.slice(2));
  const fixture = readJson(options.fixturePath);
  const outputPrefix = options.outputPrefix;
  const payloadPreviewPath = path.join(OUTPUT_DIR, `${outputPrefix}-payload.preview.json`);
  const rawResponsePath = path.join(OUTPUT_DIR, `${outputPrefix}-raw-response.json`);
  const processedOutputPath = path.join(OUTPUT_DIR, `${outputPrefix}-draft.processed.json`);

  const { sanitized, strategy } = buildStrategyFromFixture(fixture);
  const payload = buildOpenAIWriterPayloadPreview({
    strategy,
    userId: fixture.userId ?? "mansour-test",
  });

  const previewDocument = {
    testInput: fixture,
    sanitizeDirectIntent: sanitized,
    articleContract: strategy.articleContract,
    strategyQualityGate: strategy.strategyQualityGate,
    combinationDebug: strategy.targetSearchCombinations,
    writerPromptPreview: payload.input[1]?.content ?? "",
    payload,
  };

  writeJsonUtf8(payloadPreviewPath, previewDocument);
  const previewRoundTrip = readFileSync(payloadPreviewPath, "utf8");

  for (const expectedSnippet of fixture.payloadPreviewMustInclude ?? []) {
    assertIncludes(previewRoundTrip, expectedSnippet, "payload preview");
  }
  assertNoQuestionCorruption(JSON.stringify(sanitized), "sanitizeDirectIntent");
  assertNoQuestionCorruption(JSON.stringify(strategy.targetSearchCombinations), "targetSearchCombinations");
  assertNoQuestionCorruption(previewDocument.writerPromptPreview, "writer prompt preview");

  if (!options.callApi) {
    console.log(
      JSON.stringify(
        {
          payloadPreviewPath,
          articleContract: strategy.articleContract,
          strategyQualityGate: strategy.strategyQualityGate,
          targetSearchCombinations: strategy.targetSearchCombinations,
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
  writeJsonUtf8(rawResponsePath, rawResponse);

  const responseText = extractOpenAIOutputText(rawResponse);
  if (!responseText) {
    throw new Error("OpenAI raw response에서 output text를 추출하지 못했습니다.");
  }

  const processed = {
    testInput: fixture,
    articleContract: strategy.articleContract,
    strategyQualityGate: strategy.strategyQualityGate,
    combinationDebug: strategy.targetSearchCombinations,
    keywordDebug: {
      mainKeyword: strategy.keywordContract.mainKeyword,
      subKeywords: strategy.keywordContract.subKeywords,
    },
    ...buildProcessedOutput(responseText),
  };
  writeJsonUtf8(processedOutputPath, processed);

  console.log(
    JSON.stringify(
      {
        payloadPreviewPath,
        rawResponsePath,
        processedOutputPath,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
