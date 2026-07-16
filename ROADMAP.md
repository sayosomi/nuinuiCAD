# ROADMAP

## Current product baseline

nuinuiCAD is a Tauri desktop 2D parametric CAD editor for sewing patterns.
Documents are persisted as one `.nui` DSL text file; `sourceText` is the
canonical state, while compiled geometry is derived for rendering and
evaluation. The former `.nuinui.json` format is accepted only by the explicit
legacy-import command and is not a save format.

The always-visible Source Editor is the primary text interface. Canvas actions
and commands preserve comments, blank lines, and ordering by patching only the
affected statements. The Inspector is read-only; parameter values are edited
in Source Editor value spans or supplied through keyboard-first command-line
creation.

Completed capabilities include DSL completion, command-line creation with
canvas picking and ghost previews, safe propagated rename, and undo/redo over
canonical text. `renameSelectedElement` opens the single-selection rename
dialog with F2; a successful rename updates only the necessary statements and
creates one Undo step.

## Backlog

- Expand performance coverage for variable, element-parameter, print-layout,
  and CommandLineBar candidate generation at large document sizes.
- Decide whether the legacy `.nuinui.json` importer can be removed after users
  no longer need local-draft import.
- Clarify the CommandLineBar cancellation copy: during a mid-session completed
  step edit, keyboard Esc cancels only that edit and restores the active
  prompt; the visible `キャンセル（Esc）` button still cancels the entire session.
- Avoid duplicate command-line ghost/validation work when an isolated edit
  reports `missing-input`; this is a performance cleanup, not a resolved B-6
  behavior issue.
- Reconcile the asymmetric Mod-key treatment between migrated legacy shortcut
  settings and newly validated Source Editor bindings.
- Decide whether rename should remain fail-closed for every warning diagnostic
  in an otherwise compilable document, or expose a narrower safety policy.
- Continue sewing-pattern features, including SVG/PDF export refinement and
  tiled A4 printing, while preserving millimeter units and Y-up geometry.
