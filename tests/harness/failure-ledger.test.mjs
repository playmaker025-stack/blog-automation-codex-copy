import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { appendFailureLedger } from "../../scripts/failure-ledger.mjs";

let tempRoot;

describe("failure ledger hook support", () => {
  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "blog-harness-ledger-"));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test("verification failures append instead of replacing prior evidence", () => {
    appendFailureLedger({
      source: "verify",
      command: "node scripts/check-patterns.mjs",
      step: "patterns",
      reason: "pattern guard failed",
      evidence: "RULE-005 failed",
    }, { root: tempRoot });

    appendFailureLedger({
      source: "verify",
      command: "node --test tests/harness/*.test.mjs",
      step: "harness",
      reason: "harness failed",
      evidence: "low score branch regressed",
    }, { root: tempRoot });

    const ledgerPath = join(tempRoot, "data", "harness-engineering", "failure-ledger.json");
    const ledger = JSON.parse(readFileSync(ledgerPath, "utf-8"));

    assert.equal(ledger.entries.length, 2);
    assert.equal(ledger.entries[0].step, "patterns");
    assert.equal(ledger.entries[1].step, "harness");
    assert.ok(ledger.entries[1].guardrail.includes("Investigate") || ledger.entries[1].guardrail.includes("Read"));
  });

  test("large evidence is capped so hooks stay usable", () => {
    const result = appendFailureLedger({
      source: "verify",
      step: "build",
      reason: "build failed",
      evidence: "x".repeat(20_000),
    }, { root: tempRoot });

    assert.ok(result.entry.evidence.length <= 12_000);
  });
});
