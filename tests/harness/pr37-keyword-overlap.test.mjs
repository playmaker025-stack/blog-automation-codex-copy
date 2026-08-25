import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  countKeywordOccurrences,
  countKeywordOccurrencesExcludingLonger,
} from "../../lib/agents/seo-metrics.ts";

// 실측(2026-08-25): 실제로 쓴 표현 5회가 22회로 집계됐다. 서브 키워드는 5회 이상이면
// 위험이고, 위험 2개 이상이면 전체 재작성이라 틀린 숫자가 글을 두 번 더 쓰게 만들었다.
const BODY = [
  "안녕하세요 부천 전자담배 만수르입니다.",
  "오늘은 부천 전자담배 액상 중에 인기 있는 걸 정리합니다.",
  "부천 전자담배 액상을 고를 때 농도부터 보셔야 합니다.",
  "부천 전자담배 액상은 1% 이하가 기본입니다.",
  "마지막으로 부천 전자담배 액상 추천을 정리하겠습니다.",
].join("\n");

const ALL = ["부천 전자담배 액상", "부천 전자담배", "전자담배 액상", "전자담배", "액상"];

describe("PR37 겹치는 키워드 중복 집계", () => {
  test("가장 긴 키워드는 그대로 센다", () => {
    assert.equal(countKeywordOccurrencesExcludingLonger(BODY, "부천 전자담배 액상", ALL), 4);
  });

  test("긴 키워드 안에 들어간 매치는 빼고 센다", () => {
    // '부천 전자담배'는 5번 나오지만 4번은 '부천 전자담배 액상'의 일부다.
    assert.equal(countKeywordOccurrences(BODY, "부천 전자담배"), 5);
    assert.equal(countKeywordOccurrencesExcludingLonger(BODY, "부천 전자담배", ALL), 1);
  });

  test("단독으로 쓰인 적 없는 하위 키워드는 0이 된다", () => {
    for (const keyword of ["전자담배 액상", "전자담배", "액상"]) {
      assert.equal(countKeywordOccurrencesExcludingLonger(BODY, keyword, ALL), 0, keyword);
    }
  });

  test("합계가 실제 사용 횟수와 맞는다", () => {
    const total = ALL.reduce(
      (sum, k) => sum + countKeywordOccurrencesExcludingLonger(BODY, k, ALL),
      0
    );
    assert.equal(total, 5);
  });
});

describe("PR37 회귀 방지", () => {
  test("겹치는 키워드가 없으면 기존 집계와 같다", () => {
    const body = "전자담배 이야기입니다. 액상 이야기도 합니다. 전자담배 하나 더.";
    const all = ["전자담배", "액상"];
    for (const k of all) {
      assert.equal(
        countKeywordOccurrencesExcludingLonger(body, k, all),
        countKeywordOccurrences(body, k),
        k
      );
    }
  });

  test("자기 자신은 자기를 가리지 않는다", () => {
    assert.equal(countKeywordOccurrencesExcludingLonger(BODY, "부천 전자담배 액상", ["부천 전자담배 액상"]), 4);
  });

  test("빈 키워드는 0", () => {
    assert.equal(countKeywordOccurrencesExcludingLonger(BODY, "   ", ALL), 0);
  });

  test("본문에 없는 키워드는 0", () => {
    assert.equal(countKeywordOccurrencesExcludingLonger(BODY, "코일", ALL), 0);
  });
});
