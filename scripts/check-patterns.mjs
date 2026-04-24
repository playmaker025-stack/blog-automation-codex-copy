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
if (!orchContent.includes('평가 점수는 ${evalResult.aggregateScore}점으로 기준보다 낮지만, 본문 초안은 저장했습니다.')) {
  fail('RULE-005', orchFile, lineOf(orchContent, 'postGateResult.passed'), 'Low-score draft warning message is missing.')
}
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
const badTextPattern = /�|[?][꾀-힣]|[肄蹂湲諛嫄吏媛濡踰]/u
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

// RULE-008: Deployment guardrails must remind us that Railway can keep serving an old CLI deployment.
const prePushHook = content(join(ROOT, '.husky', 'pre-push'))
if (!prePushHook.includes('via CLI') || !prePushHook.includes('Active 커밋 제목') || !prePushHook.includes('Apply N changes')) {
  fail('RULE-008', join(ROOT, '.husky', 'pre-push'), 0, 'pre-push hook must remind deploy verification for old CLI active builds.')
}

const pipelineDoc = content(join(ROOT, 'docs', 'harness', 'pipeline.md'))
if (
  !pipelineDoc.includes('배포 검증 체크') ||
  !pipelineDoc.includes('GitHub 푸시만 확인하고 "배포 완료"라고 판단하지 않는다.') ||
  !pipelineDoc.includes('Apply N changes')
) {
  fail('RULE-008', join(ROOT, 'docs', 'harness', 'pipeline.md'), 0, 'Pipeline doc must include deploy verification checklist.')
}

const claudeDoc = content(join(ROOT, 'CLAUDE.md'))
if (!claudeDoc.includes('Railway repo 연결 뒤에도 Active 배포가 예전 CLI 빌드로 남음')) {
  fail('RULE-008', join(ROOT, 'CLAUDE.md'), 0, 'Known failure patterns must document Railway CLI deploy drift.')
}
if (!claudeDoc.includes('Railway `Apply N changes` 미적용 상태에서 GitHub 자동배포가 안 생김')) {
  fail('RULE-008', join(ROOT, 'CLAUDE.md'), 0, 'Known failure patterns must document Railway Apply-changes drift.')
}

if (!claudeDoc.includes('`/verify` 통과 후 커밋/푸시/배포 확인까지 완료') || !claudeDoc.includes('`git push origin main`')) {
  fail('RULE-008', join(ROOT, 'CLAUDE.md'), 0, 'Workflow doc must require commit/push/deploy verification after verify passes.')
}

const verifyScript = content(join(ROOT, 'scripts', 'verify.mjs'))
if (!verifyScript.includes('Next cycle: commit the verified changes, push origin/main, then confirm a fresh Railway deployment and the live screen behavior.')) {
  fail('RULE-008', join(ROOT, 'scripts', 'verify.mjs'), 0, 'verify script must print the post-verify deployment cycle reminder.')
}

if (violations.length === 0) {
  process.exit(0)
}

for (const violation of violations) {
  console.error(`[${violation.rule}] ${violation.loc} - ${violation.message}`)
}
process.exit(1)
