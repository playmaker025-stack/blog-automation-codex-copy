import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const topicsPage = fs.readFileSync("app/topics/page.tsx", "utf8");
const generatorSource = fs.readFileSync("lib/agents/topic-generator.ts", "utf8");
const routeSource = fs.readFileSync("app/api/topics/generate/route.ts", "utf8");

describe("시리즈물 선행포스팅 설계 UI 연결", () => {
  test("생성 모드 버튼과 입력 필드를 노출한다", () => {
    assert.match(topicsPage, /시리즈물 선행포스팅 설계/);
    assert.match(topicsPage, /placeholder="본편 목표 주제"/);
    assert.match(topicsPage, /placeholder="본편 목표 키워드"/);
    assert.match(topicsPage, /원하는 블로그 자동 추천/);
  });

  test("시리즈 결과 카드를 5개 구조로 렌더링하고 목록 저장과 연결한다", () => {
    assert.match(topicsPage, /seriesWorkflowResult\.seriesPlans\.map/);
    assert.match(topicsPage, /SERIES_ROLE_LABELS/);
    assert.match(topicsPage, /replacementTopicText/);
    assert.match(topicsPage, /seriesWorkflowReady/);
    assert.match(topicsPage, /selectedGenerated\.size/);
  });

  test("시리즈 워크플로우 저장 시 전용 결과를 사용한다", () => {
    assert.match(topicsPage, /generateMode === "series-workflow"/);
    assert.match(topicsPage, /seriesWorkflowResult\?\.generatedTopics/);
    assert.match(topicsPage, /setSeriesWorkflowResult\(json\)/);
  });
});

describe("시리즈물 선행포스팅 설계 플래너", () => {
  test("본편 예약, 예열 분산, 후속글 흐름 문자열을 포함한다", () => {
    assert.match(generatorSource, /본편 목표 키워드가 필요합니다/);
    assert.match(generatorSource, /예열글 1 → 본편/);
    assert.match(generatorSource, /예열글 1\/2\/3 → 본편 → 후속글/);
    assert.match(generatorSource, /본편 → 후속글 \/ 후속글 → 본편/);
  });

  test("예열 3편, 본편 1편, 후속글 1편 역할을 모두 가진다", () => {
    assert.match(generatorSource, /role: "preheat_criteria"/);
    assert.match(generatorSource, /role: "preheat_experience"/);
    assert.match(generatorSource, /role: "preheat_consulting"/);
    assert.match(generatorSource, /role: "main_hub"/);
    assert.match(generatorSource, /role: "followup"/);
  });

  test("API 라우트가 series-workflow 모드를 지원한다", () => {
    assert.match(routeSource, /mode\?: "topics" \| "preposting-series" \| "series-workflow"/);
    assert.match(routeSource, /if \(body\.mode === "series-workflow"\)/);
    assert.match(routeSource, /runSeriesWorkflowPlanner/);
  });
});
