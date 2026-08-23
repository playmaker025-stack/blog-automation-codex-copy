import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  filterBlockedTopics,
  filterOutsideDomainSignals,
  hasOutsideDomain,
  isLocalityToken,
} from "../../lib/agents/blog-workflow-policy.ts";

// 실측 배경:
// 대표 리서치 키워드가 "만수동"(지역명 단독)으로 뽑혀서 네이버 검색 결과가 그 지역의
// 병원/대출/부동산 글로 채워졌고, 그 단어가 연관 키워드로 프롬프트에 유입돼
// 글목록에 병원·대출 주제가 생성됐다. 지역 필터는 "인천 안"만 보므로 전부 통과했다.

describe("PR26 타업종 주제 차단", () => {
  test("운영 지역 안이어도 타업종이면 차단한다", () => {
    const topics = [
      { title: "부평 전자담배 입문자 기기 추천" },
      { title: "만수동 병원 어디가 좋을까" },
      { title: "부평 대출 한도 알아보기" },
      { title: "구월동 부동산 시세 정리" },
      { title: "인천 전자담배 액상 고르는 법" },
    ];
    const kept = filterBlockedTopics(topics).map((topic) => topic.title);

    assert.deepEqual(kept, [
      "부평 전자담배 입문자 기기 추천",
      "인천 전자담배 액상 고르는 법",
    ]);
  });

  test("기존 지역 차단과 함께 동작한다", () => {
    const topics = [
      { title: "강남 전자담배 매장 추천" },
      { title: "부평 전자담배 매장 추천" },
    ];
    assert.deepEqual(
      filterBlockedTopics(topics).map((t) => t.title),
      ["부평 전자담배 매장 추천"]
    );
  });

  test("정상 주제는 하나도 걸리지 않는다", () => {
    const topics = [
      { title: "전자담배 코일 탄맛 원인과 해결" },
      { title: "입호흡 폐호흡 차이 정리" },
      { title: "부평역 전자담배 매장 방문 전 확인할 것" },
      { title: "액상 누수 증상별 점검 순서" },
      { title: "만수동 전자담배 만수르 상담 안내" },
    ];
    assert.equal(filterBlockedTopics(topics).length, topics.length);
  });

  test("리서치 신호에서 타업종 조각을 걷어낸다", () => {
    const signals = ["전자담배 액상", "만수동 병원", "코일 교체 시기", "부평 대출", "입호흡 기기"];
    assert.deepEqual(filterOutsideDomainSignals(signals), [
      "전자담배 액상",
      "코일 교체 시기",
      "입호흡 기기",
    ]);
  });

  test("붙여 쓰든 띄어 쓰든 실제 업종어는 잡는다", () => {
    assert.equal(hasOutsideDomain("부평병원 추천"), true);
    assert.equal(hasOutsideDomain("부평 병원 추천"), true);
    assert.equal(hasOutsideDomain("전자담배 기기 추천"), false);
  });

  // 지역 검사와 달리 공백을 제거하면 안 된다. "확대 출시" -> "확대출시"가 "대출"에 걸린다.
  test("다른 단어에 흡수된 우연한 일치는 오탐하지 않는다", () => {
    assert.equal(hasOutsideDomain("신제품 확대 출시 안내"), false);
    assert.equal(hasOutsideDomain("액상 병 원료 이야기"), false);
  });
});

describe("PR26 지역명 단독 토큰 판별", () => {
  test("행정구역/역 접미사를 지역으로 인식한다", () => {
    for (const token of ["만수동", "부평역", "남동구", "인천", "부평", "청천동"]) {
      assert.equal(isLocalityToken(token), true, `${token}을 지역으로 인식 못함`);
    }
  });

  test("업종 용어는 지역으로 오인하지 않는다", () => {
    for (const token of ["전자담배", "액상", "코일", "입호흡", "만수르"]) {
      assert.equal(isLocalityToken(token), false, `${token}을 지역으로 오인함`);
    }
  });

  test("차단 지역도 지역 토큰으로 인식한다", () => {
    assert.equal(isLocalityToken("강남"), true);
    assert.equal(isLocalityToken("서울"), true);
  });
});
