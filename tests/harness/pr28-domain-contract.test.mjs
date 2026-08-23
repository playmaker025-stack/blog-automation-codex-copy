import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  VAPE_DOMAIN_CONTRACT,
  buildContractVocabulary,
  formatDomainContract,
  touchesContract,
  sanitizeResearchItems,
  sanitizeResearchTexts,
  sanitizeKeywordResearch,
  findCoverageGaps,
  formatCoverageGaps,
} from "../../lib/agents/domain-contract.ts";

const C = VAPE_DOMAIN_CONTRACT;

// Codex 리뷰 지적: 발행 이력을 도메인 판정 근거로 쓰면 주제 공간이 닫히고
// 한 번 발행된 오염 제목이 영구적으로 업종 증거가 된다. 그래서 계약을 선언형으로 뒀다.
describe("PR28 도메인 계약", () => {
  // 의도어("추천", "사용법")만으로는 업종이 성립하지 않는다.
  // 이걸 허용했더니 "디랙스 스미스머신 사용법"이 통과했다.
  test("의도어만 있는 타업종 문구는 통과하지 못한다", () => {
    assert.equal(touchesContract("디랙스 스미스머신 사용법", C), false);
    assert.equal(touchesContract("스미스머신 추천 후기", C), false);
    assert.equal(touchesContract("전자담배 사용법", C), true);
  });

  test("계약 어휘는 발행 이력과 무관하게 존재한다", () => {
    const vocabulary = buildContractVocabulary(C);
    for (const term of ["전자담배", "액상", "코일", "누수", "입호흡", "만수르"]) {
      assert.ok(vocabulary.has(term), `계약에 없음: ${term}`);
    }
    assert.ok(vocabulary.size > 80, `어휘가 너무 작음: ${vocabulary.size}`);
  });

  test("업종 소재는 계약을 건드린다", () => {
    for (const text of [
      "전자담배 코일 탄맛 원인",
      "입호흡 액상 고르는 법",
      "말론 기기 실사용 후기",
      "만수동 전자담배 매장 방문 안내",
    ]) {
      assert.equal(touchesContract(text, C), true, `계약 미검출: ${text}`);
    }
  });

  // 업종어 없이 의도어만 있는 문구는 어느 업종인지 알 수 없다.
  // "매장"을 주어로 인정하면 "스미스머신 매장 추천"도 통과해버린다.
  test("업종어 없는 모호한 문구는 통과하지 못한다", () => {
    assert.equal(touchesContract("만수동 매장 방문 안내", C), false);
    assert.equal(touchesContract("만수동 전자담배 매장 방문 안내", C), true);
  });

  test("타업종 소재는 계약을 건드리지 않는다", () => {
    for (const text of [
      "디랙스 스미스머신 사용법",
      "공기업 주식 없는 혜택",
      "아시아나 마일리지 전환",
      "토이푸들 분양",
      "인천대교 완공일",
    ]) {
      assert.equal(touchesContract(text, C), false, `오탐: ${text}`);
    }
  });

  test("계약 선언문이 프롬프트에 들어갈 형태로 나온다", () => {
    const text = formatDomainContract(C);
    assert.ok(text.includes("업종 계약"));
    assert.ok(text.includes("전자담배"));
    assert.ok(text.includes("지역명 단독은 주제가 아닙니다"));
    assert.ok(text.includes("브랜드 목록에 없으면"));
  });
});

// Codex가 지적한 가장 큰 우회 경로. 카페/지식인 제목이 원문 그대로 프롬프트에 들어갔다.
describe("PR28 리서치 정화", () => {
  test("카페/지식인 항목에서 타업종 글을 버린다", () => {
    const items = [
      { title: "전자담배 코일 자주 갈아야 하나요", description: "" },
      { title: "스미스머신 무게 추천 좀", description: "헬스장 기구" },
      { title: "입호흡 액상 추천해주세요", description: "" },
      { title: "공기업 주식 배당 언제 나오나요", description: "" },
    ];
    const kept = sanitizeResearchItems(items, C).map((x) => x.title);
    assert.deepEqual(kept, [
      "전자담배 코일 자주 갈아야 하나요",
      "입호흡 액상 추천해주세요",
    ]);
  });

  test("제목이 애매해도 설명이 업종이면 살린다", () => {
    const items = [{ title: "이거 왜 이럴까요", description: "액상이 자꾸 누수됩니다" }];
    assert.equal(sanitizeResearchItems(items, C).length, 1);
  });

  test("자유 텍스트 배열도 정화한다", () => {
    assert.deepEqual(
      sanitizeResearchTexts(["전자담배 액상 추천", "스미스머신 사용법", "코일 교체"], C),
      ["전자담배 액상 추천", "코일 교체"]
    );
  });

  test("키워드 리서치는 자유 텍스트만 정화하고 수치는 보존한다", () => {
    const research = {
      blog: { competition: "high", total: 12345 },
      relatedKeywords: [{ word: "액상" }, { word: "스미스머신" }, { word: "코일" }],
      questionIntents: ["코일 교체 주기", "공기업 주식 배당"],
      communitySignals: ["액상 누수 문의", "토이푸들 분양"],
      longtailSuggestions: ["만수동 전자담배 액상", "만수동 전자담배 스미스머신"],
      summary: { contentAngles: ["액상 관점 설명", "스미스머신 관점 설명"], intentMix: ["정보형 우세"] },
    };
    const out = sanitizeKeywordResearch(research, C);

    assert.deepEqual(out.relatedKeywords.map((x) => x.word), ["액상", "코일"]);
    assert.deepEqual(out.questionIntents, ["코일 교체 주기"]);
    assert.deepEqual(out.communitySignals, ["액상 누수 문의"]);
    // longtail은 오염된 연관어에서 합성된 값이라 필터가 아니라 폐기한다.
    assert.deepEqual(out.longtailSuggestions, []);
    assert.deepEqual(out.summary.contentAngles, ["액상 관점 설명"]);
    // 수치와 무관한 필드는 그대로여야 한다.
    assert.deepEqual(out.blog, { competition: "high", total: 12345 });
    assert.deepEqual(out.summary.intentMix, ["정보형 우세"]);
  });

  test("빈 입력에 안전하다", () => {
    assert.deepEqual(sanitizeResearchItems(undefined, C), []);
    assert.deepEqual(sanitizeResearchTexts(undefined, C), []);
  });
});

// 검색 자유 텍스트를 뺐더니 주제가 단조로워졌다. 소재가 없어서가 아니라
// 어디가 비었는지 알려주는 장치가 없어서였다. 계약을 생성기로도 쓴다.
describe("PR28 커버리지 빈틈 생성기", () => {
  const PUBLISHED = [
    "전자담배 코일 탄맛 원인과 해결",
    "입호흡 액상 추천 정리",
    "전자담배 기기 입문자 추천",
    "액상 보관 온도 관리법",
  ];

  test("이미 다룬 조합은 제안하지 않는다", () => {
    const gaps = findCoverageGaps({ contract: C, publishedTitles: PUBLISHED, limit: 200 });
    const pairs = gaps.map((g) => `${g.subject}×${g.angle}`);
    assert.equal(pairs.includes("코일×탄맛"), false, "이미 쓴 조합이 제안됨");
    assert.equal(pairs.includes("액상×보관"), false, "이미 쓴 조합이 제안됨");
  });

  test("별칭으로 쓴 글도 다룬 것으로 인식한다", () => {
    // "전담 고장"을 쓴 글이 있으면 "전자담배 × 고장"도 다뤄진 것이다.
    const gaps = findCoverageGaps({
      contract: C,
      publishedTitles: ["전담 고장 증상 정리"],
      limit: 500,
    });
    assert.equal(
      gaps.some((g) => g.subject === "전자담배" && g.angle === "고장"),
      false,
      "별칭 표기를 놓침"
    );
  });

  test("한 슬라이스가 여러 소재에 걸친다", () => {
    const gaps = findCoverageGaps({ contract: C, publishedTitles: PUBLISHED, limit: 6 });
    const subjects = new Set(gaps.map((g) => g.subject));
    assert.ok(subjects.size >= 4, `소재가 몰림: ${[...subjects].join(", ")}`);
  });

  // 소재만 교차하면 깊은 구간에서 "전부 × 상담"처럼 관점이 몰린다.
  test("한 슬라이스 안에서 관점도 겹치지 않는다", () => {
    for (const rotation of [0, 40, 120, 400, 900]) {
      const gaps = findCoverageGaps({ contract: C, publishedTitles: PUBLISHED, limit: 6, rotation });
      const angles = new Set(gaps.map((g) => g.angle));
      assert.ok(angles.size >= 5, `관점이 몰림(rotation ${rotation}): ${[...angles].join(", ")}`);
    }
  });

  test("회전값이 다르면 다른 구간이 나온다", () => {
    const a = findCoverageGaps({ contract: C, publishedTitles: PUBLISHED, limit: 6, rotation: 0 });
    const b = findCoverageGaps({ contract: C, publishedTitles: PUBLISHED, limit: 6, rotation: 30 });
    assert.notDeepEqual(
      a.map((g) => `${g.subject}×${g.angle}`),
      b.map((g) => `${g.subject}×${g.angle}`)
    );
  });

  test("같은 회전값이면 같은 결과가 나온다", () => {
    const a = findCoverageGaps({ contract: C, publishedTitles: PUBLISHED, limit: 6, rotation: 7 });
    const b = findCoverageGaps({ contract: C, publishedTitles: PUBLISHED, limit: 6, rotation: 7 });
    assert.deepEqual(a, b);
  });

  test("제안된 조합은 전부 계약 안에 있다", () => {
    const gaps = findCoverageGaps({ contract: C, publishedTitles: PUBLISHED, limit: 40 });
    for (const gap of gaps) {
      assert.equal(touchesContract(gap.subject, C), true, `계약 밖 소재: ${gap.subject}`);
    }
  });

  test("프롬프트 블록이 조합을 나열한다", () => {
    const text = formatCoverageGaps(
      findCoverageGaps({ contract: C, publishedTitles: PUBLISHED, limit: 5 })
    );
    assert.ok(text.includes("아직 다루지 않은 조합"));
    assert.ok(text.includes("×"));
    assert.ok(text.includes("서로 다른 조합을 골라"));
  });

  test("빈 입력에 안전하다", () => {
    assert.deepEqual(findCoverageGaps({ contract: C, publishedTitles: [], limit: 3 }).length, 3);
    assert.ok(formatCoverageGaps([]).includes("계산된 것이 없습니다"));
  });
});
