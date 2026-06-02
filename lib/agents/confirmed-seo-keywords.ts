import type { ConfirmedSeoKeywordRejection, ConfirmedSeoKeywords, KeywordContract } from "./types";

interface DirectInputKeywordSource {
  mainKeyword?: string | null;
  subKeywords?: string[] | null;
}

interface PostingTopicKeywordSource {
  title?: string | null;
  targetKeyword?: string | null;
  targetMainKeyword?: string | null;
  subKeywords?: string[] | null;
  keywords?: string[] | null;
}

interface TopicMetadataKeywordSource {
  targetKeyword?: string | null;
  targetMainKeyword?: string | null;
  subKeywords?: string[] | null;
  keywords?: string[] | null;
}

const GENERIC_SEO_KEYWORDS = new Set([
  "비교",
  "추천",
  "기기",
  "제품",
  "기준",
  "사용자",
  "액상",
  "관리",
]);

const BLOCKED_HEADING_PARTS = [
  "체크포인트",
  "기준",
  "먼저",
  "시작 전에",
  "놓치는",
  "알아야 할",
  "확인해야 할",
  "정리",
  "이유",
  "방법",
  "포인트",
];

function normalizeKeyword(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
}

function uniq(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeKeyword(value);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function isHeadingLikeKeyword(value: string): boolean {
  const normalized = normalizeKeyword(value);
  if (!normalized) return true;
  if (normalized.length > 24) return true;
  if (/[?!]/u.test(normalized)) return true;
  if (normalized.split(/\s+/).length >= 5) return true;
  if (BLOCKED_HEADING_PARTS.some((part) => normalized.includes(part))) return true;
  if (/(하는|되는|없는|같은|놓치는|알아야|확인해야|정리하는|보는|잡아야)$/u.test(normalized)) return true;
  if (/[은는이가을를에에서고]$/u.test(normalized)) return true;
  return false;
}

function validateKeywordCandidate(
  value: string | null | undefined,
  rejectedCandidates: ConfirmedSeoKeywordRejection[],
  reasonPrefix: string
): string | null {
  const normalized = normalizeKeyword(value);
  if (!normalized) return null;

  if (GENERIC_SEO_KEYWORDS.has(normalized.toLowerCase())) {
    rejectedCandidates.push({
      value: normalized,
      reason: `${reasonPrefix}: 일반 반복어라 확정 SEO 키워드에서 제외했습니다.`,
    });
    return null;
  }

  if (isHeadingLikeKeyword(normalized)) {
    rejectedCandidates.push({
      value: normalized,
      reason: `${reasonPrefix}: 제목형 또는 문장형 항목이라 확정 SEO 키워드에서 제외했습니다.`,
    });
    return null;
  }

  return normalized;
}

function pickPostingListMainKeyword(
  selectedPostingTopic?: PostingTopicKeywordSource | null,
  topicMetadata?: TopicMetadataKeywordSource | null
): string {
  return normalizeKeyword(
    selectedPostingTopic?.targetKeyword ||
      selectedPostingTopic?.targetMainKeyword ||
      topicMetadata?.targetKeyword ||
      topicMetadata?.targetMainKeyword
  );
}

function pickPostingListSubKeywords(
  selectedPostingTopic?: PostingTopicKeywordSource | null,
  topicMetadata?: TopicMetadataKeywordSource | null
): string[] {
  return uniq([
    ...(selectedPostingTopic?.subKeywords ?? []),
    ...(selectedPostingTopic?.keywords ?? []),
    ...(topicMetadata?.subKeywords ?? []),
    ...(topicMetadata?.keywords ?? []),
  ]);
}

export function buildConfirmedSeoKeywords(params: {
  keywordContract?: Pick<KeywordContract, "mainKeyword" | "subKeywords"> | null;
  directInput?: DirectInputKeywordSource | null;
  selectedPostingTopic?: PostingTopicKeywordSource | null;
  topicMetadata?: TopicMetadataKeywordSource | null;
}): ConfirmedSeoKeywords {
  const rejectedCandidates: ConfirmedSeoKeywordRejection[] = [];

  const contractMain = validateKeywordCandidate(
    params.keywordContract?.mainKeyword,
    rejectedCandidates,
    "keywordContract.mainKeyword"
  );
  const contractSubKeywords = uniq(
    (params.keywordContract?.subKeywords ?? [])
      .map((keyword) => validateKeywordCandidate(keyword, rejectedCandidates, "keywordContract.subKeywords"))
      .filter((keyword): keyword is string => Boolean(keyword))
  );

  if (contractMain || contractSubKeywords.length > 0) {
    return {
      mainKeyword: contractMain,
      subKeywords: contractSubKeywords.filter((keyword) => keyword !== contractMain),
      source: "keywordContract",
      rejectedCandidates,
    };
  }

  const directMain = validateKeywordCandidate(
    params.directInput?.mainKeyword,
    rejectedCandidates,
    "directInput.mainKeyword"
  );
  const directSubKeywords = uniq(
    (params.directInput?.subKeywords ?? [])
      .map((keyword) => validateKeywordCandidate(keyword, rejectedCandidates, "directInput.subKeywords"))
      .filter((keyword): keyword is string => Boolean(keyword))
  );

  if (directMain || directSubKeywords.length > 0) {
    return {
      mainKeyword: directMain,
      subKeywords: directSubKeywords.filter((keyword) => keyword !== directMain),
      source: "directInput",
      rejectedCandidates,
    };
  }

  const postingListRawMain = pickPostingListMainKeyword(params.selectedPostingTopic, params.topicMetadata);
  if (!postingListRawMain && params.selectedPostingTopic?.title) {
    rejectedCandidates.push({
      value: normalizeKeyword(params.selectedPostingTopic.title),
      reason: "이 글 목록 항목에 타깃 키워드가 없습니다.",
    });
  }

  const postingListMain = validateKeywordCandidate(
    postingListRawMain,
    rejectedCandidates,
    "postingList.mainKeyword"
  );
  const postingListSubKeywords = uniq(
    pickPostingListSubKeywords(params.selectedPostingTopic, params.topicMetadata)
      .map((keyword) => validateKeywordCandidate(keyword, rejectedCandidates, "postingList.subKeywords"))
      .filter((keyword): keyword is string => Boolean(keyword))
  );

  if (postingListMain || postingListSubKeywords.length > 0) {
    return {
      mainKeyword: postingListMain,
      subKeywords: postingListSubKeywords.filter((keyword) => keyword !== postingListMain),
      source: "postingList",
      rejectedCandidates,
    };
  }

  return {
    mainKeyword: null,
    subKeywords: [],
    source: "none",
    rejectedCandidates,
  };
}
