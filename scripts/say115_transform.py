from __future__ import annotations

import re
from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, text: str) -> None:
    Path(path).write_text(text)


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one replacement target, found {count}: {old[:100]!r}")
    write(path, text.replace(old, new, 1))


def sub_once(path: str, pattern: str, repl: str, flags: int = re.S | re.M) -> None:
    text = read(path)
    next_text, count = re.subn(pattern, repl, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"{path}: expected one regex target, found {count}: {pattern[:120]!r}")
    write(path, next_text)


def remove_type_import_name(path: str, module: str, name: str) -> None:
    text = read(path)
    pattern = rf'import type \{{(?P<body>.*?)\}} from "{re.escape(module)}";\n'
    match = re.search(pattern, text, flags=re.S)
    if not match:
        raise SystemExit(f"{path}: import type from {module} not found")
    names = [item.strip() for item in match.group("body").split(",") if item.strip()]
    if name not in names:
        raise SystemExit(f"{path}: {name} not present in import from {module}: {names}")
    names.remove(name)
    replacement = "" if not names else "import type {\n  " + ",\n  ".join(names) + f'\n}} from "{module}";\n'
    write(path, text[:match.start()] + replacement + text[match.end():])


def prepend_once(path: str, line: str) -> None:
    text = read(path)
    if line in text:
        return
    write(path, line + text)


# Canonical geometry model: no legacy palette ownership.
replace_once("src/types/geometry.ts", "  colorId?: string;\n", "")
sub_once(
    "src/types/geometry.ts",
    r"\nexport type PaletteColor = \{.*?\n\};\n\nexport type DocumentPalette = \{.*?\n\};\n",
    "\n",
)

# Keep the still-to-be-removed SAY-129/SAY-143 UI/persistence surface compiling,
# but move those legacy types out of the canonical geometry model.
path = "src/palette/palette.ts"
text = read(path)
text = text.replace('import type { DocumentPalette, PaletteColor } from "../types/geometry";\n\n', "", 1)
text = text.replace("DocumentPalette", "LegacyDocumentPalette").replace("PaletteColor", "LegacyPaletteColor")
prefix = '''export type LegacyPaletteColor = {\n  id: string;\n  name: string;\n  hex: string;\n};\n\nexport type LegacyDocumentPalette = {\n  colors: LegacyPaletteColor[];\n  defaultColorId: string;\n};\n\n'''
write(path, prefix + text)

# Move legacy consumer type dependencies to the palette domain.
for path, module in [
    ("src/palette/paletteSettingsStorage.ts", "./palette"),
    ("src/palette/elementColors.ts", "./palette"),
    ("src/model/elementPresentationStatus.ts", "../palette/palette"),
    ("src/editor/sourceEditorEvaluationIndex.ts", "../palette/palette"),
    ("src/components/canvasRevisionPresentation.ts", "../palette/palette"),
    ("src/components/canvasHostAdapter.ts", "../palette/palette"),
]:
    remove_type_import_name(path, "../types/geometry", "DocumentPalette")
    text = read(path).replace("DocumentPalette", "LegacyDocumentPalette")
    write(path, text)
    prepend_once(path, f'import type {{ LegacyDocumentPalette }} from "{module}";\n')

# Legacy element-color rendering may still read historical extra fields until SAY-129,
# but CadElement itself no longer declares them.
path = "src/palette/elementColors.ts"
text = read(path)
text = text.replace(
    "export const resolvedColorIdForElement = ({\n",
    "const legacyColorId = (element: CadElement) =>\n  (element as CadElement & { colorId?: string }).colorId;\n\nexport const resolvedColorIdForElement = ({\n",
    1,
)
text = text.replace(
    "  if (element.colorId && colorsById.has(element.colorId)) return element.colorId;\n",
    "  const elementColorId = legacyColorId(element);\n  if (elementColorId && colorsById.has(elementColorId)) return elementColorId;\n",
    1,
)
text = text.replace(
    "    if (ancestor && isGroupElement(ancestor) && ancestor.colorId && colorsById.has(ancestor.colorId)) {\n      return ancestor.colorId;\n    }\n",
    "    const ancestorColorId = ancestor ? legacyColorId(ancestor) : undefined;\n    if (ancestor && isGroupElement(ancestor) && ancestorColorId && colorsById.has(ancestorColorId)) {\n      return ancestorColorId;\n    }\n",
    1,
)
write(path, text)

# nui4 parser registry: top-level legacy `color ...` is no longer a statement.
replace_once("src/dsl/dslStatementKeywords.ts", '  color: "color",\n', "")
path = "src/dsl/dslSettingsParser.ts"
text = read(path)
text = text.replace('  | "color"\n', "", 1)
text = text.replace('["color", "role", "view", "layout", "print", "svg", "place"]', '["role", "view", "layout", "print", "svg", "place"]', 1)
text = text.replace('["color", "role", "view", "layout", "print", "svg"]', '["role", "view", "layout", "print", "svg"]', 1)
text = text.replace('Extract<DslSettingsKind, "color" | "role" | "view" | "layout" | "print" | "svg" | "place">', 'Extract<DslSettingsKind, "role" | "view" | "layout" | "print" | "svg" | "place">', 1)
write(path, text)

path = "src/dsl/dslConstructionsSettings.ts"
text = read(path)
text = text.replace('  keyword: "color" | "role" | "view" | "layout" | "print" | "svg" | "place";\n', '  keyword: "role" | "view" | "layout" | "print" | "svg" | "place";\n', 1)
text = text.replace('  { keyword: "color", args: [positional("hex"), arg("name"), arg("default")] },\n', "", 1)
write(path, text)

path = "src/dsl/dslParser.ts"
text = read(path)
text = text.replace("  dslStatementKeywords.color,\n", "", 1)
text = text.replace('  "color",\n', "", 1)
text, count = re.subn(
    r'\n    case "color": \{.*?\n      return \{ \.\.\.base, kind: "color", hex, isDefault \};\n    \}',
    "",
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit("src/dsl/dslParser.ts: color lowering case not found")
write(path, text)

# DSL statement/compiler model has no palette field or palette statement.
remove_type_import_name("src/dsl/dslTypes.ts", "../types/geometry", "DocumentPalette")
path = "src/dsl/dslTypes.ts"
text = read(path)
text, count = re.subn(r'\n  \| \(DslStatementBase & \{ kind: "color"; hex: string; isDefault: boolean \}\)', "", text, count=1)
if count != 1:
    raise SystemExit("src/dsl/dslTypes.ts: color statement variant not found")
text = text.replace("  palette?: DocumentPalette;\n", "")
write(path, text)

# Geometry/container common `color:` argument and parameter bridge are removed.
replace_once("src/dsl/dslConstructions.ts", '  arg("color", "colorId"),\n', "")
path = "src/parameters/parameterDefinitions.ts"
text = read(path)
text = text.replace('  | "color"\n', "", 1)
text = text.replace('  { key: "colorId", label: "表示色", kind: "color" },\n', "", 1)
write(path, text)

sub_once(
    "src/parameters/parameterAccess.ts",
    r'\n  if \(key === "colorId" && value === undefined\) \{\n    const rest = \{ \.\.\.element \};\n    delete rest\.colorId;\n    return rest as CadElement;\n  \}',
    "",
)

path = "src/dsl/dslApplyArgs.ts"
text = read(path)
text = text.replace(
    'import { elementTypeSupportsHiddenActivity, elementTypesWithoutOwnDrawableGeometry } from "../model/elementActivity";',
    'import { elementTypeSupportsHiddenActivity } from "../model/elementActivity";',
    1,
)
text, count = re.subn(
    r'\n    // `color` is a common argument.*?\n    if \(!parameter\) \{.*?\n      continue;\n    \}',
    "\n    if (!parameter) continue;",
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit("src/dsl/dslApplyArgs.ts: common color lowering block not found")
text = text.replace('      case "choice":\n      case "color":\n', '      case "choice":\n', 1)
write(path, text)

path = "src/dsl/dslSerializeElement.ts"
text = read(path)
text = text.replace('import { elementTypesWithoutOwnDrawableGeometry } from "../model/elementActivity";\n', "", 1)
text = text.replace('  if (parameterKey === "colorId") return formatDslName((value as string | undefined) ?? "");\n\n', "", 1)
text = text.replace('    case "color":\n      return formatDslName(value as string);\n', "", 1)
text = text.replace(
    '      if (key === "state") return activity !== "visible";\n      return key === "colorId" && Boolean(element.colorId) && !elementTypesWithoutOwnDrawableGeometry.has(element.type);\n',
    '      return key === "state" && activity !== "visible";\n',
    1,
)
write(path, text)

# Compiler no longer consumes/returns palette state.
remove_type_import_name("src/dsl/dslCompiler.ts", "../types/geometry", "DocumentPalette")
remove_type_import_name("src/dsl/dslCompiler.ts", "../types/geometry", "PaletteColor")
path = "src/dsl/dslCompiler.ts"
text = read(path)
text, count = re.subn(
    r'\nconst applyPaletteStatements = \(\{.*?\n\};\n\nexport const applyVisibilitySettings',
    "\nexport const applyVisibilitySettings",
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit("src/dsl/dslCompiler.ts: palette compiler block not found")
text = text.replace("  const palette = applyPaletteStatements({ statements, context, diagnostics, includeStatement });\n\n", "", 1)
text = text.replace("    activeVisibilityProfileId,\n    palette\n", "    activeVisibilityProfileId\n", 1)
text = text.replace("      palette: context.palette,\n", "", 1)
text = text.replace("    palette: visibilitySettings.palette,\n", "", 1)
write(path, text)

# Canonical document facade/serializer/StatementMap owns no palette section.
path = "src/dsl/dslDocument.ts"
text = read(path)
text = text.replace('import { defaultDocumentPalette } from "../palette/palette";\n', "", 1)
write(path, text)
remove_type_import_name(path, "../types/geometry", "DocumentPalette")
remove_type_import_name(path, "../types/geometry", "PaletteColor")
text = read(path)
text = text.replace("  palette: DocumentPalette;\n", "", 1)
text = text.replace('   * 非要素文のキー: `color:<id>` / `role:<id>` / `view:<id>` / `layout:<id>` /\n', '   * 非要素文のキー: `role:<id>` / `view:<id>` / `layout:<id>` /\n', 1)
text = text.replace("    palette?: number;\n", "", 1)
text, count = re.subn(
    r'\n// ==== パレット ====\n\nexport const serializePaletteColorLine = \(.*?\nexport const serializeDrawingProfileLines',
    "\nexport const serializeDrawingProfileLines",
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit("src/dsl/dslDocument.ts: palette serializer block not found")
text = text.replace("    serializePaletteLines(data.palette),\n", "", 1)
text = text.replace('    } else if (statement.kind === "color") {\n      sectionEnds.palette = Math.max(sectionEnds.palette ?? 0, info.line);\n', "", 1)
text = text.replace("    palette: compiled.palette ?? defaultDocumentPalette(),\n", "", 1)
write(path, text)

# Module execution shares the compiler result model; no palette bridge.
remove_type_import_name("src/dsl/moduleExecutionCompiler.ts", "../types/geometry", "DocumentPalette")
path = "src/dsl/moduleExecutionCompiler.ts"
text = read(path)
text = text.replace("  palette?: DocumentPalette;\n", "", 1)
text = text.replace("    palette: visibilitySettings.palette,\n", "", 1)
write(path, text)

# Canonical document default no longer injects a palette.
path = "src/document/canonicalDocument.ts"
text = read(path)
text = text.replace('import { defaultDocumentPalette } from "../palette/palette";\n', "", 1)
text = text.replace("  palette: defaultDocumentPalette(),\n", "", 1)
write(path, text)

# Canonical shadow snapshot no longer contains a palette field.
remove_type_import_name("src/document/shadowText.ts", "../types/geometry", "DocumentPalette")
path = "src/document/shadowText.ts"
text = read(path)
text = text.replace("  palette: DocumentPalette;\n", "", 1)
text = text.replace("  palette: snapshot.palette,\n", "", 1)
write(path, text)

# Text-patch diff no longer owns palette source lines.
path = "src/document/textPatch.ts"
text = read(path)
text = text.replace("  serializePaletteColorLine,\n  serializePaletteLines,\n", "", 1)
text = text.replace("  palette: boolean;\n", "", 1)
text = text.replace('    palette: serializePaletteLines(oldDoc.palette).join("\\n") !== serializePaletteLines(newDoc.palette).join("\\n"),\n', "", 1)
write(path, text)

# Legacy store retains an ephemeral UI compatibility palette until SAY-129.
path = "src/state/cadDocumentStore.ts"
remove_type_import_name(path, "../types/geometry", "DocumentPalette")
remove_type_import_name(path, "../types/geometry", "PaletteColor")
text = read(path)
text = text.replace(
    "  isValidPaletteColorId\n} from \"../palette/palette\";",
    "  isValidPaletteColorId,\n  type LegacyDocumentPalette,\n  type LegacyPaletteColor\n} from \"../palette/palette\";",
    1,
)
text = text.replace("palette: DocumentPalette", "palette: LegacyDocumentPalette")
text = text.replace("Partial<PaletteColor>", "Partial<LegacyPaletteColor>")
text = text.replace('  | "palette"\n', "", 1)
text = text.replace("  palette: state.palette,\n", "", 1)
text = text.replace("    state.palette === document.palette &&\n", "", 1)
text = text.replace("    palette: document.palette,\n", "", 1)
text = text.replace("    palette: change.palette ?? before.palette,\n", "", 1)
text = text.replace("  palette: defaultDocumentPalette(),\n", "", 1)
text, count = re.subn(
    r'\nconst elementWithoutColorId = \(element: CadElement\): CadElement => \{.*?\n\};\n',
    "\n",
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit("src/state/cadDocumentStore.ts: elementWithoutColorId block not found")
text, count = re.subn(
    r'  setPalette: \(palette\) => get\(\)\.commitDocumentChange\(\{ palette \}\),\n  updatePaletteColor:.*?\n  setDefaultColorId: \(id\) => \{.*?\n  \},\n  replaceDocument:',
    '''  setPalette: (palette) => set({ palette }),\n  updatePaletteColor: (id, patch) => {\n    const palette = get().palette;\n    if (!palette.colors.some((color) => color.id === id)) return;\n    set({\n      palette: {\n        ...palette,\n        colors: palette.colors.map((color) => color.id === id ? { ...color, ...patch, id } : color)\n      }\n    });\n  },\n  addPaletteColor: () => {\n    const palette = get().palette;\n    set({ palette: { ...palette, colors: [...palette.colors, createPaletteColor(palette.colors)] } });\n  },\n  deletePaletteColor: (id) => {\n    const palette = get().palette;\n    if (id === palette.defaultColorId || !palette.colors.some((color) => color.id === id)) return;\n    set({ palette: { ...palette, colors: palette.colors.filter((color) => color.id !== id) } });\n  },\n  setDefaultColorId: (id) => {\n    const palette = get().palette;\n    if (!isValidPaletteColorId(palette, id) || palette.defaultColorId === id) return;\n    set({ palette: { ...palette, defaultColorId: id } });\n  },\n  replaceDocument:''',
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit("src/state/cadDocumentStore.ts: palette action block not found")
text = text.replace(
    "    ...canonicalFields(canonical),\n    sourceRevision: 0,\n",
    "    ...canonicalFields(canonical),\n    palette: defaultDocumentPalette(),\n    sourceRevision: 0,\n",
    1,
)
text = text.replace(
    "  replaceDocument: (document: DslDocumentData, filePath: string | null) => void;\n",
    "  replaceDocument: (document: DslDocumentData & { palette?: LegacyDocumentPalette }, filePath: string | null) => void;\n",
    1,
)
text = text.replace(
    "          ...canonicalFields(canonical),\n          ...clearedPreviewState(),\n",
    "          ...canonicalFields(canonical),\n          palette: snapshot.palette ?? state.palette,\n          ...clearedPreviewState(),\n",
    1,
)
write(path, text)

# Selection color command remains until SAY-129, but colorId is now a legacy extra field.
path = "src/commands/selectionCommands.ts"
text = read(path)
text = text.replace(
    "const elementWithoutColorId = (element: CadElement): CadElement => {\n  const rest = { ...element };\n  delete rest.colorId;\n  return rest as CadElement;\n};\n",
    "const elementWithoutColorId = (element: CadElement): CadElement => {\n  const rest = { ...element } as CadElement & { colorId?: string };\n  delete rest.colorId;\n  return rest;\n};\n",
    1,
)
write(path, text)

# Source/document test utilities should no longer manufacture canonical palettes.
path = "src/dsl/dslDocumentTestUtils.ts"
text = read(path)
text = text.replace('import { defaultDocumentPalette } from "../palette/palette";\n', "", 1)
text = text.replace("  palette: defaultDocumentPalette(),\n", "", 1)
text = text.replace('      palette: { colors: [], defaultColorId: "" },\n', "", 1)
text = text.replace("    palette: first.palette ?? defaultDocumentPalette(),\n", "", 1)
write(path, text)

print("=== remaining core legacy references ===")
for root in ["src/dsl", "src/document", "src/parameters", "src/types"]:
    for file in Path(root).rglob("*.ts"):
        if file.name.endswith(".test.ts"):
            continue
        source = file.read_text(errors="ignore")
        for lineno, line in enumerate(source.splitlines(), 1):
            if any(token in line for token in ["DocumentPalette", "PaletteColor", "colorId", 'kind: "color"', "serializePalette", "sectionEnds.palette"]):
                print(f"{file}:{lineno}:{line}")
