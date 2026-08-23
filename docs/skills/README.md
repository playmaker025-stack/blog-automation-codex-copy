# Skills — 스킬 개요

스킬은 에이전트가 사용하는 도구 함수다.
모든 스킬은 `lib/skills/` 에 구현되어 있다.
이 중 일부만 Anthropic SDK tool-use 형식으로 에이전트에 등록되고,
나머지는 파이프라인 코드가 직접 호출하는 내부 스킬이다.

## 스킬 목록

| 스킬 | 파일 | 외부 호출 | 설명 |
|------|------|----------|------|
| `source-resolver` | `source-resolver.ts` | HTTP | 참조 URL 유효성 검증 + 제목/요약 추출 |
| `topic-feasibility-judge` | `topic-feasibility-judge.ts` | 없음 | 토픽 실현 가능성 휴리스틱 판단 (금지 표현/독자 적합성/avoidTopics 게이트) |
| `user-profile-loader` | `user-profile-loader.ts` | GitHub | 사용자 프로필 + 금지 표현 로드 |
| `user-corpus-retriever` | `user-corpus-retriever.ts` | GitHub | 사용자 예시 글 코퍼스 로드 |
| `expansion-planner` | `expansion-planner.ts` | 없음 | 아웃라인 → 섹션별 상세 작성 방향 계획 (순수 함수) |
| `review-record-audit` | `review-record-audit.ts` | GitHub | 과거 포스팅 패턴 분석 |
| `naver-keyword-research` | `naver-keyword-research.ts` | 네이버 API | 검색(blog/kin/cafearticle) + 데이터랩 트렌드/쇼핑 통합 리서치 |
| `naver-community-research` | `naver-community-research.ts` | 네이버 API | 카페 수요 / 지식인 반복 질문 수집 (`naverCafeSearch`, `naverKinSearch`) |
| `naver-content-fetcher` | `naver-content-fetcher.ts` | HTTP + Anthropic | 상위 노출 글 본문 수집 후 핵심 내용 요약 |
| `import-parser` | `import-parser.ts` | 없음 | 글목록/발행 인덱스 TXT 파싱 (UTF-8 → EUC-KR 자동 폴백) |
| `remaining-topic-resolver` | `remaining-topic-resolver.ts` | 없음 | 남은 미발행 토픽 해소 순서 결정 |

## 입출력 타입

tool-use로 등록되는 스킬의 입출력 타입은 `lib/types/skill.ts` 에 정의되어 있다.
그 외 내부 스킬은 각 파일에서 타입을 함께 export 한다.

## 에이전트별 스킬 사용

```
strategy-planner
  ├── user-profile-loader
  ├── user-corpus-retriever
  ├── topic-feasibility-judge
  ├── source-resolver
  ├── review-record-audit
  ├── naver-keyword-research
  ├── naver-community-research
  └── naver-content-fetcher

master-writer
  ├── user-corpus-retriever   (corpusSummary가 이미 있으면 등록하지 않음)
  ├── expansion-planner
  └── source-resolver

harness-evaluator
  ├── user-corpus-retriever
  └── review-record-audit
```

`master-writer`는 `corpus-selector`가 만든 corpus summary artifact를 받으면
`user_corpus_retriever` 도구를 등록하지 않는다 (`lib/agents/master-writer.ts`의 `TOOLS` 구성).

## 에이전트(스킬 아님)

아래는 `lib/agents/`의 판정 계층이다. tool-use 도구가 아니라 파이프라인이 직접 호출한다.

| 에이전트 | 파일 | 역할 |
|---|---|---|
| `seo-analyst` | `seo-analyst-agent.ts` | 키워드를 5개 SERP 모듈로 분류 (`references/agent-seo-analyst.md`) |
| `writer-engine` | `writer-engine.ts` | serpModule별 글 구조 선택 (`references/agent-writer-engine.md`) |
| `naver-logic` | `naver-logic-agent.ts` | D.I.A. / C-Rank / hybrid 판정과 사후 감사 |
| `content-topology` | `content-topology.ts` | 허브/리프 판정과 내부링크 후보 |

호출 순서는 `strategy-planner.ts`에서 확정된다:
`contentTopology → naverLogic → seoAnalyst → writerEngine → keywordContract → articleContract → articlePlan → overlapReport`
