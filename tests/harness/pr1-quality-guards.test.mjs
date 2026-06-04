import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildOpenAIWriterPayloadPreview } from "../../lib/agents/openai-writer-preview.ts";
import { wrapForNaverMobile } from "../../lib/agents/naver-mobile-wrap.ts";
import {
  EXACT_INSERTION_MAX_LENGTH,
  MAIN_KEYWORD_MAX_LENGTH,
  classifySearchCombination,
  sanitizeMainKeywordCandidate,
} from "../../lib/agents/search-combination-utils.ts";
import { sanitizeDirectIntent } from "../../lib/agents/direct-intent-utils.ts";

const ROOT = process.cwd();
const strategyPlannerSource = readFileSync(
  path.join(ROOT, "lib/agents/strategy-planner.ts"),
  "utf8"
);
const masterWriterSource = readFileSync(
  path.join(ROOT, "lib/agents/master-writer.ts"),
  "utf8"
);
const seoMetricsSource = readFileSync(
  path.join(ROOT, "lib/agents/seo-metrics.ts"),
  "utf8"
);
const fixture = JSON.parse(
  readFileSync(path.join(ROOT, "tests", "fixtures", "pr1-korean-input.json"), "utf8")
);

function buildUtf8SmokeStrategy() {
  const classification = classifySearchCombination(fixture.rawInputTitle);
  return {
    title: "부평 고유가 피해 지원금 사용처, 전자담배 매장 방문 전 확인할 점",
    outline: [
      {
        heading: "방문 전에 많이 묻는 질문부터 확인",
        subPoints: ["지원금 사용처", "매장 결제 가능 여부"],
        contentDirection: "실제 상황으로 시작합니다.",
        estimatedParagraphs: 2,
      },
    ],
    keyPoints: ["지원금 사용처 확인", "전자담배 매장 결제 가능 여부 확인"],
    estimatedLength: 1700,
    tone: "friendly",
    keywords: [fixture.expected.promptPrimaryKeyword, ...fixture.subKeywords],
    suggestedSources: [],
    rationale: "UTF-8 smoke test",
    targetSearchCombinations: [
      {
        phrase: fixture.rawInputTitle,
        displayIntent: classification.displayIntent,
        exactInsertionAllowed: classification.exactInsertionAllowed,
        exactBlockReason: classification.exactBlockReason,
        role: "mixed",
        priority: "core",
        rationale: "긴 조합은 exact phrase 대신 의도로만 사용",
        suggestedPlacement: "도입부",
      },
    ],
    contentTopology: {
      kind: "leaf",
      reason: "일반 글 완결형 테스트",
      searchIntent: "지원금 사용처와 매장 결제 가능 여부 확인",
      bodyPlacement: "직접 답변",
      requiredSections: ["질문 상황", "확인 기준", "마무리"],
      internalLinkTargets: [],
    },
    keywordContract: {
      title: "부평 고유가 피해 지원금 사용처, 전자담배 매장 방문 전 확인할 점",
      articleType: "leaf",
      articleStage: "info_summary",
      searchIntent: "지원금 사용처와 매장 결제 가능 여부를 이 글에서 완결",
      topology: "leaf",
      bodyRole: "질문형 일반 글",
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
      excludedTopics: ["제품 TOP5 나열"],
      handoffTopics: [],
      differentiationPoints: ["지원금 사용처와 매장 결제 가능 여부를 한 흐름으로 설명"],
    },
  };
}

describe("PR1 품질 가드", () => {
  test("mainKeyword 필터는 정상 핵심 검색어는 살리고 긴 direct input은 차단한다", () => {
    const longInput = sanitizeMainKeywordCandidate("부평 고유가 피해 지원금 사용처 전자담배 만수르");
    const normalKeyword = sanitizeMainKeywordCandidate("부평 고유가 피해 지원금");

    assert.equal(longInput, null);
    assert.equal(normalKeyword, "부평 고유가 피해 지원금");
    assert.ok(normalKeyword.length <= MAIN_KEYWORD_MAX_LENGTH);
  });

  test("strategy-planner는 directIntent를 추출 직후 sanitize하고 전 경로에 sanitized 값만 전달한다", () => {
    assert.ok(strategyPlannerSource.includes("const rawDirectIntent = extractDirectKeywordIntent(topic);"));
    assert.ok(strategyPlannerSource.includes("const directIntent = sanitizeDirectIntent(rawDirectIntent);"));
    assert.ok(strategyPlannerSource.includes("buildUserMessage(topic, topicId, userId, directIntent, publicationLearning, params.duplicateModeOverride)"));
    assert.ok(strategyPlannerSource.includes("applyDirectKeywordPriority(plan, directIntent)"));
    assert.ok(strategyPlannerSource.includes("buildTargetSearchCombinations({ topic, plan, directIntent })"));
    assert.ok(strategyPlannerSource.includes("directIntent,\n    })") || strategyPlannerSource.includes("directIntent,\r\n    })"));
  });

  test("buildKeywordContract는 raw topic.title fallback 없이 sanitize된 후보만 사용한다", () => {
    const directKeywordBlockStart = strategyPlannerSource.indexOf("const directMainKeyword =");
    const mainKeywordBlockStart = strategyPlannerSource.indexOf("const mainKeyword =", directKeywordBlockStart);
    const mainKeywordBlock = strategyPlannerSource.slice(mainKeywordBlockStart, mainKeywordBlockStart + 220);

    assert.ok(mainKeywordBlock.includes("directMainKeyword ||"));
    assert.ok(mainKeywordBlock.includes("seriesDetailPrimaryKw ||"));
    assert.ok(mainKeywordBlock.includes("aiMainKeyword ||"));
    assert.ok(mainKeywordBlock.includes("sanitizedPlanKeyword0 ||"));
    assert.ok(mainKeywordBlock.includes("targetMainKeyword ||"));
    assert.ok(mainKeywordBlock.includes('"";'));
    assert.equal(mainKeywordBlock.includes("topic.title"), false);
  });

  test("classifySearchCombination은 긴 조합을 exact insertion 금지로 분류한다", () => {
    const phrase = fixture.rawInputTitle;
    const classification = classifySearchCombination(phrase);

    assert.equal(classification.exactInsertionAllowed, false);
    assert.equal(classification.displayIntent, fixture.expected.displayIntent);
    assert.equal(classification.exactBlockReason, fixture.expected.exactBlockReason);
    assert.ok(phrase.length > EXACT_INSERTION_MAX_LENGTH);
  });

  test("writer는 exactInsertionAllowed=false 조합을 displayIntent 중심으로 노출한다", () => {
    assert.match(masterWriterSource, /const exactAllowed = item\.exactInsertionAllowed !== false;/u);
    assert.match(masterWriterSource, /item\.displayIntent \|\| classifySearchCombination\(item\.phrase\)\.displayIntent/u);
    assert.match(masterWriterSource, /intent signal only/u);
  });

  test("wrapForNaverMobile은 리스트 마커를 유지하고 단어를 중간에 찢지 않는다", () => {
    const wrapped = wrapForNaverMobile("- 전자담배 액상 추천은 인기 순위보다 쿨링감과 단맛 기준을 먼저 봐야 합니다.");
    const lines = wrapped.split("\n");

    assert.match(lines[0], /^- /);
    assert.equal(lines.includes("전"), false);
    assert.equal(lines.includes("자담배"), false);
    assert.ok(lines.length >= 2);
  });

  test("긴 조합은 evaluator에서 exact phrase 삽입 요구로 회귀하지 않는다", () => {
    assert.ok(seoMetricsSource.includes("const exactAllowed = combination.exactInsertionAllowed !== false;"));
    assert.ok(seoMetricsSource.includes("if (exactMatches > 0 && exactAllowed) {"));
    assert.ok(seoMetricsSource.includes('exactAllowed ? `${exactMatches}회 직접 표현` : "직접 표현 강제 없음"'));
    assert.ok(seoMetricsSource.includes('else if (tokenCoverage < 0.6) {'));
    assert.ok(seoMetricsSource.includes('${combination.displayIntent ??'));
    assert.ok(seoMetricsSource.includes("else if (exactAllowed && exactMatches === 0 && tokenCoverage >= 1) {"));
  });

  test("UTF-8 smoke test는 sanitize/조합/prompt/JSON round-trip에서 한글을 보존한다", () => {
    const sanitized = sanitizeDirectIntent({
      mainKeyword: fixture.mainKeyword,
      subKeywords: fixture.subKeywords,
    });
    const strategy = buildUtf8SmokeStrategy();
    const payload = buildOpenAIWriterPayloadPreview({
      strategy,
      userId: "mansour-test",
    });
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "pr1-utf8-"));
    const previewPath = path.join(tempDir, "payload.preview.json");
    const previewDoc = {
      testInput: fixture,
      sanitizeDirectIntent: sanitized,
      targetSearchCombinations: strategy.targetSearchCombinations,
      writerPromptPreview: payload.input[1].content,
    };

    writeFileSync(previewPath, JSON.stringify(previewDoc, null, 2), "utf8");
    const roundTrip = readFileSync(previewPath, "utf8");

    assert.ok(sanitized);
    assert.equal(JSON.stringify(sanitized).includes("??"), false);
    assert.equal(JSON.stringify(strategy.targetSearchCombinations).includes("??"), false);
    assert.equal(payload.input[1].content.includes("??"), false);
    assert.match(payload.input[1].content, /부평 고유가 피해 지원금 사용처 확인 \+ 전자담배 매장 결제 가능 여부 확인/u);
    assert.equal(payload.input[1].content.includes(fixture.rawInputTitle), false);
    assert.match(roundTrip, /부평 고유가 피해 지원금 사용처/u);
    assert.match(roundTrip, /전자담배/u);
    assert.match(roundTrip, /만수르/u);
    assert.equal(roundTrip.includes("??"), false);
  });
});
