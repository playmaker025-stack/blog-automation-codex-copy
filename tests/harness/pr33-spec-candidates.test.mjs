import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  emptyCandidateStore,
  candidateKey,
  coerceValue,
  verdictFor,
  mergeCandidates,
  pendingCandidates,
  applyCandidate,
  decideCandidate,
  buildSpecExtractionPrompt,
  parseSpecExtraction,
  CANDIDATE_FIELDS,
} from "../../lib/agents/spec-candidates.ts";

const REGISTRY = {
  version: 1,
  products: [
    {
      name: "크로스미니6",
      aliases: ["XROS 6 MINI"],
      category: "기기",
      batteryMah: 1600,
      wattControl: false,
      form: "박스형",
      source: "사장님 발행글",
      verifiedAt: "2026-08-24",
    },
  ],
  updatedAt: "2026-08-24T00:00:00.000Z",
};

const cand = (o = {}) => ({
  id: "c1",
  product: "크로스미니6",
  field: "batteryMah",
  value: "1600mAh",
  evidence: "배터리 : 1600mAh",
  postId: "post-x",
  extractedAt: "2026-08-24T00:00:00.000Z",
  status: "대기",
  ...o,
});

describe("PR33 값 해석", () => {
  test("숫자에서 단위와 쉼표를 걷어낸다", () => {
    assert.equal(coerceValue("batteryMah", "3500mAh"), 3500);
    assert.equal(coerceValue("puffs", "35,000퍼프"), 35000);
    assert.equal(coerceValue("weightG", "약 95g"), 95);
    assert.equal(coerceValue("nicotinePercent", "0.98%"), 0.98);
  });

  test("불리언은 한국어 표현도 받는다", () => {
    assert.equal(coerceValue("wattControl", "가능"), true);
    assert.equal(coerceValue("wattControl", "true"), true);
    assert.equal(coerceValue("liquidRefillable", "불가"), false);
    assert.equal(coerceValue("batteryRechargeable", "없음"), false);
  });

  // 억지로 넣느니 승인 화면에서 사람이 고치는 게 낫다.
  test("해석 못 하면 null을 준다", () => {
    assert.equal(coerceValue("batteryMah", "넉넉한 편"), null);
    assert.equal(coerceValue("wattControl", "글쎄요"), null);
    assert.equal(coerceValue("puffs", ""), null);
  });

  test("문자열 필드는 원문 표기를 유지한다", () => {
    assert.equal(coerceValue("podMl", "2ml, 3ml"), "2ml, 3ml");
    assert.equal(coerceValue("form", "박스형"), "박스형");
  });
});

describe("PR33 원장 대조", () => {
  test("같은 값이면 동일", () => {
    assert.equal(verdictFor(cand({ value: "1600mAh" }), REGISTRY), "동일");
  });

  test("다른 값이면 충돌", () => {
    assert.equal(verdictFor(cand({ value: "1900mAh" }), REGISTRY), "충돌");
  });

  test("원장에 없는 항목이면 신규", () => {
    assert.equal(verdictFor(cand({ field: "podMl", value: "2ml" }), REGISTRY), "신규");
  });

  test("원장에 없는 제품이면 신규", () => {
    assert.equal(verdictFor(cand({ product: "처음보는기기" }), REGISTRY), "신규");
  });

  test("별칭으로 들어와도 같은 제품으로 본다", () => {
    assert.equal(verdictFor(cand({ product: "XROS 6 MINI", value: "1600mAh" }), REGISTRY), "동일");
  });

  test("불리언도 대조한다", () => {
    assert.equal(verdictFor(cand({ field: "wattControl", value: "불가" }), REGISTRY), "동일");
    assert.equal(verdictFor(cand({ field: "wattControl", value: "가능" }), REGISTRY), "충돌");
  });
});

describe("PR33 대기함 병합", () => {
  test("원장과 같은 값은 대기함에 넣지 않는다", () => {
    const r = mergeCandidates(emptyCandidateStore(), [cand({ value: "1600mAh" })], REGISTRY);
    assert.equal(r.added, 0);
    assert.equal(r.skipped, 1);
  });

  // 승인할 게 없는 항목으로 목록이 불면 사장님이 목록을 안 보게 된다.
  test("충돌은 반드시 넣는다", () => {
    const r = mergeCandidates(emptyCandidateStore(), [cand({ value: "1900mAh" })], REGISTRY);
    assert.equal(r.added, 1);
  });

  test("같은 제품·필드·값은 글이 달라도 한 번만 쌓인다", () => {
    let s = emptyCandidateStore();
    s = mergeCandidates(s, [cand({ id: "a", value: "1900mAh", postId: "p1" })], REGISTRY).store;
    const r = mergeCandidates(s, [cand({ id: "b", value: "1900mAh", postId: "p2" })], REGISTRY);
    assert.equal(r.added, 0);
    assert.equal(r.store.candidates.length, 1);
  });

  test("값이 다르면 별개 후보로 쌓인다", () => {
    let s = emptyCandidateStore();
    s = mergeCandidates(s, [cand({ id: "a", value: "1900mAh" })], REGISTRY).store;
    const r = mergeCandidates(s, [cand({ id: "b", value: "2000mAh" })], REGISTRY);
    assert.equal(r.added, 1);
    assert.equal(r.store.candidates.length, 2);
  });

  test("키는 공백과 대소문자를 무시한다", () => {
    const a = candidateKey({ product: "말론S", field: "podMl", value: "4 ml" });
    const b = candidateKey({ product: "말론S", field: "podMl", value: "4ML" });
    assert.equal(a, b);
  });
});

describe("PR33 대기 목록 정렬", () => {
  test("충돌을 신규보다 먼저 보여준다", () => {
    let s = emptyCandidateStore();
    s = mergeCandidates(
      s,
      [
        cand({ id: "new", field: "podMl", value: "2ml" }),
        cand({ id: "conflict", field: "batteryMah", value: "1900mAh" }),
      ],
      REGISTRY
    ).store;
    const list = pendingCandidates(s, REGISTRY);
    assert.equal(list[0].id, "conflict");
    assert.equal(list[0].verdict, "충돌");
  });

  test("판단이 끝난 후보는 목록에서 빠진다", () => {
    let s = emptyCandidateStore();
    s = mergeCandidates(s, [cand({ id: "x", value: "1900mAh" })], REGISTRY).store;
    s = decideCandidate(s, "x", "거절");
    assert.equal(pendingCandidates(s, REGISTRY).length, 0);
    assert.equal(s.candidates[0].status, "거절");
  });
});

describe("PR33 승인 반영", () => {
  test("기존 제품의 항목을 갱신한다", () => {
    const next = applyCandidate(REGISTRY, cand({ value: "1900mAh" }));
    assert.equal(next.products[0].batteryMah, 1900);
    assert.ok(next.products[0].source.includes("post-x"));
  });

  test("사람이 고친 값이 우선한다", () => {
    const next = applyCandidate(REGISTRY, cand({ value: "1900mAh" }), { overrideValue: "1700mAh" });
    assert.equal(next.products[0].batteryMah, 1700);
  });

  test("원장에 없는 제품은 새로 만든다", () => {
    const next = applyCandidate(REGISTRY, cand({ product: "신제품", value: "2200mAh" }));
    assert.equal(next.products.length, 2);
    const created = next.products.find((p) => p.name === "신제품");
    assert.equal(created.batteryMah, 2200);
  });

  test("해석 못 하는 값은 원장을 건드리지 않는다", () => {
    const next = applyCandidate(REGISTRY, cand({ value: "넉넉한 편" }));
    assert.deepEqual(next, REGISTRY);
  });

  test("원본 원장을 변형하지 않는다", () => {
    const before = REGISTRY.products[0].batteryMah;
    applyCandidate(REGISTRY, cand({ value: "1900mAh" }));
    assert.equal(REGISTRY.products[0].batteryMah, before);
  });
});

// 잘못 뽑힌 값이 조용히 사실이 되면 이 기능이 막으려던 문제를 다시 만든다.
describe("PR33 추출 결과 파싱", () => {
  test("정상 응답을 파싱한다", () => {
    const out = parseSpecExtraction(
      '{"products":[{"name":"말론바","facts":[{"field":"puffs","value":"35000퍼프","evidence":"말론바 스펙이 35000퍼프에"}]}]}'
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].facts[0].field, "puffs");
  });

  test("원장에 없는 필드는 버린다", () => {
    const out = parseSpecExtraction(
      '{"products":[{"name":"X","facts":[{"field":"내맘대로필드","value":"1","evidence":"e"},{"field":"puffs","value":"2","evidence":"e"}]}]}'
    );
    assert.equal(out[0].facts.length, 1);
    assert.equal(out[0].facts[0].field, "puffs");
  });

  test("앞뒤에 설명이 붙어도 JSON만 뽑아낸다", () => {
    const out = parseSpecExtraction(
      '알겠습니다.\n```json\n{"products":[{"name":"A","facts":[{"field":"podMl","value":"4ml","evidence":"e"}]}]}\n```'
    );
    assert.equal(out.length, 1);
  });

  test("깨진 응답은 빈 배열 — 파이프라인을 막지 않는다", () => {
    assert.deepEqual(parseSpecExtraction("죄송합니다 못 찾겠습니다"), []);
    assert.deepEqual(parseSpecExtraction(""), []);
    assert.deepEqual(parseSpecExtraction('{"products":"이상함"}'), []);
  });

  test("사실이 하나도 없는 제품은 버린다", () => {
    assert.deepEqual(parseSpecExtraction('{"products":[{"name":"A","facts":[]}]}'), []);
  });

  test("근거가 없어도 값은 살리되 빈 문자열로 표시한다", () => {
    const out = parseSpecExtraction('{"products":[{"name":"A","facts":[{"field":"puffs","value":"1"}]}]}');
    assert.equal(out[0].facts[0].evidence, "");
  });
});

describe("PR33 추출 프롬프트", () => {
  const prompt = buildSpecExtractionPrompt({
    title: "말론바 리뷰",
    content: "말론바 스펙이 35000퍼프에 액상 용량이 22ml 입니다",
    knownProducts: ["크로스미니6", "말론S"],
  });

  test("추론 금지와 근거 요구가 들어간다", () => {
    assert.ok(prompt.includes("명시적으로 적혀 있는"));
    assert.ok(prompt.includes("추론하거나"));
    assert.ok(prompt.includes("원문 그대로"));
  });

  test("빠뜨리는 편이 낫다고 명시한다", () => {
    assert.ok(prompt.includes("빠뜨리는 것이 잘못 넣는 것보다 낫습니다"));
  });

  test("이미 아는 제품명을 알려줘 표기를 맞추게 한다", () => {
    assert.ok(prompt.includes("크로스미니6"));
    assert.ok(prompt.includes("말론S"));
  });

  test("추출 가능한 필드를 전부 나열한다", () => {
    for (const f of CANDIDATE_FIELDS) assert.ok(prompt.includes(f), `누락: ${f}`);
  });

  test("본문과 제목이 들어간다", () => {
    assert.ok(prompt.includes("말론바 리뷰"));
    assert.ok(prompt.includes("35000퍼프"));
  });
});

// 실측(2026-08-26): 일괄 승인에서 21건이 "해석 못 함"으로 떨어졌는데
// 절반은 사람이 읽으면 명백한 값이었다.
describe("PR40 업종 표현 해석", () => {
  test("팟교체형은 액상 리필 불가다", () => {
    assert.equal(coerceValue("liquidRefillable", "팟교체형"), false);
    assert.equal(coerceValue("liquidRefillable", "액상팟 교체형"), false);
    assert.equal(coerceValue("liquidRefillable", "일회용 전자담배"), false);
  });

  test("충전하며 재사용은 배터리 충전 가능이다", () => {
    assert.equal(coerceValue("batteryRechargeable", "충전하며 재사용하는 방식"), true);
    assert.equal(coerceValue("batteryRechargeable", "충전 하며 사용"), true);
  });

  test("단계·모드가 있으면 출력 조절이 된다", () => {
    assert.equal(coerceValue("wattControl", "3단계"), true);
    assert.equal(coerceValue("wattControl", "출력모드 : 노멀 , 터보"), true);
  });

  test("조절 슬라이드가 있으면 흡입압 조절이 된다", () => {
    assert.equal(
      coerceValue("airflowControl", "흡입압 조절 슬라이드바가 디바이스 하단부에 위치해 있습니다"),
      true
    );
  });

  // 항목이 틀리게 들어온 값까지 억지로 읽으면 원장이 오염된다.
  test("항목과 무관한 값은 여전히 해석하지 않는다", () => {
    assert.equal(coerceValue("liquidRefillable", "액상 탱크 : 20ml"), null);
    assert.equal(coerceValue("airflowControl", "불명"), null);
  });

  test("부정 신호가 긍정보다 먼저다", () => {
    // "충전식 팟 교체형" — 교체형이 최종 의미다.
    assert.equal(coerceValue("liquidRefillable", "충전식 팟 교체형"), false);
  });
});

describe("PR40 숫자 항목 쓰레기 차단", () => {
  test("숫자 없는 값은 후보로 만들지 않는다", () => {
    const out = parseSpecExtraction(
      JSON.stringify({
        products: [
          {
            name: "그래피티2",
            facts: [
              { field: "puffs", value: "사용 가능 퍼프 수", evidence: "e" },
              { field: "batteryMah", value: "배터리 성능 개선", evidence: "e" },
              { field: "weightG", value: "가벼운 무게", evidence: "e" },
              { field: "podMl", value: "2ml", evidence: "e" },
            ],
          },
        ],
      })
    );
    assert.equal(out.length, 1);
    assert.deepEqual(out[0].facts.map((f) => f.field), ["podMl"]);
  });

  test("숫자가 있으면 그대로 통과한다", () => {
    const out = parseSpecExtraction(
      '{"products":[{"name":"A","facts":[{"field":"puffs","value":"35000퍼프","evidence":"e"}]}]}'
    );
    assert.equal(out[0].facts.length, 1);
  });
});
