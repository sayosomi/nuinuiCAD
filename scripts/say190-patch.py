from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_exact(path: str, old: str, new: str, count: int = 1) -> None:
    file_path = ROOT / path
    text = file_path.read_text()
    actual = text.count(old)
    if actual != count:
        raise RuntimeError(f"{path}: expected {count} occurrence(s), found {actual}: {old[:120]!r}")
    file_path.write_text(text.replace(old, new, count))


# Bake: a reversed arc is now exactly representable; retain the exactness-failure
# classification test by feeding it an intentionally inconsistent computed sweep.
replace_exact(
    "src/commands/bakeFailureResults.test.ts",
    '''    const arc = compiled.doc.document.elements.find((element) => element.name === "A")!;
    const plan = planFor(compiled, evaluate(compiled), [arc.id]);
''',
    '''    const arc = compiled.doc.document.elements.find((element) => element.name === "A")!;
    const evaluation = evaluate(compiled);
    const geometry = evaluation.computedGeometry.get(arc.id);
    if (geometry?.kind !== "arcLine") throw new Error("expected arc geometry");
    const mismatchedEvaluation: EvaluationResult = {
      ...evaluation,
      computedGeometry: new Map(evaluation.computedGeometry).set(arc.id, {
        ...geometry,
        sweepAngleDeg: geometry.sweepAngleDeg / 2,
        length: geometry.length / 2
      })
    };
    const plan = planFor(compiled, mismatchedEvaluation, [arc.id]);
'''
)

replace_exact(
    "src/commands/bakeGeometry.test.ts",
    '  it("rejects reversed arcs without inserting an approximation", () => {',
    '  it("bakes a reversed arc exactly as an explicit clockwise arc", () => {'
)
replace_exact(
    "src/commands/bakeGeometry.test.ts",
    '''    expect(plan?.generatedElementIds).toEqual([]);
    expect(applyLineSplices(current.sourceText, plan!.splices)).toContain("// Bake skipped: arc A — not losslessly representable");
''',
    '''    expect(plan?.generatedElementIds).toHaveLength(1);
    expect(plan?.skippedTargets).toEqual([]);
    expect(applyLineSplices(current.sourceText, plan!.splices)).toContain(
      "arc A_bake = arc(center: (0, 0), radius: 10, start: 90, end: 0, direction: clockwise)"
    );
'''
)
replace_exact(
    "src/commands/bakeGeometry.test.ts",
    '      "arc A_bake = arc(center: (0, 0), radius: 12, start: 30, end: 150)"',
    '      "arc A_bake = arc(center: (0, 0), radius: 12, start: 30, end: 150, direction: counterclockwise)"'
)

replace_exact(
    "src/commands/creationRecipes.test.ts",
    '      arcLine: "arc 作成arcLine = arc(center: @A, radius: 12, start: 12, end: 12)",',
    '      arcLine: "arc 作成arcLine = arc(center: @A, radius: 12, start: 12, end: 12, direction: counterclockwise)",'
)

replace_exact(
    "src/dsl/dslSerializer.test.ts",
    '''        end: -90,
        id: a1,''',
    '''        end: -90,
        direction: counterclockwise,
        id: a1,'''
)

replace_exact(
    "src/geometry/geometryHoverPresentation.test.ts",
    '''        { label: "スイープ", value: "-90°" },
        { label: "長さ", value: "78.54 mm" },''',
    '''        { label: "スイープ", value: "-90°" },
        { label: "進行方向", value: "時計回り" },
        { label: "長さ", value: "78.54 mm" },'''
)

replace_exact(
    "src/editor/sourceEditorController.test.ts",
    '''      { id: "arc", name: "Arc", type: "arcLine", activity: "visible", centerPoint: { mode: "coordinate", x: 0, y: 0 }, radius: 0, startAngleDeg: 0, endAngleDeg: 120 }
''',
    '''      { id: "arc", name: "Arc", type: "arcLine", activity: "visible", centerPoint: { mode: "coordinate", x: 0, y: 0 }, radius: 0, startAngleDeg: 0, endAngleDeg: 120, direction: "counterclockwise" }
'''
)
replace_exact(
    "src/editor/sourceEditorController.test.ts",
    '''    // arc's own "center: (0, 0)" tuple is the first value span in its
    // enclosing statement.
    const firstZero = text.indexOf("(0, 0)") + 1;
    internals.view.dispatch({ selection: EditorSelection.cursor(firstZero) });

    // Wrapping backward from the first coordinate should land on the whole dirty,
    // now-4-character value — a stale 3-character "120" span would clip it short.
''',
    '''    // `direction` is the canonical value immediately after `end`, so moving
    // backward from it must still resolve the whole dirty `end` value.
    const directionValue = text.indexOf("counterclockwise");
    expect(directionValue).toBeGreaterThanOrEqual(0);
    internals.view.dispatch({ selection: EditorSelection.cursor(directionValue + 1) });

    // The dirty value is four characters long; a stale three-character span
    // from the last-good parse would clip it short.
'''
)

# User-facing and normative docs.
dsl_path = ROOT / "docs/dsl.md"
dsl = dsl_path.read_text()
if "### arc の進行方向" not in dsl:
    anchor = "### tangentOffset の曲率側"
    if anchor not in dsl:
        raise RuntimeError("docs/dsl.md: tangentOffset anchor missing")
    section = '''### arc の進行方向

concrete `arc(...)` は `direction: counterclockwise | clockwise` で始角度から終角度への進行方向を指定できます。省略時は `counterclockwise` と同じ意味ですが、canonical serializer は常に `direction` を明示します。

```nui
arc A = arc(
  center: @C,
  radius: 20,
  start: 0,
  end: 90,
  direction: counterclockwise,
)

arc B = arc(
  center: @C,
  radius: 20,
  start: 90,
  end: 0,
  direction: clockwise,
)
```

runtime の方向は signed `sweepAngleDeg` が正です。反時計回りは正、時計回りは負です。`start == end` は 0 sweep で、`0 -> 360` のように明示した full turn は `counterclockwise` なら `+360`、`clockwise` なら `-360` になります。`through(...)` と `corner(...)` には `direction` 引数を追加しません。

'''
    dsl_path.write_text(dsl.replace(anchor, section + anchor, 1))

spec_path = ROOT / "docs/nui4/spec.md"
spec = spec_path.read_text()
if "### Directed concrete arcs" not in spec:
    anchor = "### Tangent offsets by Bezier curvature side"
    if anchor not in spec:
        raise RuntimeError("docs/nui4/spec.md: tangentOffset anchor missing")
    section = '''### Directed concrete arcs

The concrete `arc(...)` construction accepts the optional named argument
`direction: counterclockwise | clockwise`. Omitting `direction` is semantically
identical to `counterclockwise`; canonical serialization always writes the
argument explicitly. Direction is represented at runtime only by the sign of
`ComputedArcLine.sweepAngleDeg`: counterclockwise uses
`+positiveSweep(start, end)`, while clockwise uses
`-positiveSweep(end, start)`. Equal start and end angles produce zero sweep;
an explicitly authored full turn such as `0 -> 360` produces `+360` or `-360`
according to `direction`.

`through(...)` and `corner(...)` do not gain a `direction` argument. Bake may
materialize a non-zero evaluated arc exactly when the directed sweep recomputed
from its start angle, end angle, and sign equals the evaluated signed sweep; a
positive sweep serializes as `counterclockwise` and a negative sweep as
`clockwise`.

'''
    spec_path.write_text(spec.replace(anchor, section + anchor, 1))
