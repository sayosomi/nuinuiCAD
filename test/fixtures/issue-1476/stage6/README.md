# Stage 6 topology and for-group regressions

These fixtures pin compiler-produced runtime facts from the unchanged Issue #1474
D1/D3 documents and the unchanged dependency-chain benchmark sources. Original
sources, source-independent numerical/geometry oracles and benchmark manifests
remain authoritative and unmodified. `provenance.json` records source, complete
production-request and projected-fixture SHA-256 values.

- `D1-r1-projection.json` and `D3-r1-projection.json` contain the exact conditional
  graph and element IDs extracted from canonical production requests. The frozen
  dependency order follows the original edge encounter order. The Rust regression
  additionally checks every edge's prerequisite rank, uniqueness, complete element
  membership and absence of cycles; it does not accept a golden order alone.
- `dependency-chain-250-v1-elements.json` and
  `dependency-chain-1000-v1-elements.json` contain the exact request element arrays.
  The independent expected template counts are 250/1000. Tests check ordered IDs,
  exclusion of unrelated elements, generated identities, parent links and occurrence
  metadata before checking operation bounds.

The graph regression uses ordinary Rust test-worker stack settings. Base D1 passes;
Base D3 exhausts the native stack. A bounded debugger capture placed the stack pointer
in a non-accessible guard page beneath repeated `DependencyTraversal::visit` frames.
The shared recursive graph algorithm is the cause of that worker failure. A crash in
the production stdio host was not reproduced, and no larger-stack workaround is
part of the repair.

The for-group counters are test-only structural work observations. The hierarchy
counter records inspected source/index entries and reached descendants/ancestors.
The membership counter records actual candidate equality checks on Base and actual
hash membership lookups after repair. They demonstrate removal of linear scans;
they do not measure CPU cycles or establish whole-document speedup.

`evidence.json` retains all 26 primary cell dispositions, the independent causal
experiments and frozen test-body hashes. All three families reproduced Base FAIL,
fixed PASS, production-repair-only removal FAIL and restored PASS. Optional source
variants and reducers were unnecessary. H-B1 remains INCONCLUSIVE: all 16 sealed
sources had empty scheduled-binding candidates, and that path was not optimized.

These changes stay within existing Rust evaluation owners. The graph traversal uses
explicit enter/exit frames with unchanged encounter order and cycle diagnostics.
The for-group hierarchy index is local to each query and source snapshot; it is not
a second resolver, document model or persistent evaluation cache. Source order and
binding/module/occurrence identities remain unchanged.
