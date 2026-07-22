# 13R-7: Legacy declaration order / CAD container parity

## Purpose

Close the two legacy lookup defects found by the Task 11-13 integration review:

1. a legacy binding is inactive until the source sweep has passed its
   declaration statement;
2. legacy `scope: group` ownership comes from reconciled CAD container identity
   and parent hierarchy, not the nearest plain lexical group.

Parser, evaluator, property, set, rename, and DSL-diagnostic work remain out of
scope.

## Source-order activation

The catalog registers every binding in catalog rank order, but the forward
sweep activates a legacy binding only after resolving references on its own
statement. Therefore a later legacy declaration is neither resolved nor a
forward candidate. It cannot suppress initializer `self`, and a visible outer
binding remains the pre-declaration fallback.

Lookup frames do not snapshot binding arrays. Global, outside-groups, and each
CAD-container owner have one mutable name lane. A frame refers to that lane;
activation appends the binding once and exposes its name to a currently active
matching frame. Owner lanes survive scope exit, so a later conditional branch
or a subsequently entered explicit-parent container sees prior declarations in
source order without copying bindings across frames or scopes.

## Reconciled container ownership

`buildDslBindingAdapterSeeds` requires the compiler/reconciliation output:
`elementIdByStatementIndex` and compiled `elements`. The resulting container
index records statement owner, lexical-scope container ID, container kind,
parent container, and effective binding namespace.

- A plain group body is owned by that `group`.
- Both `then` and `else` are owned by the same `conditionalGroup`; the owner
  lane is shared, while branch-local typed declarations keep separate lexical
  namespaces.
- A loop body is owned by its `forGroup`.
- An explicit `parent:` on a legacy element uses the reconciled parent ID even
  when the declaration is lexically outside or precedes entry into that
  container.
- A group-scoped legacy binding with no parent remains outside-groups only.

These rules match `variableIsInScope` after declaration activation.

## Complexity and handoff

Visibility descriptors and runtime lanes remain compact. Registration and
activation store each binding once; frames retain map references, not binding
copies. Requests select structurally eligible lanes and never restore a
reference-by-binding visibility filter. The production-equivalent pipeline
therefore remains `O(N + S + B + R + E)` with no comparison sort or
binding/reference-by-scope product.

Task 14 and later consumers use the existing batch initializer resolver and
bulk `visibleBindingsAt` contract. They do not reinterpret legacy declaration
order, CAD ownership, forward candidates, or visibility.

Focused tests cover before/after activation for global, outside-groups, plain
group, conditional, forGroup, and explicit-parent owners; conditional
then-to-else persistence; self and outer fallback; no legacy forward result;
`variableIsInScope` parity; and observer proof that future legacy candidates
are not inspected per reference.
