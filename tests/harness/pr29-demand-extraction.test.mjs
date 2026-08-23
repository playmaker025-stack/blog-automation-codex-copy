import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { VAPE_DOMAIN_CONTRACT } from "../../lib/agents/domain-contract.ts";
import {
  buildExtractionPrompt,
  formatDemandSignals,
  EMPTY_DEMAND,
} from "../../lib/agents/demand-signals.ts";
import {
  emptyRegistry,
  mergeBrandCandidates,
  withRegisteredBrands,
} from "../../lib/agents/brand-merge.ts";

const C = VAPE_DOMAIN_CONTRACT;

// 오염의 원인은 네이버를 본 것이 아니라 보는 방식이었다.
// 단어 빈도(bag-of-words) 대신 LLM 개체 추출로 바꾼다.
describe("PR29 수요 추출 프롬프트", () => {
  const items = [
    { title: "전자담배 코일 며칠마다 갈아야 하나요", description: "" },
    { title: "디랙스 스미스머신 무게 추천", description: "헬스장 기구" },
  ];

  test("무관한 소재를 버리라고 명시한다", () => {
    const prompt = buildExtractionPrompt({ items, contract: C });
    assert.ok(prompt.includes("헬스기구"));
    assert.ok(prompt.includes("금융상품"));
    assert.ok(prompt.includes("전부 버리세요"));
  });

  test("확실하지 않으면 뽑지 말라고 지시한다", () => {
    const prompt = buildExtractionPrompt({ items, contract: C });
    assert.ok(prompt.includes("확실하지 않으면 뽑지 마세요"));
    assert.ok(prompt.includes("적게 뽑는 편이 낫습니다"));
  });

  test("수집된 글이 번호와 함께 들어간다", () => {
    const prompt = buildExtractionPrompt({ items, contract: C });
    assert.ok(prompt.includes("1. 전자담배 코일 며칠마다 갈아야 하나요"));
  });

  test("HTML 태그를 걷어낸다", () => {
    const prompt = buildExtractionPrompt({
      items: [{ title: "<b>전자담배</b> 액상 추천", description: "" }],
      contract: C,
    });
    assert.equal(prompt.includes("<b>"), false);
  });
});

describe("PR29 수요 신호 출력", () => {
  test("추출된 질문을 우선하라고 지시한다", () => {
    const text = formatDemandSignals({
      questions: [{ question: "코일 며칠마다 갈아야 하나요", subject: "코일" }],
      products: [],
      discardedCount: 3,
      failed: false,
    });
    assert.ok(text.includes("실제 검색 수요"));
    assert.ok(text.includes("코일 며칠마다"));
    assert.ok(text.includes("이 질문에 답하는 주제를 우선하세요"));
  });

  // 추출 실패가 파이프라인을 막으면 안 되고, 없는 자료를 지어내게 해서도 안 된다.
  test("추출 실패 시 지어내지 말라고 명시한다", () => {
    const text = formatDemandSignals(EMPTY_DEMAND);
    assert.ok(text.includes("추출된 질문이 없습니다"));
    assert.ok(text.includes("지어내지 마세요"));
  });
});

describe("PR29 제품명 자동 등록", () => {
  test("새 제품명을 출처와 함께 등록한다", () => {
    const { registry, added } = mergeBrandCandidates({
      registry: emptyRegistry(),
      candidates: [{ name: "베이프온", evidence: "베이프온 신제품 후기" }],
      contract: C,
      now: "2026-08-23T00:00:00.000Z",
    });
    assert.deepEqual(added, ["베이프온"]);
    assert.equal(registry.brands[0].evidence, "베이프온 신제품 후기");
    assert.equal(registry.brands[0].seenCount, 1);
  });

  test("계약에 이미 있는 제품명은 등록하지 않는다", () => {
    const { added } = mergeBrandCandidates({
      registry: emptyRegistry(),
      candidates: [{ name: "말론", evidence: "말론 후기" }],
      contract: C,
    });
    assert.deepEqual(added, []);
  });

  test("다시 나오면 등록 대신 확인 횟수를 올린다", () => {
    const first = mergeBrandCandidates({
      registry: emptyRegistry(),
      candidates: [{ name: "베이프온", evidence: "글 A" }],
      contract: C,
    });
    const second = mergeBrandCandidates({
      registry: first.registry,
      candidates: [{ name: "베이프온", evidence: "글 B" }],
      contract: C,
    });
    assert.deepEqual(second.added, []);
    assert.equal(second.registry.brands[0].seenCount, 2);
  });

  // LLM이 실수로 뽑아도 여기서 막는다.
  test("제품명이 아닌 것은 거른다", () => {
    const { added } = mergeBrandCandidates({
      registry: emptyRegistry(),
      candidates: [
        { name: "전자담배", evidence: "" },
        { name: "부평", evidence: "" },
        { name: "만수동전자담배", evidence: "" },
        { name: "2024", evidence: "" },
        { name: "가", evidence: "" },
        { name: "진짜정말길고이상한이름인데제품명일리가없는것", evidence: "" },
        { name: "코일 자주 갈아야 하나요 라는 질문", evidence: "" },
      ],
      contract: C,
    });
    assert.deepEqual(added, []);
  });

  test("등록부는 계약 위에 얹힌다", () => {
    const { registry } = mergeBrandCandidates({
      registry: emptyRegistry(),
      candidates: [{ name: "베이프온", evidence: "" }],
      contract: C,
    });
    const merged = withRegisteredBrands(C, registry);
    assert.ok(merged.brands.includes("베이프온"));
    assert.ok(merged.brands.includes("말론"), "계약 원본이 유지돼야 함");
    // 원본 계약은 바뀌지 않아야 한다.
    assert.equal(C.brands.includes("베이프온"), false);
  });

  test("등록부가 비어 있으면 계약을 그대로 쓴다", () => {
    assert.deepEqual(withRegisteredBrands(C, emptyRegistry()), C);
  });
});
