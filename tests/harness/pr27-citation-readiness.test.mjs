import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateCitationReadiness,
  isCitationBlocking,
  buildCitationRevisionInstructions,
  shouldReviseForCitation,
  CITATION_BLOCKING_THRESHOLD,
} from "../../lib/agents/citation-readiness.ts";

const CITABLE = `입호흡과 폐호흡의 가장 큰 차이는 연기를 입에 머금고 넘기느냐입니다.
연초 대체감을 원하면 입호흡이 맞고 큰 연무량을 원하면 폐호흡이 가깝습니다.
다만 니코틴 농도가 9.8mg 이상이면 같은 방식이어도 만족감이 달라집니다.

처음 고를 때는 출력과 팟 용량을 먼저 봅니다.
입문자는 고정 출력 기기가 실패 확률이 낮습니다.

## 선택 순서

1. 흡입 방식을 정합니다
2. 니코틴 농도를 맞춥니다
3. 기기 출력을 확인합니다

## 자주 묻는 질문

입호흡 기기로 폐호흡을 할 수 있나요?
니코틴 농도는 어떻게 낮추나요?
코일은 며칠마다 교체하나요?
`;

const NOT_CITABLE = `전자담배를 고를 때는 여러 가지를 잘 살펴보는 것이 중요합니다.
관리를 잘 하시면 더 오래 쓸 수 있습니다.
매장에 방문하시면 자세히 안내해 드리겠습니다.
`;

describe("PR27 인용 가능성 검수", () => {
  test("인용 가능한 글은 만점에 가깝다", () => {
    const r = evaluateCitationReadiness(CITABLE);
    assert.equal(r.hasLeadAnswer, true, "도입 완결 문장 미검출");
    assert.equal(r.hasConcreteValue, true, "구체값 미검출");
    assert.equal(r.hasParsableStructure, true, "파싱 구조 미검출");
    assert.equal(r.hasFaq, true, `FAQ 미검출 (${r.faqCount}개)`);
    assert.equal(r.score, 100);
    assert.equal(isCitationBlocking(r), false);
  });

  test("일반론만 있는 글은 발행이 막힌다", () => {
    const r = evaluateCitationReadiness(NOT_CITABLE);
    assert.ok(r.score < CITATION_BLOCKING_THRESHOLD, `점수 ${r.score}`);
    assert.equal(isCitationBlocking(r), true);
    assert.ok(r.findings.length >= 2);
  });

  test("부족한 축마다 재작성 지시가 나온다", () => {
    const instructions = buildCitationRevisionInstructions(evaluateCitationReadiness(NOT_CITABLE));
    const joined = instructions.join("\n");
    assert.ok(joined.includes("AI 인용 가능성"));
    assert.ok(joined.includes("FAQ"));
    assert.ok(joined.includes("파싱") || joined.includes("목록"));
    // 지어내라고 하면 안 된다.
    assert.ok(joined.includes("지어내지는 마세요"));
  });

  // 인용 가능성은 계약 위반이 아니라 품질 축이다. 발행을 영구히 막으면 재작성 라운드를
  // 다 쓴 뒤 정상 초안까지 승인 불가로 남는다. 그래서 차단이 아니라 재작성 압력으로 쓴다.
  test("FAQ가 없으면 발행을 막지는 않지만 재작성을 트리거한다", () => {
    const noFaq = CITABLE.split("## 자주 묻는 질문")[0];
    const r = evaluateCitationReadiness(noFaq);
    assert.equal(r.hasFaq, false);
    assert.ok(r.score >= CITATION_BLOCKING_THRESHOLD, `점수는 통과권이어야 함: ${r.score}`);
    assert.equal(isCitationBlocking(r), false, "품질 축이 발행을 영구 차단하면 안 됨");
    assert.equal(shouldReviseForCitation(r), true, "FAQ 없는데 재작성이 안 걸림");
  });

  test("만점이 아니면 계속 재작성한다", () => {
    assert.equal(shouldReviseForCitation(evaluateCitationReadiness(CITABLE)), false);
    assert.equal(shouldReviseForCitation(evaluateCitationReadiness(NOT_CITABLE)), true);
    assert.equal(shouldReviseForCitation(undefined), false);
  });

  test("클릭 방어 지시가 함께 나간다", () => {
    const joined = buildCitationRevisionInstructions(evaluateCitationReadiness(NOT_CITABLE)).join("\n");
    assert.ok(joined.includes("본문에만"));
  });

  test("FAQ 제목이 없어도 후반부 질문을 인식한다", () => {
    const noHeading = CITABLE.replace("## 자주 묻는 질문", "");
    assert.equal(evaluateCitationReadiness(noHeading).hasFaq, true);
  });

  test("표도 파싱 구조로 인정한다", () => {
    const withTable = `기기별 차이는 출력과 용량에서 갈립니다.
입문자는 고정 출력이 안전합니다.
가격은 39,000원부터 시작합니다.

| 기기 | 가격 | 대상 |
|---|---|---|
| A | 39,000원 | 입문자 |

## FAQ

어떤 기기가 입문자에게 맞나요?
배터리는 얼마나 가나요?
`;
    const r = evaluateCitationReadiness(withTable);
    assert.equal(r.hasParsableStructure, true);
    assert.equal(r.score, 100);
  });
});
