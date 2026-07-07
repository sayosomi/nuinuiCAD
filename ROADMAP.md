# ROADMAP

## DSL

The current DSL workflow remains selection export, text edit, and patch apply
back to existing elements by stable `id=...`.

Next phases:

1. Cover existing GUI drafting elements with natural DSL syntax and lossless
   serialization.
2. Add standalone DSL import/export commands that rebuild a document from DSL
   source without relying on an existing element list.

Implemented:

- Dependency-closure export for selected ranges includes selected group content,
  parent groups, and upstream dependencies while preserving document order.

DSL import must preserve the deterministic document-order evaluator. It should
report missing, disabled, invalid, or too-late references rather than repairing
or reordering elements automatically.
