import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildArticleContract, evaluateStrategyQualityGate } from "../../lib/agents/article-contract-utils.ts";
import { buildOpenAIWriterPayloadPreview } from "../../lib/agents/openai-writer-preview.ts";
import { runFinalDraftCheck } from "../../lib/agents/final-draft-check.ts";

const ROOT = process.cwd();
const TARGET_FILES = [
  "lib/agents/openai-writer-preview.ts",
  "lib/agents/article-contract-utils.ts",
  "lib/agents/final-draft-check.ts",
];

const MOJIBAKE_PATTERN = /[\uFFFD\u4E00-\u9FFF]/u;

function makeTopic(overrides = {}) {
  return {
    topicId: "utf8-topic",
    title: "부평 전자담배 액상 추천",
    description: "부평에서 액상을 고르기 전에 맛보다 기준을 먼저 정리하는 글",
    category: "전자담배",
    tags: ["부평 전자담배 액상 추천", "입호흡 액상"],
    feasibility: null,
    relatedSources: [],
    status: "draft",
    assignedUserId: "a",
    createdAt: "2026-05-28T00:00:00.000Z",
    updatedAt: "2026-05-28T00:00:00.000Z",
    ...overrides,
  };
}

function makePlan(overrides = {}) {
  return {
    title: "부평 전자담배 액상 추천, 맛보다 먼저 봐야 할 기준",
    outline: [
      {
        heading: "맛보다 먼저 기준을 잡아야 하는 이유",
        subPoints: ["기기 궁합", "쿨링과 목넘김"],
        contentDirection: "초보자가 액상을 고를 때 먼저 봐야 할 기준을 설명한다.",
        estimatedParagraphs: 2,
      },
    ],
    keyPoints: ["맛 이름보다 기기 궁합", "질문문 안 exact keyword 금지"],
    estimatedLength: 1600,
    tone: "친근한 상담형",
    keywords: ["부평 전자담배 액상 추천", "입호흡 액상"],
    suggestedSources: [],
    rationale: "액상 추천 본문에서 제품 순위보다 선택 기준을 먼저 해결한다.",
    keywordContract: {
      title: "부평 전자담배 액상 추천, 맛보다 먼저 봐야 할 기준",
      articleType: "warmup",
      articleStage: "info_summary",
      searchIntent: "부평에서 전자담배 액상을 고르기 전 기준을 알고 싶은 상황",
      topology: "leaf",
      bodyRole: "액상 선택 기준을 현재 글 안에서 해결한다.",
      mainKeyword: "부평 전자담배 액상 추천",
      subKeywords: ["입호흡 액상"],
      bridgeKeywords: [],
      internalLinkAnchors: [],
      forbiddenTerms: ["선행포스팅", "키워드빌드업", "SEO 점수"],
      limitedKeywords: [
        { keyword: "부평 전자담배 액상 추천", min: 4, max: 7, role: "main" },
        { keyword: "입호흡 액상", min: 1, max: 3, role: "sub" },
      ],
      excludedTopics: ["제품 TOP5 나열"],
      handoffTopics: [],
      differentiationPoints: ["맛 순위보다 선택 기준으로 분리"],
    },
    ...overrides,
  };
}

describe("PR9 Korean UTF-8 guard", () => {
  test("대상 소스 파일에는 대표적인 한글 깨짐 패턴이 남아 있지 않다", () => {
    for (const relativePath of TARGET_FILES) {
      const source = readFileSync(path.join(ROOT, relativePath), "utf8");
      assert.equal(MOJIBAKE_PATTERN.test(source), false, `${relativePath} contains mojibake`);
    }
  });

  test("writer prompt preview는 UTF-8 한글을 round-trip으로 보존한다", () => {
    const topic = makeTopic();
    const plan = makePlan();
    plan.articleContract = buildArticleContract({ topic, plan });
    plan.strategyQualityGate = evaluateStrategyQualityGate({ articleContract: plan.articleContract });

    const payload = buildOpenAIWriterPayloadPreview({ strategy: plan, userId: "a" });
    const promptText = payload.input.map((item) => item.content).join("\n");

    assert.match(promptText, /키워드 계약서/u);
    assert.match(promptText, /부평 전자담배 액상 추천/u);
    assert.match(promptText, /선행포스팅/u);
    assert.equal(MOJIBAKE_PATTERN.test(promptText), false);

    const tempDir = mkdtempSync(path.join(os.tmpdir(), "pr9-utf8-"));
    const previewPath = path.join(tempDir, "writer-prompt-preview.json");
    writeFileSync(previewPath, JSON.stringify({ payload }, null, 2), "utf8");
    const roundTrip = readFileSync(previewPath, "utf8");

    assert.match(roundTrip, /키워드 계약서/u);
    assert.match(roundTrip, /부평 전자담배 액상 추천/u);
    assert.equal(MOJIBAKE_PATTERN.test(roundTrip), false);
  });

  test("finalDraftCheck는 정상 한글 금지 표현을 감지한다", () => {
    const topic = makeTopic();
    const plan = makePlan();
    plan.articleContract = buildArticleContract({ topic, plan });

    const content = [
      "안녕하세요, 만수동만수르입니다.",
      "",
      "오늘은 선행포스팅이라는 말 없이 실제 기준을 설명해야 하지만 일부러 선행포스팅 문구를 넣었습니다.",
      "",
      "\"입호흡 액상 괜찮나요?\"라고 묻는 문장은 exact keyword 검수 대상입니다.",
    ].join("\n");

    const result = runFinalDraftCheck({ title: plan.title, content, strategy: plan });

    assert.equal(result.ok, false);
    assert.ok(result.matchedForbiddenPhrases.includes("선행포스팅"));
    assert.ok(result.blockingReasons.some((reason) => reason.includes("금지 표현 감지: 선행포스팅")));
    assert.ok(result.keywordStuffingFindings.some((finding) => finding.includes("질문문/따옴표 안 exact keyword 사용")));
    assert.equal(MOJIBAKE_PATTERN.test(JSON.stringify(result)), false);
  });
});
