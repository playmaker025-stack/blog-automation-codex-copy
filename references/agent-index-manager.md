# Agent Index Manager Reference

## 목적

Index Manager는 발행 완료 글의 인덱스 반영, 기존 글 업데이트 주기, SERP 모듈별 운영 우선순위를 관리한다.

## 인덱스 필드 확장 제안

기존 post index에 아래 운영 필드를 추가할 수 있다.

```json
{
  "id": "P001",
  "publishedAt": "2026-06-01",
  "lastUpdated": "2026-06-01",
  "updatePriority": "high",
  "updateDue": "2026-08-01",
  "serpModule": "ai_briefing",
  "aiBriefingCitationCount": 0,
  "serpModuleCheckedAt": "2026-06-09T00:00:00+09:00"
}
```

필드 의미:

- `lastUpdated`: 마지막 내용 업데이트 날짜
- `updatePriority`: `high | normal | archive`
- `updateDue`: 다음 업데이트 권장일
- `serpModule`: 발행 당시 또는 최근 점검 기준 SERP 모듈
- `aiBriefingCitationCount`: 수동 입력 가능한 AI 브리핑 인용 횟수
- `serpModuleCheckedAt`: SERP 모듈을 마지막으로 확인한 시각

## 업데이트 우선순위

| 조건 | updatePriority |
| --- | --- |
| `serpModule = ai_briefing` + 60일 이상 업데이트 없음 | `high` |
| `serpModule = ai_briefing` + 30~60일 업데이트 없음 | `normal` |
| 미노출 확인 또는 인용 급감 | `high` |
| `serpModule = blog_view` 문제해결 글 | `normal` |
| 시즌/정책/가격 정보가 오래된 글 | `high` |
| 더 이상 운영 가치가 낮은 글 | `archive` |

## 주간 점검 루틴

사용자가 “이번 주 전략”, “업데이트할 글”, “기존 글 점검”을 요청하면 아래 순서로 처리한다.

```text
1. updateDue가 이번 주 이내인 글 목록 조회
2. updatePriority = high 글 우선 출력
3. ai_briefing 대상 글은 인용 가능 구조가 유지되는지 확인
4. place 대상 글은 스마트플레이스 정보와 맞는지 확인
5. blog_view 대상 글은 최신 증상/해결 기준이 맞는지 확인
6. 수정이 필요한 글은 posting-list와 index 교차 확인 후 업데이트 후보로 제안
```

## 완료 여부 교차 확인

완료 여부는 항상 `posting-list + index` 교차 확인으로 판단한다.

- `posting-list`: 앞으로 작성할 글과 상태 관리
- `index`: 실제 발행된 글과 URL 관리

둘 중 하나만 보고 완료로 판단하지 않는다.

## 주의

- 발행 제목이 실제 제목과 달라졌을 때는 실질 변경 여부를 먼저 판단한다.
- 핵심 키워드, 검색의도, 지역/카테고리 축이 바뀌면 posting-list 수정이 필요하다.
- 단순 문장 다듬기 수준이면 index만 실제 발행 제목으로 반영할 수 있다.
