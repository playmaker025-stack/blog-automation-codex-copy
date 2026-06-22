import { NextRequest, NextResponse } from "next/server";
import { requestOpenAIText } from "@/lib/openai/responses";
import { normalizeUserId } from "@/lib/utils/normalize";

export const dynamic = "force-dynamic";

const TITLE_SYSTEM_PROMPT = `당신은 2026년 네이버 블로그 SEO 전문가입니다.
주어진 메인 키워드와 서브 키워드를 바탕으로 네이버 노출에 최적화된 블로그 제목 3개를 생성합니다.

제목 생성 규칙:
- 제목 길이: 25~38자 (네이버 VIEW탭 + AI 브리핑 노출 최적 범위)
- 메인 키워드는 제목 앞 1/3 이내에 자연스럽게 포함
- 서브 키워드는 제목 뒤쪽에 자연스럽게 배치
- 클릭 유도 + 검색의도가 명확하게 드러나는 구조
- 가격, 할인, 쿠폰, 증정, 프로모션 문구 금지
- 과장("최고", "최강", "완벽한") 금지
- 세 가지 각도로 각각 다르게 작성:
  1번: 정보형 (왜·방법·이유·차이 각도) — AI 브리핑 노출 타깃
  2번: 경험/리뷰형 (직접 써본 결과·실제 사용 각도) — 신뢰도 중심
  3번: 추천/비교형 (고를 때·선택 기준·추천 각도) — VIEW탭 + 피드 타깃

반드시 아래 JSON 형식으로만 출력하세요. 다른 문장은 절대 출력하지 마세요.
{"titles":["제목1","제목2","제목3"]}`;

export async function POST(request: NextRequest) {
  let body: { mainKeyword: string; subKeywords?: string[]; userId: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "요청 본문 파싱 실패" }, { status: 400 });
  }

  const { mainKeyword, subKeywords = [] } = body;
  const userId = normalizeUserId(body.userId);

  if (!mainKeyword?.trim() || !userId) {
    return NextResponse.json(
      { error: "mainKeyword와 userId가 필요합니다." },
      { status: 400 }
    );
  }

  const subKeywordText = subKeywords.filter(Boolean).join(", ");
  const userMessage = [
    `메인 키워드: ${mainKeyword.trim()}`,
    subKeywordText ? `서브 키워드: ${subKeywordText}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const raw = await requestOpenAIText({
      model: process.env.OPENAI_TITLE_MODEL ?? "gpt-4.1",
      input: [
        { role: "system", content: TITLE_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      maxOutputTokens: 300,
      temperature: 0.85,
    });

    const jsonMatch = raw.match(/\{"titles"\s*:\s*\[[\s\S]*?\]\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "AI 응답 파싱 실패" }, { status: 500 });
    }

    const parsed = JSON.parse(jsonMatch[0]) as { titles: string[] };
    const titles = (parsed.titles ?? [])
      .map((t: string) => t.trim())
      .filter((t: string) => t.length >= 10 && t.length <= 60);

    if (titles.length === 0) {
      return NextResponse.json({ error: "생성된 제목이 없습니다." }, { status: 500 });
    }

    return NextResponse.json({ titles });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "알 수 없는 오류";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
