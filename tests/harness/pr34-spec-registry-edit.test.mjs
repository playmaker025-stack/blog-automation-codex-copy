import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  setSpecField,
  clearSpecField,
  addProduct,
  deleteProduct,
  setProductNotes,
  setProductAliases,
  setDomainNotes,
  isEditableField,
} from "../../lib/agents/spec-registry-edit.ts";
import { findSpecViolations } from "../../lib/agents/product-specs.ts";

const base = () => ({
  version: 1,
  products: [
    {
      name: "젤로맥스",
      aliases: ["젤로 맥스"],
      category: "기기",
      batteryMah: 1600,
      form: "박스형",
      wattControl: false,
      notes: ["기존 메모"],
      source: "사장님 발행글",
      verifiedAt: "2026-08-24",
    },
  ],
  domainNotes: ["기존 규칙"],
  updatedAt: "2026-08-24T00:00:00.000Z",
});

describe("PR34 값 수정", () => {
  test("숫자 항목을 고친다", () => {
    const { registry, error } = setSpecField(base(), "젤로맥스", "batteryMah", "1900mAh");
    assert.equal(error, undefined);
    assert.equal(registry.products[0].batteryMah, 1900);
  });

  test("불리언을 한국어로 고친다", () => {
    const { registry } = setSpecField(base(), "젤로맥스", "wattControl", "가능");
    assert.equal(registry.products[0].wattControl, true);
  });

  test("별칭으로도 찾는다", () => {
    const { registry, error } = setSpecField(base(), "젤로 맥스", "batteryMah", "1900");
    assert.equal(error, undefined);
    assert.equal(registry.products[0].batteryMah, 1900);
  });

  test("해석 못 하는 값은 거부하고 사유를 준다", () => {
    const before = base();
    const { registry, error } = setSpecField(before, "젤로맥스", "batteryMah", "넉넉한 편");
    assert.ok(error);
    assert.equal(registry.products[0].batteryMah, 1600);
  });

  test("없는 제품은 거부한다", () => {
    const { error } = setSpecField(base(), "없는제품", "batteryMah", "1000");
    assert.ok(error?.includes("찾지 못했"));
  });

  // name/source를 화면에서 고치게 두면 원장 키가 깨진다.
  test("편집 불가 필드는 막는다", () => {
    assert.equal(isEditableField("batteryMah"), true);
    assert.equal(isEditableField("name"), false);
    assert.equal(isEditableField("source"), false);
    const { error } = setSpecField(base(), "젤로맥스", "name", "다른이름");
    assert.ok(error);
  });

  test("수정하면 확인일과 출처가 갱신된다", () => {
    const { registry } = setSpecField(base(), "젤로맥스", "batteryMah", "1900");
    assert.ok(registry.products[0].source.includes("사장님 직접 입력"));
    assert.notEqual(registry.products[0].verifiedAt, "2026-08-24");
  });

  test("원본 원장을 변형하지 않는다", () => {
    const before = base();
    setSpecField(before, "젤로맥스", "batteryMah", "1900");
    assert.equal(before.products[0].batteryMah, 1600);
  });
});

// 확신이 없을 때는 틀린 값보다 빈칸이 안전하다.
describe("PR34 값 비우기", () => {
  test("항목이 실제로 사라진다", () => {
    const { registry } = clearSpecField(base(), "젤로맥스", "batteryMah");
    assert.equal(registry.products[0].batteryMah, undefined);
    assert.equal("batteryMah" in registry.products[0], false);
  });

  // 비운 항목은 검사기에서 모순이 아니라 미확인이 돼야 한다.
  test("비우면 모순 판정이 미확인으로 바뀐다", () => {
    const withValue = base();
    const claim = "젤로맥스는 박스형이 아니라 원통형입니다.";

    const before = findSpecViolations(claim, withValue);
    assert.ok(before.some((v) => v.kind === "모순" && v.attribute === "형태"));

    const { registry } = clearSpecField(withValue, "젤로맥스", "form");
    const after = findSpecViolations(claim, registry);
    assert.equal(after.filter((v) => v.kind === "모순").length, 0);
    assert.ok(after.some((v) => v.kind === "미확인"));
  });
});

describe("PR34 제품 추가·삭제", () => {
  test("새 제품을 만든다", () => {
    const { registry, error } = addProduct(base(), { name: "하복", category: "기기" });
    assert.equal(error, undefined);
    assert.equal(registry.products.length, 2);
    assert.ok(registry.products.some((p) => p.name === "하복"));
  });

  test("이름순으로 정렬된다", () => {
    const { registry } = addProduct(base(), { name: "가나다" });
    assert.equal(registry.products[0].name, "가나다");
  });

  test("이미 있는 이름은 거부한다", () => {
    const { error } = addProduct(base(), { name: "젤로맥스" });
    assert.ok(error?.includes("이미 등록"));
  });

  test("별칭과 겹쳐도 거부한다", () => {
    const { error } = addProduct(base(), { name: "젤로 맥스" });
    assert.ok(error);
  });

  test("빈 이름은 거부한다", () => {
    assert.ok(addProduct(base(), { name: "   " }).error);
  });

  test("제품을 지운다", () => {
    const { registry, error } = deleteProduct(base(), "젤로맥스");
    assert.equal(error, undefined);
    assert.equal(registry.products.length, 0);
  });

  test("없는 제품 삭제는 거부한다", () => {
    assert.ok(deleteProduct(base(), "없음").error);
  });
});

describe("PR34 메모·별칭·업종 규칙", () => {
  test("메모를 통째로 갈아끼운다", () => {
    const { registry } = setProductNotes(base(), "젤로맥스", ["새 메모", "  ", "또 하나"]);
    assert.deepEqual(registry.products[0].notes, ["새 메모", "또 하나"]);
  });

  test("빈 줄만 있으면 메모가 비워진다", () => {
    const { registry } = setProductNotes(base(), "젤로맥스", ["", "   "]);
    assert.deepEqual(registry.products[0].notes, []);
  });

  test("별칭을 갈아끼운다", () => {
    const { registry } = setProductAliases(base(), "젤로맥스", [" ZELO MAX ", "", "젤맥"]);
    assert.deepEqual(registry.products[0].aliases, ["ZELO MAX", "젤맥"]);
  });

  test("업종 규칙을 갈아끼운다", () => {
    const { registry } = setDomainNotes(base(), ["1% 이하가 기본 농도", ""]);
    assert.deepEqual(registry.domainNotes, ["1% 이하가 기본 농도"]);
  });

  test("메모 수정은 다른 항목을 건드리지 않는다", () => {
    const { registry } = setProductNotes(base(), "젤로맥스", ["새 메모"]);
    assert.equal(registry.products[0].batteryMah, 1600);
    assert.equal(registry.products[0].form, "박스형");
  });
});
