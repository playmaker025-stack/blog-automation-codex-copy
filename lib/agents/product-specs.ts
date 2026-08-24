/**
 * product-specs — 제품 사양 원장과 사양 주장 검사기 (순수 로직).
 *
 * 왜 필요한가 (2026-08-24 발견):
 * 계약(domain-contract.ts)에는 "말론", "크로스미니" 같은 제품 이름만 있고
 * 형태·출력·용량 같은 사실이 없었다. 그래서 비교글을 쓰라고 하면 모델이
 * 빈칸을 상상으로 채웠다.
 *
 * 실제 사고: "크로스미니6 vs 말론S" 글에서 두 기기의 성격이 통째로 뒤바뀌었다.
 *   생성된 글 — 크로스미니6=출력조절/버튼, 말론S=자동흡입/박스형
 *   사실     — 크로스미니6=자동흡입/박스형그립, 말론S=원통형/스크린+버튼/출력조절
 * 사양 몇 개가 틀린 게 아니라 주어가 서로 바뀌었고, 글 전체 논지가 그 위에
 * 서 있었다. 게다가 "직접 써봤더니"까지 붙어 있었다.
 *
 * 화이트리스트가 이걸 가린다는 게 핵심이다. 말론S는 정당한 업종 제품이라
 * 모든 도메인 필터를 통과한다. 가드레일이 "주제 맞음"을 확인해주고 나서
 * 내용이 지어진다. 스코프는 지켰는데 사실이 없는 상태다.
 *
 * 그래서 검사를 두 갈래로 둔다.
 *   A. 모순 — 등록된 값과 반대되는 주장 (원통형인데 박스형이라고 씀)
 *   B. 미확인 - 원장에 없는 제품/항목에 대한 사양 주장
 * A는 명백한 거짓이라 차단, B는 원장이 자랄 때까지 경고로 둔다.
 */

/** 상호배타적 속성. 하나를 주장하면 나머지는 거짓이 된다. */
export type FormFactor = "원통형" | "박스형";

/**
 * 격발 방식 — 빨면 켜지는가(자동/오토드로우), 버튼을 누르는가.
 *
 * 아래 DrawStyle(입호흡/폐호흡)과 헷갈리면 안 된다. 실제로 한 번 섞었다:
 * 마이팟프로를 누수 대응 글의 "오토드로우와 버튼 베이핑 둘 다"만 보고
 * 겸용으로 넣었는데, 정작 이 기기의 간판은 "입·폐호흡 모두 가능"이었다.
 * 둘은 완전히 다른 축이다.
 */
export type InhaleMode = "자동" | "버튼" | "겸용";

/**
 * 흡입 방식 — 담배처럼 입에 머금는가(MTL), 폐까지 들이마시는가(DTL).
 *
 * 사장님 지적: "입과 폐를 호흡법만으로 구분하는 게 아니라 기기 타입과
 * 액상도 모두 다르다." 그래서 이걸 틀리면 손님이 맞지 않는 액상을 사서
 * 누수로 이어진다 — 사양 오류가 실제 피해로 연결되는 축이다.
 */
export type DrawStyle = "입호흡" | "폐호흡" | "겸용";

/**
 * 조절 방식은 배타적 열거형이 아니라 독립된 두 축이다.
 *
 * 처음엔 "와트조절 | 흡입압조절 | 조절없음" 하나로 묶었는데, 회귀 테스트가
 * 잡아냈다. 크로스미니6는 와트 조절이 없으면서 동시에 흡입압 조절이 있다 —
 * 둘 다 참이다. 하나로 묶으면 "출력 조절이 없어서 단순합니다"라는 맞는
 * 문장을 모순으로 막는다.
 */
export interface ControlAxes {
  /** 출력(와트) 조절 가능 여부. */
  wattControl?: boolean;
  /** 흡입압(에어플로우) 조절 가능 여부. */
  airflowControl?: boolean;

  /**
   * 배터리 충전 가능 여부.
   *
   * 액상 리필과 반드시 나눠야 한다. "충전식"이라는 한 단어가 둘 다를 가리켜서
   * 글에서 자주 뒤섞인다. 도조오팔이 대표적이다 — 배터리는 충전되지만 액상은
   * 이미 주입된 상태라 다 쓰면 버린다. "충전식이니 오래 쓴다"고 쓰면 틀린다.
   */
  batteryRechargeable?: boolean;
  /** 액상 리필(재주입) 가능 여부. */
  liquidRefillable?: boolean;
}

export interface ProductSpec extends ControlAxes {
  /** 원장 키이자 대표 표기. */
  name: string;
  /** 본문에 나올 수 있는 다른 표기. */
  aliases?: string[];
  category: "기기" | "일회용" | "액상" | "소모품";
  officialName?: string;
  form?: FormFactor;
  inhaleMode?: InhaleMode;
  drawStyle?: DrawStyle;
  batteryMah?: number;
  podMl?: string;
  resistanceOhm?: string;
  /** 출력 범위 표기. 예: "15~35W". wattControl이 true여도 범위는 따로 확인해야 한다. */
  wattRange?: string;

  // ── 일회용(disposable) 전용 축 ──
  // 기기와 사양 축이 다르다. 일회용은 형태·출력보다 퍼프수·농도·액상량으로 팔린다.
  /** 표기 퍼프 수. 사장님 지적대로 실사용은 전압·흡입 습관에 따라 크게 달라진다. */
  puffs?: number;
  /** 니코틴 농도(%). */
  nicotinePercent?: number;
  /** 내장 액상 용량. 팟 교체형의 podMl과 구분한다. */
  liquidMl?: string;
  charging?: string;
  sizeMm?: string;
  weightG?: number;
  /** 사양표에 안 들어가는 확인된 사실. 프롬프트에 그대로 들어간다. */
  notes?: string[];
  /** 이 값을 어디서 확인했는지. 나중에 의심스러우면 추적할 수 있어야 한다. */
  source: string;
  verifiedAt: string;
}

export interface ProductSpecRegistry {
  version: number;
  products: ProductSpec[];
  /**
   * 제품에 딸리지 않는 업종 공통 규칙. 용어 정의와 단위 뜻이 여기 들어간다.
   *
   * 필요한 이유: "고농도"처럼 업계에서 범위로 쓰는 말을 모델이 특정 숫자로
   * 단정해버린다. 사장님 기준으로 1% 이하가 기본이고 1%를 넘으면 고농도인데,
   * 이걸 5%로 못 박으면 틀린 글이 된다. 제품 사양표로는 담을 수 없는 층이다.
   */
  domainNotes?: string[];
  updatedAt: string;
}

export const SPEC_REGISTRY_VERSION = 1;

export function emptySpecRegistry(now: Date = new Date()): ProductSpecRegistry {
  return {
    version: SPEC_REGISTRY_VERSION,
    products: [],
    domainNotes: [],
    updatedAt: now.toISOString(),
  };
}

// ── 주장 탐지 패턴 ────────────────────────────────────────────

const FORM_PATTERNS: Array<[FormFactor, RegExp]> = [
  ["원통형", /원통형|스틱형|펜\s*형/],
  ["박스형", /박스\s*형|박스\s*타입/],
];

/**
 * 불리언 축에 대한 주장 패턴. 순서가 중요하다 —
 * 부정형("출력 조절이 없다")이 긍정형("출력 조절") 패턴에도 걸리므로 먼저 본다.
 */
const AXIS_CLAIMS: Array<{
  attr: string;
  field: keyof ControlAxes;
  value: boolean;
  re: RegExp;
}> = [
  {
    attr: "출력조절",
    field: "wattControl",
    value: false,
    re: /(?:출력|와트|파워)\s*(?:을|를|이|가)?\s*조절\s*(?:이|은|가)?\s*(?:없|안\s*[되돼])|복잡한\s*조절\s*없|조절\s*없이/,
  },
  {
    attr: "흡입압조절",
    field: "airflowControl",
    value: true,
    re: /흡입압\s*조절|에어\s*플로우\s*조절|공기량\s*조절/,
  },
  {
    attr: "출력조절",
    field: "wattControl",
    value: true,
    re: /(?:출력|와트|파워)\s*(?:을|를)?\s*조절|출력\s*세팅|와트\s*설정|\d+\s*[Ww]\s*(?:까지|로)\s*조절/,
  },
  // 액상 리필을 배터리 충전보다 먼저 본다. "액상 충전"이 아래 배터리 패턴에도 걸린다.
  {
    attr: "액상리필",
    field: "liquidRefillable",
    value: false,
    re: /액상\s*(?:을|를|은|이)?\s*(?:리필|충전|주입|보충)\s*(?:은|이|가)?\s*(?:안\s*[되돼]|불가|없)|다\s*쓰면\s*버리|리필\s*(?:형|식)\s*(?:이|은)?\s*아니/,
  },
  {
    attr: "액상리필",
    field: "liquidRefillable",
    value: true,
    re: /액상\s*(?:을|를)?\s*(?:리필|재?주입|보충)|리필\s*(?:해서|하며|가능|형|식)/,
  },
  {
    attr: "배터리충전",
    field: "batteryRechargeable",
    value: false,
    re: /충전\s*(?:이|은|가)?\s*(?:안\s*[되돼]|불가|없)|충전\s*(?:식|형)\s*(?:이|은)?\s*아니/,
  },
  {
    attr: "배터리충전",
    field: "batteryRechargeable",
    value: true,
    re: /배터리\s*(?:를|는)?\s*충전|충전\s*(?:하면서|해서|식|형|가능)|C\s*타입\s*(?:으로)?\s*충전|USB\s*충전/,
  },
];

const DRAW_PATTERNS: Array<[DrawStyle, RegExp]> = [
  ["겸용", /입\s*[·,&\/]?\s*폐\s*호흡\s*(?:을|를)?\s*(?:모두|둘\s*다|다)|입폐\s*겸용|입\s*호흡\s*(?:과|와)\s*폐\s*호흡/],
  ["폐호흡", /폐\s*호흡|폐홉|DTL/],
  ["입호흡", /입\s*호흡|입홉|MTL/],
];

const INHALE_PATTERNS: Array<[InhaleMode, RegExp]> = [
  ["겸용", /자동\s*(?:흡입)?\s*(?:과|와|\/|,)\s*버튼|버튼\s*(?:과|와|\/|,)\s*자동|둘\s*다\s*(?:가능|지원)/],
  ["자동", /자동\s*흡입|오토\s*흡입|입에\s*물고\s*(?:바로|빨)/],
  ["버튼", /버튼\s*(?:조작|식|베이핑)|버튼\s*(?:을)?\s*눌러/],
];

/**
 * 수치형 사양 주장. 값을 대조하는 게 아니라 "그 항목이 원장에 있는가"를 본다.
 *
 * 단위별로 나눈 이유: 처음엔 "숫자 항목이 하나라도 등록됐으면 통과"로 뭉뚱그렸는데,
 * 그러면 배터리·팟용량을 등록하는 순간 미확인 와트 주장("35W까지")이 그냥
 * 통과해버린다. 항목 하나를 채운 대가로 다른 항목의 감시가 풀리면 안 된다.
 */
const NUMERIC_CLAIMS: Array<{
  attr: string;
  /** 하나라도 등록돼 있으면 통과. 일회용/팟형이 같은 단위를 다른 필드로 쓴다. */
  fields: Array<keyof ProductSpec>;
  re: RegExp;
}> = [
  { attr: "배터리", fields: ["batteryMah"], re: /\d+\s*mAh|배터리\s*용량\s*(?:은|는|이)?\s*\d/ },
  {
    attr: "용량",
    fields: ["podMl", "liquidMl"],
    re: /\d+\.?\d*\s*ml\b|팟\s*용량|카트리지\s*용량|액상\s*용량/,
  },
  { attr: "저항값", fields: ["resistanceOhm"], re: /\d+\.?\d*\s*(?:옴|Ω)|저항값\s*(?:은|는|이)?\s*\d/ },
  { attr: "출력범위", fields: ["wattRange"], re: /\d+\s*[~-]\s*\d+\s*[Ww]\b|\d+\s*[Ww]\s*(?:까지|로|출력)/ },
  { attr: "크기", fields: ["sizeMm"], re: /\d+\.?\d*\s*(?:mm|㎜)/ },
  { attr: "퍼프수", fields: ["puffs"], re: /\d[\d,]*\s*퍼프|\d+\s*만\s*퍼프/ },
  {
    attr: "니코틴농도",
    fields: ["nicotinePercent"],
    // %만 보면 무관한 백분율에 걸린다. 니코틴/농도 문맥을 요구한다.
    re: /니코틴[^.]{0,12}\d+\.?\d*\s*%|\d+\.?\d*\s*%\s*(?:니코틴|농도)|농도\s*(?:는|은|가)?\s*\d+\.?\d*\s*%/,
  },
];

/**
 * 니코틴 농도 등급 주장. 사장님 기준으로 1% 이하가 기본(일반), 1% 초과가 고농도다.
 *
 * 숫자가 아니라 등급어로 틀리는 경우가 따로 있다. 0.98%짜리 도조오팔을
 * "고농도"라고 쓰면 손님이 훨씬 센 걸 기대하고 산다. 등록된 농도가 있으면
 * 등급어가 맞는지 기계적으로 대조할 수 있어서 검사에 넣는다.
 */
export const HIGH_NICOTINE_THRESHOLD = 1;

const NICOTINE_GRADE_PATTERNS: Array<[boolean, RegExp]> = [
  // true = 고농도 주장
  [true, /고농도/],
  [false, /기본\s*농도|일반\s*농도|저농도/],
];

/** 근거 없는 1인칭 경험 주장. 매장 글에서는 신뢰 문제로 직결된다. */
const FIRSTHAND_PATTERN = /직접\s*써\s*봤|직접\s*사용해\s*봤|제가\s*써\s*보니|써\s*본\s*결과|직접\s*테스트/;

export interface SpecViolation {
  kind: "모순" | "미확인" | "근거없는경험";
  product: string;
  attribute: string;
  claimed?: string;
  registered?: string;
  sentence: string;
}

// ── 유틸 ──────────────────────────────────────────────────────

function allNames(spec: ProductSpec): string[] {
  return [spec.name, ...(spec.aliases ?? [])];
}

/**
 * 문장 분리.
 *
 * 네이버 본문은 마침표를 거의 안 쓰고 줄바꿈과 제로폭 공백(U+200B)으로
 * 문단을 나눈다. 그걸 모르면 "크로스미니6가 맞는 분" 섹션과 "말론S가 맞는 분"
 * 섹션이 한 덩어리로 뭉쳐서 엉뚱한 제품에 속성이 붙는다. 실측에서 정상 글을
 * 막는 오탐이 여기서 나왔다.
 *
 * 그래서 마침표 외에 제로폭 공백, 불릿 기호, 꺾쇠 소제목에서도 끊는다.
 */
const SENTENCE_BREAK =
  /(?<=[.!?])\s+|\n+|​+|(?=[▪•·]️?)|(?=<[^>]{2,30}>)|(?=\d️⃣)/;

/** 이보다 긴 덩어리는 분리 실패로 본다. 귀속을 신뢰할 수 없어 판정에서 뺀다. */
export const MAX_ATTRIBUTABLE_LENGTH = 200;

export function splitSentences(text: string): string[] {
  return text
    .split(SENTENCE_BREAK)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 문장 안에서 어떤 제품에 대한 주장인지 고른다.
 *
 * "크로스미니6는 A, 말론S는 B" 같은 문장이 흔해서 문장당 제품 하나로 볼 수 없다.
 * 주장 표현 바로 앞에 나온 제품명에 귀속시킨다.
 */
function attributeTo(
  sentence: string,
  claimIndex: number,
  specs: ProductSpec[]
): ProductSpec | null {
  let best: { spec: ProductSpec; at: number } | null = null;
  for (const spec of specs) {
    for (const name of allNames(spec)) {
      let from = 0;
      for (;;) {
        const at = sentence.indexOf(name, from);
        if (at === -1 || at > claimIndex) break;
        if (!best || at > best.at) best = { spec, at };
        from = at + name.length;
      }
    }
  }
  return best?.spec ?? null;
}

/**
 * 매치 직후에 부정 표현이 오는지 본다.
 *
 * "버튼 조작 없이 바로 쓰고 싶은 분"을 "버튼식"으로 읽으면 정상 문장을 막는다.
 * 부정이면 뒤집지 않고 그냥 건너뛴다 — 뒤집기는 새 오탐을 만들 수 있고,
 * 놓치는 쪽이 맞는 글을 막는 쪽보다 낫다.
 */
const NEGATION_AFTER = /^.{0,12}?(없|안\s*[되돼]|불가|필요\s*없|아니)/;

function firstMatch<T>(sentence: string, patterns: Array<[T, RegExp]>): { value: T; index: number } | null {
  for (const [value, re] of patterns) {
    const m = re.exec(sentence);
    if (!m) continue;
    const tail = sentence.slice(m.index + m[0].length);
    if (NEGATION_AFTER.test(tail)) continue;
    return { value, index: m.index };
  }
  return null;
}

function mentionedProducts(sentence: string, specs: ProductSpec[]): ProductSpec[] {
  return specs.filter((s) => allNames(s).some((n) => sentence.includes(n)));
}

// ── 검사기 ────────────────────────────────────────────────────

export interface SpecCheckOptions {
  /** 원장에 없는 제품의 사양 주장도 위반으로 볼지. 기본은 본다(경고 등급). */
  flagUnknown?: boolean;
}

/**
 * 초안에서 사양 주장을 뽑아 원장과 대조한다.
 *
 * 값을 자연어로 완전 대조하는 건 불가능하다. 대신 상호배타적 속성
 * (원통형↔박스형, 와트조절↔조절없음, 자동↔버튼)만 본다. 이번 사고가
 * 정확히 그 형태였고, 기계적으로 확실하게 잡힌다.
 */
export function findSpecViolations(
  content: string,
  registry: ProductSpecRegistry,
  options: SpecCheckOptions = {}
): SpecViolation[] {
  const flagUnknown = options.flagUnknown ?? true;
  const specs = registry.products;
  if (specs.length === 0 && !flagUnknown) return [];

  const violations: SpecViolation[] = [];

  for (const sentence of splitSentences(content)) {
    const here = mentionedProducts(sentence, specs);

    const checks: Array<{
      attr: string;
      hit: { value: string; index: number } | null;
      registered: (s: ProductSpec) => string | undefined;
    }> = [
      { attr: "형태", hit: firstMatch(sentence, FORM_PATTERNS), registered: (s) => s.form },
      { attr: "흡입방식", hit: firstMatch(sentence, INHALE_PATTERNS), registered: (s) => s.inhaleMode },
      { attr: "입폐호흡", hit: firstMatch(sentence, DRAW_PATTERNS), registered: (s) => s.drawStyle },
    ];

    for (const { attr, hit, registered } of checks) {
      if (!hit) continue;

      // 한 문장에 등록 제품이 둘 이상이면 귀속이 불안정하다.
      // 한국어는 수식이 명사 앞에 와서("버튼 조작과 출력 조절까지 써보고 싶은
      // 입문자는 말론S") 앞뒤 어느 쪽으로도 틀릴 수 있다. 차단 판정이라
      // 정확도를 재현율보다 앞에 둔다 — 비교글 특성상 단일 제품 문장이
      // 충분히 많아서 실제 오류는 여전히 잡힌다.
      if (here.length > 1) continue;
      if (sentence.length > MAX_ATTRIBUTABLE_LENGTH) continue;

      const owner = here.length === 1 ? here[0] : attributeTo(sentence, hit.index, specs);

      if (!owner) {
        // 등록된 제품이 문장에 없는데 사양 주장만 있다. 일반론일 수 있어 넘긴다.
        continue;
      }
      const known = registered(owner);
      if (known === undefined) {
        if (flagUnknown) {
          violations.push({
            kind: "미확인",
            product: owner.name,
            attribute: attr,
            claimed: String(hit.value),
            sentence,
          });
        }
        continue;
      }
      // 겸용은 자동/버튼 주장과 충돌하지 않는다.
      if ((attr === "흡입방식" || attr === "입폐호흡") && known === "겸용") continue;
      if (known !== hit.value) {
        violations.push({
          kind: "모순",
          product: owner.name,
          attribute: attr,
          claimed: String(hit.value),
          registered: known,
          sentence,
        });
      }
    }

    // 조절 축(와트/흡입압)은 독립된 불리언이라 따로 본다.
    // 와트 조절이 없으면서 흡입압 조절이 있는 기기가 실제로 있다(크로스미니6).
    // 축마다 한 번씩만 판정한다. 부정형 패턴을 긍정형보다 앞에 뒀으므로
    // 먼저 걸린 쪽이 이긴다. 전체 루프를 break하면 한 문장이 여러 축을
    // 주장할 때(출력 조절 + 충전) 뒤쪽 축이 통째로 안 걸린다.
    const judgedAxes = new Set<string>();
    for (const claim of AXIS_CLAIMS) {
      if (judgedAxes.has(claim.field)) continue;
      const m = claim.re.exec(sentence);
      if (!m) continue;
      if (NEGATION_AFTER.test(sentence.slice(m.index + m[0].length))) continue;
      if (here.length > 1) break;
      if (sentence.length > MAX_ATTRIBUTABLE_LENGTH) break;
      judgedAxes.add(claim.field);

      const owner = here.length === 1 ? here[0] : attributeTo(sentence, m.index, specs);
      if (!owner) break;

      const known = owner[claim.field];
      if (known === undefined) {
        if (flagUnknown) {
          violations.push({
            kind: "미확인",
            product: owner.name,
            attribute: claim.attr,
            claimed: claim.value ? "가능" : "불가",
            sentence,
          });
        }
      } else if (known !== claim.value) {
        violations.push({
          kind: "모순",
          product: owner.name,
          attribute: claim.attr,
          claimed: claim.value ? "가능" : "불가",
          registered: known ? "가능" : "불가",
          sentence,
        });
      }
    }

    // 니코틴 등급어(고농도/기본농도)가 등록된 농도와 맞는지 본다.
    // 숫자를 안 쓰고 등급어만 틀리는 경우가 따로 있다.
    {
      const grade = firstMatch(sentence, NICOTINE_GRADE_PATTERNS);
      if (grade && here.length === 1 && sentence.length <= MAX_ATTRIBUTABLE_LENGTH) {
        const spec = here[0];
        if (spec.nicotinePercent !== undefined) {
          const isHigh = spec.nicotinePercent > HIGH_NICOTINE_THRESHOLD;
          if (isHigh !== grade.value) {
            violations.push({
              kind: "모순",
              product: spec.name,
              attribute: "니코틴등급",
              claimed: grade.value ? "고농도" : "기본농도",
              registered: `${spec.nicotinePercent}% (${isHigh ? "고농도" : "기본농도"})`,
              sentence,
            });
          }
        }
      }
    }

    // 수치형 사양은 값 대조 대신 "그 항목이 원장에 있는지"만 본다.
    if (flagUnknown) {
      for (const claim of NUMERIC_CLAIMS) {
        if (!claim.re.test(sentence)) continue;
        for (const spec of here) {
          if (claim.fields.every((f) => spec[f] === undefined)) {
            violations.push({
              kind: "미확인",
              product: spec.name,
              attribute: claim.attr,
              sentence,
            });
          }
        }
      }
    }

    // 1인칭 경험 주장 + 제품명이 같이 있으면 근거를 요구한다.
    if (FIRSTHAND_PATTERN.test(sentence) && here.length > 0) {
      for (const spec of here) {
        violations.push({
          kind: "근거없는경험",
          product: spec.name,
          attribute: "사용경험",
          sentence,
        });
      }
    }
  }

  return violations;
}

/** 위반을 사람이 읽을 문장으로. 차단 사유로 그대로 노출된다. */
export function describeSpecViolation(v: SpecViolation): string {
  const head = `${v.product} ${v.attribute}`;
  if (v.kind === "모순") {
    return `사양 모순: ${head} — 원장에는 "${v.registered}"인데 본문은 "${v.claimed}"로 썼습니다. (${v.sentence.slice(0, 60)})`;
  }
  if (v.kind === "미확인") {
    return `미확인 사양 주장: ${head} — 원장에 값이 없는데 본문이 단정했습니다. 사양을 등록하거나 문장을 빼세요. (${v.sentence.slice(0, 60)})`;
  }
  return `근거 없는 사용 경험: ${v.product} — "직접 써봤다"는 표현은 실제 사용 기록이 있을 때만 씁니다. (${v.sentence.slice(0, 60)})`;
}

/**
 * 프롬프트에 넣을 사실 시트.
 *
 * 모르는 항목은 아예 적지 않는다. "미상"이라고 적으면 모델이 그 칸을
 * 채우려 든다 — 빈칸은 채워야 할 것으로 읽히기 때문이다.
 */
export function buildProductFactSheet(registry: ProductSpecRegistry): string {
  const domain = registry.domainNotes ?? [];
  if (registry.products.length === 0 && domain.length === 0) return "";

  const lines = registry.products.map((s) => {
    const bits: string[] = [];
    if (s.officialName) bits.push(`정식명 ${s.officialName}`);
    if (s.form) bits.push(`형태 ${s.form}`);
    if (s.inhaleMode) bits.push(`격발 ${s.inhaleMode}`);
    if (s.drawStyle) bits.push(`흡입 ${s.drawStyle}`);
    if (s.wattControl !== undefined) bits.push(`출력(와트) 조절 ${s.wattControl ? "가능" : "없음"}`);
    if (s.airflowControl !== undefined) bits.push(`흡입압 조절 ${s.airflowControl ? "가능" : "없음"}`);
    if (s.batteryRechargeable !== undefined)
      bits.push(`배터리 충전 ${s.batteryRechargeable ? "가능" : "불가"}`);
    if (s.liquidRefillable !== undefined)
      bits.push(`액상 리필 ${s.liquidRefillable ? "가능" : "불가(주입 완료 상태)"}`);
    if (s.batteryMah) bits.push(`배터리 ${s.batteryMah}mAh`);
    if (s.podMl) bits.push(`팟용량 ${s.podMl}`);
    if (s.liquidMl) bits.push(`액상용량 ${s.liquidMl}`);
    if (s.puffs) bits.push(`표기 퍼프 ${s.puffs.toLocaleString("ko-KR")}`);
    if (s.nicotinePercent !== undefined) bits.push(`니코틴 ${s.nicotinePercent}%`);
    if (s.wattRange) bits.push(`출력범위 ${s.wattRange}`);
    if (s.resistanceOhm) bits.push(`저항 ${s.resistanceOhm}`);
    if (s.charging) bits.push(`충전 ${s.charging}`);
    if (s.sizeMm) bits.push(`크기 ${s.sizeMm}`);
    if (s.weightG) bits.push(`무게 ${s.weightG}g`);
    const notes = s.notes?.length ? ` / ${s.notes.join(" / ")}` : "";
    return `- ${s.name}: ${bits.join(", ")}${notes}`;
  });

  return [
    ...(domain.length > 0
      ? ["## 업종 용어와 단위 (아래 정의를 그대로 따를 것)", ...domain.map((n) => `- ${n}`), ""]
      : []),
    "## 확인된 제품 사양 (이 값만 사실로 쓸 것)",
    ...lines,
    "",
    "규칙:",
    "- 위에 적히지 않은 항목은 사실로 단정하지 말 것. 형태, 출력 조절 방식, 배터리, 용량, 저항값 모두 해당한다.",
    "- 모르면 그 이야기를 아예 하지 말 것. 추측을 완곡하게 쓰는 것도 안 된다.",
    "- 위 목록에 없는 제품은 사양을 언급하지 말 것. 이름만 쓰는 건 괜찮다.",
    "- 실제 사용 기록이 주어지지 않았다면 \"직접 써봤다\" 류의 1인칭 경험을 쓰지 말 것.",
  ].join("\n");
}

/** 원장에서 제품을 찾는다. 별칭도 본다. */
export function findSpec(registry: ProductSpecRegistry, name: string): ProductSpec | null {
  const needle = name.trim();
  return (
    registry.products.find((s) => allNames(s).some((n) => n === needle)) ??
    registry.products.find((s) => allNames(s).some((n) => needle.includes(n))) ??
    null
  );
}
