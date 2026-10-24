# Issue 1454 continuation evidence

Continuation admission: Human LOCAL CHECK PASS at exact checkpoint
`9e0e1345877aebb00f317c80c5f97b909c0379e1`; agent fetched/pruned and verified
exact Base main, exact topic/local HEAD, clean tracked/untracked state, no
competing active implementation/audit/E2E, and current Issue plus checkpoint
comment. Original traces.md and result.md remain unchanged as historical evidence.

## Oracle corrections frozen before corrected candidate execution

No new topology: P1–P10 + A1–A6 remain 16/16.

- P7 synchronous write throw permits failing-request-only rejection *or* all-pending
  terminal rejection. In either case the failed correlation must be removed.
  If E1 remains pending, a valid E1 response must still fulfill it. The chosen
  repair fail-closes actual write failures; serialization is isolated instead.
- A3 cyclic/BigInt serialization: only unsent X2 rejects; E1 remains pending then
  fulfills from the same frozen id 1 success bytes. No notification/kill.
  After E1 settles the pending map must be empty. This chooses the Issue's
  permitted per-request alternative; it is not a new all-pending requirement.
- A6 diagnostic stderr failure does not imply loss of stdin/stdout. Consume and
  report its error, retain E1/X2 pending, then fulfill each with the frozen normal
  replies. No kill or termination notification. The original required terminal
  rejection was overstrict and is superseded. The diagnostic stream must still
  have a production error listener: tests remove the independent harness listener
  before triggering the error. No global exception suppression is used.
- A5 first received a production Interface error handler before any rerun.
  Both Interface and stdout error/closure handlers are installed in the final
  client; closing the Interface is part of terminal/disposal cleanup. Stream error
  handlers remain installed to consume late teardown errors. Expected end/error/
  close observers are attached before transitions, not afterward.

## Independent exact-Base reproduction (safe, no timeout or unhandled error)

Loaded `git show edd7ce153630ca1aa0d0ab64e8db367a579cf11c:src/node/rustEvaluationProcess.ts`
without changing the checkout; TypeScript transpilation only, no source repair.
Source SHA-256: `002d3316e393f1baacc04ad2f61d57a8c15af5d827f3fbe4c97fc0bb9683c700`.
Used real Writable/PassThrough and public production request/export/dispose calls.
All Promise observers installed at submission; setImmediate checkpoints, no sleeps.
A narrow readline.createInterface observer attached a separate Interface error
listener for **Base observation only**, preserving errors as evidence and allowing
Node close delivery. No global uncaughtException handler, mock settlements, retries,
or real child spawns. Closed/destroyed every owned fixture. Execution: 0.073 s,
exit 0, zero uncaught exceptions. This run validates the following *wrong Base
observations*, not conformance PASS:

| Existing unit | Independently confirmed Base observation |
| --- | --- |
| P1/P3 control | Unknown/duplicate ignored; E1/X2 fulfill own payloads. |
| A1/P4/P5 | Exit then request writes a new frame and leaves Promise pending. |
| P6/P10 | Dispose rejects both and kills once; late error incorrectly notifies once. |
| A2/P3 | Malformed line then request is accepted; no owner notification. |
| A4 | Missing response payload rejects E1 but leaves X2 pending on untrusted G1. |
| P7 sync | X2 rejects, E1 valid reply succeeds, but failed X2 remains in pending map. |
| A3 | BigInt X2 rejects, E1 valid reply succeeds, but failed X2 remains in pending map. |
| P7 async | Actual stdin destroy(error) leaves both requests pending. |
| P8 | Actual stdin destroy() leaves pending requests unresolved. |
| A5 error | Interface has zero production error listeners; observer receives stdout failure; both requests remain pending. |
| A5 EOF | stdout end leaves both requests pending. |
| A6 | Only harness consumes stderr error; normal stdout replies still fulfill both; no terminal notification. |

The private pending-map observation supplements public Promise checks to distinguish
permitted failing-request isolation from a leaked correlation entry. No test changes
production state through that map.

A second safe Base comparison ran the complete corrected 35-case matrix through
exact-Base classes (TypeScript CommonJS transpilation, only module selection
changed). It registered an independent Interface error observer before the A5
transition and logged `BASE Interface error observed: stdout failed`. Result:
**7 passed / 28 failed**, 32 ms of test execution, exit 1 as expected, **zero
unhandled errors and no timeout**. This confirms every corrected regression
against exact Base without blindly repeating the hanging original sequence.
The temporary task-owned comparison test was removed after execution; no Base
source file was written or substituted in the implementation checkout.

## Fixed first-owner families

Four distinct first-incorrect lifecycle boundaries, all inside the one authorized
RustEvaluationProcess owner. Manifestations are grouped here, not counted separately.

| Family | Frozen oracle / earliest incorrect owner | Reduced Base failure / nearby PASS | Minimal repair and fixed evidence |
| --- | --- | --- | --- |
| F1 terminal state admission and notification | Terminal G1 rejects new work; dispose never notifies a crash; at most one callback/kill. | A1 exit then request writes and remains pending. P6 dispose then error notifies. Initial pending rejection on exit and intentional kill-once controls pass on Base. | Guard request/frame handling by terminal state; centralize the guarded terminal transition; close readline on terminal/dispose, suppress disposed-generation notification, guard owned kill. P4/P5/P6/P9/P10 and A1 pass. Existing lazy owner identity guard is reused without source changes. |
| F2 response protocol integrity | Invalid JSON/IDs/envelopes invalidate G1 and release owner; valid unknown/duplicate IDs do not cross-settle. | A2 malformed line then request is accepted. A4 missing payload rejects one request only. P3 valid unknown/duplicate and P2 ordinary request-error controls pass on Base. | Route integrity errors through terminal rejection; require safe nonnegative integer IDs and exactly one payload or string error. P3/A2/A4 pass; P1/P2 normal and reverse/error controls remain passing. |
| F3 request registration/commit cleanup | Unsent failed requests must not retain orphan correlation; permitted failing-request-only rejection preserves earlier valid work. Actual write failure may fail-close all. | A3 serialization rejects X2, E1 still fulfills, yet one stale map entry remains. P7 sync throw similarly retains X2. Nearby valid E1 response passes on Base. This is a map-entry leak, not a claim that the rejected X2 Promise remains pending. | Serialize before registering; isolate serialization rejection. Catch real synchronous write failure and observe write callback errors through terminal transition. P7/A3 pass with empty map, isolated serialization rejection and fail-closed actual writes. |
| F4 stream lifecycle event ownership | Response/input loss must reject pending work; expected stream/Interface errors must be consumed; stderr diagnostics do not require terminal rejection. | A5 Interface error has no production listener; independent observer safely exposes two pending requests. EOF/stdin failure also leave pending work. A6 only harness handles stderr error, while normal replies still work. P1/P8 backpressure/drain and A6 ordinary diagnostic controls pass on Base. | Install Interface, stdout and stdin error/closure/finish handlers; retain error handlers through teardown; register stdin write callback. Consume/report stderr errors without invalidating requests. P7/P8/A5/A6 pass with no unhandled errors. |

## Final frozen-unit dispositions

| Unit | Final disposition | Fixed observation |
| --- | --- | --- |
| P1 | PASS | Exact distinct E1/X2 envelopes; reverse and normal replies fulfill own payloads. |
| P2 | PASS | Only X2 rejects; E3/E1 successes isolated. |
| P3 | BUG→FIXED→REPASS | Unknown/duplicate control still passes; all malformed/invalid-ID variants reject G1 and permit successful replacement. |
| P4 | BUG→FIXED→REPASS | E1 retains success, X2 rejects, late events/new calls cannot revive G1; notification once. |
| P5 | BUG→FIXED→REPASS | Both child-event orders reject pending pair; G2 E3 succeeds; notification once. |
| P6 | BUG→FIXED→REPASS | Both reject, kill once, no crash notification or post-dispose acceptance. |
| P7 | BUG→FIXED→REPASS | Sync throw, actual deferred callback failure and asynchronous stream error settle deterministically; correlation cleared. Permitted alternatives encoded explicitly. |
| P8 | BUG→FIXED→REPASS | False writes/drain succeed; real stdin close/finish rejects E3 and prevents writes. |
| P9 | PASS | G2 exact identity shared; stale G1 callbacks/frames/errors cannot affect G2; IDs restart at 1. |
| P10 | BUG→FIXED→REPASS | Intentional G1 release, successful G2, stale callbacks isolated; final disposal rejects work and kills each generation once. |
| A1 | BUG→FIXED→REPASS | Idle exit prevents a new write/request. |
| A2 | BUG→FIXED→REPASS | Idle malformed line invalidates G1; later request rejects. |
| A3 | BUG→FIXED→REPASS | Corrected per-request oracle: X2 rejects unsent; E1 fulfills; no stale correlation, kill or notification. |
| A4 | BUG→FIXED→REPASS | Missing, invalid-error and ambiguous envelopes invalidate/reject both pending requests. |
| A5 | BUG→FIXED→REPASS | Interface/stdout error and EOF reject pair without unhandled errors or timeouts. |
| A6 | BUG→FIXED→REPASS | Corrected diagnostic oracle: client consumes stderr error; E1/X2 still fulfill; no kill/notification. Original terminal requirement withdrawn. |

Accepted extra reducers: **6**, all repassed; total **16/16**, no new exploration.

## Oracle sensitivity and genuine controls

Actual production observations are checked before deliberately perturbing them.
The same assertions reject swapped E1/X2 payloads, unknown/duplicate acceptance,
pending Promise observations, leaked map counts, silent post-terminal acceptance,
doubled notification count derived from the real count, stale G1 owner identity,
write-error success, and rejection of a buffered false-write request. These are
negative fault controls, not counted defects. Normal/reverse envelopes, isolated
request error, ignored unknown/duplicate IDs, genuine drain/reply completion,
owner reuse/replacement, and nonterminal diagnostics are adjacent genuine PASS
controls. All sensitivity controls complete on the fixed client.

## Verification history

- First fixed focused execution: 35/35 PASS, 23 ms; no unhandled error/timeout.
- Lifecycle repetitions: **10/10 complete executions PASS**, 35 tests each; every
  iteration passed, no retry-until-green. Deferred callbacks and actual Node
  stream events drive transitions, not wall-clock sleeps.
- First ordered verification stopped at build: TypeScript found a circular test
  fixture inference and insufficient response-property narrowing. Both type
  definitions were corrected; no lifecycle runtime failure occurred. Full suite
  had not begun. The exact ordered block was restarted after those corrections.

- Final exact ordered block: **PASS (exit 0)** in the required sequence:
  1. `npm test -- src/node/rustEvaluationProcess.test.ts --maxWorkers=2`: **35/35 PASS**.
  2. `npm run build`: **PASS**, including application, nui-language and MCP build.
  3. `npm run lint`: **PASS**.
  4. `npm test -- --maxWorkers=2`: **685 files passed / 2 skipped; 10,992 tests
     passed / 183 skipped**, 284.93 s. Full suite executed once, after type fixes;
     no source change after that result.
  5. `git diff --check`: **PASS**; repeated after this evidence-only update.
- Final source inspection against Issue contract: no blocking mismatch found in
  the local change. This is implementation-local verification, not independent
  ChatGPT review or protected CI.
- No unresolved residuals, hangs, unhandled exceptions, unsafe cleanup, or scope
  deviations remain in the accepted matrix. No additional accepted exploration.
- Original stopped checkpoint evidence is preserved without edits. These are
  reusable task evidence, not superseded implementation plans to delete.
- Rust parity and Human GUI E2E: NOT REQUIRED / NOT RUN. No Rust semantics,
  payload conversion, DSL, native host, config, dependencies or architecture
  ownership changed. Existing suite skips retained; no new test skips added.
- Final continuation changed only `src/node/rustEvaluationProcess.ts`,
  `src/node/rustEvaluationProcess.test.ts`, and this completion evidence. Entire
  Issue branch also contains the preserved `traces.md` and `result.md` from its
  first checkpoint. No PR, merge, Issue closure or main restoration performed.
- Human weekly/five-hour remaining-plan observations: **UNAVAILABLE**. Usage
  attribution/rate: **UNAVAILABLE**; no quota impact inferred from time or tests.
