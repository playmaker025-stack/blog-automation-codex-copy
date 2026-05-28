import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const { buildConfirmedSeoKeywords } = await import(new URL("../../lib/agents/confirmed-seo-keywords.ts", import.meta.url));
const { analyzeKeywordUsage, evaluateSeoCompleteness } = await import(new URL("../../lib/agents/seo-metrics.ts", import.meta.url));
const {
  getDraftVersionReportForIndex,
  getVisibleSeoKeywordItems,
} = await import(new URL("../../components/pipeline/keyword-report-utils.ts", import.meta.url));
const { isValidSeoKeyword } = await import(new URL("../../lib/agents/seo-keyword-utils.ts", import.meta.url));

test("각 초안 카드는 자기 index의 키워드 리포트만 사용한다", () => {
  const reports = [
    { label: "1차 초안", keywordReport: { seoKeywordItems: [{ keyword: "부평 전자담배 액상 추천" }] } },
    null,
    { label: "3차 초안", keywordReport: { seoKeywordItems: [{ keyword: "지원금 사용처" }] } },
  ];

  assert.equal(getDraftVersionReportForIndex(reports, 0)?.label, "1차 초안");
  assert.equal(getDraftVersionReportForIndex(reports, 1), null);
  assert.equal(getDraftVersionReportForIndex(reports, 2)?.label, "3차 초안");
});

test("제목형 문장과 heading 문구는 SEO 키워드로 취급하지 않는다", () => {
  assert.equal(isValidSeoKeyword("초보자가 시작 전에 자주 놓치는 체크포인트"), false);
  assert.equal(isValidSeoKeyword("맛보다 먼저 봐야 할 기준"), false);
  assert.equal(isValidSeoKeyword("방문 전 확인해야 할 포인트"), false);
  assert.equal(isValidSeoKeyword("선택 기준을 먼저 잡아야 하는 이유"), false);
  assert.equal(isValidSeoKeyword("처음 고를 때 실패 줄이는 방법"), false);
});

test("직접 입력한 확정 메인/서브 키워드만 Stage 1에 표시한다", () => {
  const confirmed = buildConfirmedSeoKeywords({
    directInput: {
      mainKeyword: "입호흡 전자담배",
      subKeywords: ["전자담배 초보자", "전자담배 처음 시작"],
    },
    selectedPostingTopic: {
      title: "초보자가 시작 전에 자주 놓치는 체크포인트",
      targetKeyword: "초보자가 시작 전에 자주 놓치는 체크포인트",
    },
  });

  assert.equal(confirmed.mainKeyword, "입호흡 전자담배");
  assert.deepEqual(confirmed.subKeywords, ["전자담배 초보자", "전자담배 처음 시작"]);

  const report = analyzeKeywordUsage({
    title: "초보자가 시작 전에 자주 놓치는 체크포인트",
    body: "입호흡 전자담배는 입문자가 먼저 기준을 잡고 보아야 합니다. 전자담배 초보자와 전자담배 처음 시작 사용자가 같이 확인하면 좋습니다.",
    confirmedSeoKeywords: confirmed,
  });

  assert.deepEqual(
    report.seoKeywordItems.map((item) => item.keyword),
    ["입호흡 전자담배", "전자담배 초보자", "전자담배 처음 시작"]
  );
});

test("메인 키워드가 없으면 제목 전체를 Stage 1에 넣지 않는다", () => {
  const confirmed = buildConfirmedSeoKeywords({
    directInput: {
      mainKeyword: "",
      subKeywords: [],
    },
    selectedPostingTopic: {
      title: "초보자가 시작 전에 자주 놓치는 체크포인트",
    },
  });

  assert.equal(confirmed.mainKeyword, null);
  assert.deepEqual(confirmed.subKeywords, []);
  assert.ok(confirmed.rejectedCandidates.some((item) => item.reason.includes("타깃 키워드가 없습니다")));

  const report = analyzeKeywordUsage({
    title: "초보자가 시작 전에 자주 놓치는 체크포인트",
    body: "설명 본문입니다.",
    confirmedSeoKeywords: confirmed,
  });

  assert.deepEqual(report.seoKeywordItems, []);
});

test("final recommendation은 제목형 문장을 메인 키워드로 다시 쓰지 않는다", () => {
  const evaluation = evaluateSeoCompleteness({
    title: "초보자가 시작 전에 자주 놓치는 체크포인트",
    body: "입호흡 전자담배는 초보자가 시작하기 전에 기준을 먼저 잡는 데 도움이 됩니다. 전자담배 초보자라면 흡입감과 관리 난이도를 함께 보세요.",
    confirmedSeoKeywords: {
      mainKeyword: "입호흡 전자담배",
      subKeywords: ["전자담배 초보자"],
      source: "directInput",
      rejectedCandidates: [],
    },
  });

  const joined = [...evaluation.improvements, ...evaluation.keywordReport.recommendations].join("\n");
  assert.match(joined, /입호흡 전자담배/);
  assert.doesNotMatch(joined, /초보자가 시작 전에 자주 놓치는 체크포인트/);
});

test("글 목록 항목에 targetKeyword가 있으면 Stage 1이 그 값을 사용한다", () => {
  const confirmed = buildConfirmedSeoKeywords({
    selectedPostingTopic: {
      title: "부평 전자담배 액상 추천 가이드",
      targetKeyword: "부평 전자담배 액상 추천",
      subKeywords: ["부평 전자담배", "전자담배 액상"],
    },
  });

  assert.equal(confirmed.source, "postingList");
  assert.equal(confirmed.mainKeyword, "부평 전자담배 액상 추천");
  assert.deepEqual(confirmed.subKeywords, ["부평 전자담배", "전자담배 액상"]);
});

test("글 목록 항목에 targetKeyword가 없으면 title을 keyword로 쓰지 않고 경고한다", () => {
  const confirmed = buildConfirmedSeoKeywords({
    selectedPostingTopic: {
      title: "초보자가 시작 전에 자주 놓치는 체크포인트",
    },
  });

  assert.equal(confirmed.source, "none");
  assert.equal(confirmed.mainKeyword, null);
  assert.ok(confirmed.rejectedCandidates.some((item) => item.reason.includes("타깃 키워드가 없습니다")));
});

test("Stage 1 UI는 확정 SEO 키워드 사용량 문구와 직접 입력 경고 문구를 포함한다", async () => {
  const source = await fs.readFile(path.join(process.cwd(), "components/pipeline/keyword-report-sections.tsx"), "utf8");
  const pageSource = await fs.readFile(path.join(process.cwd(), "app/pipeline/page.tsx"), "utf8");

  assert.match(source, /Stage 1\. 확정 SEO 키워드 사용량/);
  assert.match(source, /제목, 소제목, 검색의도 문장은 제외됩니다/);
  assert.match(pageSource, /메인 키워드가 입력되지 않았습니다/);
  assert.match(pageSource, /이 글 목록 항목에 타깃 키워드가 없습니다/);
});

test("workspace-panel은 index 기반 리포트와 Stage 1 fallback을 초안 카드마다 붙인다", async () => {
  const source = await fs.readFile(path.join(process.cwd(), "components/pipeline/workspace-panel.tsx"), "utf8");

  assert.match(source, /getDraftVersionReportForIndex\(draftVersionReports,\s*index\)/);
  assert.match(source, /stage1EmptyMessage=\{stage1EmptyMessage\}/);
});

test("pipeline page는 수정본 검토 요청과 발행 검토에 confirmedSeoKeywords를 전달한다", async () => {
  const source = await fs.readFile(path.join(process.cwd(), "app/pipeline/page.tsx"), "utf8");

  assert.match(source, /confirmedSeoKeywords/);
  assert.doesNotMatch(source, /seoKeywordSource/);
});

test("Stage 1 visible items는 여전히 main/sub만 노출한다", () => {
  const visible = getVisibleSeoKeywordItems({
    seoKeywordItems: [
      {
        keyword: "입호흡 전자담배",
        role: "main",
        exactCount: 2,
        includedCount: 1,
        effectiveCount: 3,
        risk: "ok",
        note: "",
        exactPhraseExclusionApplied: false,
      },
      {
        keyword: "초보자가 시작 전에 자주 놓치는 체크포인트",
        role: "sub",
        exactCount: 1,
        includedCount: 0,
        effectiveCount: 1,
        risk: "under",
        note: "",
        exactPhraseExclusionApplied: false,
      },
      {
        keyword: "전자담배 초보자",
        role: "sub",
        exactCount: 2,
        includedCount: 0,
        effectiveCount: 2,
        risk: "ok",
        note: "",
        exactPhraseExclusionApplied: false,
      },
    ],
    contractApplied: true,
  });

  assert.deepEqual(
    visible.map((item) => item.keyword),
    ["입호흡 전자담배", "전자담배 초보자"]
  );
});
