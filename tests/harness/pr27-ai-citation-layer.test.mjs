import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { analyzeSerpModule } from "../../lib/agents/seo-analyst-agent.ts";
import {
  buildWriterStructurePlan,
  formatWriterStructureBrief,
} from "../../lib/agents/writer-engine.ts";

const ALL_MODULES = ["ai_briefing", "ai_tab", "clip", "place", "shopping", "blog_view"];

function planFor(mod, title = "전자담배 기기 선택 기준") {
  return buildWriterStructurePlan(analyzeSerpModule({ title, observedSerpModule: mod }));
}

// 목표는 네이버 AI탭 노출이다. 예전에는 ai_briefing에만 인용 유도를 적용하고
// blog_view/place에는 "요약 회피"를 적용했는데, 실측하니 전체 토픽의 59%가
// blog_view/place라서 대부분의 글이 인용되기 어렵게 쓰이고 있었다.
describe("PR27 AI 인용 레이어는 전 모듈 공통", () => {
  test("모든 모듈이 인용 레이어를 갖는다", () => {
    for (const mod of ALL_MODULES) {
      const plan = planFor(mod);
      assert.ok(plan.citationLayer.length > 0, `${mod}에 인용 레이어 없음`);
    }
  });

  test("모든 모듈이 독립 인용 문장 3개를 요구한다", () => {
    for (const mod of ALL_MODULES) {
      const layer = planFor(mod).citationLayer.join("\n");
      assert.ok(layer.includes("독립 문장 3개"), `${mod}: 인용 문장 요구 없음`);
      assert.ok(layer.includes("직접 답변"), `${mod}: 직접 답변 요구 없음`);
    }
  });

  test("모든 모듈이 FAQ와 파싱 가능 구조를 요구한다", () => {
    for (const mod of ALL_MODULES) {
      const layer = planFor(mod).citationLayer.join("\n");
      assert.ok(layer.includes("FAQ"), `${mod}: FAQ 요구 없음`);
      assert.ok(/목록.*단계.*표|파싱/.test(layer), `${mod}: 파싱 구조 요구 없음`);
    }
  });

  test("place도 이제 FAQ를 요구한다 (전략 변경 전에는 불필요였다)", () => {
    const plan = planFor("place", "만수동 전자담배 매장 방문 안내");
    assert.ok(plan.citationLayer.join("\n").includes("FAQ"));
    assert.ok(plan.qaChecklist.some((item) => item.includes("FAQ")));
  });
});

describe("PR27 클릭 방어", () => {
  test("모든 모듈이 본문 전용 정보를 남기도록 지시한다", () => {
    for (const mod of ALL_MODULES) {
      const plan = planFor(mod);
      assert.ok(plan.clickRetention.length > 0, `${mod}에 클릭 방어 없음`);
      assert.ok(
        plan.clickRetention.join("\n").includes("본문에"),
        `${mod}: 본문 전용 정보 지시 없음`
      );
    }
  });

  test("모듈별로 본문에 남길 정보가 다르다", () => {
    const place = planFor("place", "만수동 전자담배 매장 안내").clickRetention.join("|");
    const shopping = planFor("shopping").clickRetention.join("|");
    const blogView = planFor("blog_view").clickRetention.join("|");
    assert.ok(place.includes("영업시간"));
    assert.ok(shopping.includes("재고"));
    assert.ok(blogView.includes("점검 순서"));
  });

  test("인용을 막는 방식이 아니라 정보를 남기는 방식이다", () => {
    for (const mod of ALL_MODULES) {
      const text = planFor(mod).clickRetention.join("\n") + planFor(mod).forbiddenMoves.join("\n");
      assert.equal(text.includes("요약 회피"), false, `${mod}: 인용 억제 지시가 남아 있음`);
    }
  });
});

describe("PR27 AI탭 대응", () => {
  test("ai_tab 모듈이 후속 질문 구조를 요구한다", () => {
    const plan = planFor("ai_tab");
    assert.equal(plan.serpModule, "ai_tab");
    assert.ok(plan.requiredElements.join("\n").includes("후속"));
    assert.ok(plan.requiredSections.some((section) => section.includes("후속 질문")));
  });

  test("인용 타입은 모든 모듈에서 계산된다", () => {
    for (const mod of ALL_MODULES) {
      const analysis = analyzeSerpModule({ title: "전자담배 액상 성분", observedSerpModule: mod });
      assert.ok(analysis.aiBriefingCitationType, `${mod}: 인용 타입 없음`);
      assert.ok(analysis.aiBriefingCitationNote, `${mod}: 인용 근거 없음`);
    }
  });

  test("브리핑에 인용 레이어가 구조보다 먼저 나온다", () => {
    const brief = formatWriterStructureBrief({
      analysis: analyzeSerpModule({ title: "전자담배 액상 성분", observedSerpModule: "place" }),
      plan: planFor("place"),
    });
    assert.ok(brief.includes("AI 인용 레이어"));
    assert.ok(brief.indexOf("AI 인용 레이어") < brief.indexOf("반드시 이 순서의 구조로"));
  });
});
