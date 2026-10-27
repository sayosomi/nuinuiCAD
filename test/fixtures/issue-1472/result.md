# #1472 — asynchronous evaluation publication evidence

Base: `e65f1030e1c93743ac650ee999bdc77d8a5142a5`.
Branch: `sayosomi/issue-1472-async-evaluation-publication`.
Scope: the host-neutral React publication boundary. Independent pushed-HEAD review,
protected PR/CI, merge and final acceptance remain external gates.

## Frozen oracle and execution

`freeze.py` and `manifest.json` specify sources, SHA-256 hashes, event order and
complete expected publication snapshots. All 16 primary traces (102 live-state
checkpoints) were sealed before the first hook measurement. The two X traces and
one reducer were added after the Base failures, before measuring those additions.
The final corpus contains **19 distinct exploration units, 121 event checkpoints,
116 live publication checkpoints and 43 source-application checkpoints**. Five
unmount checkpoints have no live publication or interaction authority. The three
real Rust source controls are verification controls, outside this exploration count.

The transport callbacks are deterministic deferred promises resolved/rejected in
`act`; they do not claim out-of-order responses from Rust's sequential JSON-lines
service. Source changes use the actual canonical document store/compiler. Evaluation
options use `buildEvaluationOptions`. Unchanged rerenders are adjacent controls.
The compiler-generated element IDs are retained, never substituted with synthetic
source identities. Each event records actual compiled/source revisions, producer
revision, monotonic request identity, mode/source/status/stale/eligibility/error,
geometry, diagnostics and `evaluationStateIsCurrentFor`.

Independent geometry: K has A=(0,0), B=(30,40), AB length 50 mm. L has B=(-12,5)
and AB length 13 mm. Limit 1 yields A only. D has a disabled A=(7,9), visible to
evaluation only with the supported disabled-ID allowance. S has a genuine scalar
`width=30` and the same hand-computable geometry as K. The I source is a legal
warning compilation with an unresolved `@Missing`, naturally Rust-ineligible and
with an explicit missing-dependency diagnostic. F is deliberately fatal editor
text, preserving the last-good compiled document. Neither fatal editor text nor
an undefined reference is misrepresented as a valid geometry result.

Wire fixtures are built from hand coordinates, without either evaluator. The real
persistent Rust controls independently verify K, L and S through canonical source,
production preparation, normal eligibility and one persistent stdio process (three
requests). Both coordinate alternatives are checked against deliberately wrong
geometry using the same assertion. No Rust source, protocol or payload contract
changed. The process has a 15-second request/close deadline, observes close/error
before teardown and is disposed/awaited. `evidence/rust-control.json` records its
binary hash. The control requires the prebuilt `rust-evaluator/target/debug/evaluation_stdio` artifact in the test environment; it fails if unavailable and has no skip or implicit Rust build. Shadow/parity reference execution is observed with a spy; cancelled
callbacks cannot evaluate the deferred reference, log a mismatch or render either
session.

## One independently confirmed first-owner family

**Incomplete request epoch identity** in `src/geometry/useEvaluationEngine.ts`.
Two related parts of that owner caused the observed family: publication accepted
an earlier result using only its serialized input key; request IDs were globally
reused by revision/input content instead of identifying each actual evaluation.
These are counted together, not as separate stale-result families.

* Exact Base A1: mount r=1, complete q1, compile trailing-comment K2 as r=2 with
  byte-identical prepared evaluation input. Base retained producer r=1/q1 but
  exposed `ready`, `isStale=false`. The currentness helper correctly rejected the
  revision mismatch; this does **not** rediscover #295.
* Exact Base B5: replacing the transport at the same compiled revision/input
  retained `ready`, `isStale=false`, q1 and interaction-current=true while a new
  transport request was pending. Its later completion also reused q1.
* A4/A5 restore the original input at the same compiled revision and reuse an old
  request ID. X2 restores before the intermediate request completes: Base promotes
  an old ready result as current. C2 infers a new reference render's ready status
  from an old Rust result. C3 transport retry reuses request identity and lets an
  old scalar failure remain authoritative during a new validation attempt.
* Adjacent Base PASS: A2 and B1/B2 cancellation ordering, B4 scalar fail-closed,
  B6 natural reference routing, and A6's fatal-edit checkpoint. These distinguish
  legitimate last-good reuse and existing callback cleanup from the new defect.
* R1 is the shortest temporal reproducer: mount K, resolve its Rust callback,
  compile K2. Removing any of these three events removes the stale-ready
  discriminator. It requires no ABA, failure, modifier or Canvas manipulation.
* Corrected A1 sequence: `(r1,q1,evaluating,false)` →
  `(r1,q1,ready,false)` → `(r1,q1,evaluating,true)` →
  `(r2,q2,ready,false)`, where the last boolean is `isStale`. Only the accepted
  producer's revision/request accompanies visible old geometry.
* Corrected B5: q1 remains visible and stale during transport replacement; q3
  becomes ready/current; late q2 completion causes zero renders and cannot replace
  q3. Restoring earlier options and remounting likewise receive newer identities.

The repair removes the content-key request-ID cache, memoizes one request epoch
against the existing effect's actual inputs (including transport/mode), and checks
key, compiled revision **and** request revision when adopting async status/error/
reference results. Existing effect cleanup still owns callback cancellation. It
adds no scheduler, cancellation API, evaluation cache or document authority.

Untouched-production proof: `base-owner.json`, `base-final-run.json` and exact Base
logs/events. The original first measurement and failures are retained. Its C1
harness accidentally compared restored K against immediately preceding L rather
than the original K; the harness comparison was corrected to the first input,
without changing the frozen source/events/state oracle. That harness failure is
not counted as a product defect. Final Base measurements use the corrected
assertion and again fail on C1's reused remount request identity.

`removal.log.gz`/`removal.json` record restoration of the exact Base owner followed by
R1/X2/B5 FAIL (exit 1), then restoration of the candidate. The final complete Base
replay also had an empty production diff and expected exit 1. The candidate passes
all of these same assertions. Eight deliberate corrupt-state checks use the same
complete assertion: wrong producer revision, request identity, readiness, stale
flag, geometry, stale failure/error, premature readiness, and scalar fallback.

## Final primary dispositions

| Unit | Disposition | Discriminator |
|---|---|---|
| A1 | BUG→FIXED→REPASS | New compiled revision, identical input |
| A2 | BASE_PASS | Old pending same-key response completes first |
| A3 | BUG→FIXED→REPASS | K/L/K compiled revision ABA |
| A4 | BUG→FIXED→REPASS | Same-revision limit restoration request identity |
| A5 | BUG→FIXED→REPASS | Disabled option restoration request identity |
| A6 | BUG→FIXED→REPASS | Fatal last-good PASS, then new compiled revision FAIL/fixed |
| B1 | BASE_PASS | New distinct-key success before old success |
| B2 | BASE_PASS | New success before old rejection |
| B3 | BUG→FIXED→REPASS | Scalar-free fallback then same-key new revision |
| B4 | BASE_PASS | Scalar failure withholds geometry, then recovery |
| B5 | BUG→FIXED→REPASS | Equal-input transport replacement and late completion |
| B6 | BASE_PASS | Eligible/ineligible/reference/eligible with late callback |
| C1 | BUG→FIXED→REPASS | Rapid revisions, actual unmount/remount, delayed callbacks |
| C2 | BUG→FIXED→REPASS | Non-scalar parity and shadow reference/status ownership |
| C3 | BUG→FIXED→REPASS | Scalar parity/shadow deferral, stale rejection and retry |
| C4 | BUG→FIXED→REPASS | Currentness and Canvas presentation eligibility |

X1: BUG→FIXED→REPASS, effective mode/retry epoch configuration counterfactual, triggered by B5. It perturbs the supported mode configurations in the hook harness; it does not claim that a shipped host offers live environment-variable reconfiguration.
X2: BUG→FIXED→REPASS, restore options while intermediate response is pending,
triggered by A4. R1: reduced Base FAIL→candidate PASS. X3–X8 and R2–R8:
**NOT_TRIGGERED**. No unresolved primary, unsupported source substitute or additional
independent family is claimed.

## Verification and limits

Focused hook plus corpus: 32/32 PASS. Repeated deterministic hook runs all passed;
`focused-repeats.json` retains exit codes. The expanded owner/Canvas/document/editor
run passed 197 tests in 8 files, exit 0. It emitted an existing React `act` advisory
in DrawingCanvas tests; no assertion failed. Targeted TypeScript checking and ESLint
passed, without warnings on the changed files.

The exact full-gate command and process result are retained in `evidence/`.
Final gate: **PASS, exit 0**. In the prescribed order: build 0; lint 0; full tests 0 (696 files / 11,225 tests passed, 2 files / 187 existing tests skipped); parity 0 (207 passed); diff check 0. The new 21 tests all executed. The gate was run once, without retries. Required GitHub protected CI remains
independent of local verification.

Only the hook production owner changed. Canvas, document ownership, editor source
mutation, Rust/process/protocol/math, host APIs, DSL, export and printing were not
modified. No architecture or implemented-language documentation update is needed
for this local repair. The fixture/oracle/report remain reusable regression assets;
no obsolete task plan is retained.

Manual E2E: **Not Required** for this host-neutral contract. No Human GUI execution
or signed native VS Code PASS is claimed. Human-supplied weekly/five-hour quota
readings: **UNAVAILABLE / UNAVAILABLE**.
