# Blog Automation — 네이버 블로그 그룹화 작성 시스템

---

## 최우선 행동 강령

### 1. 모든 응답과 작업은 한국어로

- 질문, 설명, 코드 주석, 커밋 메시지, 오류 분석은 모두 한국어로 작성한다.
- 코드 내부 식별자, 라이브러리명, API명은 기존 영어 표기를 유지할 수 있다.

### 2. 확인 요청 금지

Codex는 아래 두 가지 예외를 제외하고 모든 작업을 즉시 실행한다.

| 예외 | 설명 |
| --- | --- |
| 보안 이슈 | 인증 정보 노출, 권한 변경, 취약점 관련 수정 |
| 외부 API 직접 호출 | Anthropic, GitHub, Naver 등 외부 서비스에 실제 요청을 보내는 작업 |

다음은 확인 없이 즉시 실행한다.

- git commit, git push, git reset, branch 삭제
- 파일/디렉터리 생성, 수정, 이동, 삭제
- 패키지 설치/제거
- 코드 수정, 리팩터링, 설정 변경
- 빌드, 테스트, 검증 실행

금지 문구:

- `~할까요?`
- `~해도 될까요?`
- `~진행할까요?`
- `확인해 주세요`

### 3. 사용자 호칭

사용자는 Codex를 `cc`라고 부른다.

---

## 프로젝트 개요

다중 사용자 기반 네이버 블로그 포스팅 자동화 웹앱이다. 사용자별 코퍼스와 운영 규칙을 바탕으로 토픽 전략 수립, 초안 생성, 품질 평가, 발행 후 인덱스 반영까지 일관된 흐름으로 처리한다.

## 핵심 원칙

1. 발행용 본문은 `Master Writer`만 작성한다.
2. 완료 여부는 `posting-list + index` 교차확인으로만 결정한다.
3. 제목/방향이 실질적으로 바뀌면 사용자 승인 후 `posting-list`를 수정하고, 그 다음 `index`를 반영한다.
4. 사용자 모델링은 GitHub 저장소의 corpus retrieval 기반으로 진행한다.
5. 코드 수정 후에는 반드시 `/verify`를 통과시킨 뒤 커밋, 푸시, Railway 실제 배포 화면 확인까지 완료해야 한다.

## 에이전트 구조

```text
orchestrator
├── strategy-planner
├── master-writer
└── harness-evaluator
```

## 스킬 목록

| 스킬 | 역할 |
| --- | --- |
| source-resolver | 참조 URL 유효성 검증 및 요약 |
| topic-feasibility-judge | 토픽 실현 가능성 판단 |
| user-profile-loader | 사용자 프로필 로드 |
| user-corpus-retriever | 사용자 코퍼스 로드 |
| expansion-planner | 아웃라인 확장 계획 수립 |
| review-record-audit | 과거 포스팅 패턴 분석 |

## 데이터 구조

```text
user-modeling/
└── users/{userId}/
    ├── profile.json
    ├── forbidden-expressions.json
    └── corpus/
        ├── index.json
        └── samples/{sampleId}.md

data/
├── posting-list/
│   └── index.json
└── index/
    └── topics.json

evals/
├── cases/index.json
├── baselines/results.json
└── runs/
```

## 환경 변수

`.env.local`이 필요하다.

- `ANTHROPIC_API_KEY`
- `GITHUB_TOKEN`
- `GITHUB_DATA_REPO`
- `GITHUB_DATA_REPO_BRANCH`

## dotfile 설정

이 프로젝트는 `.Codex/agents/`, `.Codex/commands/`, `.mcp.json`을 사용한다. 현재 환경에서 dotfile 생성이 제한될 수 있으므로 `_dotfiles/` 템플릿과 `setup.ps1` 스크립트를 통해 복구한다.

## 코딩 자동 교정 루프

1. 코드 수정 후 즉시 `node scripts/verify.mjs` 실행
2. 실패 시 완료 선언 금지
3. 실패 로그 삭제 금지
4. 테스트 실패는 구현 로직으로 먼저 해결

검증 명령어:

```bash
node scripts/verify.mjs
node scripts/verify.mjs --skip-build --skip-test
```

## 완료 사이클 강제 규칙

아래 순서를 모두 끝내야 작업 완료로 본다.

1. 코드 수정
2. `/verify` 통과
3. 커밋
4. `git push origin main`
5. Railway `Deployments`에서 최신 배포 생성 여부 확인
6. Railway `Active` 커밋 제목과 실제 배포 화면 확인

다음 징후가 보이면 완료로 판단하지 않는다.

- Railway `Active`가 여전히 `via CLI`
- `Apply N changes`가 남아 있음
- 최신 GitHub 커밋이 배포 화면에 보이지 않음
- 실제 배포 URL에서 수정된 UI/동작이 확인되지 않음

---

## 운영 규칙 추가 — 2026-04-24

### 1. 글목록 생성 시 블로그 역할 적합성 강제 검사

새 주제를 생성할 때는 SEO 가능성만 보지 않고, 반드시 해당 블로그 역할과 맞는지 먼저 판정한다.

- `A`: 지역/카테고리 허브형
- `B`: 스토리/상담형 구매전환
- `C`: 기술/구조 설명형
- `D`: 질문/증상 중심 문제해결형
- `E`: 실용 확장 유입형

주제가 역할과 맞지 않으면 생성 후보에서 제외하거나 다른 블로그 코드로 재배정한다. 특히 아래는 강하게 판정한다.

- `A`는 허브형이 아니면 제외
- `B`는 구매 검토/전환 맥락이 약하면 제외
- `D`는 문제 해결 구조가 아니면 제외
- `E`는 추상 주제 대신 실제 검색형 실용 주제만 허용

### 2. 허브/리프 판정 강제 저장

모든 새 주제는 생성 시점에 반드시 `허브` 또는 `리프`로 판정하고 저장한다.

- 허브: 지역/카테고리 기준으로 넓게 묶는 글
- 리프: 단일 문제 해결 글

리프 주제가 누적되면 연결될 허브가 실제로 존재하는지 자동 검수한다. 연결 허브가 없으면 다음 중 하나를 수행한다.

1. 기존 허브와 연결
2. 허브 필요 상태로 표시
3. 리프 주제를 보류

허브/리프 미분류 상태로 다음 단계에 넘기지 않는다.

### 3. 내부링크 실존 글 검증 규칙

내부링크 후보는 실존 글로만 확정한다. 임의 생성 링크는 금지한다.

- 리프 → 지역 허브 우선
- 허브 → 관련 리프 차순위
- 적합한 대상이 없으면 내부링크를 비워두고 `후보 없음`으로 기록

내부링크 설계 단계에서는 반드시 실제 발행 인덱스 기준으로 존재 여부를 검증한다.

### 4. 실제 발행 제목과 목록 제목 불일치 처리

실제 발행 제목은 인덱스에 반영하되, 목록 제목 수정은 별도 규칙으로 처리한다.

`실질 변경`은 아래 중 하나에 해당할 때로 본다.

- 핵심 키워드가 바뀜
- 검색의도가 바뀜
- 제목 방향이 정보형에서 비교형, 문제해결형 등으로 바뀜
- 지역/카테고리 축이 바뀜

위 조건이면 사용자 승인 없이 목록 제목을 바꾸지 않는다. 순서는 항상 아래와 같다.

1. 실제 발행 제목 확인
2. 실질 변경 여부 판정
3. 실질 변경이면 사용자 승인
4. `posting-list` 최신 전체본 수정
5. 그 다음 `index` 반영

단순 문장 다듬기 수준이면 인덱스만 실제 발행 제목으로 반영할 수 있다.

### 5. 사진 파일명 규칙

사진 파일명 예시는 아래 다섯 요소를 기준으로 구성한다.

- 지역
- 카테고리
- 메인키워드
- 브랜드
- 의도

파일명 규칙:

- 실제 파일명은 영문/숫자/언더스코어/하이픈만 사용
- 한글, 공백, 괄호, 특수문자 사용 금지
- 형식 예시: `incheon_vape_starter_device_voopoo_intro_01`

추천 파일명 생성 시 위 다섯 요소를 최대한 유지하고, 번호는 `_01`부터 이어 붙인다.

---

## 알려진 실패 패턴

### [2026-04-07] 파이프라인 초안쓰기 단계에서 무한 대기

- 원인: AI 호출 타임아웃 부재, 실패 시 상태 복구 누락
- 재발 방지: 모든 AI 호출에 `AbortSignal.timeout(...)` 적용, catch 블록에서 상태 복구

### [2026-04-07] 임포트된 posts의 topicId 없음으로 교차체크 불일치

- 원인: 제목 exact normalize 매칭 한계
- 재발 방지: 제목 유사도 매칭 보강 필요

### [2026-04-24] 승인 팝업 수정 요청이 write phase까지 전달되지 않음

- 원인: 승인 경로에서 `modifications` 누락
- 재발 방지: UI → API → orchestrator → writer prompt 전체 경로 검증

### [2026-04-24] Railway가 최신 GitHub 커밋 대신 예전 CLI 배포를 계속 Active로 유지

- 원인: repo 연결 전 CLI 배포가 Active였고, 최신 GitHub 배포 여부를 실제 URL까지 검증하지 않음
- 재발 방지: `Deployments`의 `Active` 커밋 제목, `via CLI` 여부, 실제 배포 화면을 모두 확인

### [2026-04-24] Railway `Apply N changes` 미적용 상태에서 자동배포가 생성되지 않음

- 원인: Source/Branch 연결이 저장만 되고 실제 적용되지 않음
- 재발 방지: `Apply N changes`가 남아 있으면 완료로 보지 않음

## 개발 스택

- Framework: Next.js 15
- Styling: Tailwind CSS
- AI: Anthropic SDK
- GitHub: Octokit REST
- 상태관리: Zustand
- 데이터 캐싱: SWR
