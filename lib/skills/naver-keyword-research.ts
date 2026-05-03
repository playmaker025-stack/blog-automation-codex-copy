/**
 * 네이버 검색/데이터랩 통합 리서치
 *
 * - 검색 API: blog / kin / cafearticle
 * - DataLab: 통합 검색어 트렌드
 * - DataLab Shopping: category/keywords, category/keyword/device
 *
 * 검색 채널별 신호를 한 번에 모아 토픽 생성과 전략 수립에서
 * 블로그 편향을 줄이고 질문형/커뮤니티형/상업형 의도를 함께 본다.
 */

export interface NaverKeywordResearchInput {
  keyword: string;
  display?: number;
  shoppingCategory?: string;
  shoppingKeywords?: string[];
}

export interface NaverSearchItem {
  title: string;
  link: string;
  description: string;
  sourceName?: string;
  postdate?: string;
}

interface NaverSearchApiItem {
  title?: string;
  link?: string;
  description?: string;
  bloggername?: string;
  cafename?: string;
  postdate?: string;
}

export interface NaverSearchChannelReport {
  total: number;
  recent30dRatioPercent: number;
  topItems: NaverSearchItem[];
}

export interface NaverDatalabSearchReport {
  available: boolean;
  startDate: string;
  endDate: string;
  latestRatio: number;
  averageRatio: number;
  peakRatio: number;
  trend: "rising" | "steady" | "falling";
}

export interface NaverShoppingKeywordRatio {
  keyword: string;
  peakRatio: number;
  averageRatio: number;
}

export interface NaverShoppingDeviceReport {
  available: boolean;
  category: string;
  keyword: string;
  pcPeakRatio: number;
  mobilePeakRatio: number;
  dominantDevice: "pc" | "mobile" | "balanced";
}

export interface NaverShoppingReport {
  available: boolean;
  category: string;
  keywordRatios: NaverShoppingKeywordRatio[];
  topKeyword?: string;
  device?: NaverShoppingDeviceReport;
  intentStrength: "low" | "medium" | "high";
}

export interface NaverKeywordResearchOutput {
  keyword: string;
  blog: NaverSearchChannelReport & {
    competition: "low" | "medium" | "high";
  };
  kin: NaverSearchChannelReport;
  cafe: NaverSearchChannelReport;
  relatedKeywords: Array<{ word: string; count: number }>;
  longtailSuggestions: string[];
  questionIntents: string[];
  communitySignals: string[];
  datalabSearch: NaverDatalabSearchReport;
  shopping?: NaverShoppingReport;
  summary: {
    intentMix: string[];
    contentAngles: string[];
    commercialSignals: string[];
  };
  error?: string;
}

type SearchKind = "blog" | "kin" | "cafearticle";
type ShoppingIntentStrength = "low" | "medium" | "high";

const STOP_WORDS = new Set([
  "그리고",
  "으로",
  "에서",
  "하는",
  "하면",
  "대한",
  "정리",
  "후기",
  "추천",
  "리뷰",
  "가이드",
  "방법",
  "정보",
  "사용",
  "비교",
  "무엇",
  "있나요",
  "어떤",
  "어디",
  "이유",
  "정도",
]);

function stripTags(value: string): string {
  return (value ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function normalizeText(value: string): string {
  return stripTags(value).replace(/\s+/g, " ").trim();
}

function competitionLevel(total: number): "low" | "medium" | "high" {
  if (total >= 100_000) return "high";
  if (total >= 30_000) return "medium";
  return "low";
}

function uniq(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function tokenize(text: string): string[] {
  return normalizeText(text)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2 && !STOP_WORDS.has(word));
}

function extractRelatedWords(
  items: NaverSearchItem[],
  mainKeyword: string,
): Array<{ word: string; count: number }> {
  const counts = new Map<string, number>();
  const mainTokens = new Set(tokenize(mainKeyword));

  for (const item of items) {
    const words = tokenize(`${item.title} ${item.description}`);
    for (const word of words) {
      if (mainTokens.has(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([word, count]) => ({ word, count }));
}

function recentRatio(items: NaverSearchItem[], days = 30): number {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const recent = items.filter((item) => {
    if (!item.postdate || item.postdate.length !== 8) return false;
    const year = item.postdate.slice(0, 4);
    const month = item.postdate.slice(4, 6);
    const day = item.postdate.slice(6, 8);
    return new Date(`${year}-${month}-${day}`).getTime() >= cutoff;
  });
  return items.length > 0 ? (recent.length / items.length) * 100 : 0;
}

function toSearchItems(items: NaverSearchApiItem[]): NaverSearchItem[] {
  return items.map((item) => ({
    title: normalizeText(item.title ?? ""),
    link: item.link ?? "",
    description: normalizeText(item.description ?? "").slice(0, 200),
    sourceName: item.bloggername ?? item.cafename,
    postdate: item.postdate,
  }));
}

function pickQuestionIntents(items: NaverSearchItem[], keyword: string): string[] {
  const keywordTokens = new Set(tokenize(keyword));
  const candidates = items
    .flatMap((item) => tokenize(item.title))
    .filter((word) => !keywordTokens.has(word));
  return uniq(candidates).slice(0, 8);
}

function pickCommunitySignals(items: NaverSearchItem[], keyword: string): string[] {
  const keywordTokens = new Set(tokenize(keyword));
  const candidates = items
    .flatMap((item) => tokenize(`${item.title} ${item.description}`))
    .filter((word) => !keywordTokens.has(word));
  return uniq(candidates).slice(0, 8);
}

function makeLongtails(
  keyword: string,
  relatedKeywords: Array<{ word: string; count: number }>,
  questionIntents: string[],
): string[] {
  const suggestions = [
    ...relatedKeywords.slice(0, 5).map((item) => `${keyword} ${item.word}`),
    ...questionIntents.slice(0, 3).map((item) => `${keyword} ${item}`),
  ];
  return uniq(suggestions).slice(0, 8);
}

function classifyTrend(latestRatio: number, averageRatio: number): "rising" | "steady" | "falling" {
  if (latestRatio >= averageRatio * 1.15) return "rising";
  if (latestRatio <= averageRatio * 0.85) return "falling";
  return "steady";
}

function summarizeIntentMix(params: {
  kinTotal: number;
  cafeTotal: number;
  shopping?: NaverShoppingReport;
  trend: NaverDatalabSearchReport["trend"];
}): string[] {
  const result: string[] = [];

  if (params.kinTotal > 0) {
    result.push("질문형 검색 수요를 반영한 문제 해결 문장이 필요합니다.");
  }
  if (params.cafeTotal > 0) {
    result.push("카페 커뮤니티 관점의 후기/비교/실사용 맥락을 보강할 수 있습니다.");
  }
  if (params.trend === "rising") {
    result.push("최근 검색 추세가 상승 중이라 발행 우선순위를 높일 만합니다.");
  }
  if (params.shopping?.intentStrength === "high") {
    result.push("쇼핑 클릭 신호가 강해 비교형·구매검토형 문맥이 잘 맞습니다.");
  }

  if (result.length === 0) {
    result.push("블로그형 정보 탐색 의도가 우세한 일반 정보 키워드입니다.");
  }

  return result;
}

function summarizeContentAngles(params: {
  relatedKeywords: Array<{ word: string; count: number }>;
  questionIntents: string[];
  communitySignals: string[];
}): string[] {
  return uniq([
    ...params.relatedKeywords.slice(0, 4).map((item) => `${item.word} 관점 설명`),
    ...params.questionIntents.slice(0, 2).map((item) => `${item} 질문에 답하는 구조`),
    ...params.communitySignals.slice(0, 2).map((item) => `${item} 후기/체감 포인트`),
  ]).slice(0, 8);
}

function summarizeCommercialSignals(shopping?: NaverShoppingReport): string[] {
  if (!shopping?.available) {
    return ["쇼핑 데이터가 없거나 카테고리 미지정 상태입니다."];
  }

  const signals: string[] = [];
  if (shopping.topKeyword) {
    signals.push(`쇼핑 클릭 비중이 가장 강한 키워드는 "${shopping.topKeyword}"입니다.`);
  }
  if (shopping.device) {
    signals.push(`쇼핑 탐색 주기기는 ${shopping.device.dominantDevice}입니다.`);
  }
  signals.push(`쇼핑 의도 강도는 ${shopping.intentStrength}입니다.`);
  return signals;
}

function buildDateRange(days: number): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000);
  const format = (value: Date) => value.toISOString().slice(0, 10);
  return { startDate: format(start), endDate: format(end) };
}

function requireNaverCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경 변수가 없습니다.");
  }
  return { clientId, clientSecret };
}

async function fetchNaverJson<T>(url: string, init?: RequestInit): Promise<T> {
  const { clientId, clientSecret } = requireNaverCredentials();
  const response = await fetch(url, {
    ...init,
    headers: {
      "X-Naver-Client-Id": clientId,
      "X-Naver-Client-Secret": clientSecret,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: init?.signal ?? AbortSignal.timeout(10_000),
  });

  const json = (await response.json()) as T & {
    errorCode?: string;
    errorMessage?: string;
  };

  if (!response.ok || json.errorCode) {
    throw new Error(`Naver API 오류: ${json.errorMessage ?? response.status}`);
  }

  return json;
}

async function naverSearch(
  kind: SearchKind,
  query: string,
  display: number,
  sort: "sim" | "date",
): Promise<{ total: number; items: NaverSearchItem[] }> {
  const url =
    `https://openapi.naver.com/v1/search/${kind}` +
    `?query=${encodeURIComponent(query)}&display=${display}&sort=${sort}`;

  const json = await fetchNaverJson<{
    total?: number;
    items?: NaverSearchApiItem[];
  }>(url, {
    method: "GET",
    signal: AbortSignal.timeout(10_000),
  });

  return {
    total: json.total ?? 0,
    items: toSearchItems(json.items ?? []),
  };
}

async function fetchDatalabSearch(keyword: string): Promise<NaverDatalabSearchReport> {
  const { startDate, endDate } = buildDateRange(30);
  const json = await fetchNaverJson<{
    results?: Array<{ data?: Array<{ ratio?: number }> }>;
  }>("https://openapi.naver.com/v1/datalab/search", {
    method: "POST",
    body: JSON.stringify({
      startDate,
      endDate,
      timeUnit: "date",
      keywordGroups: [{ groupName: keyword, keywords: [keyword] }],
    }),
    signal: AbortSignal.timeout(10_000),
  });

  const ratios = (json.results?.[0]?.data ?? [])
    .map((item) => item.ratio ?? 0)
    .filter((ratio) => Number.isFinite(ratio));
  const latestRatio = ratios.at(-1) ?? 0;
  const averageRatio = ratios.length > 0
    ? ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length
    : 0;
  const peakRatio = ratios.length > 0 ? Math.max(...ratios) : 0;

  return {
    available: ratios.length > 0,
    startDate,
    endDate,
    latestRatio: Number(latestRatio.toFixed(1)),
    averageRatio: Number(averageRatio.toFixed(1)),
    peakRatio: Number(peakRatio.toFixed(1)),
    trend: classifyTrend(latestRatio, averageRatio || 1),
  };
}

async function fetchShoppingKeywords(params: {
  category: string;
  keyword: string;
  shoppingKeywords: string[];
}): Promise<NaverShoppingKeywordRatio[]> {
  const { startDate, endDate } = buildDateRange(30);
  const keywords = uniq([params.keyword, ...params.shoppingKeywords]).slice(0, 5);

  const json = await fetchNaverJson<{
    results?: Array<{ title?: string; data?: Array<{ ratio?: number }> }>;
  }>("https://openapi.naver.com/v1/datalab/shopping/category/keywords", {
    method: "POST",
    body: JSON.stringify({
      startDate,
      endDate,
      timeUnit: "date",
      category: params.category,
      keyword: keywords.map((item) => ({
        name: item,
        param: [item],
      })),
    }),
    signal: AbortSignal.timeout(10_000),
  });

  return (json.results ?? []).map((item) => {
    const ratios = (item.data ?? []).map((row) => row.ratio ?? 0);
    const peakRatio = ratios.length > 0 ? Math.max(...ratios) : 0;
    const averageRatio = ratios.length > 0
      ? ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length
      : 0;
    return {
      keyword: item.title ?? "",
      peakRatio: Number(peakRatio.toFixed(1)),
      averageRatio: Number(averageRatio.toFixed(1)),
    };
  });
}

async function fetchShoppingDevice(params: {
  category: string;
  keyword: string;
}): Promise<NaverShoppingDeviceReport> {
  const { startDate, endDate } = buildDateRange(30);
  const json = await fetchNaverJson<{
    results?: Array<{ data?: Array<{ group?: string; ratio?: number }> }>;
  }>("https://openapi.naver.com/v1/datalab/shopping/category/keyword/device", {
    method: "POST",
    body: JSON.stringify({
      startDate,
      endDate,
      timeUnit: "date",
      category: params.category,
      keyword: params.keyword,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  const data = json.results?.[0]?.data ?? [];
  const pcPeakRatio = Math.max(0, ...data.filter((row) => row.group === "pc").map((row) => row.ratio ?? 0));
  const mobilePeakRatio = Math.max(0, ...data.filter((row) => row.group === "mo").map((row) => row.ratio ?? 0));

  let dominantDevice: "pc" | "mobile" | "balanced" = "balanced";
  if (mobilePeakRatio >= pcPeakRatio * 1.1) dominantDevice = "mobile";
  else if (pcPeakRatio >= mobilePeakRatio * 1.1) dominantDevice = "pc";

  return {
    available: data.length > 0,
    category: params.category,
    keyword: params.keyword,
    pcPeakRatio: Number(pcPeakRatio.toFixed(1)),
    mobilePeakRatio: Number(mobilePeakRatio.toFixed(1)),
    dominantDevice,
  };
}

function classifyShoppingIntent(keywordRatios: NaverShoppingKeywordRatio[]): ShoppingIntentStrength {
  const peak = Math.max(0, ...keywordRatios.map((item) => item.peakRatio));
  if (peak >= 70) return "high";
  if (peak >= 35) return "medium";
  return "low";
}

export async function naverKeywordResearch(
  input: NaverKeywordResearchInput,
): Promise<NaverKeywordResearchOutput> {
  const { keyword, display = 30, shoppingCategory, shoppingKeywords = [] } = input;

  try {
    const [blogByDate, blogBySim, kinByDate, kinBySim, cafeByDate, cafeBySim, datalabSearch] =
      await Promise.all([
        naverSearch("blog", keyword, display, "date"),
        naverSearch("blog", keyword, 1, "sim"),
        naverSearch("kin", keyword, display, "date"),
        naverSearch("kin", keyword, 1, "sim"),
        naverSearch("cafearticle", keyword, display, "date"),
        naverSearch("cafearticle", keyword, 1, "sim"),
        fetchDatalabSearch(keyword),
      ]);

    const relatedKeywords = extractRelatedWords(blogByDate.items, keyword);
    const questionIntents = pickQuestionIntents(kinByDate.items, keyword);
    const communitySignals = pickCommunitySignals(cafeByDate.items, keyword);
    const longtailSuggestions = makeLongtails(keyword, relatedKeywords, questionIntents);

    let shopping: NaverShoppingReport | undefined;
    if (shoppingCategory) {
      const keywordRatios = await fetchShoppingKeywords({
        category: shoppingCategory,
        keyword,
        shoppingKeywords: shoppingKeywords.length > 0 ? shoppingKeywords : longtailSuggestions,
      });
      const topKeyword = [...keywordRatios].sort((a, b) => b.peakRatio - a.peakRatio)[0]?.keyword;
      const deviceKeyword = topKeyword ?? keyword;
      const device = await fetchShoppingDevice({
        category: shoppingCategory,
        keyword: deviceKeyword,
      });

      shopping = {
        available: keywordRatios.length > 0,
        category: shoppingCategory,
        keywordRatios,
        topKeyword,
        device,
        intentStrength: classifyShoppingIntent(keywordRatios),
      };
    }

    const summary = {
      intentMix: summarizeIntentMix({
        kinTotal: kinBySim.total,
        cafeTotal: cafeBySim.total,
        shopping,
        trend: datalabSearch.trend,
      }),
      contentAngles: summarizeContentAngles({
        relatedKeywords,
        questionIntents,
        communitySignals,
      }),
      commercialSignals: summarizeCommercialSignals(shopping),
    };

    return {
      keyword,
      blog: {
        total: blogBySim.total,
        competition: competitionLevel(blogBySim.total),
        recent30dRatioPercent: Number(recentRatio(blogByDate.items).toFixed(1)),
        topItems: blogByDate.items.slice(0, 10),
      },
      kin: {
        total: kinBySim.total,
        recent30dRatioPercent: Number(recentRatio(kinByDate.items).toFixed(1)),
        topItems: kinByDate.items.slice(0, 10),
      },
      cafe: {
        total: cafeBySim.total,
        recent30dRatioPercent: Number(recentRatio(cafeByDate.items).toFixed(1)),
        topItems: cafeByDate.items.slice(0, 10),
      },
      relatedKeywords,
      longtailSuggestions,
      questionIntents,
      communitySignals,
      datalabSearch,
      shopping,
      summary,
    };
  } catch (error) {
    return {
      keyword,
      blog: { total: 0, competition: "low", recent30dRatioPercent: 0, topItems: [] },
      kin: { total: 0, recent30dRatioPercent: 0, topItems: [] },
      cafe: { total: 0, recent30dRatioPercent: 0, topItems: [] },
      relatedKeywords: [],
      longtailSuggestions: [],
      questionIntents: [],
      communitySignals: [],
      datalabSearch: {
        available: false,
        startDate: "",
        endDate: "",
        latestRatio: 0,
        averageRatio: 0,
        peakRatio: 0,
        trend: "steady",
      },
      shopping: shoppingCategory
        ? {
            available: false,
            category: shoppingCategory,
            keywordRatios: [],
            intentStrength: "low",
          }
        : undefined,
      summary: {
        intentMix: [],
        contentAngles: [],
        commercialSignals: [],
      },
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
