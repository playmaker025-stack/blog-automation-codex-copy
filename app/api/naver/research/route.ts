import { NextRequest, NextResponse } from "next/server";
import { naverKeywordResearch } from "@/lib/skills/naver-keyword-research";

export async function GET(request: NextRequest) {
  const keyword = request.nextUrl.searchParams.get("keyword");
  const displayParam = request.nextUrl.searchParams.get("display");
  const shoppingCategory = request.nextUrl.searchParams.get("shoppingCategory") ?? undefined;
  const shoppingKeywords = request.nextUrl.searchParams
    .getAll("shoppingKeyword")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!keyword) {
    return NextResponse.json({ error: "keyword 파라미터가 필요합니다." }, { status: 400 });
  }

  const display = Number.parseInt(displayParam ?? "30", 10);

  try {
    const result = await naverKeywordResearch({
      keyword,
      display: Number.isFinite(display) && display > 0 ? display : 30,
      shoppingCategory,
      shoppingKeywords,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "리서치 실패" },
      { status: 500 },
    );
  }
}
