# 13R-6: Binding lookup closure

## Purpose

Close the three remaining Task 11-13 lookup defects without changing parser,
evaluation, property, set, rename, or DSL-diagnostic behavior:

1. forward candidates are later typed declarations in the reference owner's
   exact lexical scope only;
2. element-local range lookup is output-sensitive rather than an owner/name
   bucket filter per reference;
3. `visibleBindingsAt` is a true one-site bulk query.

## Lookup contract

- The reverse sweep reads only the current reverse frame, whose scope is the
  initializer owner's `effectiveScopeId`. Later ancestor and sibling
  declarations are never forward candidates. Candidate IDs remain catalog-rank
  ordered by reversing the reverse-sweep bucket once per emitted result.
- Element-local `startOrder`, `endOrder`, and site `order` are non-negative safe
  integers and invalid values fail fast. Catalog construction stores each
  owner/name bucket in catalog-rank, start-order, and end-order indexes. The
  ordered indexes use a fixed five-pass radix; they do not use comparison sort
  or allocate from the largest order value.
- Batch local queries are grouped by owner/name and radix-normalized by order.
  Two endpoint sweeps compute the contiguous query range covered by each
  binding, then bindings are appended to covered queries in catalog-rank order.
  Work is `O(bindings + requests + emitted candidates)`; invisible locals are
  not inspected per request.
- `visibleBindingsAt` traverses source/scope state to its site once, collects
  local then inner-to-outer lexical levels, and scans catalog once for final
  rank order. A found local or lexical level owns the name even when duplicate;
  duplicates are omitted from the visible result without falling back outward.
  Future typed declarations are inactive, so pre-declaration outer fallback is
  preserved.

## Observation and complexity

Test-only lookup traces distinguish registrations, requests, site traversals,
actual candidate inspections, and emitted candidates. Candidate inspection is
recorded where a binding enters a lane merge, local range-query result, or
forward result; invisible and shadowed buckets are not reported as visits.

Scope preparation, adapter, catalog and local index, canonical batch
resolution, analysis, and eligibility remain
`O(N + S + B + R + E)`. Lane count and radix pass count are fixed. There is no
comparison sort, maximum-order-sized storage, binding-by-reference filtering,
or name-by-name source sweep.

## Handoff

`resolveInitializerReferences` remains the only production initializer
resolver. `visibleBindingsAt` remains the production bulk visibility API and
now performs one site traversal. Exact single-name resolution and trace helpers
remain test-only and are rejected from non-test source by the public-surface
guard.

Focused tests lock exact-scope forward classification, catalog-order forward
edges, local range output sensitivity, bulk one-traversal behavior, legacy and
typed shadow/duplicate parity, local precedence, cycle suppression, invalid
dependency propagation, eligibility, and stable/canonical IDs and order.
