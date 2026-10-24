import assert from "node:assert/strict";
import test from "node:test";
import { directArguments, normalizeCommandResult, normalizeVerificationResult } from "../src/command-normalization.mjs";

test("normalizes a declared direct command without granting shell syntax", () => {
  assert.deepEqual(directArguments("node --test test/example.test.mjs"), ["node", "--test", "test/example.test.mjs"]);
  assert.equal(directArguments("node test.mjs && rm -rf scratch"), null);
  assert.equal(directArguments(""), null);
});

test("normalizes process and verification results deterministically", () => {
  const result = normalizeCommandResult({ status: 1, stdout: undefined, stderr: "failed", error: undefined, signal: null });
  assert.deepEqual(result, { code: 1, stdout: "", stderr: "failed", error: "", cancelled: false, failureKind: "nonzero-exit" });
  assert.deepEqual(normalizeVerificationResult(result), { passed: false, output: "exit=1\n\nfailed\n", failureKind: "nonzero-exit" });
});

test("timeout, buffer exhaustion, spawn errors and signals are distinct fail-closed outcomes", () => {
  for (const [result, reason, cancelled] of [
    [{ status:null, signal:"SIGKILL", error:{code:"ETIMEDOUT", message:"deadline expired"} }, "deadline", false],
    [{ status:null, signal:"SIGKILL", error:{code:"ENOBUFS", message:"output too long"} }, "output-limit", false],
    [{ status:null, signal:null, error:{code:"ENOENT", message:"missing executable"} }, "spawn-error", false],
    [{ status:null, signal:"SIGTERM", error:undefined }, "signaled", true],
    [{ status:null, signal:null, error:{code:"ABORT_ERR", message:"aborted"} }, "cancelled", true],
  ]) {
    const observed=normalizeCommandResult(result);
    assert.equal(observed.failureKind,reason);
    assert.equal(observed.cancelled,cancelled);
    assert.equal(normalizeVerificationResult(observed).passed,false);
    assert.equal(normalizeVerificationResult(observed).failureKind,reason);
  }
});

test("source output is byte-bounded even if Node returns a final oversized chunk", () => {
  const readout = normalizeCommandResult({
    status:null, signal:"SIGKILL",
    error:{code:"ENOBUFS",message:"buffer budget exceeded"},
    stdout:"A".repeat(20_000), stderr:"B".repeat(10_000),
  }, { maxOutputBytes: 1024 });
  assert.equal(readout.failureKind,"output-limit");
  assert.ok(readout.stdout.length < 1200);
  assert.ok(readout.stderr.length < 1200);
  assert.match(readout.stdout,/cropped to declared/u);
  assert.equal(normalizeVerificationResult(readout).passed,false);
});

test("clean zero process exit alone is necessary but spawn errors also refuse", () => {
  const clean=normalizeCommandResult({status:0,signal:null});
  assert.deepEqual(normalizeVerificationResult(clean), {
    passed:true,output:"exit=0\\n\\n\\n",failureKind:null
  });
  const contradictory=normalizeCommandResult({status:0,signal:null,error:{code:"EIO",message:"observer error"}});
  assert.equal(normalizeVerificationResult(contradictory).passed,false);
  assert.equal(normalizeVerificationResult(contradictory).failureKind,"spawn-error");
});
