import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

const DEFAULT_PATH = join('data', 'harness-engineering', 'failure-ledger.json')

function loadLedger(path) {
  if (!existsSync(path)) {
    return {
      schemaVersion: 1,
      entries: [],
      lastUpdated: null,
    }
  }

  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return {
      schemaVersion: 1,
      entries: [],
      lastUpdated: null,
      recoveredFromCorruptFile: true,
    }
  }
}

export function appendFailureLedger(entry, options = {}) {
  const root = options.root ?? process.cwd()
  const ledgerPath = options.path ?? join(root, DEFAULT_PATH)
  const now = new Date().toISOString()
  const ledger = loadLedger(ledgerPath)
  const normalized = {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    at: now,
    source: entry.source ?? 'verify',
    command: entry.command ?? null,
    step: entry.step ?? null,
    reason: entry.reason ?? 'unknown failure',
    exitCode: entry.exitCode ?? null,
    evidence: String(entry.evidence ?? '').slice(0, 12_000),
    guardrail: entry.guardrail ?? 'Investigate before changing code around this area again.',
  }

  const next = {
    ...ledger,
    schemaVersion: 1,
    entries: [...(ledger.entries ?? []), normalized].slice(-300),
    lastUpdated: now,
  }

  mkdirSync(dirname(ledgerPath), { recursive: true })
  writeFileSync(ledgerPath, JSON.stringify(next, null, 2))
  return { ledgerPath, entry: normalized }
}
