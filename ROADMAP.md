# ROADMAP

## DSL

The current DSL workflow remains selection export, text edit, and patch apply
back to existing elements by stable `id=...`.

Next phases:

1. Cover existing GUI drafting elements with natural DSL syntax and lossless
   serialization.
2. Add standalone DSL import/export commands that rebuild a document from DSL
   source without relying on an existing element list.
3. Add dependency-closure export for selected ranges so a selected draft slice
   can be exported with the elements it needs to evaluate independently.

DSL import must preserve the deterministic document-order evaluator. It should
report missing, disabled, invalid, or too-late references rather than repairing
or reordering elements automatically.
