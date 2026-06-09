# Agent Writer Engine Reference

## 목적

Writer Engine은 SEO Analyst가 판정한 `serpModule`, `contentType`, `aiBriefingCitationType`, `placeSubtype`을 받아 글 구조를 선택한다. writer는 자체적으로 키워드나 SERP 모듈을 추론하지 않는다.

## 생성 전 체크리스트

```text
1. keywordContract 확인
2. articleContract 확인
3. articlePlan.lockedRequirements 확인
4. serpModule 확인
5. serpModule별 글 구조 선택
6. finalDraftCheck에서 금지어/누락/중복 검수
```

## AI 브리핑 전략 분기

기존처럼 모든 글에 `AI 브리핑 회피`를 적용하지 않는다.

```text
IF serpModule == "ai_briefing":
  → 인용 유도 구조

IF serpModule == "blog_view" OR serpModule == "place":
  → 요약 회피 구조
```

## serpModule별 writer 구조

### `ai_briefing`

목표: AI 브리핑 출처로 인용될 수 있는 명확한 답변 구조.

필수 구조:

1. 첫 문단: 검색 질문에 대한 직접 답변
2. 두 번째 문단: 비교/판단 기준
3. 세 번째 문단: 예외 조건 또는 주의점
4. 본문 중간: 단계/목록/표 중 하나
5. 하단: FAQ 2~3개

금지:

- 정의형 제목만으로 끝내기
- 출처 없는 수치 단정
- 제품 스펙을 확인 없이 단정
- 내부 제작용 용어 노출

### `blog_view`

목표: 블로그/뷰 영역에서 독자가 클릭해 읽을 만한 문제 해결 또는 사용법 글.

문제해결형:

```text
증상 → 원인 → 직접 점검 → 해결 방법 → 매장 상담이 필요한 경우
```

사용법형:

```text
상황 → 준비물/조건 → 단계별 방법 → 실수 방지 → 관련 글 연결
```

### `place`

목표: 스마트플레이스 보조 문서와 방문 전 안내 글.

필수 구조:

1. 지역/동선 상황
2. 어떤 매장인지
3. 방문 전 확인할 것
4. 상담 시 물어볼 질문
5. 스마트플레이스 CTA

`placeSubtype`별 강조:

- `place_city`: 지역 허브와 매장 선택 기준
- `place_dong`: 가까운 방문과 생활권 맥락
- `place_station`: 역세권/퇴근길/이동 동선
- `place_visit_check`: 방문 전 체크리스트
- `place_review`: 실제 방문/상담 경험

### `clip`

목표: 클립 또는 숏폼 콘텐츠를 보조하는 텍스트.

구조:

- 영상에서 보여줄 핵심 장면
- 체감 포인트
- 블로그에서 보충할 설명
- 클립 링크 또는 촬영 가이드

### `shopping`

목표: 쇼핑/스토어 중심 질의에서 블로그가 구매 전 판단을 보조.

구조:

- 구매 전 확인 기준
- 비교 기준
- 과장 없는 장단점
- 매장 상담 또는 스토어 연결

## aiBriefingCitationType별 차이

### `geo_priority`

- 직접 답변과 구조화가 우선이다.
- 기존 검색 순위가 낮아도 출처 후보가 될 수 있다는 운영 가설을 둔다.
- 정보형, 방법형, 문제해결형에 적용한다.

### `seo_required`

- 상위노출 전략과 AI 브리핑 인용 구조를 함께 적용한다.
- 비교형, 추천형, 구매검토형에 적용한다.
- 제목, 도입, 본문 충실도, 내부링크, 사용자 경험 서술을 모두 강화한다.

## 사용자 요구사항 우선 원칙

ArticlePlan의 `lockedRequirements`, `requiredEntities`, `requiredSections`는 SERP 전략보다 우선한다.

예:

- 사용자가 추천 제품 5개를 지정했으면 5개 모두 본문에 들어가야 한다.
- 제품명마다 추천 이유와 추천 대상을 작성해야 한다.
- 기준 설명형으로만 빠지면 실패다.
