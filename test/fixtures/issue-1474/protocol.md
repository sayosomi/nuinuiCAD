# Frozen #1474 discovery protocol

Base: `60f54f3ccec505821bc615e516bab8192bd20533`. Generate with Python standard
library only, before product observations. The source and oracle SHA-256 values
are sealed in manifest.json; oracle JSON contains every scalar, point coordinate,
line endpoint and distinct named prerequisite. All numbers are bounded integers.
Normative authority: docs/nui1/spec.md highest-level principles, value references,
numeric arithmetic and geometry properties; docs/dsl.md coordinate and segment.

A: balanced binary reduction of 64/256/1024 leaves valued i%7+1. 2N-1 scalar
nodes plus sink point and two disjoint controls. A4 changes Leaf0 by +11; only
its ancestor sums and sink change, all other declarations stay equal. The
unaffected Leaf1 and every sibling are checked individually.
B: one scalar root, one point and 64/256/1000 segments. Root +11 moves every
segment start by (+11,-11); endpoints and disjoint controls stay equal.
C: 21/85/333 serial diamonds; a=p+1,b=p+2,c=a+b-p=p+3. Every node is checked,
not only the final sink. C4 moves only the two unrelated controls to the front,
then restores. No expected semantic output or named edge changes.
D: 21/85/333 serial geometry diamonds. Two segments share the previous point;
their end coordinates are (i+1,-i-1) and (i+2,-i-2). The join sums the left end
and right start coordinates. Thus Q_k=(3+k(k+1)/2,-3-k(k+1)/2), k=1..size.
Producer (+11,-11) propagates to all starts/joins, leaving all segment ends and
controls unchanged. Drawable count is 3*size+2 including ControlPoint.

Sources intentionally put consumers before prerequisites. Canonical compilation
must accept them and runtime must use resolved dependency order. Source revisions
begin at source revision 0 from regenerateCanonicalFromModel(emptyDocument(),1)
(the second argument is language major version), each distinct source
transition adds one. Restoration has the original hash and a new revision.
Stable identity is checked across edits by declaration name, never raw array order.
Semantic V/E are independently generated; canonical endpoint V/E (including
version/base/final-stage nodes and edges) are sealed by legality preflight before
the first discovery evaluation or measurement. Duplicate kinds are reported
separately from distinct endpoint pairs. Max fan-in/out are reported in both views.

Independent negative sensitivity: the same complete-output assertion must reject
an actual scalar or point coordinate shifted by 1; each revision must also reject
stale pre-edit expectations when its analytic values change. The authored output
is compared exactly in integer coordinates; no TS/Rust result generates an oracle.

One-time Rust build deadline 120s and process cold request are separate setup.
Five warmups, then 21 paired measured trials with alternating order. Pairs:
A1:A2, A2:A3, B1:B2, B2:B3, C1:C2, C2:C3, D1:D2, D2:D3,
A3:B3, B3:C3, C3:D3, and each family largest initial:changed transition.
Revisions for transition pairs use original -> changed -> restored canonical
states. Existing chain-250/1000 and interactive-large-v2 sources are neighboring
controls, not exploration credit; source hashes and actual V/E are reported.

Stages: canonical compile (including reconciliation/graph), buildEvaluationOptions
and prepareRustEvaluation (lowering), JSON encoding probe, persistent Rust request
(includes production encoding, transport, Rust evaluation, JSON decode), result
decode. Encoding probe is separate and not subtracted from the request time.
Record wall and worker CPU per stage, child cumulative CPU/RSS observations at
batch boundaries (ps, outside timed sections), source/payload bytes, V/E, output
counts, max degrees. p50/p95/max use sorted 21 samples, nearest-rank p95.
Child CPU cannot be reliably apportioned to individual sub-ms requests on macOS;
report batch deltas and sampling resolution honestly. No fixed CI timing gate.

Ratio >8 from medium to large or sharp topology-only change triggers bounded
CPU profiling/operation-count analysis, not a defect classification. A claimed
performance defect requires three independently repeated paired blocks on exact
unchanged Base plus causal avoidable-complexity evidence. Expected full-document
work or legitimate edge growth is not a bug. Unproved causes stay INCONCLUSIVE.

Cases have 120s deadlines; Rust requests/close 15s; one child, one request at a
time; 2GiB worker heap; external watchdog monitors owned process tree, 6GiB total
RSS and 120s no-output progress deadline (build/final gate separately bounded).
Stop exploration on actual hang/exhaustion/unsafe lifecycle/contract ambiguity.
Listeners precede teardown; cleanup kills owned children only. X1-X8 and R1-R8
stay NOT_TRIGGERED unless evidence independently justifies and seals a new unit.
