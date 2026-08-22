from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, text: str) -> None:
    Path(path).write_text(text)


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

path = "src/palette/paletteSettingsStorage.ts"
text = read(path).replace("defaultLegacyDocumentPalette", "defaultDocumentPalette").replace("normalizeLegacyDocumentPalette", "normalizeDocumentPalette")
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
path = "src/document/moduleModelBridge.ts"
text = read(path).replace('    case "choice":\n    case "color":\n', '    case "choice":\n')
write(path, text)

path = "src/dsl/dslCompletionMetadata.ts"
text = read(path).replace('    case "color":\n      return "accent";\n', "", 1)
write(path, text)

path = "src/dsl/dslSignatureHelpQuery.ts"
text = read(path).replace('    case "color":\n      return "signatureHelp.parameter.color";\n', "", 1)
write(path, text)

# Semantic comparison helpers no longer compare canonical palette state.
path = "src/dsl/dslDocumentTestUtils.ts"
text = read(path).replace("  expect(a.palette).toEqual(b.palette);\n", "", 1)
write(path, text)

# Generated canonical model edits no longer include palette mutations.
path = "src/document/documentTestGenerators.ts"
text = read(path)
text, n = re.subn(r'\n    case "paletteEdit": \{.*?\n    \}\n', '\n', text, count=1, flags=re.S)
if n != 1:
    raise SystemExit("src/document/documentTestGenerators.ts: paletteEdit case not found")
write(path, text)

print("SAY-115 fixup applied")
