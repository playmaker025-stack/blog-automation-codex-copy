import { readFileSync, readdirSync } from 'fs'
import { join, relative } from 'path'

const ROOT = process.cwd()
const AGENTS_DIR = join(ROOT, 'lib', 'agents')

const violations = []

function fail(rule, filePath, lineNo, message) {
  violations.push({
    rule,
    loc: `${relative(ROOT, filePath).replace(/\\/g, '/')}:${lineNo}`,
    message,
  })
}

function lines(filePath) {
  return readFileSync(filePath, 'utf-8').split('\n')
}

function content(filePath) {
  return readFileSync(filePath, 'utf-8')
}

function agentFiles() {
  return readdirSync(AGENTS_DIR)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => join(AGENTS_DIR, file))
}

function lineOf(fileContent, needle) {
  const index = fileContent.indexOf(needle)
  if (index < 0) return 0
  return fileContent.slice(0, index).split('\n').length
}

function extractStringLiterals(source) {
  const strings = []
  for (const match of source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g)) {
    strings.push(match[1] ?? match[2] ?? '')
  }
  return strings
}

const orchFile = join(AGENTS_DIR, 'orchestrator.ts')
const orchContent = content(orchFile)

// RULE-001: Anthropic calls must be cancelable to avoid Railway timeouts and stuck SSE streams.
for (const file of agentFiles()) {
  const fileLines = lines(file)
  for (let index = 0; index < fileLines.length; index++) {
    const line = fileLines[index]
    if (line.includes('client.messages.create') || line.includes('client.messages.stream')) {
      const window = fileLines.slice(index, index + 60).join('\n')
      if (!window.includes('AbortSignal') && !window.includes('signal:')) {
        fail('RULE-001', file, index + 1, 'Anthropic messages call does not pass an AbortSignal.')
      }
    }
  }
}

// RULE-002: Failed pipeline runs must recover only topics locked by the same run.
if (!orchContent.includes('thisSetTopicInProgress')) {
  fail('RULE-002', orchFile, 0, 'Missing thisSetTopicInProgress guard.')
}
if (!/updateTopicStatus\s*\([^)]*,\s*"draft"\)/.test(orchContent)) {
  fail('RULE-002', orchFile, 0, 'Missing draft recovery for stuck in-progress topics.')
}
if (!orchContent.includes('topic recovery failed')) {
  fail('RULE-002', orchFile, 0, 'Missing recovery failure log.')
}

// RULE-003: in-progress writes must go through the atomic topic lock.
for (const file of agentFiles()) {
  const fileLines = lines(file)
  const isOrchestrator = file.endsWith('orchestrator.ts')

  for (let index = 0; index < fileLines.length; index++) {
    const line = fileLines[index]
    if (/status:\s*["']in-progress["']/.test(line) && !line.trimStart().startsWith('//')) {
      if (!isOrchestrator) {
        fail('RULE-003', file, index + 1, 'Direct in-progress assignment outside orchestrator.')
      } else {
        const lookback = fileLines.slice(Math.max(0, index - 40), index + 1).join('\n')
        if (!lookback.includes('atomicSetTopicInProgress') && !lookback.includes('statusAtReject')) {
          fail('RULE-003', file, index + 1, 'Direct in-progress assignment is outside atomicSetTopicInProgress.')
        }
      }
    }
  }
}

// RULE-004: GitHub writes in orchestrator must be conflict-retried.
{
  const fileLines = lines(orchFile)
  for (let index = 0; index < fileLines.length; index++) {
    if (fileLines[index].includes('writeJsonFile(')) {
      const lookback = fileLines.slice(Math.max(0, index - 80), index + 1).join('\n')
      if (!lookback.includes('withConflictRetry') && !lookback.includes('atomicSetTopicInProgress')) {
        fail('RULE-004', orchFile, index + 1, 'writeJsonFile is not guarded by withConflictRetry.')
      }
    }
  }
}

// RULE-005: Low eval scores save a usable draft instead of blocking the completed write.
if (!/status:\s*"ready"[\s\S]{0,1200}pass:\s*false/.test(orchContent)) {
  fail('RULE-005', orchFile, lineOf(orchContent, 'status: "ready"'), 'Low-score branch must keep the post ready and emit pass=false.')
}

// RULE-006: Completion payload must include operational next steps.
for (const needle of ['buildCompletionSupport', 'hashtags', 'imageFileNames']) {
  if (!orchContent.includes(needle)) {
    fail('RULE-006', orchFile, lineOf(orchContent, needle), `Missing completion support field: ${needle}.`)
  }
}

const pipelinePage = join(ROOT, 'app', 'pipeline', 'page.tsx')
const pageContent = content(pipelinePage)
if (!pageContent.includes('reviewActualDraft')) {
  fail('RULE-006', pipelinePage, 0, 'Pipeline page must use the shared actual-draft review helper.')
}
if (!pageContent.includes('method: "PATCH"') || !pageContent.includes('postId: result.postId')) {
  fail('RULE-006', pipelinePage, 0, 'Actual-draft title updates must patch the post index.')
}

const normalizeFile = join(ROOT, 'lib', 'utils', 'normalize.ts')
const normalizeContent = content(normalizeFile)
if (!normalizeContent.includes('user-([a-z0-9]+)')) {
  fail('RULE-006', normalizeFile, 0, 'normalizeUserId must keep user-a style aliases working.')
}

// RULE-007: New user-facing strings must not reintroduce common mojibake fragments.
const badTextPattern = /(?:\?ê¾|å|Ã|Â€)/u
const fullTextFiles = [
  pipelinePage,
  join(ROOT, 'components', 'pipeline', 'approval-dialog.tsx'),
  join(ROOT, 'components', 'pipeline', 'pipeline-stream.tsx'),
  join(ROOT, 'components', 'pipeline', 'stage-indicator.tsx'),
  join(ROOT, 'components', 'pipeline', 'state-inspector.tsx'),
]

for (const file of fullTextFiles) {
  const src = content(file)
  if (badTextPattern.test(src)) {
    fail('RULE-007', file, 0, 'Visible pipeline UI contains mojibake fragments.')
  }
}

const stringOnlyFiles = [
  join(ROOT, 'app', 'api', 'pipeline', 'strategy', 'route.ts'),
  join(ROOT, 'app', 'api', 'pipeline', 'write', 'route.ts'),
  join(ROOT, 'app', 'api', 'github', 'profile', 'route.ts'),
]

for (const file of stringOnlyFiles) {
  const literals = extractStringLiterals(content(file))
  if (literals.some((literal) => badTextPattern.test(literal))) {
    fail('RULE-007', file, 0, 'User-facing string literal contains mojibake fragments.')
  }
}

// RULE-008: Deployment guardrails must require deploy verification after verify passes.
const prePushHook = content(join(ROOT, '.husky', 'pre-push'))
if (!prePushHook.includes('via CLI') || !prePushHook.includes('Active') || !prePushHook.includes('Apply N changes')) {
  fail('RULE-008', join(ROOT, '.husky', 'pre-push'), 0, 'pre-push hook must remind deploy verification for old CLI active builds.')
}

const pipelineDoc = content(join(ROOT, 'docs', 'harness', 'pipeline.md'))
if (!pipelineDoc.includes('Apply N changes') || !pipelineDoc.includes('git push origin main')) {
  fail('RULE-008', join(ROOT, 'docs', 'harness', 'pipeline.md'), 0, 'Pipeline doc must include deploy verification checklist.')
}

const claudeDoc = content(join(ROOT, 'CLAUDE.md'))
if (!claudeDoc.includes('via CLI') || !claudeDoc.includes('Active') || !claudeDoc.includes('Apply N changes')) {
  fail('RULE-008', join(ROOT, 'CLAUDE.md'), 0, 'Known failure patterns must document Railway CLI deploy drift.')
}
if (!claudeDoc.includes('Apply N changes')) {
  fail('RULE-008', join(ROOT, 'CLAUDE.md'), 0, 'Known failure patterns must document Railway Apply-changes drift.')
}
if (!claudeDoc.includes('git push origin main') || !claudeDoc.includes('/verify')) {
  fail('RULE-008', join(ROOT, 'CLAUDE.md'), 0, 'Workflow doc must require commit/push/deploy verification after verify passes.')
}

const verifyScript = content(join(ROOT, 'scripts', 'verify.mjs'))
if (!verifyScript.includes('Next cycle: commit the verified changes, push origin/main, then confirm a fresh Railway deployment and the live screen behavior.')) {
  fail('RULE-008', join(ROOT, 'scripts', 'verify.mjs'), 0, 'verify script must print the post-verify deployment cycle reminder.')
}

// RULE-009: Published-post learning must stay URL/body -> corpus -> writing-profile retrieval based.
const userLearningFile = join(ROOT, 'lib', 'agents', 'user-learning.ts')
const userLearningContent = content(userLearningFile)
const pathsFile = join(ROOT, 'lib', 'github', 'paths.ts')
const pathsContent = content(pathsFile)
const typesFile = join(ROOT, 'lib', 'agents', 'types.ts')
const typesContent = content(typesFile)

for (const needle of [
  'writingProfile',
  'user-modeling/users/${userId}/writing-profile.json',
]) {
  if (!pathsContent.includes(needle)) {
    fail('RULE-009', pathsFile, lineOf(pathsContent, needle), `Missing writing-profile path contract: ${needle}.`)
  }
}

for (const needle of [
  'fetchPublishedMarkdownFromNaver',
  'Paths.postContent(post.postId)',
  'Paths.corpusSample(userId, sampleId)',
  'writeWritingProfile',
  'loadWritingProfile',
  'MAX_STORED_CORPUS_SAMPLES',
  'MAX_STORED_EXEMPLARS',
]) {
  if (!userLearningContent.includes(needle)) {
    fail('RULE-009', userLearningFile, lineOf(userLearningContent, needle), `Published learning workflow is missing: ${needle}.`)
  }
}

if (!userLearningContent.includes('sourceSampleCount') || !userLearningContent.includes('representativeExcerpts')) {
  fail('RULE-009', userLearningFile, 0, 'Writing profile must store compact sample counts and representative excerpts.')
}
if (!/const samples = \[\.\.\.sampleMap\.values\(\)\][\s\S]*?slice\(0,\s*MAX_STORED_CORPUS_SAMPLES\)/.test(userLearningContent)) {
  fail('RULE-009', userLearningFile, lineOf(userLearningContent, 'const samples ='), 'Corpus index must keep the configured stored sample limit.')
}
if (!/const nextExemplars = \[\.\.\.exemplarMap\.values\(\)\][\s\S]*?slice\(0,\s*MAX_STORED_EXEMPLARS\)/.test(userLearningContent)) {
  fail('RULE-009', userLearningFile, lineOf(userLearningContent, 'const nextExemplars ='), 'Exemplar index must keep the configured stored exemplar limit.')
}
if (!typesContent.includes('"writing-profile"')) {
  fail('RULE-009', typesFile, 0, 'PublicationLearningSummary source must include writing-profile.')
}

const enforcedWorkflowNeedle = '발행 후 학습 강제 워크플로우'
for (const docFile of [
  join(ROOT, 'AGENTS.md'),
  join(ROOT, 'CLAUDE.md'),
  join(ROOT, 'docs', 'harness', 'pipeline.md'),
]) {
  if (!content(docFile).includes(enforcedWorkflowNeedle)) {
    fail('RULE-009', docFile, 0, 'Workflow docs must document the enforced published-post learning workflow.')
  }
}

// RULE-010: Main-keyword pre-posting series must keep series metadata and block main posts.
const topicGeneratorFile = join(ROOT, 'lib', 'agents', 'topic-generator.ts')
const topicGeneratorContent = content(topicGeneratorFile)
const githubTypesFile = join(ROOT, 'lib', 'types', 'github-data.ts')
const githubTypesContent = content(githubTypesFile)
const githubTopicsRoute = join(ROOT, 'app', 'api', 'github', 'topics', 'route.ts')
const githubTopicsContent = content(githubTopicsRoute)
const topicGenerateRoute = join(ROOT, 'app', 'api', 'topics', 'generate', 'route.ts')
const topicGenerateContent = content(topicGenerateRoute)

for (const needle of ['seriesId', 'seriesRole', 'targetMainKeyword', 'sequenceOrder', 'prerequisiteTopicIds']) {
  if (!githubTypesContent.includes(needle)) {
    fail('RULE-010', githubTypesFile, lineOf(githubTypesContent, needle), `Topic type must preserve series metadata: ${needle}.`)
  }
  if (!githubTopicsContent.includes(needle)) {
    fail('RULE-010', githubTopicsRoute, lineOf(githubTopicsContent, needle), `Topic POST route must persist series metadata: ${needle}.`)
  }
}

for (const needle of [
  'runPrePostingSeriesPlanner',
  'preposting-series',
  'seriesRole: "prelude"',
  'seriesRole: "main"',
  'prerequisiteTopicIds: plannedTopicIds.slice',
]) {
  if (!topicGeneratorContent.includes(needle) && !topicGenerateContent.includes(needle)) {
    fail('RULE-010', topicGeneratorFile, lineOf(topicGeneratorContent, needle), `Pre-posting series planner contract missing: ${needle}.`)
  }
}

const topicsPageContent = content(join(ROOT, 'app', 'topics', 'page.tsx'))
if (!topicsPageContent.includes('선행 포스팅 설계') || !topicsPageContent.includes('seriesMainKeyword')) {
  fail('RULE-010', join(ROOT, 'app', 'topics', 'page.tsx'), 0, 'Topics page must expose the pre-posting series planner UI.')
}
if (!orchContent.includes('assertSeriesPrerequisitesPublished') || !orchContent.includes('선행 포스팅 미발행')) {
  fail('RULE-010', orchFile, 0, 'Orchestrator must block main series posts until prelude topics are published.')
}
if (!content(join(ROOT, 'AGENTS.md')).includes('메인 키워드 선행 포스팅 설계 규칙')) {
  fail('RULE-010', join(ROOT, 'AGENTS.md'), 0, 'AGENTS.md must document the main-keyword pre-posting series rule.')
}

// RULE-011: Series detail planning must be stored and consumed by the strategy planner.
const seriesDetailRoute = join(ROOT, 'app', 'api', 'topics', 'series-detail', 'route.ts')
const seriesDetailContent = content(seriesDetailRoute)
const seriesTopicsPageContent = content(join(ROOT, 'app', 'topics', 'page.tsx'))
const strategyPlannerContent = content(join(ROOT, 'lib', 'agents', 'strategy-planner.ts'))

for (const needle of ['seriesDetailPlan', 'seriesDetailReadyAt', 'TopicSeriesDetailPlan']) {
  if (!githubTypesContent.includes(needle)) {
    fail('RULE-011', githubTypesFile, lineOf(githubTypesContent, needle), `Topic type must preserve series detail planning fields: ${needle}.`)
  }
}
for (const needle of ['runSeriesDetailPlanner', 'plannedTopics']) {
  if (!seriesDetailContent.includes(needle) && !topicGeneratorContent.includes(needle)) {
    fail('RULE-011', seriesDetailRoute, lineOf(seriesDetailContent, needle), `Series detail planner API contract missing: ${needle}.`)
  }
}
if (!seriesTopicsPageContent.includes('시리즈 상세 설계') || !seriesTopicsPageContent.includes('handleSaveSeriesDetails')) {
  fail('RULE-011', join(ROOT, 'app', 'topics', 'page.tsx'), 0, 'Topics page must expose series detail planning and save flow.')
}
if (!strategyPlannerContent.includes('seriesDetailPlan') || !strategyPlannerContent.includes('시리즈 상세 설계:')) {
  fail('RULE-011', join(ROOT, 'lib', 'agents', 'strategy-planner.ts'), 0, 'Strategy planner must consume stored series detail planning context.')
}

if (violations.length === 0) {
  process.exit(0)
}

for (const violation of violations) {
  console.error(`[${violation.rule}] ${violation.loc} - ${violation.message}`)
}
process.exit(1)
