import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  buildStyleFingerprint,
  extractSentenceEndings,
  extractSignaturePhrases,
  formatStyleFingerprint,
  isUsableFingerprint,
} from "../../lib/agents/style-fingerprint.ts";

// 실제 사용자 a 코퍼스에서 가져온 문장들 (reference-a-01, published-post 발췌 기준)
const USER_A_SAMPLES = [
  "안녕하세요 만수동만수르 입니다. 세상에 액상 종류가 왜이리 많은지 저희만 해도 취급하는 종류가 500종에 육박하니 유저분들은 이 중에서 옥석 가리기가 얼마나 어려울지 말안해도 가늠이 됩니다요",
  "안녕하세요 만수동만수르 입니다. 요즘 도조 오팔이 문의가 많아서 한번 정리해봤습니다. 솔직히 처음엔 그냥 지나쳤어요. 근데 문의가 점점 많아져서 제가 직접 써보고 느낀 점 그대로 적어볼게요",
  "안녕하세요 만수동만수르 입니다. 저처럼 멘솔고자인 사람도 참지 않고 쓸수있는 정도이죠 딱 시원한 느낌 개인적으로는 이런 느낌을 선호하는데 누군가에겐 너무 향이 없고 심심할수 있습니다",
  "안녕하세요 만수동만수르 입니다. 이녀석은 신맛도 살짝 있고 단맛도 있고 과일 자체의 풍미도 적당하게 있습니다. 약간 사탕이나 젤리같은 그런 느낌이라고 보면될거 같아요",
];

// 대조군 — 전형적인 AI 블로그 문체
const GENERIC_SAMPLES = [
  "안녕하세요. 오늘은 전자담배 선택 기준에 대해 알아보겠습니다. 핵심 포인트를 한 번에 정리해드리겠습니다.",
  "안녕하세요. 오늘은 액상 고르는 방법에 대해 알아보겠습니다. 체크포인트를 하나씩 살펴보겠습니다.",
];

describe("PR25 style-fingerprint — 실제 문체 증거 추출", () => {
  test("종결어미를 사용 횟수와 함께 뽑는다", () => {
    const endings = extractSentenceEndings(USER_A_SAMPLES);
    assert.ok(endings.length > 0);
    for (const item of endings) {
      assert.ok(item.count > 0);
      assert.equal(typeof item.ending, "string");
    }
    // 내림차순 정렬 보장
    for (let i = 1; i < endings.length; i += 1) {
      assert.ok(endings[i - 1].count >= endings[i].count);
    }
  });

  test("여러 글에 반복되는 고유 표현을 잡아낸다", () => {
    const phrases = extractSignaturePhrases(USER_A_SAMPLES);
    assert.ok(phrases.length > 0);
    // "만수동만수르 입니다"는 4개 글 전부에 나오는 진짜 지문이다.
    assert.ok(
      phrases.some((phrase) => phrase.includes("만수동만수르")),
      `실제 지문을 못 잡음: ${JSON.stringify(phrases)}`
    );
  });

  test("한 글에만 나오는 주제어는 지문으로 채택하지 않는다", () => {
    const phrases = extractSignaturePhrases(USER_A_SAMPLES);
    // "도조 오팔"은 두 번째 글에만 나오므로 문서 빈도 1 → 제외되어야 한다.
    assert.equal(phrases.some((phrase) => phrase.includes("도조 오팔")), false);
  });

  test("표본이 1개면 지문을 만들지 않는다", () => {
    assert.deepEqual(extractSignaturePhrases([USER_A_SAMPLES[0]]), []);
  });

  test("긴 표현이 채택되면 그 안의 짧은 조각은 버린다", () => {
    const phrases = extractSignaturePhrases(USER_A_SAMPLES);
    for (const phrase of phrases) {
      const containedBy = phrases.filter((other) => other !== phrase && other.includes(phrase));
      assert.equal(containedBy.length, 0, `중복 조각 채택됨: ${phrase}`);
    }
  });

  test("실제 도입/마무리 문장을 원문 그대로 남긴다", () => {
    const fingerprint = buildStyleFingerprint(USER_A_SAMPLES);
    assert.ok(fingerprint.openingLines.length > 0);
    assert.ok(fingerprint.closingLines.length > 0);
    // 형용사 설명이 아니라 실제 문장이어야 한다.
    assert.ok(fingerprint.openingLines[0].includes("안녕하세요"));
  });

  test("사용자가 다르면 지문도 다르다", () => {
    const a = buildStyleFingerprint(USER_A_SAMPLES);
    const generic = buildStyleFingerprint(GENERIC_SAMPLES);
    assert.notDeepEqual(a.signaturePhrases, generic.signaturePhrases);
    assert.notDeepEqual(a.openingLines, generic.openingLines);
  });

  test("빈 입력은 사용 불가 지문이 된다", () => {
    const empty = buildStyleFingerprint([]);
    assert.equal(isUsableFingerprint(empty), false);
    assert.equal(empty.sampleCount, 0);
  });
});

// 실측: 사용자 c/d/e 코퍼스에는 네이버 블로그 UI 텍스트가 섞여 들어와 있었고,
// 필터 전에는 `span.u likeit button 공감`, `네이버 블로그 NAVER 블로그`가 지문 상위를 차지했다.
describe("PR25 수집 노이즈 방어", () => {
  const NOISY_SAMPLES = [
    "2025. 11. 25. 16:47 작성 제목=전자담배 코일 관리법 span.u likeit button 공감 face 슬픔 0 검색 이 블로그에서 검색 첫 댓글을 남겨보세요 네이버 블로그 NAVER 블로그 부평 전자담배 만수르 입니다. 코일은 이렇게 관리합니다",
    "2025. 12. 01. 10:12 작성 제목=액상 고르는 법 span.u likeit button 공감 face 슬픔 0 검색 이 블로그에서 검색 첫 댓글을 남겨보세요 네이버 블로그 NAVER 블로그 부평 전자담배 만수르 입니다. 액상은 이렇게 고릅니다",
  ];

  test("마크업/영문 UI 조각은 지문으로 채택하지 않는다", () => {
    const phrases = extractSignaturePhrases(NOISY_SAMPLES);
    for (const bad of ["span", "likeit", "button", "face", "NAVER"]) {
      assert.equal(
        phrases.some((phrase) => phrase.includes(bad)),
        false,
        `UI 잔재가 지문에 들어감(${bad}): ${JSON.stringify(phrases)}`
      );
    }
  });

  test("한글 UI 문구도 지문으로 채택하지 않는다", () => {
    const phrases = extractSignaturePhrases(NOISY_SAMPLES);
    for (const bad of ["블로그에서", "댓글을", "남겨보세요"]) {
      assert.equal(
        phrases.some((phrase) => phrase.includes(bad)),
        false,
        `한글 UI 문구가 지문에 들어감(${bad}): ${JSON.stringify(phrases)}`
      );
    }
  });

  test("노이즈를 걷어내고 진짜 지문은 남긴다", () => {
    const phrases = extractSignaturePhrases(NOISY_SAMPLES);
    assert.ok(
      phrases.some((phrase) => phrase.includes("만수르")),
      `진짜 지문이 사라짐: ${JSON.stringify(phrases)}`
    );
  });

  test("작성일/제목= 같은 수집 메타는 도입 문장에서 제거된다", () => {
    const fingerprint = buildStyleFingerprint(NOISY_SAMPLES);
    const opening = fingerprint.openingLines[0] ?? "";
    assert.equal(opening.includes("제목="), false);
    assert.equal(/^\d{4}\./.test(opening), false);
  });

  test("숫자만으로 된 조각은 지문이 아니다", () => {
    const phrases = extractSignaturePhrases(NOISY_SAMPLES);
    assert.equal(phrases.some((phrase) => /^[\d\s]+$/.test(phrase)), false);
  });
});

describe("PR25 프롬프트 출력", () => {
  test("지문 블록은 형용사가 아니라 실제 표현과 횟수를 담는다", () => {
    const text = formatStyleFingerprint(buildStyleFingerprint(USER_A_SAMPLES));
    assert.ok(text.includes("문체 지문"));
    assert.ok(/\d+회/.test(text), "사용 횟수가 없음");
    assert.ok(text.includes("만수동만수르"));
  });

  test("지문이 없으면 지어내지 않고 부족하다고 말한다", () => {
    const text = formatStyleFingerprint(null);
    assert.ok(text.includes("표본이 부족"));
    assert.equal(text.includes("친근"), false);
  });
});
