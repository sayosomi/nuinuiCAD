from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, text: str) -> None:
    Path(path).write_text(text)


def replace(path: str, old: str, new: str, count: int = -1) -> None:
    text = read(path)
    next_text = text.replace(old, new, count)
    if next_text == text:
        raise SystemExit(f"{path}: replacement target not found: {old[:120]!r}")
    write(path, next_text)


def sub(path: str, pattern: str, repl: str, count: int = 1) -> None:
    text = read(path)
    next_text, n = re.subn(pattern, repl, text, count=count, flags=re.S | re.M)
    if n != count:
        raise SystemExit(f"{path}: regex expected {count}, found {n}: {pattern[:120]!r}")
    write(path, next_text)


# Keep public legacy UI helper names stable; only their types moved out of canonical geometry.
path = "src/palette/palette.ts"
text = read(path)
for old, new in [
    ("defaultLegacyDocumentPalette", "defaultDocumentPalette"),
    ("isValidLegacyPaletteColorId", "isValidPaletteColorId"),
    ("normalizeLegacyDocumentPalette", "normalizeDocumentPalette"),
    ("createLegacyPaletteColorId", "createPaletteColorId"),
    ("createLegacyPaletteColor", "createPaletteColor"),
]:
    text = text.replace(old, new)
write(path, text)

# Remove the remaining palette-only source patch section and palette anchors.
path = "src/document/textPatch.ts"
text = read(path)
text = text.replace("sectionEnds.visibility ?? sectionEnds.palette ?? sectionEnds.version ?? 0", "sectionEnds.visibility ?? sectionEnds.version ?? 0")
text = text.replace("sectionEnds.palette ?? sectionEnds.version ?? 0", "sectionEnds.version ?? 0")
text = text.replace("sectionEnds.elements ?? sectionEnds.visibility ?? sectionEnds.palette ?? sectionEnds.version ?? 0", "sectionEnds.elements ?? sectionEnds.visibility ?? sectionEnds.version ?? 0")
text, n = re.subn(r'\n// ==== パレットセクション ====\n\nconst patchPalette = .*?\n\};\n\n// ==== 表示ロール・プロファイルセクション ====', '\n// ==== 表示ロール・プロファイルセクション ====', text, count=1, flags=re.S)
if n != 1:
    raise SystemExit("src/document/textPatch.ts: patchPalette block not found")
text = text.replace("  patchPalette(input, ops);\n", "")
write(path, text)

# Remove residual source indexing / validation branches for top-level color statements.
path = "src/dsl/dslDocument.ts"
text = read(path)
text = text.replace('      case "color":\n        byKey.set(`color:${statement.name}`, info);\n        break;\n', "", 1)
write(path, text)

path = "src/dsl/dslParser.ts"
text = read(path)
text = text.replace("const hexColorPattern = /^#[0-9a-fA-F]{6}$/;\n\n", "", 1)
text, n = re.subn(r'  if \(result\.statement\.kind === "color"\) \{.*?\n  \}\n', "", text, count=1, flags=re.S)
if n != 1:
    raise SystemExit("src/dsl/dslParser.ts: residual color validation not found")
write(path, text)

# Palette-specific ParameterValueKind bridge cases are now dead.
for path in [
    "src/document/moduleModelBridge.ts",
    "src/dsl/dslCompletionMetadata.ts",
    "src/dsl/dslSignatureHelpQuery.ts",
]:
    text = read(path)
    text = text.replace('    case "choice":\n    case "color":\n', '    case "choice":\n')
    text = text.replace('      case "choice":\n      case "color":\n', '      case "choice":\n')
    write(path, text)

# Semantic comparison helpers no longer compare canonical palette state.
path = "src/dsl/dslDocumentTestUtils.ts"
text = read(path).replace("  expect(a.palette).toEqual(b.palette);\n", "", 1)
write(path, text)

# documentTestGenerators used to mutate the palette as one arbitrary generated model change.
# Drop that generator branch; palette is no longer part of DslDocumentData.
path = "src/document/documentTestGenerators.ts"
text = read(path)
text, n = re.subn(r'\n\s*case \d+: \{\n\s*const palette = current\.palette;.*?\n\s*\}\n', '\n', text, count=1, flags=re.S)
if n == 0:
    # The branch is labeled by operation name in current source; remove the smallest block containing current.palette.
    text, n = re.subn(r'\n\s*\{\n(?:(?!\n\s*\{).)*?current\.palette.*?\n\s*\},', '\n', text, count=1, flags=re.S)
if n == 0:
    print("note: documentTestGenerators palette branch requires test/source follow-up")
write(path, text)

print("SAY-115 fixup applied")
