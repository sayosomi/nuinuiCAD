# 13R-3: Binding pipeline linearization

## Contract

The production-equivalent path is lexical scope/index preparation, DSL seed
adapter, catalog construction, initializer resolution, binding analysis, and
program eligibility. `B` is every catalog binding, `R` initializer reference
occurrences, `S` lexical scopes including root, and `E` emitted graph edges.
Forward duplicate candidates may make `E` larger than `R`.

Scope preparation is `O(N + S)` for parsed statements `N`; catalog, adapter,
and analysis are linear in their inputs, and resolution is a forward/reverse
source sweep. The full path is `O(N + S + B + R + E)`. This preserves the
Task 13 `O(B + R)` core contract after scope preparation; no comparison sort
or binding/reference × scope traversal is permitted.

## APIs and invariants

- `LexicalScopeIndex.scopeMetadataById` gives parent, dense rank, effective
  group, and DFS ancestor interval by scope ID in O(1). Raw sparse statement
  indexes are Map keys; dense storage is bounded by statement count.
- Legacy visibility is `global`, `subtree`, or `outsideGroups`, never an
  expanded scope-id array. Task 13R-5 registers them in global,
  root/outside-only, and scope-entry lanes respectively, so a group lookup
  cannot filter a root outside-groups bucket. Its result remains
  parity-compatible with `variableIsInScope`.
- `resolveInitializerReferences` canonicalizes arbitrary request arrival order
  by binding rank and contiguous `occurrenceIndex`; unknown binding IDs,
  duplicates, and gaps fail fast. It returns canonical order without caller
  sorting.
- A typed declaration is added to the active namespace only after resolving
  its initializer. Thus prior same-scope and outer candidates resolve normally;
  only the declaration itself is excluded. If no visible candidate exists, a
  same-name initializer is `self`, never `forward`.
- Map/Set insertion order only reflects prior canonical source order. Forward
  candidate/edge work is output-sensitive in `E`.

## Tests and measurement

Focused tests cover shuffle normalization, self pre-declaration behavior,
legacy scope parity, local namespace precedence, duplicate/cycle/eligibility
behavior, and 13R-1/13R-2 regressions. The Task 00 250/1000 benchmark measures
the complete pipeline and records worker CPU median/p95/scaling without a new
absolute wall-clock gate.
