# Issue #1505 generated topology conformance

Base: `a827e9c359aaaa07ec03bfe08ac48b8bcddfbb08`.

`manifest.json` contains the sealed UTF-8 source bytes, their SHA-256 hashes,
independent arithmetic/geometry expectations and complete source-template,
Module-instance and loop-ordinal paths. The original 16 primary sequences and
all 65 checkpoints remain unchanged from the first seal. Four effective
reducers add 16 checkpoints. All 81 checkpoints compile; one R4 observation is
intentionally runtime-invalid and must report the exact missing index against
Read without publishing fallback geometry. The normal persistent Rust process
also evaluates this explicitly labelled invalid observation because production
eligibility accepts it. No compiler-invalid or Rust-ineligible program is sent.

Exploration usage: 16 primary + 0 X + 5 R slots = 21/28. Four R sequences are
active. The first R4 reduction used an unresolved tuple carry initializer and
masked the targeted producer; its source/oracle and non-causal disposition are
retained in `superseded-reducer4.json`. Its replacement uses the existing
Control point as the legal initializer. This failed reduction consumes an R
slot; it is not product evidence. X1–X6 and R6 are NOT_TRIGGERED.

## Independent oracle

The oracle was calculated before invoking either evaluator. No production
geometry algorithm calculates expected values. Straight lengths use the
Euclidean formula; all other expectations are integer arithmetic and ordered
list/cardinality calculations. Coordinates and lengths use 1e-8 mm tolerance.

- R1: `(x0+11*i,-5+3*i)`, cardinalities 1,3,1,1.
- R2: binders `[1]`, `[1,3,5]`, `[1,3]`, `[1]`; each dependent edge is 3-4-5.
- R3: two templates; source line length 9/15 and offset result
  `(7+11*i+2*span,7*i-3)`; cardinalities 2,4,2,2.
- R4: step 1/2, valid and invalid explicit indexes, then exact recovery.
- C1: empty / `[6,11]` / empty, no phantom row; length observer.
- C2: selected `[6+delta]` or `[11,17,23]`; nested lazy unselected division by
  zero never activates; exact branch length and members.
- C3: `3*x-2` over `[4]`, `[4,9,4]`, `[9,4]`, `[4]`; order/duplicates retained.
- C4: point-array map adds `(7,-3)`; all members materialize as ordered
  drawable occurrences, with a separate statically indexed line consumer.
- M1/M2: asymmetric instance biases 17/-41, independently edited counts and
  conditional collections; supported exported count observers.
- M3: independently variable nested Module loops, separate instance paths.
- M4: hidden geometry stays computed; disabled First yields no rows or sibling
  geometry; Second and root Control remain unchanged.
- N1: all ordered pairs, `(100*i+10*j,-i-j)`; 1x2,2x3,1x3,1x2.
- N2: separate Up/Down branch scopes; metadata may describe inactive templates,
  but only selected branch geometry exists; inner-bound changes remove old rows.
- N3: selected generated edge length `5+2*k`, end X `19*k+5`; count and selected
  index change together, preserving compiler-owned target identity.
- N4: selected current edge translated to `(101,-31)` and scaled by 2; source
  template, selected ordinal, length and transformed endpoints are asserted.

Every evaluation also asserts the complete computed geometry key set, ordered
paths within each template/instance, the absence of static template geometry,
unaffected Control `(-113,71)`, current diagnostics and source identity,
fresh/incremental dependency signatures, and independent TS/Rust expectations.
Fresh opaque IDs are deliberately normalized through canonical source ownership.

## Four causal families

- **F1 — numeric_binding_runtime.rs:** the Rust numeric-input validator required
  a drawable ID even for a correctly typed collection-length target. Respect
  the already-validated collection identity. The focused Rust test retains
  rejection of a genuinely missing drawable target.
- **F2 — dslDocument.ts:** numeric geometry-input lowering converted unknown
  conditional collection length to 0. Preserve the unknown length so the
  existing collection runtime chooses the current selected branch.
- **F3 — dslDocument.ts:** semantic analysis correctly resolved geometry
  statement-for binders, but drawable input lowering omitted them. Lower their
  source collection and canonical ordinal through existing collectionIndex
  targets. No new runtime target/API or source-name resolver is introduced.
- **F4 — moduleScalarRuntime.ts:** collection-node publication retained provisional
  identity map programs, while direct indexed consumers received finalized
  programs. Apply the existing lazy-program replacement to published collection
  nodes too. Reducer4 isolates this with a geometry carry, independent of F3.

`causal-evidence.json` records the complete Base matrix failure, nearby passing
controls, each individual repair removal, each full restored matrix PASS,
production/test/manifest hashes, actual built-and-spawned Rust executable SHA,
request counts and process closure. Full raw records and logs remain outside the
checkout at `/Users/yosomi/.codex/evidence/issue-1505/`.

One complete active matrix run is 21 tests (one seal + 20 sequences), 81 source
checkpoints, 162 TS evaluations and 162 Rust requests through one persistent
process. Removing F1 fails collection cases; removing F2 fails C2/Reducer2;
removing F3 fails C4/Reducer3; removing F4 fails C4/Reducer4. Each restoration
passes all 21 tests. Original primary oracles and historical fixtures are intact.

The existing compiler, typed graph, reference evaluator, production lowering and
Rust process client are reused. No architectural boundary or normative language
contract changes. DSL reference wording now explicitly covers the corrected
existing behaviors. These are CLI-only observations; no Canvas, GUI, performance,
Human E2E, export or physical sewability claim is made.
