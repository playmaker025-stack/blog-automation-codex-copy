import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { analyzeSerpModule } from "../../lib/agents/seo-analyst-agent.ts";
import {
  buildWriterStructurePlan,
  formatWriterStructureBrief,
} from "../../lib/agents/writer-engine.ts";

function analyze(title, keywords = []) {
  return analyzeSerpModule({ title, keywords, now: new Date("2026-08-23T00:00:00.000Z") });
}

describe("PR24 SEO analyst — SERP 모듈 판정", () => {
  test("지역명 + 매장 맥락은 place로 분류된다", () => {
    const result = analyze("구월동 전자담배 매장 방문 전 확인할 것", ["구월동 전자담배"]);
    assert.equal(result.serpModule, "place");
    assert.equal(result.recommendedBlogRole, "A");
    assert.equal(result.primarySearchIntent, "방문형");
  });

  test("역 이름은 place_station 하위 타입이 된다", () => {
    const result = analyze("부평역 전자담배 매장 퇴근길 방문");
    assert.equal(result.serpModule, "place");
    assert.equal(result.placeSubtype, "place_station");
  });

  test("지역 맥락이 있는 후기는 clip이 아니라 place_review로 흡수된다", () => {
    const result = analyze("만수동 전자담배 매장 후기");
    assert.equal(result.serpModule, "place");
    assert.equal(result.placeSubtype, "place_review");
  });

  test("지역 없는 체감/후기형은 clip으로 분류된다", () => {
    const result = analyze("입호흡 기기 실사용 후기 언박싱");
    assert.equal(result.serpModule, "clip");
    assert.equal(result.recommendedBlogRole, "E");
  });

  test("증상/원인형은 blog_view 문제해결형이 된다", () => {
    const result = analyze("코일 탄맛 원인과 해결 방법");
    assert.equal(result.serpModule, "blog_view");
    assert.equal(result.primarySearchIntent, "문제해결형");
    assert.equal(result.recommendedBlogRole, "D");
  });

  test("구매 전환 신호는 shopping으로 분류된다", () => {
    const result = analyze("입호흡 기기 가격 최저가 구매");
    assert.equal(result.serpModule, "shopping");
    assert.equal(result.primarySearchIntent, "구매검토형");
  });

  test("직접 확인 없이 예측한 ai_briefing은 확정하지 않는다", () => {
    const result = analyze("입호흡 폐호흡 차이 비교");
    assert.equal(result.predictedSerpModule, "ai_briefing");
    assert.equal(result.serpModuleConfidence, "low");
    assert.equal(result.observedSerpModule, null);
    assert.ok(result.serpModuleReason.includes("확정하지 않았습니다"));
  });

  test("실측값이 있으면 예측을 덮어쓰고 신뢰도가 high가 된다", () => {
    const result = analyzeSerpModule({
      title: "코일 탄맛 원인과 해결 방법",
      observedSerpModule: "ai_briefing",
    });
    assert.equal(result.serpModule, "ai_briefing");
    assert.equal(result.predictedSerpModule, "blog_view");
    assert.equal(result.serpModuleConfidence, "high");
    assert.equal(result.checkDevice, "mobile");
  });

  test("블로그탭은 절대 주 신호가 아니다", () => {
    assert.equal(analyze("아무 키워드").blogTabIsPrimarySignal, false);
  });

  test("비교형 ai_briefing은 seo_required, 정보형은 geo_priority", () => {
    assert.equal(
      analyzeSerpModule({ title: "입문자 기기 추천 베스트", observedSerpModule: "ai_briefing" })
        .aiBriefingCitationType,
      "seo_required"
    );
    assert.equal(
      analyzeSerpModule({ title: "액상 성분과 원리", observedSerpModule: "ai_briefing" })
        .aiBriefingCitationType,
      "geo_priority"
    );
  });
});

describe("PR24 writer engine — 모듈별 구조가 실제로 달라진다", () => {
  test("모듈이 다르면 필수 섹션 구성이 다르다", () => {
    const modules = ["ai_briefing", "clip", "place", "shopping", "blog_view"];
    const sectionSets = modules.map((module) =>
      buildWriterStructurePlan(
        analyzeSerpModule({ title: "테스트 주제", observedSerpModule: module })
      ).requiredSections.join("|")
    );

    assert.equal(new Set(sectionSets).size, modules.length);
  });

  test("ai_briefing은 인용 가능한 독립 문장 3개와 FAQ를 요구한다", () => {
    const plan = buildWriterStructurePlan(
      analyzeSerpModule({ title: "입호흡 폐호흡 차이", observedSerpModule: "ai_briefing" })
    );
    assert.ok(plan.requiredSections.some((section) => section.includes("FAQ")));
    assert.ok(plan.requiredElements.some((item) => item.includes("독립 문장 3개")));
    assert.ok(plan.forbiddenMoves.some((item) => item.includes("총정리")));
  });

  test("place는 FAQ를 요구하지 않고 스마트플레이스 연결을 요구한다", () => {
    const plan = buildWriterStructurePlan(analyze("구월동 전자담배 매장 방문"));
    assert.ok(plan.requiredSections.some((section) => section.includes("스마트플레이스")));
    assert.equal(plan.requiredSections.some((section) => section.includes("FAQ")), false);
  });

  test("blog_view 문제해결형은 증상/원인/해결 구조를 강제한다", () => {
    const plan = buildWriterStructurePlan(analyze("코일 탄맛 원인 해결"));
    assert.deepEqual(plan.requiredSections.slice(0, 3), ["증상", "원인", "직접 점검"]);
  });

  test("사용자 고정 요구사항은 SERP 구조보다 우선한다고 브리핑된다", () => {
    const analysis = analyze("구월동 전자담배 매장 방문");
    const brief = formatWriterStructureBrief({
      analysis,
      plan: buildWriterStructurePlan(analysis),
      articlePlan: {
        title: "추천 5종",
        mainKeyword: "입호흡 추천",
        subKeywords: [],
        searchIntent: "구매검토형",
        requiredEntities: ["유웰 발라리안 맥스프로"],
        lockedRequirements: ["추천 기기 5개를 모두 포함한다."],
        requiredSections: [],
        planVersion: 1,
        updatedAt: "2026-08-23T00:00:00.000Z",
      },
    });

    assert.ok(brief.includes("사용자 요구사항 우선"));
    assert.ok(brief.includes("유웰 발라리안 맥스프로"));
  });

  test("판정값이 없으면 브리핑이 모듈을 단정하지 않는다", () => {
    const brief = formatWriterStructureBrief({});
    assert.ok(brief.includes("SERP 모듈 미판정"));
  });

  test("브리핑은 작업용 용어를 본문에 쓰지 말라고 지시한다", () => {
    const analysis = analyze("코일 탄맛 원인 해결");
    const brief = formatWriterStructureBrief({
      analysis,
      plan: buildWriterStructurePlan(analysis),
    });
    assert.ok(brief.includes("작업용 용어를 본문에 쓰지 마세요"));
  });
});
