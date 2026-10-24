// One effectful operation: execute one already-admitted command and capture its
// actual result. This is an execution boundary, NOT an OS sandbox, scheduler,
// customer acceptance, or authority to run third-party code.
import { spawnSync } from "node:child_process";
import { directArguments, normalizeCommandResult, normalizeVerificationResult } from "./command-normalization.mjs";

export const DEFAULT_COMMAND_LIMITS = Object.freeze({
  timeoutMs: 600_000,
  maxOutputBytes: 4 * 1024 * 1024,
});
const MAX_TIMEOUT_MS = 3_600_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

function admittedLimit(value, ceiling, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > ceiling) {
    throw new TypeError(`${label} requires a finite positive integer at most ${ceiling}`);
  }
  return value;
}

// The Work principal may name stricter wall/output ceilings. The original
// supplier owns this policy once, so mission/intake consumers cannot silently
// invent a separate command-budget grammar or accept a shell override.
export function admitCommandLimits(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some(key => !["timeoutMs", "maxOutputBytes"].includes(key)))
    throw new TypeError("command limits allow only timeoutMs and maxOutputBytes");
  return Object.freeze({
    timeoutMs: admittedLimit(input.timeoutMs ?? DEFAULT_COMMAND_LIMITS.timeoutMs,
      MAX_TIMEOUT_MS, "timeoutMs"),
    maxOutputBytes: admittedLimit(input.maxOutputBytes ?? DEFAULT_COMMAND_LIMITS.maxOutputBytes,
      MAX_OUTPUT_BYTES, "maxOutputBytes"),
  });
}

export function runCommand(command, {
  cwd, shell = "auto", signal,
  timeoutMs = DEFAULT_COMMAND_LIMITS.timeoutMs,
  maxOutputBytes = DEFAULT_COMMAND_LIMITS.maxOutputBytes,
} = {}) {
  if (typeof command !== "string" || !command.trim() || command.includes("\0"))
    throw new TypeError("an original nonempty command string without NUL bytes is required");
  if (![false, true, "auto"].includes(shell))
    throw new TypeError("shell must be true, false, or auto");
  const commandLimits = admitCommandLimits({ timeoutMs, maxOutputBytes });
  timeoutMs = commandLimits.timeoutMs;
  maxOutputBytes = commandLimits.maxOutputBytes;
  if (signal !== undefined && (typeof signal !== "object" || typeof signal.aborted !== "boolean"))
    throw new TypeError("signal must be an AbortSignal-like object");
  if (signal?.aborted) throw signal.reason ?? new Error("command execution cancelled by customer");

  const childEnvironment = { ...process.env };
  // Node deliberately suppresses recursive node --test execution when this
  // private marker leaks from the outer test runner. Verification commands
  // are separate host acts and must execute rather than inherit suppression.
  delete childEnvironment.NODE_TEST_CONTEXT;

  const argv = shell === true ? null : directArguments(command);
  if (shell === false && argv === null)
    throw new TypeError("shell:false requires directly admitted arguments without shell syntax");

  // A declared direct Node verification is a request for this provider's
  // runtime, not whatever executable an ambient PATH happens to name.
  if (argv?.[0] === "node") argv[0] = process.execPath;
  const common = {
    cwd,
    encoding: "utf8",
    maxBuffer: maxOutputBytes, // Node applies this to EACH captured stream.
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    env: childEnvironment,
  };
  const started = process.hrtime.bigint();
  // A synchronous API cannot guarantee interruptibility from a same-thread
  // AbortSignal once spawnSync blocks. Only the preflight check and OS child
  // timeout are assured. Nor do they prove termination of spawned descendants.
  const raw = argv
    ? spawnSync(argv[0], argv.slice(1), { ...common, shell: false })
    : spawnSync(command, { ...common, shell: true });
  const observedWallMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
  return Object.freeze({
    ...normalizeCommandResult(raw, { maxOutputBytes }),
    observedWallMs,
    limits: Object.freeze({ timeoutMs, maxOutputBytes, unit: "wall-ms-and-bytes-per-output-stream" }),
  });
}

// Run an original test/verify command; only a clean exit status 0 passes.
// A timeout, excessive output, signal, or launch failure is NOT accepted Work.
export function runTestsCommand(workdir, command, opts = {}) {
  // The original Work owns its declared execution directory. An extra option
  // may tighten resource bounds, but must not move a verifier to another
  // source territory through an accidental or adversarial cwd override.
  const run = runCommand(command, { ...opts, cwd: workdir });
  return Object.freeze({
    ...normalizeVerificationResult(run),
    observedWallMs: run.observedWallMs,
    limits: run.limits,
  });
}
