import { execSync } from 'child_process'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { appendFailureLedger } from './failure-ledger.mjs'

const FAILURES_DIR = join(process.cwd(), 'data', 'verify-failures')

const skipBuild = process.argv.includes('--skip-build')
const skipTest = process.argv.includes('--skip-test')

const steps = [
  {
    name: 'typecheck',
    cmd: 'npx tsc --noEmit --skipLibCheck',
    description: 'TypeScript type check',
  },
  {
    name: 'lint',
    cmd: 'npx eslint . --max-warnings=0 --quiet',
    description: 'ESLint check',
  },
  {
    name: 'patterns',
    cmd: 'node scripts/check-patterns.mjs',
    description: 'Known failure pattern guard',
  },
  ...(!skipBuild
    ? [
        {
          name: 'build',
          cmd: 'npx next build',
          description: 'Next.js production build',
        },
      ]
    : []),
  ...(!skipTest
    ? [
        {
          name: 'harness',
          cmd: 'node --test tests/harness/*.test.mjs',
          description: 'Harness tests',
        },
      ]
    : []),
]

function run(cmd) {
  return execSync(cmd, {
    encoding: 'utf-8',
    stdio: 'pipe',
    cwd: process.cwd(),
  })
}

function saveFailureLog(failures) {
  mkdirSync(FAILURES_DIR, { recursive: true })
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19)
  const logPath = join(FAILURES_DIR, `${timestamp}.json`)
  writeFileSync(
    logPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        failures,
      },
      null,
      2,
    ),
  )
  return logPath
}

const results = []
let hasFailure = false

console.log('\n=== Verification started ===\n')

for (const step of steps) {
  process.stdout.write(`[${step.name}] ${step.description} ... `)

  try {
    run(step.cmd)
    console.log('pass')
    results.push({ step: step.name, status: 'pass' })
  } catch (err) {
    const stderr = err.stderr || ''
    const stdout = err.stdout || ''
    const output = (stdout + '\n' + stderr).trim()

    console.log('fail')
    console.log('\n--- Failure output ---')
    console.log(output)
    console.log('---\n')

    const failure = {
      step: step.name,
      status: 'fail',
      command: step.cmd,
      error: output,
      exitCode: err.status,
    }
    results.push(failure)
    appendFailureLedger({
      source: 'verify',
      command: step.cmd,
      step: step.name,
      reason: `${step.name} failed`,
      exitCode: err.status,
      evidence: output,
      guardrail: 'Read this failure entry before changing related pipeline, harness, or hook code.',
    })
    hasFailure = true
  }
}

console.log('\n=== Verification result ===')
for (const result of results) {
  console.log(`${result.status === 'pass' ? 'PASS' : 'FAIL'} ${result.step}`)
}

if (hasFailure) {
  const failures = results.filter((result) => result.status === 'fail')
  const logPath = saveFailureLog(failures)
  console.log(`\nFailure log saved: ${logPath}`)
  console.log('Cumulative failure ledger updated: data/harness-engineering/failure-ledger.json')
  process.exit(1)
}

console.log('\nAll verification steps passed.')
process.exit(0)
