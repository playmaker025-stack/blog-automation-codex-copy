// Repository-relative data paths used by the GitHub-backed storage layer.

export const Paths = {
  userProfile: (userId: string) => `user-modeling/users/${userId}/profile.json`,
  forbiddenExpressions: (userId: string) =>
    `user-modeling/users/${userId}/forbidden-expressions.json`,
  pipelineUserDraft: (userId: string) =>
    `data/pipeline-ledger/user-drafts/${userId}.json`,

  /**
   * 발행 결과 관측치. 글마다 파일을 따로 쌓는다(덧붙이기 전용).
   * 발행 목록(index.json)에 배열로 넣으면 수집기끼리 통째로 덮어쓴다.
   */
  postOutcomeDir: (postId: string) => `data/outcomes/${postId}`,
  postOutcome: (postId: string, observationId: string) =>
    `data/outcomes/${postId}/${observationId}.json`,
  /**
   * 관측 색인. 글마다 폴더를 뒤지지 않고 "무엇을 언제 쟀는지"를 한 파일에서 읽는다.
   * 이게 없으면 수집기가 한 바퀴 돌 때마다 글 수만큼 GitHub 목록 조회를 한다.
   */
  outcomeIndex: () => "data/outcomes/_index.json",

  corpusIndex: (userId: string) =>
    `user-modeling/users/${userId}/corpus/index.json`,
  corpusSample: (userId: string, sampleId: string) =>
    `user-modeling/users/${userId}/corpus/samples/${sampleId}.md`,
  exemplarIndex: (userId: string) =>
    `user-modeling/users/${userId}/corpus/exemplar_index.json`,
  writingProfile: (userId: string) =>
    `user-modeling/users/${userId}/writing-profile.json`,

  topicsIndex: () => "data/index/topics.json",
  postingListIndex: () => "data/posting-list/index.json",
  postMeta: (postId: string) => `data/posting-list/posts/${postId}/meta.json`,
  postContent: (postId: string) => `data/posting-list/posts/${postId}/content.md`,

  contentLearning: (userId: string) => `data/content-learning/${userId}.json`,

  evalCasesIndex: () => "evals/cases/index.json",
  evalBaselines: () => "evals/baselines/results.json",
  evalRun: (runId: string) => `evals/runs/${runId}.json`,
  baseline: (scenarioId: string) => `evals/baselines/${scenarioId}/latest.json`,
  baselineCandidates: (scenarioId: string) =>
    `evals/baselines/${scenarioId}/candidates.json`,

  appConfig: () => "data/config/app.json",
  domainBrands: () => "data/config/domain-brands.json",
  usageLedger: () => "data/usage/ledger.json",
  productSpecs: () => "data/config/product-specs.json",
  productSpecCandidates: () => "data/config/product-spec-candidates.json",
  localityKeywordLedger: (userId: string) =>
    `data/locality-keywords/${userId}/ledger.json`,
  approvalRecord: (pipelineId: string) => `data/approvals/${pipelineId}.json`,
  draftSessions: (userId: string) => `data/draft-sessions/${userId}/index.json`,
} as const;
