from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, text: str) -> None:
    Path(path).write_text(text)


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    if old not in text:
        raise RuntimeError(f"expected text not found in {path}: {old[:100]!r}")
    write(path, text.replace(old, new, 1))


# Completion/signature surfaces no longer advertise the removed common `color:` argument.
replace_once(
    "src/editor/cmAutocomplete.test.ts",
    '      "dx", "dy", "state", "color", "steps"\n',
    '      "dx", "dy", "state", "steps"\n',
)

path = "src/dsl/dslCallCompletionContext.test.ts"
text = read(path)
for old, new in [
    ('      "line1", "line2", "index", "extensions", "state", "color", "steps"\n',
     '      "line1", "line2", "index", "extensions", "state", "steps"\n'),
    ('      "startPoint", "endPoint", "scale", "angleDeg", "mirrorX", "baseLines", "state", "color", "steps"\n',
     '      "startPoint", "endPoint", "scale", "angleDeg", "mirrorX", "baseLines", "state", "steps"\n'),
    ('      "dy", "state", "color", "steps"\n',
     '      "dy", "state", "steps"\n'),
    ('      "line1: ", "line2: ", "index: ", "extensions: ", "state: ", "color: ", "steps: "\n',
     '      "line1: ", "line2: ", "index: ", "extensions: ", "state: ", "steps: "\n'),
    ('      "angle", "curveSide", "distance", "state", "color", "steps"\n',
     '      "angle", "curveSide", "distance", "state", "steps"\n'),
]:
    if old not in text:
        raise RuntimeError(f"expected completion text not found: {old!r}")
    text = text.replace(old, new, 1)
write(path, text)

replace_once(
    "src/dsl/dslSignatureHelpQuery.test.ts",
    '      "x", "y", "state", "color", "steps"\n',
    '      "x", "y", "state", "steps"\n',
)

# Argument application no longer writes CadElement.colorId.
path = "src/dsl/dslApplyArgs.test.ts"
text = read(path)
text = text.replace(
    '      arg("state", "disabled"), arg("color", "red"),\n',
    '      arg("state", "disabled"),\n',
    1,
)
text = text.replace(
    '      placement: { kind: "ratio", value: 0.25 }, activity: "disabled", colorId: "red",\n',
    '      placement: { kind: "ratio", value: 0.25 }, activity: "disabled",\n',
    1,
)
write(path, text)

# The construction/settings registries explicitly characterize the removed mappings as absent.
replace_once(
    "src/dsl/dslConstructions.test.ts",
    '    expect(argNameForParameter("freePoint", "colorId")).toBe("color");\n',
    '    expect(argNameForParameter("freePoint", "colorId")).toBeNull();\n',
)
path = "src/dsl/dslConstructions.test.ts"
text = read(path)
text, count = re.subn(
    r'    expect\(settingsSpecFor\("color"\)\)\.toMatchObject\(\{\n      args: \[\n        \{ arg: "hex", positional: true \},\n        \{ arg: "name" \},\n        \{ arg: "default" \},\n      \],\n    \}\);\n',
    '    expect(settingsSpecFor("color")).toBeNull();\n',
    text,
    count=1,
)
if count != 1:
    raise RuntimeError("settingsSpecFor(color) expectation not found")
write(path, text)

# Common geometry/mutation color is rejected uniformly as an unknown removed argument.
path = "src/dsl/dslCallParser.test.ts"
text = read(path)
pattern = re.compile(
    r'  it\("rejects, color: on a bare mutation statement but keeps it valid on a drawable element", \(\) => \{.*?\n  \}\);',
    re.S,
)
replacement = '''  it("rejects the removed common color argument on mutations and drawable elements", () => {
    for (const source of [
      "reverse(target: AB, color: red)",
      "edge(end1: AB.end, end2: CD.start, color: red)",
      "point A = coordinate(x: 0, y: 0, color: red)"
    ]) {
      expect(messages(source).join("\\n")).toContain("引数「color」");
    }
  });'''
text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise RuntimeError("legacy dslCallParser color test not found")
write(path, text)

# Drawing Modifier color remains covered above; direct element color is now intentionally invalid.
path = "src/dsl/dslDrawingModifier.test.ts"
text = read(path)
pattern = re.compile(
    r'  it\("keeps direct state and palette color behavior unchanged", \(\) => \{.*?\n  \}\);',
    re.S,
)
replacement = '''  it("keeps direct state while rejecting the removed element color argument", () => {
    const stateOnly = compileDslDocument(
      "nui 4\\npoint P = coordinate(x: 0, y: 0, state: hidden)"
    );
    expect(stateOnly.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(stateOnly.document?.elements[0]).toMatchObject({ activity: "hidden" });

    const withColor = compileDslDocument(
      "nui 4\\npoint P = coordinate(x: 0, y: 0, color: pattern-black)"
    );
    expect(withColor.diagnostics.filter((item) => item.severity === "error")).toEqual([
      expect.objectContaining({ message: expect.stringContaining("引数「color」") })
    ]);
  });'''
text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise RuntimeError("legacy direct palette color test not found")
write(path, text)

# Source projection/value-span tests keep their original purpose using valid state syntax.
replace_once(
    "src/dsl/dslStatementProjection.test.ts",
    '    const source = ["point A = coordinate(", "  x: 0,", "  y: 0,", "  color: red,", "  state: hidden", ")"].join("\\n");\n    const color = source.indexOf("red");\n    const values = dslDocumentValueSpansAt({ normalizedSource: source, sourceRevision: 9 }, color);\n    expect(values).toEqual(expect.objectContaining({ ok: true }));\n    if (values.ok) expect(values.value.map((span) => source.slice(span.from, span.to))).toEqual(expect.arrayContaining(["red", "hidden"]));\n',
    '    const source = ["point A = coordinate(", "  x: 1,", "  y: 2,", "  state: hidden", ")"].join("\\n");\n    const state = source.indexOf("hidden");\n    const values = dslDocumentValueSpansAt({ normalizedSource: source, sourceRevision: 9 }, state);\n    expect(values).toEqual(expect.objectContaining({ ok: true }));\n    if (values.ok) expect(values.value.map((span) => source.slice(span.from, span.to))).toEqual(expect.arrayContaining(["1", "2", "hidden"]));\n',
)

path = "src/dsl/dslValueSpans.test.ts"
text = read(path)
text = text.replace(
    '    const source = "line AB = segment(start: A, end: B, color: red, state: hidden)";\n'
    '    const spans = dslLineValueSpans(source);\n'
    '    expect(spans.map((span) => textOf(source, span))).toEqual(["A", "B", "red", "hidden"]);\n',
    '    const source = "line AB = segment(start: A, end: B, state: hidden)";\n'
    '    const spans = dslLineValueSpans(source);\n'
    '    expect(spans.map((span) => textOf(source, span))).toEqual(["A", "B", "hidden"]);\n',
    1,
)
text = text.replace(
    '    expect(order).toEqual(["B", "red", "hidden", "A", "B"]);\n',
    '    expect(order).toEqual(["B", "hidden", "A", "B"]);\n',
    1,
)
write(path, text)

# The value-step test already covers non-steppable strings and references; remove the obsolete color-kind case.
path = "src/dsl/dslValueStep.test.ts"
text = read(path)
text, count = re.subn(
    r'\n    const coloredLineSource = "line L = segment\(start: A,end: B,color: red\)";\n    const coloredLine = compileElement\(coloredLineSource\);\n    expect\(stepAt\(coloredLineSource, coloredLine, "red", 1\)\)\.toBeNull\(\);',
    "",
    text,
    count=1,
)
if count != 1:
    raise RuntimeError("obsolete dslValueStep color case not found")
write(path, text)

# Preserve the module semantic test by using a still-valid global statement that is forbidden in a module body.
replace_once(
    "src/dsl/moduleSemanticAnalysis.test.ts",
    '      "  color hidden (\\"#ff0000\\")",\n',
    '      \'  role hidden (name: "hidden")\',\n',
)

# Palette mutations are no longer part of canonical document property testing.
path = "src/state/cadDocumentStore.shadow.property.test.ts"
text = read(path)
text = text.replace('    "paletteEdit",\n', "", 1)
text = text.replace('            palette: document.palette,\n', "", 1)
write(path, text)

print("SAY-115 full regression test fixup applied")
