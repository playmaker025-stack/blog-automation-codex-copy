import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  findSpecViolations,
  describeSpecViolation,
  buildProductFactSheet,
  splitSentences,
  emptySpecRegistry,
  findSpec,
} from "../../lib/agents/product-specs.ts";

// 실제 사고에서 쓰인 값 그대로. 사장님 발행글에서 확인된 사실이다.
const REGISTRY = {
  version: 1,
  products: [
    {
      name: "크로스미니6",
      aliases: ["크로스미니 6", "XROS 6 MINI"],
      category: "기기",
      officialName: "VAPORESSO XROS 6 MINI",
      form: "박스형",
      inhaleMode: "자동",
      wattControl: false,
      airflowControl: true,
      batteryMah: 1600,
      podMl: "2ml, 3ml",
      source: "사장님 발행글",
      verifiedAt: "2026-08-24",
    },
    {
      name: "말론S",
      aliases: ["말론 S", "Malone S"],
      category: "기기",
      form: "원통형",
      wattControl: true,
      source: "사장님 발행글",
      verifiedAt: "2026-08-24",
    },
  ],
  updatedAt: "2026-08-24T00:00:00.000Z",
};


// 2026-08-24 사고: 두 기기의 성격이 통째로 뒤바뀐 채 발행 직전까지 갔다.
describe("PR32 사양 모순 검출", () => {
  test("형태가 뒤바뀌면 잡는다", () => {
    const v = findSpecViolations("반대로 말론S는 자동흡입 중심의 콤팩트한 박스형 감성이 강합니다.", REGISTRY);
    const 모순 = v.filter((x) => x.kind === "모순");
    assert.equal(모순.length, 1);
    assert.equal(모순[0].product, "말론S");
    assert.equal(모순[0].attribute, "형태");
    assert.equal(모순[0].registered, "원통형");
    assert.equal(모순[0].claimed, "박스형");
  });

  test("없는 기능을 있다고 하면 잡는다", () => {
    const v = findSpecViolations("크로스미니6는 출력 조절이 가능한 구조라 맛을 맞춰 쓸 수 있습니다.", REGISTRY);
    const 모순 = v.filter((x) => x.kind === "모순");
    assert.equal(모순.length, 1);
    assert.equal(모순[0].registered, "불가");
    assert.equal(모순[0].claimed, "가능");
  });

  test("있는 기능을 없다고 해도 잡는다", () => {
    const v = findSpecViolations("말론S는 복잡한 조절 없이도 안정적으로 맛을 내줍니다.", REGISTRY);
    const 모순 = v.filter((x) => x.kind === "모순");
    assert.equal(모순.length, 1);
    assert.equal(모순[0].product, "말론S");
    assert.equal(모순[0].claimed, "불가");
  });

  test("별칭으로 써도 잡는다", () => {
    const v = findSpecViolations("XROS 6 MINI는 원통형 바디입니다.", REGISTRY);
    assert.equal(v.filter((x) => x.kind === "모순").length, 1);
  });

  test("맞게 쓴 문장은 통과한다", () => {
    const ok = [
      "말론S는 원통형 디자인이라 손에 감기는 맛이 있습니다.",
      "크로스미니6는 자동 흡입이라 입에 물고 빨면 바로 반응합니다.",
      "말론S는 출력 조절이 되니 액상 캐릭터가 더 드러납니다.",
    ].join("\n");
    assert.equal(findSpecViolations(ok, REGISTRY).filter((x) => x.kind === "모순").length, 0);
  });
});

// 오탐은 곧 기능 정지다. 맞는 글을 막는 검사기는 아무도 안 켜둔다.
describe("PR32 오탐 방지", () => {
  test('"버튼 조작 없이"를 버튼식으로 읽지 않는다', () => {
    const v = findSpecViolations("크로스미니6는 버튼 조작 없이 바로 쓰고 싶은 분에게 맞습니다.", REGISTRY);
    assert.equal(v.filter((x) => x.kind === "모순").length, 0);
  });

  test('"출력 조절이 없다"를 출력조절 주장으로 읽지 않는다', () => {
    const v = findSpecViolations("크로스미니6는 출력 조절이 없어서 단순합니다.", REGISTRY);
    assert.equal(v.filter((x) => x.kind === "모순").length, 0);
  });

  // 한국어는 수식이 명사 앞에 온다. "출력 조절까지 써보고 싶은 입문자는 말론S"
  // 처럼 속성이 뒤에 오는 제품 것일 수 있어 귀속이 불안정하다.
  test("한 문장에 등록 제품이 둘이면 모순 판정을 하지 않는다", () => {
    const s =
      "자동흡입 중심의 크로스미니6가 적응이 빠르고 버튼 조작과 출력 조절까지 써보고 싶은 입문자는 말론S가 만족도가 높습니다.";
    assert.equal(findSpecViolations(s, REGISTRY).filter((x) => x.kind === "모순").length, 0);
  });

  test("문장 분리에 실패한 긴 덩어리는 판정하지 않는다", () => {
    const blob = "크로스미니6 " + "가".repeat(220) + " 원통형";
    assert.equal(findSpecViolations(blob, REGISTRY).filter((x) => x.kind === "모순").length, 0);
  });

  test("겸용으로 등록된 제품은 자동/버튼 주장과 충돌하지 않는다", () => {
    const reg = {
      ...REGISTRY,
      products: [{ ...REGISTRY.products[1], inhaleMode: "겸용" }],
    };
    const v = findSpecViolations("말론S는 자동 흡입도 됩니다.\n말론S는 버튼 조작도 가능합니다.", reg);
    assert.equal(v.filter((x) => x.kind === "모순").length, 0);
  });

  test("등록되지 않은 제품 이야기는 모순으로 잡지 않는다", () => {
    const v = findSpecViolations("이 기기는 박스형입니다.", REGISTRY);
    assert.equal(v.filter((x) => x.kind === "모순").length, 0);
  });
});

describe("PR32 미확인 사양 주장", () => {
  test("원장에 값이 없는 항목을 단정하면 경고한다", () => {
    // 말론S는 inhaleMode가 등록돼 있지 않다.
    const v = findSpecViolations("말론S는 자동흡입 중심입니다.", REGISTRY);
    const 미확인 = v.filter((x) => x.kind === "미확인");
    assert.equal(미확인.length, 1);
    assert.equal(미확인[0].attribute, "흡입방식");
  });

  test("등록 안 된 수치 항목을 말하면 경고한다", () => {
    const v = findSpecViolations("말론S는 배터리 1200mAh입니다.", REGISTRY);
    assert.ok(v.some((x) => x.kind === "미확인" && x.attribute === "배터리"));
  });

  test("등록된 수치 항목은 경고하지 않는다", () => {
    const v = findSpecViolations("크로스미니6는 배터리 1600mAh입니다.", REGISTRY);
    assert.equal(v.filter((x) => x.attribute === "배터리").length, 0);
  });

  // 항목 하나를 채운 대가로 다른 항목의 감시가 풀리면 안 된다.
  test("배터리를 등록해도 미등록 와트 범위 주장은 여전히 잡는다", () => {
    const reg = {
      ...REGISTRY,
      products: REGISTRY.products.map((p) =>
        p.name === "말론S" ? { ...p, batteryMah: 2300, podMl: "4ml" } : p
      ),
    };
    const v = findSpecViolations("말론S는 35W까지 출력이 올라갑니다.", reg);
    assert.ok(
      v.some((x) => x.kind === "미확인" && x.attribute === "출력범위"),
      JSON.stringify(v)
    );
    // 배터리는 등록됐으니 조용해야 한다.
    const v2 = findSpecViolations("말론S는 배터리 2300mAh입니다.", reg);
    assert.equal(v2.filter((x) => x.attribute === "배터리").length, 0);
  });

  test("flagUnknown을 끄면 미확인은 보고하지 않는다", () => {
    const v = findSpecViolations("말론S는 자동흡입 중심입니다.", REGISTRY, { flagUnknown: false });
    assert.equal(v.filter((x) => x.kind === "미확인").length, 0);
  });
});

// 프롬프트가 "직접 써봤더니"를 강제하고 있었다. 매장 글에서 신뢰 문제로 직결된다.
describe("PR32 근거 없는 사용 경험", () => {
  test("제품명과 함께 직접 사용 주장이 나오면 잡는다", () => {
    const v = findSpecViolations("직접 써봤더니 말론S는 3일 만에 적응됐습니다.", REGISTRY);
    assert.ok(v.some((x) => x.kind === "근거없는경험" && x.product === "말론S"));
  });

  test("제품명 없는 일반 경험담은 잡지 않는다", () => {
    const v = findSpecViolations("직접 써봤더니 처음 3일이 중요했습니다.", REGISTRY);
    assert.equal(v.filter((x) => x.kind === "근거없는경험").length, 0);
  });
});

// 일회용은 기기와 사양 축이 다르다. 퍼프수·니코틴 농도·액상량으로 판다.
describe("PR32 일회용 사양 축", () => {
  const DISPOSABLE = {
    version: 1,
    products: [
      {
        name: "도조오팔",
        aliases: ["도조 오팔"],
        category: "일회용",
        puffs: 20000,
        liquidMl: "20ml",
        nicotinePercent: 0.98,
        batteryMah: 1000,
        source: "사장님 발행글",
        verifiedAt: "2026-08-24",
      },
      {
        name: "미등록일회용",
        category: "일회용",
        source: "테스트",
        verifiedAt: "2026-08-24",
      },
    ],
    updatedAt: "2026-08-24T00:00:00.000Z",
  };

  test("등록된 퍼프수·농도·액상량은 통과한다", () => {
    const t = "도조오팔은 20000퍼프에 20ml, 니코틴 0.98%입니다.";
    assert.equal(findSpecViolations(t, DISPOSABLE).length, 0);
  });

  test("미등록 일회용의 퍼프수 주장은 잡는다", () => {
    const v = findSpecViolations("미등록일회용은 30000퍼프입니다.", DISPOSABLE);
    assert.ok(v.some((x) => x.kind === "미확인" && x.attribute === "퍼프수"));
  });

  test("미등록 일회용의 니코틴 농도 주장은 잡는다", () => {
    const v = findSpecViolations("미등록일회용은 니코틴 2% 제품입니다.", DISPOSABLE);
    assert.ok(v.some((x) => x.kind === "미확인" && x.attribute === "니코틴농도"));
  });

  // %만 보면 무관한 백분율까지 잡아 정상 글을 막는다.
  test("니코틴과 무관한 백분율은 잡지 않는다", () => {
    const v = findSpecViolations("미등록일회용을 쓴 손님의 80%가 재구매했습니다.", DISPOSABLE);
    assert.equal(v.filter((x) => x.attribute === "니코틴농도").length, 0);
  });

  test("액상 용량은 팟용량과 같은 단위라도 각자 필드로 인정된다", () => {
    const v = findSpecViolations("도조오팔은 20ml가 들어 있습니다.", DISPOSABLE);
    assert.equal(v.filter((x) => x.attribute === "용량").length, 0);
  });
});

describe("PR32 사실 시트", () => {
  test("등록된 값만 적고 모르는 항목은 아예 넣지 않는다", () => {
    const sheet = buildProductFactSheet(REGISTRY);
    assert.ok(sheet.includes("형태 박스형"));
    assert.ok(sheet.includes("배터리 1600mAh"));
    // 말론S는 배터리가 등록돼 있지 않다. "미상" 같은 빈칸을 만들면 모델이 채우려 든다.
    assert.ok(!sheet.includes("미상"));
    assert.ok(!/말론S:[^\n]*배터리/.test(sheet));
  });

  test("모르면 쓰지 말라는 규칙이 함께 들어간다", () => {
    const sheet = buildProductFactSheet(REGISTRY);
    assert.ok(sheet.includes("사실로 단정하지 말"));
    assert.ok(sheet.includes("직접 써봤다"));
  });

  test("원장이 비면 빈 문자열을 준다", () => {
    assert.equal(buildProductFactSheet(emptySpecRegistry()), "");
  });
});

describe("PR32 기타", () => {
  test("빈 원장에서도 터지지 않는다", () => {
    assert.deepEqual(findSpecViolations("말론S는 박스형입니다.", emptySpecRegistry()), []);
  });

  test("네이버 본문의 제로폭 공백과 불릿에서 문장을 끊는다", () => {
    const naver = "크로스미니6가 맞는 분​▪️박스형 그립이 편한 분​▪️원통형이 좋은 분";
    const parts = splitSentences(naver);
    assert.ok(parts.length >= 3, `분리 실패: ${JSON.stringify(parts)}`);
  });

  test("별칭으로 제품을 찾는다", () => {
    assert.equal(findSpec(REGISTRY, "XROS 6 MINI")?.name, "크로스미니6");
    assert.equal(findSpec(REGISTRY, "없는제품"), null);
  });

  test("위반 설명에 등록값과 본문 주장이 함께 나온다", () => {
    const v = findSpecViolations("말론S는 박스형입니다.", REGISTRY).find((x) => x.kind === "모순");
    const msg = describeSpecViolation(v);
    assert.ok(msg.includes("원통형") && msg.includes("박스형"));
  });
});
