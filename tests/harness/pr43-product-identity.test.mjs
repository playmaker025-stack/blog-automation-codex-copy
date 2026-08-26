import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeProductName,
  expandNameVariants,
  resolveProduct,
  findDuplicateSuggestions,
  mergeProducts,
} from "../../lib/agents/product-identity.ts";

const spec = (name, extra = {}) => ({
  name,
  aliases: [],
  category: "기기",
  source: "테스트",
  verifiedAt: "2026-08-26",
  ...extra,
});

const reg = (...products) => ({ version: 1, products, updatedAt: "2026-08-26" });

describe("PR43 표기 정규화", () => {
  test("공백·대소문자·전각을 지운다", () => {
    assert.equal(normalizeProductName("와카 버스트"), normalizeProductName("와카버스트"));
    assert.equal(normalizeProductName("SUPA X3"), normalizeProductName("supa  x3"));
    assert.equal(normalizeProductName("아머-프로"), normalizeProductName("아머프로"));
  });

  // 여기가 이 모듈의 핵심 안전장치다. 과잉 병합이 제일 위험하다.
  test("다른 제품은 정규화해도 다르다", () => {
    const pairs = [
      ["말론", "말론S"],
      ["말론", "말론바"],
      ["젤로", "젤로맥스"],
      ["발라리안맥스", "발라리안맥스프로"],
      ["엘프바", "엘프바 아이스킹"],
    ];
    for (const [a, b] of pairs) {
      assert.notEqual(normalizeProductName(a), normalizeProductName(b), `${a} vs ${b}`);
    }
  });
});

describe("PR43 괄호 병기", () => {
  test("전체·앞·안 세 가지로 쪼갠다", () => {
    const v = expandNameVariants("수파X3 (SUPA X3)");
    assert.ok(v.includes("수파X3 (SUPA X3)"));
    assert.ok(v.includes("수파X3"));
    assert.ok(v.includes("SUPA X3"));
  });

  test("괄호가 없으면 그대로 하나다", () => {
    assert.deepEqual(expandNameVariants("말론S"), ["말론S"]);
  });

  // "말론(2세대)"의 "2세대"를 별칭으로 만들면 다른 제품과 섞인다.
  test("괄호 안이 너무 짧으면 별칭으로 안 만든다", () => {
    const v = expandNameVariants("말론(2)");
    assert.equal(v.includes("2"), false);
  });
});

describe("PR43 제품 확정", () => {
  const registry = reg(
    spec("수파X3 (SUPA X3)"),
    spec("말론"),
    spec("말론S"),
    spec("와카버스트")
  );

  test("괄호 안 표기로 들어와도 같은 제품으로 붙는다", () => {
    assert.equal(resolveProduct(registry, "SUPA X3").spec?.name, "수파X3 (SUPA X3)");
  });

  test("공백만 다른 표기도 붙는다", () => {
    assert.equal(resolveProduct(registry, "와카 버스트").spec?.name, "와카버스트");
  });

  test("말론과 말론S를 섞지 않는다", () => {
    assert.equal(resolveProduct(registry, "말론").spec?.name, "말론");
    assert.equal(resolveProduct(registry, "말론S").spec?.name, "말론S");
  });

  test("모르는 이름은 확정하지 않는다", () => {
    assert.equal(resolveProduct(registry, "처음보는기기").spec, null);
  });

  // 조용히 첫 번째를 고르면 엉뚱한 제품에 사양이 붙는다.
  test("둘 이상 걸리면 확정하지 않고 후보를 돌려준다", () => {
    const dup = reg(spec("말론", { aliases: ["Malone"] }), spec("말론 (Malone)"));
    const found = resolveProduct(dup, "Malone");
    assert.equal(found.spec, null);
    assert.equal(found.ambiguous.length, 2);
  });
});

describe("PR43 중복 진단", () => {
  test("표기만 다른 쌍을 찾는다", () => {
    const registry = reg(spec("와카 버스트"), spec("와카버스트"));
    const found = findDuplicateSuggestions(registry);
    assert.equal(found.length, 1);
    assert.equal(found[0].reason, "표기 동일");
  });

  test("괄호 병기 쌍을 찾는다", () => {
    const found = findDuplicateSuggestions(reg(spec("SUPA X3"), spec("수파X3 (SUPA X3)")));
    assert.equal(found.length, 1);
    assert.equal(found[0].reason, "괄호 병기");
  });

  test("다른 제품은 제안하지 않는다", () => {
    const registry = reg(spec("말론"), spec("말론S"), spec("말론바"), spec("젤로"), spec("젤로맥스"));
    assert.equal(findDuplicateSuggestions(registry).length, 0);
  });

  test("사양이 많은 쪽을 남길 후보로 제안한다", () => {
    const registry = reg(spec("와카 버스트"), spec("와카버스트", { batteryMah: 1000, podMl: "2ml" }));
    assert.equal(findDuplicateSuggestions(registry)[0].keeper, "와카버스트");
  });

  test("값이 어긋나는 항목을 알려준다", () => {
    const registry = reg(
      spec("와카 버스트", { batteryMah: 900 }),
      spec("와카버스트", { batteryMah: 1000 })
    );
    assert.deepEqual(findDuplicateSuggestions(registry)[0].conflictingFields, ["batteryMah"]);
  });
});

describe("PR43 병합", () => {
  const registry = reg(
    spec("와카버스트", { batteryMah: 1000 }),
    spec("와카 버스트", { podMl: "2ml", batteryMah: 900, aliases: ["WAKA"] })
  );

  test("빈 항목만 채운다", () => {
    const { registry: next } = mergeProducts(registry, "와카버스트", "와카 버스트");
    const merged = next.products.find((p) => p.name === "와카버스트");
    assert.equal(merged.podMl, "2ml");
  });

  // 어느 쪽이 맞는지는 사람이 안다. 조용히 덮으면 안 된다.
  test("값이 어긋나면 남길 쪽을 유지하고 보고한다", () => {
    const { registry: next, keptConflicts } = mergeProducts(registry, "와카버스트", "와카 버스트");
    assert.equal(next.products.find((p) => p.name === "와카버스트").batteryMah, 1000);
    assert.deepEqual(keptConflicts, ["batteryMah"]);
  });

  test("합쳐진 이름과 별칭이 별칭으로 남는다", () => {
    const { registry: next } = mergeProducts(registry, "와카버스트", "와카 버스트");
    const merged = next.products.find((p) => p.name === "와카버스트");
    assert.ok(merged.aliases.includes("와카 버스트"));
    assert.ok(merged.aliases.includes("WAKA"));
  });

  test("합친 제품은 사라진다", () => {
    const { registry: next } = mergeProducts(registry, "와카버스트", "와카 버스트");
    assert.equal(next.products.length, 1);
  });

  test("합친 뒤 옛 표기로도 찾아진다", () => {
    const { registry: next } = mergeProducts(registry, "와카버스트", "와카 버스트");
    assert.equal(resolveProduct(next, "와카 버스트").spec?.name, "와카버스트");
  });

  test("없는 제품은 거부한다", () => {
    assert.ok(mergeProducts(registry, "없음", "와카 버스트").error);
    assert.ok(mergeProducts(registry, "와카버스트", "와카버스트").error);
  });

  test("원본을 변형하지 않는다", () => {
    const before = registry.products.length;
    mergeProducts(registry, "와카버스트", "와카 버스트");
    assert.equal(registry.products.length, before);
  });
});

// 코덱스 리뷰(2026-08-26): mergeProducts가 이름만 다르면 무엇이든 합쳤다.
// API를 직접 부르거나 화면이 바뀌면 '말론'과 '말론S'가 합쳐져 하나가 삭제된다.
describe("PR46 병합 안전장치", () => {
  test("표기가 다른 제품은 합치기를 거부한다", () => {
    const r = mergeProducts(reg(spec("말론"), spec("말론S")), "말론", "말론S");
    assert.ok(r.error);
    assert.equal(r.registry.products.length, 2);
  });

  test("진짜 중복은 그대로 합친다", () => {
    const r = mergeProducts(reg(spec("와카버스트"), spec("와카 버스트")), "와카버스트", "와카 버스트");
    assert.equal(r.error, undefined);
    assert.equal(r.registry.products.length, 1);
  });

  // 합쳐질 쪽에만 있던 농도가 사라지면 그 제품은 원장에서 없는 농도가 된다.
  test("농도 변형은 양쪽을 다 살린다", () => {
    const r = mergeProducts(
      reg(spec("컴온", { nicotinePercent: 0.5 }), spec("컴 온", { nicotinePercent: 0.8 })),
      "컴온",
      "컴 온"
    );
    assert.deepEqual(r.registry.products[0].nicotinePercent, [0.5, 0.8]);
  });
});
