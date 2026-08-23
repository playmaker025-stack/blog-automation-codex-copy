import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  buildDomainAnchors,
  buildDomainVocabulary,
  filterBlockedTopics,
  filterOutsideDomainSignals,
  hasDisallowedLocality,
  hasLandmarkMention,
  hasOutsideDomain,
  isLocalityToken,
  isOnDomainTopic,
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

// 금지어 목록만으로는 계속 샜다. 병원/대출을 막으니 맞춤복/롯데택배가 나왔다.
// 그래서 사용자 기존 글의 어휘로 화이트리스트를 만들어 뒤집었다.
describe("PR26 업종 축 화이트리스트", () => {
  // 어휘가 MIN_DOMAIN_VOCABULARY(20) 미만이면 판정을 건너뛰므로 픽스처를 그 위로 채운다.
  const PUBLISHED = [
    { title: "부평 전자담배 만수르 입문자 기기 추천", description: "입문자가 처음 고를 때 보는 기준", tags: ["전자담배", "기기"] },
    { title: "입호흡 액상 고르는 방법", description: "멘솔 강도와 단맛 기준으로 액상을 고른다", tags: ["액상", "입호흡"] },
    { title: "전자담배 코일 탄맛 원인", description: "코일 수명과 와트 설정에서 오는 탄맛 원인", tags: ["코일"] },
    { title: "만수동 전자담배 매장 방문 안내", description: "매장 상담과 시연 안내", tags: ["매장"] },
    { title: "폐호흡 무화기 세척 주기", description: "무화기 세척", tags: ["폐호흡", "무화기"] },
    { title: "니코틴 농도 단계별 정리", description: "농도 선택", tags: ["니코틴", "농도"] },
    { title: "일회용 전자담배 종류 안내", description: "일회용 라인업", tags: ["일회용", "종류"] },
    { title: "팟 누수 증상 점검 순서", description: "누수 점검", tags: ["팟", "누수"] },
    { title: "배터리 충전 습관 정리", description: "충전 관리", tags: ["배터리", "충전"] },
    { title: "액상 보관 온도 관리", description: "보관 온도", tags: ["보관", "온도"] },
  ];

  const vocabulary = buildDomainVocabulary(PUBLISHED);

  test("업종 앵커는 기존 글에서 유도된다", () => {
    const anchors = buildDomainAnchors(PUBLISHED);
    assert.ok(anchors.includes("전자담배"), `앵커: ${anchors.join(", ")}`);
    // 지역명은 업종 축이 아니다.
    assert.equal(anchors.includes("만수동"), false);
  });

  test("완전한 타업종 주제를 차단한다", () => {
    for (const title of [
      "만수동 맞춤복 잘하는 곳",
      "롯데택배 배송 서비스 이용 방법",
      "부평 이삿짐 센터 비교",
      "인천 반려동물 미용 예약",
    ]) {
      assert.equal(isOnDomainTopic({ title }, vocabulary), false, `차단 실패: ${title}`);
    }
  });

  test("발행 이력이 적은 정상 주제는 막지 않는다", () => {
    // "코일 탄맛"은 상위 앵커에 없지만 어휘에는 있으므로 통과해야 한다.
    assert.equal(isOnDomainTopic({ title: "코일 탄맛 원인과 해결 방법" }, vocabulary), true);
    assert.equal(isOnDomainTopic({ title: "입호흡 기기 관리 순서" }, vocabulary), true);
  });

  test("제목이 애매해도 설명에 업종어가 있으면 통과한다", () => {
    const topic = {
      title: "배터리 오래 쓰는 습관",
      description: "전자담배 기기를 오래 쓰기 위한 충전 습관 정리",
      tags: [],
    };
    assert.equal(isOnDomainTopic(topic, vocabulary), true);
  });

  test("어휘 근거가 부족하면 차단하지 않는다", () => {
    assert.equal(isOnDomainTopic({ title: "아무 주제" }, new Set(["전자담배"])), true);
  });
});

// 지역 축은 블랙리스트라 목록에 없는 지명은 전부 통과했다.
// "인천 송도 포스코타워 전자담배 구매처"가 그렇게 새어나왔다.
describe("PR26 건물·랜드마크 차단", () => {
  test("허용 지역 안이어도 건물명이 붙으면 막는다", () => {
    const title = "인천 송도 포스코타워 전자담배 구매처와 체험 후기";
    assert.equal(hasLandmarkMention(title), true);
    assert.equal(filterBlockedTopics([{ title }]).length, 0);
  });

  test("여러 랜드마크 접미사를 잡는다", () => {
    for (const title of [
      "부평 스퀘어원 전자담배 매장",
      "송도 트리플스트리트 아울렛 전자담배",
      "인천 청라 플라자 전자담배 구매",
      "부평 삼산타워 전자담배 후기",
    ]) {
      assert.equal(hasLandmarkMention(title), true, `랜드마크 미검출: ${title}`);
    }
  });

  // 접미사는 오탐 없는 것만 골랐다. 센터/몰/백화점은 일반 문맥에서도 쓰여 제외했다.
  test("일반 문맥의 단어를 랜드마크로 오인하지 않는다", () => {
    for (const title of [
      "전자담배 서비스센터 문의 방법",
      "온라인 쇼핑몰 구매 시 확인할 것",
      "부평 전자담배 매장 방문 안내",
      "코일 탄맛 원인과 해결",
    ]) {
      assert.equal(hasLandmarkMention(title), false, `오탐: ${title}`);
    }
  });
});

// 지역 축을 블랙리스트에서 화이트리스트로 뒤집었다.
// 전에는 "서울/부산 등이 들어있나"만 봐서 목록에 없는 지명이 전부 통과했다.
describe("PR26 지역 화이트리스트", () => {
  test("허용 목록의 지역은 통과한다", () => {
    for (const title of [
      "만수동 전자담배 매장 안내",
      "구월동 전자담배 액상 추천",
      "부평역 전자담배 방문 안내",
      "남동구 전자담배 기기 후기",
      "송도 전자담배 입문자 기기",
      "인천대입구 전자담배 상담",
    ]) {
      assert.equal(hasDisallowedLocality(title), false, `오탐: ${title}`);
    }
  });

  test("허용 목록에 없는 지역명은 차단한다", () => {
    for (const title of [
      "청량리 전자담배 매장 추천",
      "판교동 전자담배 구매처",
      "학익동 전자담배 액상",
    ]) {
      assert.equal(hasDisallowedLocality(title), true, `차단 실패: ${title}`);
      assert.equal(filterBlockedTopics([{ title }]).length, 0);
    }
  });

  // 2음절 일반어는 접미사 앞이 한 글자라 패턴에 애초에 안 걸린다.
  // 3음절 이상 복합어만 예외 목록으로 막는다.
  test("지역명처럼 생긴 일반어를 지역으로 오인하지 않는다", () => {
    for (const title of [
      "실내 흡연구역 이용 안내",
      "금연구역 표시 확인 방법",
      "기기 오작동 증상 점검",
      "코일 재작동 안 될 때",
      "전자담배 자동 충전 기능",
    ]) {
      assert.equal(hasDisallowedLocality(title), false, `오탐: ${title}`);
    }
  });
});
