/**
 * Next.js가 서버를 띄울 때 한 번 부른다. 상주 작업은 여기서 시작한다.
 *
 * 순위 수집기는 사람이 화면을 열지 않아도 돌아야 하므로 요청 경로가 아니라
 * 여기에 붙인다. edge 런타임에서는 타이머도 GitHub 호출도 쓸 수 없으므로
 * nodejs 런타임에서만 시작한다.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { startOutcomeCollector } = await import("./lib/agents/outcome-scheduler");
  startOutcomeCollector();
}
