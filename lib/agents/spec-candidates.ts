/**
 * spec-candidates — 발행글에서 뽑은 사양 후보의 순수 로직.
 *
 * 왜 만드나 (2026-08-24):
 * 사장님이 인덱스에 글을 계속 넣으신 이유는 "AI를 학습시키기 위해서"였는데,
 * 실제로 학습되는 건 문체뿐이었다. writing-profile.json에는 structureRules,
 * toneRules, openingPatterns만 있고 "크로스미니6 = 1600mAh"가 들어갈 칸이
 * 없었다. 발췌 30개를 조사해보니 수치 사양이 들어간 건 0건이었고, 하필
 * "말론바 스펙 & 사용법" 글의 발췌는 "스펙과 사용법을 알려드리려 합니다!"
 * 에서 잘려 있었다 — 스펙 예고문까지만 학습한 셈이다.
 *
 * 그래서 글이 들어올 때마다 사실 후보를 뽑아 확인 대기함에 쌓는다.
 * 사장님은 승인/거절만 하면 원장에 들어간다.
 *
 * 승인 전에는 프롬프트에 절대 넣지 않는다. 자동 추출이 조용히 사실로
 * 승격되면 이 기능이 막으려던 바로 그 문제를 다시 만든다.
 */

import type { ProductSpec, ProductSpecRegistry } from "./product-specs";
import { resolveProduct } from "./product-identity.ts";

/** 원장에 실제로 넣을 수 있는 필드만 후보로 받는다. */
export const CANDIDATE_FIELDS = [
  "officialName",
  "form",
  "inhaleMode",
  "drawStyle",
  "wattControl",
  "airflowControl",
  "batteryRechargeable",
  "liquidRefillable",
  "batteryMah",
  "podMl",
  "liquidMl",
  "resistanceOhm",
  "wattRange",
  "puffs",
  "nicotinePercent",
  "sizeMm",
  "weightG",
  "charging",
] as const;

export type CandidateField = (typeof CANDIDATE_FIELDS)[number];

/** 사람이 읽을 필드 이름. 화면과 프롬프트 양쪽에서 쓴다. */
export const FIELD_LABELS: Record<CandidateField, string> = {
  officialName: "정식 제품명",
  form: "형태 (원통형/박스형)",
  inhaleMode: "격발 방식 (자동/버튼/겸용)",
  drawStyle: "흡입 방식 (입호흡/폐호흡/겸용)",
  wattControl: "출력(와트) 조절 가능 여부",
  airflowControl: "흡입압 조절 가능 여부",
  batteryRechargeable: "배터리 충전 가능 여부",
  liquidRefillable: "액상 리필 가능 여부",
  batteryMah: "배터리 용량 (mAh)",
  podMl: "팟 용량 (교체형)",
  liquidMl: "내장 액상 용량 (일회용)",
  resistanceOhm: "코일 저항값",
  wattRange: "출력 범위",
  puffs: "표기 퍼프 수",
  nicotinePercent: "니코틴 농도 (%)",
  sizeMm: "크기 (mm)",
  weightG: "무게 (g)",
  charging: "충전 방식",
};

export type CandidateStatus = "대기" | "승인" | "거절";

/** 원장과 대조한 결과. 화면에서 무엇부터 볼지 정하는 데 쓴다. */
export type CandidateVerdict = "신규" | "충돌" | "동일";

export interface SpecCandidate {
  id: string;
  product: string;
  field: CandidateField;
  /** 원문 표기 그대로. 형 변환은 승인 시점에 한다. */
  value: string;
  /** 이 값이 나온 문장. 사장님이 원문을 안 열고 판단할 수 있게 하는 핵심. */
  evidence: string;
  postId: string;
  postTitle?: string;
  extractedAt: string;
  status: CandidateStatus;
  decidedAt?: string;
}

export interface SpecCandidateStore {
  version: number;
  candidates: SpecCandidate[];
  updatedAt: string;
}

export const CANDIDATE_STORE_VERSION = 1;

export function emptyCandidateStore(now: Date = new Date()): SpecCandidateStore {
  return { version: CANDIDATE_STORE_VERSION, candidates: [], updatedAt: now.toISOString() };
}

/** 같은 제품·필드·값이면 같은 후보로 본다. 글이 달라도 중복으로 쌓지 않는다. */
export function candidateKey(c: Pick<SpecCandidate, "product" | "field" | "value">): string {
  return `${c.product.trim()}|${c.field}|${normalizeValue(c.value)}`;
}

function normalizeValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

// 한 글자(o/x)와 "예"/"아니오"는 정확 일치로만 본다. 부분 문자열로 보면 오작동한다.
const TRUE_WORDS = ["true", "가능", "있음", "지원"];
const FALSE_WORDS = ["false", "불가", "없음", "미지원"];

/**
 * 업종에서 실제로 쓰는 표현들. 실측(2026-08-26) 일괄 승인에서 21건이
 * "해석 못 함"으로 떨어졌는데 절반은 사람이 읽으면 명백한 값이었다.
 *
 * "팟교체형"은 팟을 통째로 갈아끼운다는 뜻이라 액상 리필이 아니다.
 * "3단계", "노멀/터보"는 출력 단계가 있다는 뜻이라 조절이 된다.
 *
 * 필드마다 다르게 읽어야 한다. "조절"은 airflowControl에서는 있다는 뜻이지만
 * liquidRefillable에서는 아무 뜻도 아니다.
 */
const FIELD_TRUE_HINTS: Partial<Record<CandidateField, string[]>> = {
  liquidRefillable: ["리필", "주입", "충전식 팟", "액상 주입"],
  batteryRechargeable: ["충전", "재사용", "c타입", "usb", "type-c"],
  wattControl: ["단계", "모드", "다이얼", "조절", "가변"],
  airflowControl: ["조절", "슬라이드", "다이얼", "링", "조리개"],
};

/** 숫자여야 하는 항목. 숫자가 없으면 값이 아니라 항목 이름이 들어온 것이다. */
const NUMERIC_FIELDS = new Set<CandidateField>([
  "batteryMah",
  "puffs",
  "weightG",
  "nicotinePercent",
]);

/**
 * "팟교체형"은 여기 없다. 사장님 지적(2026-08-26) — 팟 교체형은 두 가지다.
 *   1) 이미 액상이 주입된 팟만 갈아끼우는 것 → 리필 불가
 *   2) 팟은 갈아끼우되 액상은 직접 주입하는 것 → 리필 가능
 * 표현만으로는 어느 쪽인지 모른다. 모르면 사람에게 묻는 게 맞다.
 */
const FIELD_FALSE_HINTS: Partial<Record<CandidateField, string[]>> = {
  liquidRefillable: ["일회용", "리필 불가", "주입 불가"],
  batteryRechargeable: ["일회용", "충전 불가"],
};

/**
 * 후보 값을 원장 필드 타입으로 바꾼다.
 *
 * 실패하면 null을 준다 — 억지로 넣느니 승인 화면에서 사람이 고치는 게 낫다.
 */
/**
 * 숫자와 단위를 같이 읽는다.
 *
 * 왜 필요한가: 예전에는 숫자 아닌 글자를 전부 지우고 숫자만 남겼다. 그래서
 * "3만퍼프"가 3이 되고 "1.2Ah"가 1.2mAh가 됐다. 단위를 무시하면 1000배 틀린
 * 값이 사실로 저장된다.
 *
 * 배수가 명확한 단위만 환산한다. 종류가 다른 단위(mg vs %)는 환산하지 않고
 * 거부한다 — 어림으로 바꾸면 틀린 사실을 원장에 넣게 된다.
 */
function parseNumberWithUnit(raw: string, field: CandidateField): number | null {
  const value = raw.trim().toLowerCase().replace(/,/g, "");

  const match = value.match(/(\d+\.?\d*)/);
  if (!match) return null;
  let n = Number(match[1]);
  if (!Number.isFinite(n)) return null;

  // 한글 수사. "3만퍼프", "1천 퍼프"
  const after = value.slice(match.index! + match[1].length);
  if (/^\s*만/.test(after)) n *= 10000;
  else if (/^\s*천/.test(after)) n *= 1000;

  if (field === "batteryMah") {
    // Ah는 mAh의 1000배. "1.2Ah"를 1.2로 저장하면 안 된다.
    if (/ah|[0-9.]\s*ah/.test(value) && !/mah/.test(value)) n *= 1000;
    return n;
  }

  if (field === "weightG") {
    if (/kg/.test(value)) n *= 1000;
    return n;
  }

  if (field === "nicotinePercent") {
    // mg는 %가 아니다. mg/ml인지 총량인지도 글마다 다르다. 사람이 판단해야 한다.
    if (/mg/.test(value)) return null;
    return n;
  }

  return n;
}

export function coerceValue(field: CandidateField, raw: string): string | number | boolean | null {
  const value = raw.trim();
  if (!value) return null;

  if (
    field === "wattControl" ||
    field === "airflowControl" ||
    field === "batteryRechargeable" ||
    field === "liquidRefillable"
  ) {
    const v = value.toLowerCase().trim();
    // 한 글자 표기(o/x)는 정확히 그것일 때만 본다. 부분 문자열로 보면
    // "max 80w"의 x가 "불가"로 읽힌다.
    if (v === "o" || v === "예") return true;
    if (v === "x" || v === "아니오") return false;
    // 부정을 긍정보다 먼저 본다. "불가능"은 "가능"을 포함하므로 순서가 뒤집히면
    // "충전 불가능"이 "충전 가능"으로 저장된다.
    if (FALSE_WORDS.some((w) => v.includes(w))) return false;
    if (TRUE_WORDS.some((w) => v.includes(w))) return true;
    if ((FIELD_FALSE_HINTS[field] ?? []).some((w) => v.includes(w))) return false;
    if ((FIELD_TRUE_HINTS[field] ?? []).some((w) => v.includes(w))) return true;
    return null;
  }

  if (field === "batteryMah" || field === "puffs" || field === "weightG") {
    const n = parseNumberWithUnit(value, field);
    return n !== null && n > 0 ? n : null;
  }

  if (field === "nicotinePercent") {
    const n = parseNumberWithUnit(value, field);
    return n !== null && n >= 0 ? n : null;
  }

  return value;
}

/** 원장과 대조한다. 값 비교는 문자열 정규화 후 느슨하게 본다. */
export function verdictFor(
  candidate: Pick<SpecCandidate, "product" | "field" | "value">,
  registry: ProductSpecRegistry
): CandidateVerdict {
  const spec = registry.products.find(
    (p) =>
      p.name === candidate.product ||
      (p.aliases ?? []).includes(candidate.product)
  );
  if (!spec) return "신규";

  const existing = (spec as unknown as Record<string, unknown>)[candidate.field];
  if (existing === undefined || existing === null) return "신규";

  const coerced = coerceValue(candidate.field, candidate.value);
  if (coerced === null) return "충돌";
  if (typeof existing === "number" && typeof coerced === "number") {
    return existing === coerced ? "동일" : "충돌";
  }
  if (typeof existing === "boolean" && typeof coerced === "boolean") {
    return existing === coerced ? "동일" : "충돌";
  }
  return normalizeValue(String(existing)) === normalizeValue(String(coerced)) ? "동일" : "충돌";
}

export interface MergeResult {
  store: SpecCandidateStore;
  added: number;
  skipped: number;
}

const MAX_CANDIDATES = 500;

/**
 * 새 후보를 대기함에 넣는다.
 *
 * 이미 원장에 같은 값이 있으면(동일) 아예 안 넣는다 — 승인할 게 없는 항목으로
 * 대기함이 불어나면 사장님이 목록을 안 보게 된다. 충돌은 반드시 넣는다.
 * 이미 판단(승인/거절)한 것과 같은 키면 다시 묻지 않는다.
 */
export function mergeCandidates(
  store: SpecCandidateStore,
  incoming: SpecCandidate[],
  registry: ProductSpecRegistry
): MergeResult {
  const seen = new Set(store.candidates.map(candidateKey));
  const next = [...store.candidates];
  let added = 0;
  let skipped = 0;

  for (const raw of incoming) {
    // 표기가 달라도 같은 제품이면 원장의 이름으로 맞춘다. 안 맞추면 같은 기기가
    // 대기함에서 카드 두 개로 갈라지고, 원장에도 중복으로 쌓인다.
    // 실측(2026-08-26): 'SUPA X3'와 '수파X3 (SUPA X3)'가 따로 등록돼 있었다.
    // 확정이 안 되면(모르는 이름·후보 둘 이상) 원래 표기를 그대로 둔다.
    const resolved = resolveProduct(registry, raw.product).spec;
    const c = resolved ? { ...raw, product: resolved.name } : raw;
    const key = candidateKey(c);
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    if (verdictFor(c, registry) === "동일") {
      skipped++;
      continue;
    }
    seen.add(key);
    next.push(c);
    added++;
  }

  return {
    store: {
      version: CANDIDATE_STORE_VERSION,
      candidates: next.slice(-MAX_CANDIDATES),
      updatedAt: new Date().toISOString(),
    },
    added,
    skipped,
  };
}

/** 대기 중인 것만, 충돌을 먼저 보여준다. 충돌이 더 급하다. */
export function pendingCandidates(
  store: SpecCandidateStore,
  registry: ProductSpecRegistry
): Array<SpecCandidate & { verdict: CandidateVerdict }> {
  return store.candidates
    .filter((c) => c.status === "대기")
    .map((c) => ({ ...c, verdict: verdictFor(c, registry) }))
    .sort((a, b) => {
      if (a.verdict !== b.verdict) return a.verdict === "충돌" ? -1 : 1;
      return b.extractedAt.localeCompare(a.extractedAt);
    });
}

/** 승인된 후보를 원장 항목에 얹는다. 원장은 순수하게 갱신된다. */
export function applyCandidate(
  registry: ProductSpecRegistry,
  candidate: SpecCandidate,
  options: { overrideValue?: string; now?: Date } = {}
): ProductSpecRegistry {
  const raw = options.overrideValue ?? candidate.value;
  const coerced = coerceValue(candidate.field, raw);
  if (coerced === null) return registry;

  const now = (options.now ?? new Date()).toISOString().slice(0, 10);
  const idx = registry.products.findIndex(
    (p) => p.name === candidate.product || (p.aliases ?? []).includes(candidate.product)
  );

  const sourceLine = `${candidate.postId} 자동 추출 → 사장님 승인`;

  if (idx === -1) {
    const created: ProductSpec = {
      name: candidate.product,
      category: "기기",
      source: sourceLine,
      verifiedAt: now,
      [candidate.field]: coerced,
    } as ProductSpec;
    return {
      ...registry,
      products: [...registry.products, created].sort((a, b) => a.name.localeCompare(b.name)),
      updatedAt: new Date().toISOString(),
    };
  }

  const products = [...registry.products];
  const prev = products[idx];
  products[idx] = {
    ...prev,
    [candidate.field]: coerced,
    verifiedAt: now,
    source: prev.source.includes(candidate.postId)
      ? prev.source
      : `${prev.source} + ${sourceLine}`,
  } as ProductSpec;

  return { ...registry, products, updatedAt: new Date().toISOString() };
}

export function decideCandidate(
  store: SpecCandidateStore,
  id: string,
  status: Exclude<CandidateStatus, "대기">
): SpecCandidateStore {
  return {
    ...store,
    candidates: store.candidates.map((c) =>
      c.id === id ? { ...c, status, decidedAt: new Date().toISOString() } : c
    ),
    updatedAt: new Date().toISOString(),
  };
}

// ── 추출 프롬프트 ────────────────────────────────────────────

/**
 * 추출 프롬프트.
 *
 * 규칙을 강하게 잡는 이유: 이 기능은 사실을 만들어내려는 게 아니라 이미 글에
 * 적힌 사실을 옮기는 것이다. 모델이 "아마 이럴 것"을 채우기 시작하면 대기함이
 * 쓰레기로 차고, 사장님이 목록을 안 보게 되며, 결국 기능이 죽는다.
 */
export function buildSpecExtractionPrompt(params: {
  title: string;
  content: string;
  knownProducts: string[];
}): string {
  const fieldList = CANDIDATE_FIELDS.map((f) => `  - ${f}: ${FIELD_LABELS[f]}`).join("\n");

  return [
    "아래는 전자담배 매장 사장님이 직접 쓴 블로그 글입니다.",
    "이 글에 **명시적으로 적혀 있는** 제품 사양만 뽑아주세요.",
    "",
    "추출 가능한 필드:",
    fieldList,
    "",
    "규칙:",
    "1. 글에 적힌 것만 뽑습니다. 추론하거나 일반 상식으로 채우지 마세요.",
    "2. 애매하면 뽑지 마세요. 빠뜨리는 것이 잘못 넣는 것보다 낫습니다.",
    "3. evidence에는 그 값이 나온 문장을 원문 그대로 넣으세요. 요약하지 마세요.",
    "4. 값은 글에 적힌 표기 그대로 넣으세요 (예: \"35000퍼프\", \"3500mAh\", \"약 95g\").",
    "5. 다른 제품과 비교하며 언급된 수치도 그 제품의 사양이면 뽑으세요.",
    "6. 제품명은 글에 나온 표기를 쓰되, 아래 이미 아는 제품명과 같은 것이면 그 표기를 쓰세요.",
    `   이미 아는 제품: ${params.knownProducts.join(", ") || "(없음)"}`,
    "7. 사양이 아닌 사용법·주의사항·감상은 뽑지 마세요.",
    "",
    "JSON만 출력하세요:",
    '{"products":[{"name":"제품명","facts":[{"field":"batteryMah","value":"3500mAh","evidence":"원문 문장"}]}]}',
    "",
    `제목: ${params.title}`,
    "본문:",
    params.content.slice(0, 12000),
  ].join("\n");
}

export interface ExtractedFact {
  field: CandidateField;
  value: string;
  evidence: string;
}

export interface ExtractedProduct {
  name: string;
  facts: ExtractedFact[];
}

/** LLM 응답을 파싱한다. 형식이 틀리면 빈 배열 — 파이프라인을 막지 않는다. */
export function parseSpecExtraction(text: string): ExtractedProduct[] {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  const products = (parsed as { products?: unknown })?.products;
  if (!Array.isArray(products)) return [];

  const allowed = new Set<string>(CANDIDATE_FIELDS);
  const result: ExtractedProduct[] = [];

  for (const p of products) {
    const name = typeof (p as { name?: unknown })?.name === "string" ? (p as { name: string }).name.trim() : "";
    if (!name) continue;
    const rawFacts = (p as { facts?: unknown })?.facts;
    if (!Array.isArray(rawFacts)) continue;

    const facts: ExtractedFact[] = [];
    for (const f of rawFacts) {
      const field = (f as { field?: unknown })?.field;
      const value = (f as { value?: unknown })?.value;
      const evidence = (f as { evidence?: unknown })?.evidence;
      if (typeof field !== "string" || !allowed.has(field)) continue;
      if (typeof value !== "string" || !value.trim()) continue;
      // 숫자 항목인데 숫자가 하나도 없으면 값이 아니라 항목 이름이다.
      // 실측(2026-08-26): "사용 가능 퍼프 수", "배터리 성능 개선", "가벼운 무게"가
      // 값으로 들어와 승인 대기함에 쌓였다. 사람이 판단할 것도 없는 쓰레기다.
      if (NUMERIC_FIELDS.has(field as CandidateField) && !/\d/.test(value)) continue;
      facts.push({
        field: field as CandidateField,
        value: value.trim(),
        // 근거가 없으면 승인 판단을 못 한다. 빈 문자열로 두되 화면에서 표시한다.
        evidence: typeof evidence === "string" ? evidence.trim().slice(0, 300) : "",
      });
    }
    if (facts.length > 0) result.push({ name, facts });
  }
  return result;
}
