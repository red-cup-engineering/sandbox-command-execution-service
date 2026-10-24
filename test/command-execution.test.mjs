import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { DEFAULT_COMMAND_LIMITS, admitCommandLimits, runCommand, runTestsCommand } from "../src/command-execution.mjs";

test("nested node test verification executes instead of inheriting recursive-run suppression", () => {
  const root = mkdtempSync(join(tmpdir(), "union-executor-nested-test-"));
  writeFileSync(join(root, "failure.test.mjs"), 'import test from "node:test"; import assert from "node:assert/strict"; test("real nested failure", () => assert.equal(1, 2));\n');
  const result = runTestsCommand(root, "node --test failure.test.mjs");
  assert.equal(result.passed, false);
  assert.match(result.output, /real nested failure/);
  assert.doesNotMatch(result.output, /skipping running files/);
});

test("direct node verification binds to the provider runtime rather than ambient PATH", () => {
  const root = mkdtempSync(join(tmpdir(), "union-executor-runtime-"));
  const fakeBin = join(root, "fake-bin");
  const fakeNode = join(fakeBin, "node");
  const priorPath = process.env.PATH;
  mkdirSync(fakeBin);
  writeFileSync(join(root, "runtime.mjs"), 'if (process.execPath !== process.argv[2]) process.exit(9);\n');
  writeFileSync(fakeNode, "#!/bin/sh\necho fake-node >&2\nexit 88\n");
  chmodSync(fakeNode, 0o755);
  try {
    process.env.PATH = `${fakeBin}:${priorPath || ""}`;
    const result = runTestsCommand(root, `node runtime.mjs ${process.execPath}`);
    assert.equal(result.passed, true);
    assert.doesNotMatch(result.output, /fake-node/);
  } finally {
    priorPath === undefined ? delete process.env.PATH : process.env.PATH = priorPath;
  }
});

test("spawn failures remain visible to verification callers", () => {
  const result = runTestsCommand(tmpdir(), "command-that-does-not-exist-union-test", { shell: false });
  assert.equal(result.passed, false);
  assert.match(result.output, /ENOENT|not found/i);
});

test("a hanging original Work verification expires under a bounded wall-clock budget", () => {
  const root=mkdtempSync(join(tmpdir(),"union-executor-deadline-"));
  writeFileSync(join(root,"slow.mjs"), "setTimeout(() => {}, 30000);\n");
  const result=runTestsCommand(root,"node slow.mjs",{shell:false,timeoutMs:50,maxOutputBytes:4096});
  assert.equal(result.passed,false);
  assert.equal(result.failureKind,"deadline");
  assert.match(result.output,/ETIMEDOUT/u);
  assert.equal(result.limits.timeoutMs,50);
  assert.equal(result.limits.maxOutputBytes,4096);
  assert.ok(result.observedWallMs >= 0 && result.observedWallMs < 2000);
});

test("excessive child output is a refused result with locally bounded retained text", () => {
  const root=mkdtempSync(join(tmpdir(),"union-executor-output-"));
  writeFileSync(join(root,"noisy.mjs"),
    'process.stdout.write("X".repeat(256*1024));\n');
  const result=runTestsCommand(root,"node noisy.mjs",{shell:false,maxOutputBytes:1024});
  assert.equal(result.passed,false);
  assert.equal(result.failureKind,"output-limit");
  assert.match(result.output,/ENOBUFS/u);
  assert.match(result.output,/cropped to declared/u);
  assert.ok(result.output.length < 1500);
  assert.equal(result.limits.maxOutputBytes,1024);
});

test("ordinary qualified verification receives its original clean result and actual wall observation", () => {
  const root=mkdtempSync(join(tmpdir(),"union-executor-clean-"));
  writeFileSync(join(root,"check.mjs"),"export const accepted = true;\n");
  const observed=runTestsCommand(root,"node --check check.mjs",{shell:false,timeoutMs:10000,maxOutputBytes:65536});
  assert.equal(observed.passed,true,observed.output);
  assert.equal(observed.failureKind,null);
  assert.ok(Number.isSafeInteger(observed.observedWallMs)&&observed.observedWallMs>=0);
  assert.deepEqual(observed.limits,{timeoutMs:10000,maxOutputBytes:65536,unit:"wall-ms-and-bytes-per-output-stream"});
  assert.ok(DEFAULT_COMMAND_LIMITS.timeoutMs > 0);
  assert.ok(Number.isFinite(DEFAULT_COMMAND_LIMITS.maxOutputBytes));
});

test("caller cannot disable bounded execution or smuggle shell syntax through explicit direct mode", () => {
  for(const bad of [0,-1,NaN,Infinity,3.5,3_600_001,undefined]){
    if(bad===undefined) continue; // absent means safe default, not unlimited
    assert.throws(()=>runCommand("node --version",{timeoutMs:bad}),/timeoutMs requires/u);
  }
  for(const bad of [0,-1,Infinity,3.5,16*1024*1024+1])
    assert.throws(()=>runCommand("node --version",{maxOutputBytes:bad}),/maxOutputBytes requires/u);
  assert.throws(()=>runCommand("node --version && echo unexpected",{shell:false}),
    /requires directly admitted arguments/u);
  assert.throws(()=>runCommand("node --version",{shell:"untrusted"}),/shell must/u);
  assert.throws(()=>runCommand("node --version",{signal:{}}),/signal must/u);
  assert.throws(()=>runCommand("node --version",{signal:{aborted:true,reason:new Error("blocked before worker")}}),
    /blocked before worker/u);
  assert.throws(()=>runCommand("node\0 --version"),/NUL bytes/u);
  assert.throws(()=>runCommand(""),/nonempty/u);
});

test("missing executable is a spawn failure, not an accepted empty task", () => {
  const result=runTestsCommand(tmpdir(),"nonexistent-org-receiving-xyz",{shell:false,timeoutMs:1000});
  assert.equal(result.passed,false);
  assert.equal(result.failureKind,"spawn-error");
  assert.match(result.output,/ENOENT/u);
});

test("one supplier owns original Work command limits, refusing silent shell or unknown resource claims", () => {
  const strict=admitCommandLimits({timeoutMs:1000,maxOutputBytes:2048});
  assert.deepEqual(strict,{timeoutMs:1000,maxOutputBytes:2048});
  assert.equal(Object.isFrozen(strict),true);
  assert.deepEqual(admitCommandLimits(),DEFAULT_COMMAND_LIMITS);
  assert.deepEqual(admitCommandLimits({timeoutMs:1000}),
    {timeoutMs:1000,maxOutputBytes:DEFAULT_COMMAND_LIMITS.maxOutputBytes});
  for(const bad of [null,[],{timeoutMs:0},{maxOutputBytes:Infinity},
    {timeoutMs:1,shell:true},{timeoutMs:500,runAsRoot:true}])
    assert.throws(()=>admitCommandLimits(bad),/command limits|requires a finite/u);
});

test("one verification cannot escape its declared original customer Work directory by option precedence", () => {
  const original=mkdtempSync(join(tmpdir(),"union-executor-original-work-"));
  const external=mkdtempSync(join(tmpdir(),"union-executor-other-owner-"));
  writeFileSync(join(external,"artifact.mjs"),"export const customer = 'other';\n");
  const held=runTestsCommand(original,"node --check artifact.mjs",
    {shell:false,cwd:external,timeoutMs:5000,maxOutputBytes:4096});
  assert.equal(held.passed,false);
  assert.equal(held.failureKind,"nonzero-exit");
  assert.match(held.output,/artifact.mjs|not found|ENOENT/iu);
  // If the extraneous option had won, this test would wrongly approve the
  // different tenant's present file as the original Work result.
});
