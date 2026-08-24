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

// "충전식"이라는 한 단어가 배터리 충전과 액상 리필 둘 다를 가리켜서 글에서
// 자주 뒤섞인다. 도조오팔은 배터리는 충전되지만 액상은 주입 완료 상태다.
describe("PR32 충전과 리필 구분", () => {
  const REG = {
    version: 1,
    products: [
      {
        name: "도조오팔",
        category: "일회용",
        batteryRechargeable: true,
        liquidRefillable: false,
        puffs: 20000,
        liquidMl: "20ml",
        source: "사장님 확인",
        verifiedAt: "2026-08-24",
      },
    ],
    updatedAt: "2026-08-24T00:00:00.000Z",
  };

  test("배터리 충전이 된다는 서술은 통과한다", () => {
    const v = findSpecViolations("도조오팔은 배터리를 충전해서 씁니다.", REG);
    assert.equal(v.filter((x) => x.kind === "모순").length, 0);
  });

  test("충전이 안 된다고 하면 잡는다", () => {
    const v = findSpecViolations("도조오팔은 충전이 안 되는 제품입니다.", REG);
    const 모순 = v.filter((x) => x.kind === "모순" && x.attribute === "배터리충전");
    assert.equal(모순.length, 1);
    assert.equal(모순[0].registered, "가능");
  });

  // 이게 제일 위험한 오류다. 배터리가 충전되니 액상도 채워 쓴다고 착각하기 쉽다.
  test("액상을 리필해 쓴다고 하면 잡는다", () => {
    const v = findSpecViolations("도조오팔은 액상을 리필해서 계속 쓸 수 있습니다.", REG);
    const 모순 = v.filter((x) => x.kind === "모순" && x.attribute === "액상리필");
    assert.equal(모순.length, 1);
    assert.equal(모순[0].registered, "불가");
  });

  test("다 쓰면 버린다는 서술은 통과한다", () => {
    const v = findSpecViolations("도조오팔은 다 쓰면 버리는 일회용입니다.", REG);
    assert.equal(v.filter((x) => x.kind === "모순").length, 0);
  });

  // 한 문장이 두 축을 동시에 주장할 수 있다. 앞 축에서 멈추면 뒤를 놓친다.
  test("한 문장에서 충전과 리필을 각각 판정한다", () => {
    const v = findSpecViolations("도조오팔은 배터리를 충전하고 액상도 리필해서 씁니다.", REG);
    const attrs = v.filter((x) => x.kind === "모순").map((x) => x.attribute);
    assert.deepEqual(attrs, ["액상리필"], JSON.stringify(v));
  });
});

// 격발 방식(자동/버튼)과 흡입 방식(입호흡/폐호흡)은 다른 축이다.
// 마이팟프로를 누수 글의 "오토드로우+버튼"만 보고 넣었다가 정작 간판인
// "입·폐호흡 모두 가능"을 놓칠 뻔했다.
describe("PR32 입호흡·폐호흡 축", () => {
  const REG = {
    version: 1,
    products: [
      {
        name: "젤로맥스",
        category: "기기",
        drawStyle: "입호흡",
        inhaleMode: "겸용",
        source: "사장님 발행글",
        verifiedAt: "2026-08-24",
      },
      {
        name: "마이팟프로",
        category: "기기",
        drawStyle: "겸용",
        inhaleMode: "겸용",
        source: "사장님 발행글",
        verifiedAt: "2026-08-24",
      },
    ],
    updatedAt: "2026-08-24T00:00:00.000Z",
  };

  test("입호흡 전용을 폐호흡이라 하면 잡는다", () => {
    const v = findSpecViolations("젤로맥스는 폐호흡 기기입니다.", REG);
    const 모순 = v.filter((x) => x.kind === "모순" && x.attribute === "입폐호흡");
    assert.equal(모순.length, 1);
    assert.equal(모순[0].registered, "입호흡");
  });

  test("맞게 쓴 입호흡 서술은 통과한다", () => {
    const v = findSpecViolations("젤로맥스는 입호흡 팟 디바이스입니다.", REG);
    assert.equal(v.filter((x) => x.kind === "모순").length, 0);
  });

  test("겸용 기기는 입호흡·폐호흡 어느 쪽 서술도 통과한다", () => {
    const a = findSpecViolations("마이팟프로는 폐호흡도 가능합니다.", REG);
    const b = findSpecViolations("마이팟프로는 입호흡으로 쓸 수 있습니다.", REG);
    assert.equal(a.filter((x) => x.kind === "모순").length, 0);
    assert.equal(b.filter((x) => x.kind === "모순").length, 0);
  });

  // 두 축이 각각 판정돼야 한다. 하나로 뭉치면 이 문장에서 오탐이 난다.
  test("격발 방식과 흡입 방식을 섞지 않는다", () => {
    const v = findSpecViolations("젤로맥스는 버튼 조작이 되는 입호흡 기기입니다.", REG);
    assert.equal(v.filter((x) => x.kind === "모순").length, 0, JSON.stringify(v));
  });
});

// 제품 사양표로는 담을 수 없는 층. "고농도"를 5%로 못 박으면 틀린 글이 된다.
describe("PR32 업종 용어 규칙", () => {
  test("domainNotes가 사실 시트 맨 앞에 들어간다", () => {
    const reg = {
      version: 1,
      products: [
        { name: "테스트기기", category: "기기", form: "박스형", source: "s", verifiedAt: "2026-08-24" },
      ],
      domainNotes: ["니코틴 1%가 기본 농도, 2% 이상이 고농도다."],
      updatedAt: "2026-08-24T00:00:00.000Z",
    };
    const sheet = buildProductFactSheet(reg);
    assert.ok(sheet.includes("업종 용어와 단위"));
    assert.ok(sheet.includes("2% 이상이 고농도"));
    assert.ok(sheet.indexOf("업종 용어와 단위") < sheet.indexOf("확인된 제품 사양"));
  });

  test("제품이 없어도 용어 규칙만으로 시트를 만든다", () => {
    const reg = {
      version: 1,
      products: [],
      domainNotes: ["mAh는 배터리 용량 단위다."],
      updatedAt: "2026-08-24T00:00:00.000Z",
    };
    assert.ok(buildProductFactSheet(reg).includes("mAh는 배터리 용량"));
  });

  test("제품도 규칙도 없으면 빈 문자열", () => {
    assert.equal(buildProductFactSheet(emptySpecRegistry()), "");
  });
});

// 숫자가 아니라 등급어로 틀리는 경우가 따로 있다. 0.98%짜리를 "고농도"라고
// 쓰면 손님이 훨씬 센 걸 기대하고 산다. 기준은 1% 이하가 기본, 초과가 고농도.
describe("PR32 니코틴 등급어", () => {
  const REG = {
    version: 1,
    products: [
      { name: "도조오팔", category: "일회용", nicotinePercent: 0.98, source: "s", verifiedAt: "2026-08-24" },
      { name: "센거", category: "일회용", nicotinePercent: 5, source: "s", verifiedAt: "2026-08-24" },
      { name: "경계값", category: "일회용", nicotinePercent: 1, source: "s", verifiedAt: "2026-08-24" },
    ],
    updatedAt: "2026-08-24T00:00:00.000Z",
  };

  test("기본 농도 제품을 고농도라 하면 잡는다", () => {
    const v = findSpecViolations("도조오팔은 고농도라 목넘김이 묵직합니다.", REG);
    const 모순 = v.filter((x) => x.kind === "모순" && x.attribute === "니코틴등급");
    assert.equal(모순.length, 1);
    assert.equal(모순[0].claimed, "고농도");
  });

  test("고농도 제품을 기본 농도라 하면 잡는다", () => {
    const v = findSpecViolations("센거는 기본 농도 제품입니다.", REG);
    assert.ok(v.some((x) => x.kind === "모순" && x.attribute === "니코틴등급"));
  });

  test("맞게 쓴 등급어는 통과한다", () => {
    const a = findSpecViolations("도조오팔은 일반 농도입니다.", REG);
    const b = findSpecViolations("센거는 고농도 제품입니다.", REG);
    assert.equal(a.filter((x) => x.attribute === "니코틴등급").length, 0);
    assert.equal(b.filter((x) => x.attribute === "니코틴등급").length, 0);
  });

  // 경계는 1%다. 1%는 기본, 1%를 넘어야 고농도.
  test("정확히 1%는 기본 농도로 본다", () => {
    const v = findSpecViolations("경계값은 고농도입니다.", REG);
    assert.ok(v.some((x) => x.kind === "모순" && x.attribute === "니코틴등급"));
    const ok = findSpecViolations("경계값은 기본 농도입니다.", REG);
    assert.equal(ok.filter((x) => x.attribute === "니코틴등급").length, 0);
  });

  test("농도가 등록 안 된 제품은 등급어를 판정하지 않는다", () => {
    const reg = { ...REG, products: [{ name: "미상", category: "일회용", source: "s", verifiedAt: "2026-08-24" }] };
    const v = findSpecViolations("미상은 고농도입니다.", reg);
    assert.equal(v.filter((x) => x.attribute === "니코틴등급").length, 0);
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
