# Issue #1503 revision conformance fixtures

Base: `75f95cf697453ec8b1421160e9ed9f9d436c3f14`.

`manifest.json` seals exact UTF-8 source hashes, ordered transitions, current
source/compiled revisions, diagnostic spans, identity obligations, compiler
owner edges and independent numeric observations. Read one checkpoint per line.
The 16 primary sequences have 4–6 checkpoints each. Four motivated extensions
and two reducers bring the total to 22 accepted units, 101 checkpoints (84 legal,
17 deliberately invalid). X5–X6 and R3–R6 are NOT_TRIGGERED. Four `.source.json` string carriers preserve exact CRLF/trailing-space source
bytes while keeping repository whitespace checks unchanged; hashes cover the
decoded source bytes. Other snapshots are plain `.nui` files. The four original
G2 snapshots and superseded G2 oracle seals remain evidence, not extra units.

## Independent oracles

- A1–A4/E1–E4: `(2,-3)` to `(2+w,-3+h)`; length `sqrt(w²+h²)`.
  E3 tests 50 → 100 → 13 → 50. A2 checks exact authored CRLF/LF bytes.
- M1/M2: independent instance spans `width+bonus`, at origins 7 and -19.
  M3: nested exports `23+delta`, `57+delta`; consumer line length 34.
  M4: nearer forward local scalar owns Tip (13 → 31 → 13), parameters
  own exports (19/47), root scalar 101 is never implicitly captured.
- G1: directed quarter arc length `r*pi/2`; station after the ten-mm lead
  at `10+r*pi/4` is `(r/sqrt(2), r-r/sqrt(2))`.
- G2: controls `(0,0),(0,h),(100,h),(100,0)`; at `t=.5`, cut is
  `(50,.75h)`. Exact de Casteljau halves seal all controls and six published
  split endpoint measurements. Lengths use independent Simpson integration
  (32,768 intervals); tolerance is the independent control-polygon minus
  chord bound after five binary subdivisions, plus 1e-6 mm. Other lengths
  and coordinates use 1e-6 mm. Internal end-handle angle follows the existing
  #1501 contract (control2 → end); end tangent points toward path interior.
- G3: affine copy end `(10,-5+w*factor)`, length `w*factor`.
  G4: shifted stage length `2*w`, end Y `5+2*w`.
- X1 exercises the existing currentSourceRevision adapter projection and a
  fatal no-op; X2 adds a distinct later final translation `(3,4)` so selected
  stage and final cannot accidentally coincide. X3 adds a declaration during
  a recoverable error. X4 covers the same sensitive branch with new Module,
  typed, nested-scope and instance identities. R1/R2 minimize the two defects.

## Two independent first-owner defects

Both corrections are local to canonicalDocument.ts; the existing reconciler
remains the sole identity algorithm. No new parser, resolver, scheduler,
evaluator, source model, public API or architecture boundary was introduced.

1. Fatal revisions reused the last-good document's compiler revision. E1/R1
   independently require 1 → 2 → 3 → 4; Base instead gives 1 → 2 → 2 → 2.
   Read currentCompiled or its existing currentSourceRevision projection.
2. The error-recovery base discarded identities first introduced during an
   errorful compilation. X3/R2/X4 show an unchanged new declaration receiving
   another ID after a comment or repair. Retain historical recovery priority,
   and use live reconciler inheritance only for additions with unclaimed IDs.

`causal-evidence.json` records unchanged Base failure, nearby passing controls,
individual repair-removal failure and restored success, exact source/test
hashes, test counts and production Rust requests. Each matrix execution uses
one real persistent Rust process, 168 production-eligible requests and 168 TS
reference evaluations over incremental and independently fresh compilations.

Fatal geometry is never evaluated as current. E2 binding errors are non-gating;
its current diagnostic has the exact @missing range and revision. E4 missing
geometry is a current warning plus production ineligibility: the reference
path verifies absent B/Edge/Read and preserved A/Control. Deleted B has no
promised identity upon restoration. Current partial and last-good state remain
separate. Independent fresh opaque IDs are never compared directly.

## Preserved initial harness assumptions

The initial G2 endAngle=90 source put the second control below the chord, so
its proposed positive-Y cut was not on-curve. The legal equivalent uses 270.
The initially assumed internal end-handle direction and .002-mm sampled-length
tolerance were also wrong; original seals remain, and independent control
geometry and subdivision bounds supersede them. E2 revision ownership is in
physicalSpan, not necessarily the optional top-level sourceRevision. E4's
undefined geometry diagnostic is warning severity and its Rust input is
intentionally ineligible. None of these harness corrections counts as a defect
or relaxes a product check. Initial validation and raw observations are retained
under `/Users/yosomi/.codex/evidence/issue-1503-20261030/`.

Production impact: canonical lifecycle/reconciliation only. Parsing, language
meaning, source bytes/spans, scalar/Module semantics and TS/Rust evaluation
contracts remain unchanged. No DSL reference or architecture change is needed.
All accepted observations are host-neutral; no GUI or Human E2E result is claimed.
The F1 correction also makes two historical assertions stale: #1468 B4's
minus-one revision exception and the runtime semantic snapshot unit's repaired
revision 2. They now assert independently established current revisions 7 and
3 respectively; historical frozen fixtures and geometry expectations are untouched.
Full gate results and tested/pushed identity are recorded in verification.json
and the Issue checkpoint after verification.
