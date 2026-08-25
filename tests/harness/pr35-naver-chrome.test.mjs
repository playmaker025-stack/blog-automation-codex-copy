import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  stripNaverChrome,
  hasNaverChrome,
  isUsableCorpusText,
} from "../../lib/agents/naver-chrome.ts";

// 실제 코퍼스 샘플의 형태를 그대로 옮겼다. 머리 UI가 1,900자쯤 붙고
// 그 끝은 항상 "본문 기타 기능 공유하기 신고하기"다.
const HEAD =
  "인천 전자담배 드래곤바 원보틀 후기 : 네이버 블로그 NAVER 블로그 만수동만수르 블로그 검색 " +
  "이 블로그에서 검색 공감 0 칭찬 0 감사 0 웃김 0 놀람 0 슬픔 0 span.u_likeit_button) 공감 face 3개 (전체)) --> " +
  "댓글 2 공유하기 블로그 주소 변경 불가 안내 블로그 마켓 판매자의 이력 관리를 위해 블로그 주소 변경이 불가합니다. " +
  "자세히 보기 레이어 닫기 블로그 아이디가 필요해요! 지금 시작해볼까요? 블로그 아이디 만들기 레이어 닫기 " +
  "전자담배 기기 561개의 글 목록열기 만수동만수르 ・ 2026. 8. 19. 17:21 URL 복사 이웃추가 본문 기타 기능 공유하기 신고하기 ";

const BODY =
  "안녕하세요 인천 전자담배 만수동만수르 입니다. 끝날듯 끝나지 않는 더위에 다들 고생이 많으십니다. " +
  "오늘은 매장에서 손님분들이 가장 많이 찾으시는 드래곤바 원보틀 세 가지를 정리해보려 합니다. " +
  "먼저 크오크는 산미가 적당하고 목넘김이 부드러워서 입문하시는 분들께 자주 권해드리는 맛입니다. " +
  "두번째 바나나밀크는 단맛이 강한 편이라 호불호가 갈리지만 한번 빠지면 계속 찾게 되는 맛이구요. " +
  "마지막 백향과 멘솔은 너무 쎄지도 않고 적당히 시원해서 여름철에 특히 인기가 많습니다. " +
  "저희 매장에서는 세 가지 모두 시연이 가능하니 편하게 들르셔서 직접 맛보고 결정하시면 됩니다. " +
  "궁금하신 점 있으시면 언제든 편하게 물어봐주세요. 지금까지 인천 전자담배 만수동만수르였습니다.";

const TAIL =
  " 태그 취소 확인 공감 0 공감 0 칭찬 0 감사 0 웃김 0 놀람 0 슬픔 0 이 글에 공감한 블로거 열고 닫기 " +
  "댓글 2 인쇄 댓글쓰기 이 블로그 전자담배 기기 카테고리 글 화면 최상단으로 이동";

const DIRTY = `# 인천 전자담배 드래곤바 원보틀 후기\n\n${HEAD}${BODY}${TAIL}`;

describe("PR35 네이버 UI 잘라내기", () => {
  test("머리 UI를 걷어내고 본문부터 시작한다", () => {
    const { text, matchedHead } = stripNaverChrome(DIRTY);
    assert.equal(matchedHead, true);
    assert.ok(text.includes("안녕하세요 인천 전자담배 만수동만수르 입니다."));
    assert.equal(text.includes("NAVER 블로그"), false);
    assert.equal(text.includes("블로그 주소 변경이 불가"), false);
  });

  test("꼬리 UI도 걷어낸다", () => {
    const { text, matchedTail } = stripNaverChrome(DIRTY);
    assert.equal(matchedTail, true);
    assert.equal(text.includes("태그 취소"), false);
    assert.equal(text.includes("화면 최상단으로 이동"), false);
    assert.ok(text.includes("여름철에 특히 인기가 많습니다."));
  });

  // 제목은 우리가 붙인 것이지 네이버 UI가 아니다.
  test("마크다운 제목은 보존한다", () => {
    const { text } = stripNaverChrome(DIRTY);
    assert.ok(text.startsWith("# 인천 전자담배 드래곤바 원보틀 후기"));
  });

  test("UI 감지가 걷어내기 전후로 뒤집힌다", () => {
    assert.equal(hasNaverChrome(DIRTY), true);
    assert.equal(hasNaverChrome(stripNaverChrome(DIRTY).text), false);
  });

  test("두 번 돌려도 결과가 같다", () => {
    const once = stripNaverChrome(DIRTY).text;
    assert.equal(stripNaverChrome(once).text, once);
  });
});

// 앱이 직접 쓴 글에는 UI가 없다. 여기서 잘못 자르면 멀쩡한 본문을 잃는다.
describe("PR35 깨끗한 글 보호", () => {
  const CLEAN = `# 발라리안 맥스 프로 사용기\n\n${BODY}\n\n두번째 문단입니다. 여기까지 읽어주셔서 감사합니다.`;

  test("건드리지 않는다", () => {
    const { text, matchedHead, matchedTail } = stripNaverChrome(CLEAN);
    assert.equal(text, CLEAN);
    assert.equal(matchedHead, false);
    assert.equal(matchedTail, false);
  });

  test("표지가 없으면 원문을 그대로 준다", () => {
    const noMarker = "표지가 하나도 없는 평범한 글입니다. ".repeat(20).trim();
    assert.equal(stripNaverChrome(noMarker).text, noMarker);
  });

  // 머리를 자르면 본문이 안 남는 경우. 자르느니 두고, 대신 학습에서 뺀다.
  test("머리를 자르면 남는 게 없을 때는 자르지 않는다", () => {
    const short = `${HEAD}짧은 본문입니다.${TAIL}`;
    const { text, matchedHead } = stripNaverChrome(short);
    assert.equal(matchedHead, false);
    assert.ok(text.includes("NAVER 블로그"));
    assert.equal(isUsableCorpusText(text), false);
  });
});

describe("PR35 본문 속 링크 카드", () => {
  test("이전 글 링크 카드를 지운다", () => {
    const withCard =
      `${HEAD}안녕하세요 만수동만수르 입니다. 이전 글이 궁금하시면 아래를 참고해주세요! ` +
      "만수동만수르 : 네이버 블로그 만수동만수르 : 네이버 블로그 만수동만수르 하이엔드 전자담배 전문점 blog.naver.com " +
      `${BODY}${TAIL}`;
    const { text } = stripNaverChrome(withCard);
    assert.equal(text.includes("네이버 블로그"), false);
    assert.equal(text.includes("blog.naver.com"), false);
    assert.ok(text.includes("이전 글이 궁금하시면"));
    assert.ok(text.includes("크오크는 산미가 적당하고"));
  });
});

// 수집이 실패해 본문 없이 UI만 담긴 샘플이 실제로 있다.
describe("PR35 학습 가능 여부", () => {
  test("정상 본문은 학습에 쓴다", () => {
    assert.equal(isUsableCorpusText(stripNaverChrome(DIRTY).text), true);
  });

  test("본문 없이 UI만 있으면 학습에서 뺀다", () => {
    const failed = `# 제목\n\n${HEAD}${HEAD}${HEAD}`;
    assert.equal(isUsableCorpusText(stripNaverChrome(failed).text), false);
  });

  test("너무 짧은 글은 학습에서 뺀다", () => {
    assert.equal(isUsableCorpusText("# 제목\n\n한 줄짜리 글."), false);
  });
});
