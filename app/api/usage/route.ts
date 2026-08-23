/**
 * GET  /api/usage  — 사용량 요약 + 추정 잔액 + 계정 상태
 * POST /api/usage  — 콘솔에서 확인한 잔액 스냅샷 기록 { balanceUsd, note? }
 *
 * Anthropic에는 잔액 조회 API가 없다(Admin API에도 balance 엔드포인트가 없고,
 * usage_report/cost_report는 Admin 키가 필요한데 개인 계정은 Admin API를 못 쓴다).
 * 그래서 앱이 자기 호출의 usage를 세고, 사용자가 가끔 찍어주는 잔액 스냅샷에서
 * 차감해 추정치를 낸다. 정확한 금액은 여전히 콘솔이 권위다.
 */

import { NextResponse } from "next/server";
import { getAccountHealth } from "@/lib/anthropic/account-health";
import { flushUsage, pendingUsageCount } from "@/lib/anthropic/usage-recorder";
import { summarize, usageLevel } from "@/lib/usage/ledger";
import { loadUsageLedger, saveBalanceMark } from "@/lib/usage/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // 버퍼에 남은 호출까지 반영해야 "방금 돌린 파이프라인"이 숫자에 잡힌다.
    await flushUsage();

    const { data } = await loadUsageLedger();
    const summary = summarize(data);

    return NextResponse.json({
      ok: true,
      summary,
      level: usageLevel(summary),
      health: getAccountHealth(),
      pending: pendingUsageCount(),
      consoleUrl: "https://console.anthropic.com/settings/billing",
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    balanceUsd?: unknown;
    note?: unknown;
  };

  const balanceUsd = Number(body.balanceUsd);
  if (!Number.isFinite(balanceUsd) || balanceUsd < 0) {
    return NextResponse.json(
      { ok: false, error: "balanceUsd는 0 이상의 숫자여야 합니다." },
      { status: 400 }
    );
  }

  try {
    // 스냅샷 기준점이 정확하려면 버퍼가 먼저 장부에 들어가 있어야 한다.
    await flushUsage();

    const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : undefined;
    const ledger = await saveBalanceMark(balanceUsd, note);
    const summary = summarize(ledger);

    return NextResponse.json({
      ok: true,
      summary,
      level: usageLevel(summary),
      health: getAccountHealth(),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
