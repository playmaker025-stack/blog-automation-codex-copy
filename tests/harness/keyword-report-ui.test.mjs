import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const {
  getDraftVersionReportForIndex,
  getVisibleSeoKeywordItems,
  isDisplayableSeoKeywordPhrase,
} = await import(new URL("../../components/pipeline/keyword-report-utils.ts", import.meta.url));

test("draftVersionReports는 초안 index 기준으로 매칭되고 다른 초안에 재사용되지 않는다", () => {
  const reports = [
    { label: "1차 초안", keywordReport: { seoKeywordItems: [{ keyword: "부평 전자담배 액상 추천" }] } },
    null,
    { label: "3차 초안", keywordReport: { seoKeywordItems: [{ keyword: "지원금 사용처" }] } },
  ];

  assert.equal(getDraftVersionReportForIndex(reports, 0)?.label, "1차 초안");
  assert.equal(getDraftVersionReportForIndex(reports, 1), null);
  assert.equal(getDraftVersionReportForIndex(reports, 2)?.label, "3차 초안");
});

test("Stage 1 문장형 heading 후보는 기본 표시 대상에서 제외된다", () => {
  assert.equal(
    isDisplayableSeoKeywordPhrase("초보자가 시작 전에 자주 놓치는 체크포인트", "sub", false),
    false
  );
  assert.equal(isDisplayableSeoKeywordPhrase("부평 고유가 피해 지원금", "main", false), true);
  assert.equal(isDisplayableSeoKeywordPhrase("부평 고유가 피해 지원금 사용처", "sub", false), true);
});

test("Stage 1은 seoKeywordItems 중 표시 가능한 main/sub keyword만 노출한다", () => {
  const visible = getVisibleSeoKeywordItems({
    seoKeywordItems: [
      {
        keyword: "부평 고유가 피해 지원금",
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
        keyword: "부평 고유가 피해 지원금 사용처",
        role: "sub",
        exactCount: 4,
        includedCount: 0,
        effectiveCount: 4,
        risk: "ok",
        note: "",
        exactPhraseExclusionApplied: false,
      },
    ],
    contractApplied: false,
  });

  assert.deepEqual(
    visible.map((item) => item.keyword),
    ["부평 고유가 피해 지원금", "부평 고유가 피해 지원금 사용처"]
  );
});

test("workspace-panel은 각 초안 카드 안에서 index 기반 리포트와 fallback을 사용한다", async () => {
  const source = await fs.readFile(path.join(process.cwd(), "components/pipeline/workspace-panel.tsx"), "utf8");

  assert.match(source, /getDraftVersionReportForIndex\(draftVersionReports,\s*index\)/);
  assert.match(source, /키워드 분석 대기 중/);
});

test("keyword-report-sections는 Stage 1에서 tokenItems가 아니라 seoKeywordItems만 사용한다", async () => {
  const source = await fs.readFile(path.join(process.cwd(), "components/pipeline/keyword-report-sections.tsx"), "utf8");

  assert.match(source, /getVisibleSeoKeywordItems\(report\)/);
  assert.doesNotMatch(source, /tokenItems/);
});
