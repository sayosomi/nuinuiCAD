# pathDistance Human Manual E2E fixture

Issue: [#1613](https://github.com/sayosomi/nuinuiCAD/issues/1613).
These are executable nui 1 fixtures; automated execution does not establish
Human Manual E2E PASS. Use the current project Human E2E admission and exact
reviewed/tested commit workflow before opening the production VS Code host.

1. Open `measurements.nui`, open Canvas, and Fit Drawing. Confirm Source has no
   compile/evaluation errors. Inspect the four separate examples and their labels.
2. Confirm the open line reports 50 / 50 mm, the quarter-circle reports
   approximately 15.7079632679 mm, the closed rectangle reports 30 mm, and its
   seam reports zero. The Bezier interval is approximately 71.03 mm, longer than
   its 68.75 mm chord (independent Simpson integral 71.03548120464426 mm;
   the existing 32-step subcubic rule differs by less than 0.02 mm).
3. In Source, exchange `point1` and `point2` on the closed and Bezier calls.
   Confirm their values remain unchanged. Use keyboard Undo to restore each edit.
4. Open `errors.nui`. Confirm the three failed scalar bindings identify the
   off-path `point1`, off-path `point2`, and ambiguous crossing respectively.
   No failed distance should appear as an ordinary numeric result. Confirm the
   unrelated healthy line and 100 mm label remain available.
5. Move `Off` onto the line (`y: 0`) in Source. Confirm the off-path diagnostics
   clear and both off-path bindings now evaluate to 50. Restore with Undo and
   confirm diagnostics return. The crossing must remain ambiguous even though
   both arguments reference the same point.
6. At a `pathDistance(` call, invoke completion and signature help with the
   keyboard. Confirm `path: path`, `point1: point`, `point2: point`, and a
   `number` result; reordered named arguments remain valid. Temporarily replace
   a call with positional arguments and confirm a named-call diagnostic.

Record the exact commit, VS Code/extension identity, files, observed labels and
diagnostics, edits/Undo results, and Human judgment in the Issue's E2E checkpoint.
Keep this reusable fixture; it is not a temporary implementation plan.
