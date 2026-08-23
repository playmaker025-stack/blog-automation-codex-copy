import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  VAPE_DOMAIN_CONTRACT,
  buildGapSearchKeyword,
  buildBroadGapSearchKeyword,
  findCoverageGaps,
} from "../../lib/agents/domain-contract.ts";
import {
  buildExtractionPrompt,
  formatDemandSignals,
  EMPTY_DEMAND,
} from "../../lib/agents/demand-signals.ts";
import {
  isAccountLevelFailure,
  describeExtractionError,
} from "../../lib/agents/demand-error.ts";
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

// 검색어가 발행 이력의 최빈어 하나뿐이면 그 주변만 계속 돈다.
// 미개척 조합을 검색어로 써서 아직 안 다룬 영역의 실수요를 가져온다.
describe("PR29 조합 검색어", () => {
  test("업종어를 앞에 붙인다", () => {
    // "코일 불량"만 검색하면 자동차/기계 코일 글이 섞인다.
    const keyword = buildGapSearchKeyword({ subject: "코일", angle: "불량", kind: "problem" }, C);
    assert.equal(keyword, "전자담배 코일 불량");
  });

  test("이미 업종어가 들어간 소재는 중복해서 붙이지 않는다", () => {
    const keyword = buildGapSearchKeyword(
      { subject: "전자담배", angle: "여름철", kind: "intent" },
      C
    );
    assert.equal(keyword, "전자담배 여름철");
  });

  test("브랜드 조합도 검색어가 된다", () => {
    const keyword = buildGapSearchKeyword({ subject: "말론", angle: "수명", kind: "problem" }, C);
    assert.equal(keyword, "전자담배 말론 수명");
  });

  // "전자담배 리플 추천"처럼 세 단어로 검색하면 결과가 몇 건 안 나온다.
  // 실측에서 조합 검색 5개를 붙였는데 수집이 36건에 그쳤다.
  test("넓은 검색어는 관점을 빼고 소재만 쓴다", () => {
    const gap = { subject: "리플", angle: "추천", kind: "intent" };
    assert.equal(buildGapSearchKeyword(gap, C), "전자담배 리플 추천");
    assert.equal(buildBroadGapSearchKeyword(gap, C), "전자담배 리플");
  });

  test("넓은 검색어도 업종어를 중복해서 붙이지 않는다", () => {
    const gap = { subject: "전자담배", angle: "여름철", kind: "intent" };
    assert.equal(buildBroadGapSearchKeyword(gap, C), "전자담배");
  });

  test("실제 조합에서 검색어를 만들면 전부 업종어를 포함한다", () => {
    const gaps = findCoverageGaps({ contract: C, publishedTitles: [], limit: 20 });
    for (const gap of gaps) {
      const keyword = buildGapSearchKeyword(gap, C);
      assert.ok(keyword.includes("전자담배"), `업종어 누락: ${keyword}`);
    }
  });
});

describe("PR29 추출 입력 상한", () => {
  test("수집이 많아도 추출 프롬프트는 상한을 넘지 않는다", () => {
    const many = Array.from({ length: 200 }, (_, index) => ({
      title: `전자담배 질문 ${index}`,
      description: "",
    }));
    const prompt = buildExtractionPrompt({ items: many, contract: C });
    // 60건 상한이라 61번째는 들어가면 안 된다.
    assert.ok(prompt.includes("전자담배 질문 0"));
    assert.equal(prompt.includes("전자담배 질문 60"), false);
  });
});

// 실측(2026-08-23): 크레딧 소진 상태에서 haiku가 400으로 거부됐는데 sonnet으로
// 폴백해 똑같이 거부됐다. 계정 단위 거부는 모델을 바꿔도 결과가 같다.
// CLAUDE.md [2026-07-03]: 이 증상이 보이면 코드보다 잔액을 먼저 확인할 것.
describe("PR29 계정 단위 실패 처리", () => {
  test("크레딧 소진 메시지를 조치 가능한 문장으로 바꾼다", () => {
    const raw = new Error(
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}'
    );
    const described = describeExtractionError(raw);
    assert.ok(described.includes("크레딧"));
    assert.ok(described.includes("billing"));
    // 원문 JSON을 그대로 노출하지 않는다.
    assert.equal(described.includes('{"type"'), false);
  });

  test("API 키 오류도 구분한다", () => {
    const described = describeExtractionError(new Error("401 invalid x-api-key"));
    assert.ok(described.includes("API 키"));
  });

  test("계정 단위 실패를 식별한다", () => {
    assert.equal(isAccountLevelFailure(Object.assign(new Error("400"), { status: 400 })), true);
    assert.equal(isAccountLevelFailure(new Error("Your credit balance is too low")), true);
    assert.equal(isAccountLevelFailure(new Error("invalid x-api-key")), true);
  });

  test("일시적 오류는 계정 단위로 보지 않는다", () => {
    assert.equal(isAccountLevelFailure(Object.assign(new Error("429"), { status: 429 })), false);
    assert.equal(isAccountLevelFailure(new Error("premature close")), false);
    assert.equal(isAccountLevelFailure(Object.assign(new Error("500"), { status: 500 })), false);
  });

  test("모르는 오류는 원문을 자르되 남긴다", () => {
    const described = describeExtractionError(new Error("x".repeat(500)));
    assert.ok(described.length <= 300);
  });
});
