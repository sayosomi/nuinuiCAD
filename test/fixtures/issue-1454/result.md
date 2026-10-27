# Issue 1454 stopped discovery checkpoint

Status: **BLOCKED / incomplete; not a repair candidate**.
Base production source remains byte-for-byte unchanged at
`edd7ce153630ca1aa0d0ab64e8db367a579cf11c`.
Branch: `sayosomi/issue-1454-rust-process-lifecycle-hunt`.

## Mandatory stop

First discovery execution:
`npm test -- src/node/rustEvaluationProcess.test.ts --maxWorkers=2`.
Vitest reported **35 tests, 7 passed, 28 failed, 1 uncaught error** in 5.49 s.
A5 stdout `destroy(new Error("stdout failed"))` caused an error forwarded by
Node readline to its Interface, which has no production error listener. The
fixture had independent error observers on all three streams; these did not
consume the separate Interface error. This interrupted normal event delivery;
the A5 error variant reached the finite 5,000 ms test guard. This is an actual
non-progressing harness sequence and unhandled exception, not a PASS, and
triggers the Issue's explicit hang/non-progress STOP rule. The guard bounded
execution; afterEach disposed every fixture and destroyed its streams. No real
child process was spawned or unrelated process killed. No retry was performed.
Subsequent rows in the same already-running Vitest invocation completed before
control returned. No further discovery, repair, or suite execution followed.

This checkpoint deliberately preserves failing discovery tests and frozen
expectations. It must not be represented as merge-ready, independently reviewed,
or protected-CI success. A continuation needs explicit authorization to resolve
the stopped harness/lifecycle condition before further execution.

## Ledger

Ten primary units plus six additional reducers/counterfactual units were accepted:
16/16; parameterized nearby controls are inside their named unit.
All expectations were frozen before execution in traces.md and the test source.
The additional units followed source-inspection evidence of missing terminal,
serialization, envelope, and stream error ownership. No additional topology is
available under this ceiling.

| Unit | Final disposition | Observed Base result |
| --- | --- | --- |
| P1 | PASS | Both normal and reverse response ordering fulfilled exact own payloads; exact envelopes; no kill/notification. |
| P2 | PASS | Only X2 rejected; E3/E1 fulfilled correctly; no terminal notification. |
| P3 | UNRESOLVED | Unknown/duplicate control passed. Malformed/string/null/missing IDs rejected work but did not notify/release generation. Fractional/negative/unsafe numeric IDs left work pending. No repair/repass. |
| P4 | UNRESOLVED | Settled E1 retained; X2 rejected on exit; later request remained pending instead of rejecting. |
| P5 | UNRESOLVED | Both error/exit orders rejected initial pair, but terminal process accepted later request; assertion stopped before replacement part. |
| P6 | UNRESOLVED | Both rejected and kill once; late child error notified unexpectedly after intentional disposal. |
| P7 | UNRESOLVED | Sync throw rejected X2 while E1 remained pending. Real asynchronous callback/destroy errors left both pending. No repair/repass. |
| P8 | UNRESOLVED | Real false-write/drain and reverse response control passed. Actual stdin close/finish left E3 pending. |
| P9 | PASS | G1 rejections, G2 ID reset/success, captured stale callback, old frames/error, repeated get identity all passed. |
| P10 | UNRESOLVED | Replacement and final rejection/kill assertions passed; late G1 disposal error incorrectly notified once. |
| A1 | UNRESOLVED | Idle exit then request left request pending. Minimal terminal-gate reducer. |
| A2 | UNRESOLVED | Idle malformed JSON then request left request pending. Minimal protocol-invalidation reducer. |
| A3 | UNRESOLVED | Cyclic/BigInt serialization rejected failing request, existing E1 remained pending. See allowed-alternative caveat below. |
| A4 | UNRESOLVED | Missing/invalid error envelope rejected E1 only and left X2 pending; ambiguous payload+error rejected E1 only. |
| A5 | UNRESOLVED | stdout error reached uncaught Interface error and timeout STOP; EOF variant left both pending. |
| A6 | UNRESOLVED | stderr diagnostic control passed; stderr error left both requests pending. |

## Findings and evidentiary limits

**Confirmed novel fixed families: 0.** Suspected boundaries below have one Base
execution only; independent reproduction, full reduction, repair and fixed
comparison were not completed. Do not count assertions or manifestations as
families, or claim the stop checkpoint completes the requested hunt.

- Terminal admission/notification owner: requestEnvelope checks disposed and
  stdin.writable but not terminated. A1 minimizes exit followed by request;
  P4/P5 retain initial rejection controls. Child error handler still notifies
  after disposal (P6/P10). No repair applied.
- Protocol response owner: handleLine rejects current pending work for parse/id
  errors without invalidating/releasing generation; numeric ID validation accepts
  non-integer/negative/unsafe IDs and silently ignores them; invalid envelopes
  reject only the matching request. A2/A4 reduce these paths; P3 unknown/duplicate
  and P2 ordinary error are nearby PASS controls. No repair applied.
- Stream failure owner: no production stdin/stdout/stderr error/closure handling
  or write-completion callback. P7/P8/A5/A6 expose pending work after stream loss;
  P1 and P8 successful false-write/drain are nearby PASS controls. Readline error
  forwarding was not safely consumed by the harness; this caused the stop.
- P7 synchronous-write and A3 serialization expectations chose all-pending
  fail-closed rejection. The contract also permits affected-request-only
  rejection, so those failures alone do **not** prove a production defect.
  Existing work remaining pending without a delivered response is insufficient
  to establish a leak. A continuation must preserve the permitted alternative
  and distinguish leaked map entries/continued availability before classification.

## Fault sensitivity

The genuine P1/P3/P9 production control and its assertion mutations passed:
wrong payload routing, unknown/duplicate acceptance, pending leak observation,
and stale owner identity were rejected by the independent assertions. The
notification-count mutation was a static cardinality check, not yet a complete
production-derived double-notification mutation control. The combined
post-terminal/write-error/backpressure sensitivity test failed on genuine Base
write-error behavior before all its negative mutations could execute. Fault
sensitivity is therefore **incomplete**, not claimed complete.

## Verification and scope

- Development focused run: FAIL (counts and stop above).
- Settled-candidate ordered verification block: NOT RUN; no settled candidate.
- Build/lint/full suite: NOT RUN due mandatory stop.
- git diff --check: PASS on stopped checkpoint (rechecked before commit).
- Rust parity: NOT REQUIRED (no Rust/payload semantics changes).
- Human GUI E2E: NOT REQUIRED / NOT RUN.
- Production edits: none. No architecture/DSL/config/dependency changes.
- No PR, merge, Issue closure, main restoration, extra worktree, or legacy
  lifecycle command. No outside-owner repair or scope expansion.
- Weekly and five-hour Human plan observations: UNAVAILABLE. Attribution/rate:
  UNAVAILABLE; no quota or token impact inferred.
