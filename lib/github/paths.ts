// Repository-relative data paths used by the GitHub-backed storage layer.

export const Paths = {
  userProfile: (userId: string) => `user-modeling/users/${userId}/profile.json`,
  forbiddenExpressions: (userId: string) =>
    `user-modeling/users/${userId}/forbidden-expressions.json`,

  corpusIndex: (userId: string) =>
    `user-modeling/users/${userId}/corpus/index.json`,
  corpusSample: (userId: string, sampleId: string) =>
    `user-modeling/users/${userId}/corpus/samples/${sampleId}.md`,
  exemplarIndex: (userId: string) =>
    `user-modeling/users/${userId}/corpus/exemplar_index.json`,

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
  localityKeywordLedger: (userId: string) =>
    `data/locality-keywords/${userId}/ledger.json`,
  approvalRecord: (pipelineId: string) => `data/approvals/${pipelineId}.json`,
} as const;
