function stripTags(value: string): string {
  return (value ?? "").replace(/<[^>]+>/g, "").trim();
}

async function searchNaver(
  kind: "cafearticle" | "kin",
  query: string,
  display: number
): Promise<{ total: number; items: Array<Record<string, string>> }> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("NAVER_CLIENT_ID / NAVER_CLIENT_SECRET environment variables are missing.");
  }

  const url =
    `https://openapi.naver.com/v1/search/${kind}` +
    `?query=${encodeURIComponent(query)}&display=${display}&sort=date`;

  const response = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": clientId,
      "X-Naver-Client-Secret": clientSecret,
    },
    signal: AbortSignal.timeout(10_000),
  });

  const json = (await response.json()) as {
    total?: number;
    items?: Array<Record<string, string>>;
    errorCode?: string;
    errorMessage?: string;
  };

  if (!response.ok || json.errorCode) {
    throw new Error(`Naver ${kind} API error: ${json.errorMessage ?? response.status}`);
  }

  return {
    total: json.total ?? 0,
    items: json.items ?? [],
  };
}

function buildRepeatedPhraseSummary(titles: string[]): string[] {
  const counts = new Map<string, number>();

  for (const title of titles) {
    const words = title
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => word.length >= 2);

    for (const word of words) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word, count]) => `${word}(${count})`);
}

export interface NaverCafeItem {
  title: string;
  link: string;
  description: string;
  cafename: string;
}

export interface NaverCafeSearchOutput {
  keyword: string;
  total: number;
  items: NaverCafeItem[];
  demandSummary: string;
  error?: string;
}

export async function naverCafeSearch(input: {
  keyword: string;
  display?: number;
}): Promise<NaverCafeSearchOutput> {
  const { keyword, display = 20 } = input;

  try {
    const { total, items } = await searchNaver("cafearticle", keyword, display);
    const parsed: NaverCafeItem[] = items.map((item) => ({
      title: stripTags(item.title ?? ""),
      link: item.link ?? "",
      description: stripTags(item.description ?? "").slice(0, 160),
      cafename: item.cafename ?? "",
    }));

    const repeatedPhrases = buildRepeatedPhraseSummary(parsed.map((item) => item.title));
    const recentTitles = parsed.slice(0, 3).map((item) => item.title).filter(Boolean);

    const demandSummary =
      total === 0
        ? "Cafe demand signal not found."
        : [
            `total=${total.toLocaleString()}`,
            repeatedPhrases.length ? `repeated=${repeatedPhrases.join(", ")}` : "",
            recentTitles.length ? `recent=${recentTitles.join(" / ")}` : "",
          ]
            .filter(Boolean)
            .join(" | ");

    return {
      keyword,
      total,
      items: parsed.slice(0, 10),
      demandSummary,
    };
  } catch (error) {
    return {
      keyword,
      total: 0,
      items: [],
      demandSummary: "Cafe demand research failed.",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface NaverKinItem {
  title: string;
  link: string;
  description: string;
}

export interface NaverKinSearchOutput {
  keyword: string;
  total: number;
  items: NaverKinItem[];
  problemSummary: string;
  error?: string;
}

export async function naverKinSearch(input: {
  keyword: string;
  display?: number;
}): Promise<NaverKinSearchOutput> {
  const { keyword, display = 20 } = input;

  try {
    const { total, items } = await searchNaver("kin", keyword, display);
    const parsed: NaverKinItem[] = items.map((item) => ({
      title: stripTags(item.title ?? ""),
      link: item.link ?? "",
      description: stripTags(item.description ?? "").slice(0, 160),
    }));

    const questionTitles = parsed.slice(0, 5).map((item) => item.title).filter(Boolean);

    const problemSummary =
      total === 0
        ? "KnowledgeIn problem signal not found."
        : [
            `total=${total.toLocaleString()}`,
            questionTitles.length ? `questions=${questionTitles.join(" / ")}` : "",
          ]
            .filter(Boolean)
            .join(" | ");

    return {
      keyword,
      total,
      items: parsed.slice(0, 10),
      problemSummary,
    };
  } catch (error) {
    return {
      keyword,
      total: 0,
      items: [],
      problemSummary: "KnowledgeIn problem research failed.",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
