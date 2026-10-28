# sandbox-command-execution-service

<!-- 561-group-standards:badges:start -->
[![Red Cup Engineering](https://img.shields.io/badge/561%20Group-Red%20Cup%20Engineering-c0392b)](https://github.com/red-cup-engineering)
[![License: MIT](https://img.shields.io/badge/license-MIT-c0392b)](LICENSE)
[![Indigenous data: CARE](https://img.shields.io/badge/Indigenous%20data-CARE-4b6f44)](https://github.com/red-cup-engineering/.github/blob/main/GOVERNANCE.md)
[![Tips welcome](https://img.shields.io/badge/tips-welcome-d4a017)](https://github.com/561-group/.github/blob/main/TIPS.md)
<!-- 561-group-standards:badges:end -->

## Finite customer Work verification and evidence

The original software mission [consumer](https://github.com/red-cup-engineering/software-mission-execution-service)
uses `runTestsCommand` at baseline, after edits, and before proposing a
result for customer induction. Every subprocess is an **already admitted**
command; this library is a *local execution adapter*, **not** a security
sandbox or scheduler. Untrusted commands require a separately authorized OS
isolation/cgroup/container boundary and network/filesystem scope. In
particular, `shell: "auto"` retains the old shell fallback for nontrivial
**trusted authored** commands; `shell:false` refuses unparseable shell
syntax rather than running it through an implicit shell.

**Original production behavior improved:** the old call used
`maxBuffer: Infinity` with no timeout and checked AbortSignal only before
launch. The current `runCommand` and `runTestsCommand` use finite default
ceilings of **600,000 wall milliseconds** and **4 MiB of captured bytes per
stream**. Customers may select strictly bounded resource limits with
`admitCommandLimits({timeoutMs,maxOutputBytes})`; omitted limits receive
the source-owned defaults. There is no nonfinite/zero limit or unknown
extra budget key. The hard allowed ceilings are 3,600,000 wall milliseconds
and 16 MiB per stream. Node's synchronous `spawnSync` implements timeout
and maxBuffer in the actual child process, not by waiting for a callback or
sampling the output after the process exits. The final returned captured
text is also cropped locally if a final Node chunk overshot the cap.
Errors are classified `deadline`, `output-limit`, `spawn-error`,
`cancelled`, `signaled`, or `nonzero-exit`; only an observed clean exit
code zero **without an error** yields `passed:true`. Downstream Work receives
`observedWallMs` from the monotonic local clock plus its original
`limits`, never an invented paid CPU or wall-clock billing event.

The workdir argument of `runTestsCommand` takes precedence over any
incidental `opts.cwd`: options cannot move a tenant's verification into
another tenant's file tree. The executable `node` in an admitted direct
command resolves to this owner's own Node runtime rather than ambient
`PATH`; no-shell commands remain no-shell.

**Honest remaining host limitations:** the synchronous call blocks its
JavaScript caller, so a same-thread AbortSignal **cannot** be guaranteed
to interrupt an already running child (preflight cancellation works).
On POSIX hosts, the command now has its own process group: after an actual
timeout/output exhaustion, the adapter signals that group with SIGKILL and
records `processGroupCleanup` as `group-signal-sent`,
`group-already-exited`, or `group-signal-failed`. This reduces lingering
child work, as tested with a real grandchild, but **does not** guarantee
termination of escaped/detached descendants or a hostile process tree;
Windows reports `not-supported` for that cleanup. OS CPU-memory/storage
budgets, networking, effect isolation,
workload admission, replication/quorum validation, retry/lease lifecycle,
independent customer result acceptance, and real settlement must be
provided and received separately. A successful test, low wall time, or a
configured deadline is not commercial revenue.

### Receiving

`npm run verify` is the original native syntax and test suite. The
bounded Work revision was tested as an exact GitHub snapshot on **Node
22.16**, using `git hash-object` to match all four source/test blobs:
**16 tests passed, zero failed**. Tests cover the original nested Node-test
behavior and PATH pinning as well as actual timed-out and noisy children,
budget-policy refusal, output truncation, ambiguous signals, clean
execution, cross-tenant cwd override denial, and POSIX descendant cleanup under an
actual elapsed deadline. The separate original
[software mission receiving branch](https://github.com/red-cup-engineering/software-mission-execution-service)
proposes carrying this same supplier's `failureKind`, limits and observed
wall time through original Work actions, not a new scheduler or commerce rail.
The upstream original package must be versioned and selected by that
consumer before claiming native installed integrated receiving. Native
source tests cannot establish which original external customer accepted a
delivered artifact or paid for it.
