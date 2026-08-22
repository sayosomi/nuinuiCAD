from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, text: str) -> None:
    Path(path).write_text(text)


# Repair type names after the first migration pass inserted the new name and then
# performed a broad legacy-name replacement.
for path in [
    "src/components/canvasRevisionPresentation.test.ts",
    "src/palette/elementColors.test.ts",
]:
    write(path, read(path).replace("LegacyLegacyDocumentPalette", "LegacyDocumentPalette"))

# The canonical text-patch property generator no longer produces palette mutations.
path = "src/document/textPatch.property.test.ts"
write(path, read(path).replace('    "paletteEdit",\n', "", 1))

# Canonical nui4 statement fixtures no longer include the removed common color argument.
path = "src/dsl/__fixtures__/nui4CanonicalStatements.ts"
write(path, read(path).replace(", color: red", ""))

# Keep the golden fixture's physical line positions stable while replacing the
# removed source palette section with comments. StatementMap line-range tests are
# about physical source mapping, not about palette syntax.
path = "src/dsl/__fixtures__/sample.nui"
text = read(path)
marker = "// P7 golden: comments and canonical multiline calls are intentional.\n"
if "// SAY-115: legacy Document Palette source removed." not in text:
    text = text.replace(
        marker,
        marker
        + "// SAY-115: legacy Document Palette source removed.\n"
        + "// Reserved comment line keeps source-map fixture positions stable.\n\n",
        1,
    )
write(path, text)

# StatementMap no longer indexes a palette section; all other golden source line
# positions remain stable because sample.nui keeps the removed lines as comments.
path = "src/dsl/dslDocument.test.ts"
text = read(path)
text = text.replace('    expect(map.byKey.get("color:pattern-black")).toMatchObject({ line: 4 });\n', "")
text = text.replace('    expect(map.byKey.get("color:cut-red")).toMatchObject({ line: 5 });\n', "")
text = text.replace(
    "    expect(map.sectionEnds).toEqual({ version: 1, palette: 5, visibility: 10, elements: 57 });\n",
    "    expect(map.sectionEnds).toEqual({ version: 1, visibility: 10, elements: 57 });\n",
    1,
)
write(path, text)

# Unknown-argument diagnostics no longer advertise the removed common color key.
path = "src/dsl/dslCompiler.test.ts"
write(path, read(path).replace("、state、color、steps、", "、state、steps、"))

# The settings sub-parser no longer owns a top-level color statement.
path = "src/dsl/dslSettingsParser.test.ts"
text = read(path)
text, _ = re.subn(
    r'\n    const color = parse\(\'color pattern-black .*?\n    expect\(color\.args\.map\(\(arg\) => \[arg\.key, arg\.value\]\)\)\.toEqual\(.*?\);',
    "",
    text,
    count=1,
    flags=re.S,
)
text = text.replace('    expect(messages("color c (name: \\"missing hex\\")").join("\\n")).toContain("必須の位置引数「hex」");\n', "")
text = text.replace('    expect(messages("color c (#fff, unknown: true)").join("\\n")).toContain("引数「unknown」");\n', "")
write(path, text)

# Element serialization no longer emits the removed common color argument.
path = "src/dsl/dslSerializeElement.test.ts"
text = read(path)
text = text.replace('      colorId: "pattern-black",\n', "", 1)
text = text.replace('        { key: "color", text: "color: pattern-black" },\n', "", 1)
text = text.replace(
    'point "前 身" = coordinate(x: -(bust / 4), y: -2, state: disabled, color: pattern-black, steps: [x: 0.1])',
    'point "前 身" = coordinate(x: -(bust / 4), y: -2, state: disabled, steps: [x: 0.1])',
    1,
)
write(path, text)

# textPatch's shared fixture used a palette declaration only as unrelated source
# noise. Replace it with comments while preserving the same number of lines so
# the splice-coordinate assertions remain meaningful. Remove the palette-specific
# patch contract itself and migrate remaining continuation examples to `state`.
path = "src/document/textPatch.test.ts"
text = read(path)
text = text.replace(
    '  "// パレット注釈",\n  \'color main ("#112233", name: "本体", default: true)\',\n',
    '  "// legacy palette source removed",\n  "// retained source-noise line",\n',
    1,
)
# The empty-elements insertion test still needs a valid non-element statement to
# anchor after; a visibility role exercises the same section-boundary behavior.
text = text.replace(
    'color main ("#112233", name: "本体", default: true)',
    'role seam (name: "縫い代")',
)
text = text.replace("color: main", "state: hidden")
text = text.replace("color: accent", "state: disabled")
text = text.replace("colorId: \"accent\"", "activity: \"disabled\"")
for title in [
    "palette line rewrites keep a full-source block-comment close before color code",
    "色の追加・編集・default移動・削除",
]:
    text, _ = re.subn(
        rf'\n  it\("{re.escape(title)}", \(\) => \{{.*?\n  \}}\);\n',
        "\n",
        text,
        count=1,
        flags=re.S,
    )
write(path, text)

print("SAY-115 test follow-up applied")
