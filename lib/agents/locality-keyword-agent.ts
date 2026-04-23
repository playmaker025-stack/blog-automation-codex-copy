import { Paths } from "@/lib/github/paths";
import { fileExists, readJsonFile, writeJsonFile } from "@/lib/github/repository";
import type { PostingIndex } from "@/lib/types/github-data";
import type { StrategyPlanResult, WriterResult } from "./types";

export const PRIMARY_LOCALITY_PRIORITY = [
  "인천",
  "부평",
  "만수",
  "구월",
  "부평역",
  "만수역",
  "계산동",
  "남동구",
  "부평구",
  "부평시장",
  "부평구청",
  "부천",
  "상동",
  "중동",
];

export const SECONDARY_LOCALITY_PRIORITY = [
  "주안",
  "간석",
  "계산",
  "삼산동",
  "백운",
  "부개동",
  "작전동",
  "청천동",
];

const OTHER_INCHEON_LOCALITIES = [
  "송도",
  "청라",
  "연수",
  "검단",
  "서창동",
  "논현동",
  "동암",
  "산곡동",
  "남동구청",
];

const NEARBY_LOCALITY_MAP: Record<string, string[]> = {
  부평: ["부평역", "부평시장", "부평구청", "청천동", "산곡동", "계산동"],
  부평역: ["부평", "부평시장", "부평구청", "백운", "부개동"],
  만수: ["만수역", "구월동", "서창동", "남동구청", "부천", "상동", "중동"],
  만수역: ["만수", "구월동", "서창동", "남동구청"],
  구월: ["만수동", "남동구청", "간석", "주안", "서창동"],
  구월동: ["만수동", "남동구청", "간석", "주안", "서창동"],
  인천: ["부평", "만수", "구월", "주안", "간석"],
  계산동: ["계산", "작전동", "부평구청", "부평", "청천동"],
  계산: ["계산동", "작전동", "부평구청", "부평"],
  남동구: ["만수", "구월", "남동구청", "서창동", "논현동"],
  부평구: ["부평", "부평역", "부평시장", "부평구청", "청천동", "산곡동"],
  부천: ["상동", "중동", "부평", "부평역"],
  상동: ["부천", "중동", "부평", "부평역"],
  중동: ["부천", "상동", "부평", "부평역"],
};

const PRODUCT_KEYWORDS = [
  "전자담배",
  "액상",
  "기기",
  "입문기기",
  "팟",
  "코일",
  "폐호흡",
  "입호흡",
  "일회용",
  "추천",
  "사용법",
  "누수",
];

const FOUR_DAYS_MS = 4 * 24 * 60 * 60 * 1000;

interface LocalityKeywordLedgerEntry {
  keyword: string;
  phrase: string;
  title: string;
  postId: string;
  topicId: string;
  userId: string;
  usedAt: string;
}

interface LocalityKeywordLedger {
  userId: string;
  entries: LocalityKeywordLedgerEntry[];
  updatedAt: string;
}

export interface LocalityKeywordPlan {
  mainLocality: string | null;
  selectedKeywords: string[];
  skippedRecentKeywords: string[];
  writerBrief: string;
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function findFirstLocality(text: string): string | null {
  const compact = text.replace(/\s+/g, "");
  const all = [...PRIMARY_LOCALITY_PRIORITY, ...SECONDARY_LOCALITY_PRIORITY, ...OTHER_INCHEON_LOCALITIES];
  return all.find((term) => compact.includes(term.replace(/\s+/g, ""))) ?? null;
}

function extractKnownKeywords(text: string): string[] {
  const compact = text.replace(/\s+/g, "");
  return unique(
    [...PRIMARY_LOCALITY_PRIORITY, ...SECONDARY_LOCALITY_PRIORITY, ...OTHER_INCHEON_LOCALITIES, ...PRODUCT_KEYWORDS]
      .filter((keyword) => compact.includes(keyword.replace(/\s+/g, "")))
  );
}

async function readLedger(userId: string): Promise<{ ledger: LocalityKeywordLedger; sha: string | null }> {
  const path = Paths.localityKeywordLedger(userId);
  if (!(await fileExists(path))) {
    return { ledger: { userId, entries: [], updatedAt: new Date().toISOString() }, sha: null };
  }
  const { data, sha } = await readJsonFile<LocalityKeywordLedger>(path);
  return {
    ledger: {
      userId,
      entries: Array.isArray(data.entries) ? data.entries : [],
      updatedAt: data.updatedAt ?? new Date().toISOString(),
    },
    sha,
  };
}

function recentKeywordSet(ledger: LocalityKeywordLedger): Set<string> {
  const cutoff = Date.now() - FOUR_DAYS_MS;
  return new Set(
    ledger.entries
      .filter((entry) => Date.parse(entry.usedAt) >= cutoff)
      .map((entry) => entry.keyword)
  );
}

function findSentenceWithKeyword(content: string, keyword: string): string | null {
  const normalized = content.replace(/\r/g, "\n");
  const chunks = normalized
    .split(/(?<=[.!?。！？])\s+|\n+/u)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  return chunks.find((chunk) => chunk.includes(keyword))?.slice(0, 180) ?? null;
}

export class LocalityKeywordAgent {
  async buildPreWritePlan(params: {
    userId: string;
    strategy: StrategyPlanResult;
    topicId: string;
  }): Promise<LocalityKeywordPlan> {
    const { userId, strategy, topicId } = params;
    const { ledger } = await readLedger(userId);
    const recent = recentKeywordSet(ledger);
    const mainLocality = findFirstLocality(strategy.title) ?? findFirstLocality(strategy.keywords.join(" "));

    const postingIndex = await readJsonFile<PostingIndex>(Paths.postingListIndex())
      .then((result) => result.data)
      .catch(() => ({ posts: [], lastUpdated: new Date().toISOString() }));

    const pendingKeywordCandidates = postingIndex.posts
      .filter((post) => post.topicId !== topicId)
      .filter((post) => !["published", "failed"].includes(post.status))
      .flatMap((post) => extractKnownKeywords(post.title));

    const nearby = mainLocality ? (NEARBY_LOCALITY_MAP[mainLocality] ?? []) : [];
    const localityPool = mainLocality
      ? unique([...nearby, ...SECONDARY_LOCALITY_PRIORITY, ...OTHER_INCHEON_LOCALITIES])
      : unique([...PRIMARY_LOCALITY_PRIORITY, ...SECONDARY_LOCALITY_PRIORITY]);

    const candidatePool = unique([
      ...localityPool,
      ...pendingKeywordCandidates,
      ...strategy.keywords.flatMap(extractKnownKeywords),
    ]);

    const selectedKeywords = candidatePool.filter((keyword) => !recent.has(keyword)).slice(0, 4);
    const skippedRecentKeywords = candidatePool.filter((keyword) => recent.has(keyword)).slice(0, 8);

    const writerBrief = selectedKeywords.length
      ? [
          "## Locality and reserve-keyword rotation",
          `Main locality: ${mainLocality ?? "not detected"}`,
          "Use 1-2 of the selected nearby/reserve keywords naturally in the body.",
          "Each selected keyword should appear 1-2 times at most. Do not force awkward sentences.",
          "If a selected keyword does not fit the paragraph, skip it instead of stuffing it.",
          "Selected keywords:",
          ...selectedKeywords.map((keyword) => `- ${keyword}`),
          skippedRecentKeywords.length
            ? `Recently used within 4 days, avoid for this draft: ${skippedRecentKeywords.join(", ")}`
            : "No recent 4-day keyword conflict found.",
        ].join("\n")
      : [
          "## Locality and reserve-keyword rotation",
          "No safe nearby/reserve keyword is available because the 4-day rotation is exhausted.",
          "Do not force extra locality keywords for this draft.",
        ].join("\n");

    return { mainLocality, selectedKeywords, skippedRecentKeywords, writerBrief };
  }

  async recordUsedKeywords(params: {
    userId: string;
    topicId: string;
    writerResult: WriterResult;
    plan: LocalityKeywordPlan;
  }): Promise<void> {
    if (params.plan.selectedKeywords.length === 0) return;

    const { ledger, sha } = await readLedger(params.userId);
    const now = new Date().toISOString();
    const newEntries = params.plan.selectedKeywords
      .map((keyword) => {
        const phrase = findSentenceWithKeyword(params.writerResult.content, keyword);
        if (!phrase) return null;
        return {
          keyword,
          phrase,
          title: params.writerResult.title,
          postId: params.writerResult.postId,
          topicId: params.topicId,
          userId: params.userId,
          usedAt: now,
        } satisfies LocalityKeywordLedgerEntry;
      })
      .filter((entry): entry is LocalityKeywordLedgerEntry => Boolean(entry));

    if (newEntries.length === 0) return;

    const updated: LocalityKeywordLedger = {
      userId: params.userId,
      entries: [...newEntries, ...ledger.entries].slice(0, 500),
      updatedAt: now,
    };

    await writeJsonFile(
      Paths.localityKeywordLedger(params.userId),
      updated,
      `chore: record locality keywords for ${params.writerResult.postId}`,
      sha
    );
  }
}

export const localityKeywordAgent = new LocalityKeywordAgent();
