import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const {
  getDraftVersionReportForIndex,
  getVisibleSeoKeywordItems,
} = await import(new URL("../../components/pipeline/keyword-report-utils.ts", import.meta.url));
const { isValidSeoKeyword } = await import(new URL("../../lib/agents/seo-keyword-utils.ts", import.meta.url));

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

test("제목형 문장과 heading 문구는 SEO 키워드로 취급하지 않는다", () => {
  assert.equal(isValidSeoKeyword("초보자가 시작 전에 자주 놓치는 체크포인트"), false);
  assert.equal(isValidSeoKeyword("맛보다 먼저 봐야 할 기준"), false);
  assert.equal(isValidSeoKeyword("방문 전 확인해야 할 포인트"), false);
  assert.equal(isValidSeoKeyword("선택 기준을 먼저 잡아야 하는 이유"), false);
  assert.equal(isValidSeoKeyword("처음 고를 때 실패 줄이는 방법"), false);
});

test("확정된 메인/서브 키워드만 Stage 1에 표시한다", () => {
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
      {
        keyword: "부평 전자담배",
        role: "sub",
        exactCount: 4,
        includedCount: 0,
        effectiveCount: 4,
        risk: "ok",
        note: "",
        exactPhraseExclusionApplied: false,
      },
    ],
    contractApplied: true,
  });

  assert.deepEqual(
    visible.map((item) => item.keyword),
    ["입호흡 전자담배", "전자담배 초보자", "부평 전자담배"]
  );
});

test("workspace-panel은 초안 탭에 발행/수정 버튼을 두지 않고 수정본 탭에만 둔다", async () => {
  const source = await fs.readFile(path.join(process.cwd(), "components/pipeline/workspace-panel.tsx"), "utf8");

  assert.match(source, /contentTab === "draft"/);
  assert.match(source, /contentTab === "revision"/);
  assert.match(source, /실제 발행본 진행/);
  assert.doesNotMatch(source, /이 초안으로 발행 진행/);
});

test("pipeline page는 수정본 검토 팝업을 빈 값으로 열고 초안 가져오기를 선택 기능으로 둔다", async () => {
  const source = await fs.readFile(path.join(process.cwd(), "app/pipeline/page.tsx"), "utf8");

  assert.match(source, /const openReviewModal = useCallback\(\(\) => \{\s*setReviewTitle\(""\);\s*setReviewBody\(""\);/s);
  assert.match(source, /초안 가져오기/);
});

test("pipeline page는 실제 발행본 인덱스 반영을 finalDraftCheck로 막지 않는다", async () => {
  const source = await fs.readFile(path.join(process.cwd(), "app/pipeline/page.tsx"), "utf8");
  const publishSection = source.slice(source.indexOf("const publishToIndex"), source.indexOf("const canStart"));

  assert.match(source, /실제 발행본 진행/);
  assert.match(source, /발행 완료 및 인덱스 반영/);
  assert.doesNotMatch(publishSection, /canApproveFinalDraft/);
});

test("workspace-panel은 각 초안 카드에 index 기반 키워드 리포트와 fallback을 붙인다", async () => {
  const source = await fs.readFile(path.join(process.cwd(), "components/pipeline/workspace-panel.tsx"), "utf8");

  assert.match(source, /getDraftVersionReportForIndex\(draftVersionReports,\s*index\)/);
  assert.match(source, /키워드 분석 대기 중/);
});

test("keyword-report-sections는 Stage 1에서 seoKeywordItems만 사용하고 tokenItems는 쓰지 않는다", async () => {
  const source = await fs.readFile(path.join(process.cwd(), "components/pipeline/keyword-report-sections.tsx"), "utf8");

  assert.match(source, /getVisibleSeoKeywordItems\(report\)/);
  assert.doesNotMatch(source, /tokenItems/);
});

test("keyword-report-sections는 exact와 included를 상세 보기에서만 보여준다", async () => {
  const source = await fs.readFile(path.join(process.cwd(), "components/pipeline/keyword-report-sections.tsx"), "utf8");

  assert.match(source, /상세 보기/);
  assert.match(source, /정확일치/);
  assert.match(source, /포함형/);
});

test("seo-metrics는 Stage 1 source로 keywordContract와 seoKeywordSource만 사용한다", async () => {
  const source = await fs.readFile(path.join(process.cwd(), "lib/agents/seo-metrics.ts"), "utf8");

  assert.match(source, /const trackedPhrases = params\.contract/);
  assert.match(source, /params\.source\?\.mainKeyword/);
  assert.match(source, /params\.source\?\.subKeywords/);
  assert.doesNotMatch(source, /targetSearchCombinations.*buildSeoKeywordItems/s);
});
