from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, text: str) -> None:
    Path(path).write_text(text)


# ParameterValueKind no longer includes the legacy palette-only color kind.
path = "src/commands/parameterPickCommand.test.ts"
write(path, read(path).replace('["text", "boolean", "color", "choice"]', '["text", "boolean", "choice"]', 1))

path = "src/dsl/dslApplyArgs.test.ts"
write(path, read(path).replace('    case "color": return "pattern-black";\n', "", 1))

# UI compatibility tests may still construct historical colorId extras, but CadElement no longer owns that field.
path = "src/components/DrawingCanvas.test.ts"
text = read(path)
text = text.replace('element.id === "line-ab" ? { ...element, colorId: "cut-red" } : element', 'element.id === "line-ab" ? ({ ...element, colorId: "cut-red" } as unknown as CadElement) : element', 1)
text = text.replace('element.id === "point-a" ? { ...element, colorId: "guide-blue" } : element', 'element.id === "point-a" ? ({ ...element, colorId: "guide-blue" } as unknown as CadElement) : element', 1)
write(path, text)

path = "src/components/canvasRevisionPresentation.test.ts"
text = read(path)
text = text.replace('import type { CadElement, DocumentPalette, EvaluationResult, VisibilityProfile } from "../types/geometry";\n', 'import type { CadElement, EvaluationResult, VisibilityProfile } from "../types/geometry";\nimport type { LegacyDocumentPalette } from "../palette/palette";\n', 1)
text = text.replace("DocumentPalette", "LegacyDocumentPalette")
write(path, text)

# Canonical shadow model has no palette field.
path = "src/document/shadowText.test.ts"
write(path, read(path).replace('      palette: { colors: [{ id: "main", name: "本体", hex: "#000000" }], defaultColorId: "main" },\n', "", 1))

# Text-patch tests: use state as the continuation attribute and drop the removed palette patch contract.
path = "src/document/textPatch.test.ts"
text = read(path)
text = text.replace('    "  color: main  // 継続コメント",\n', '    "  state: hidden  // 継続コメント",\n', 1)
text = text.replace('element.name === "A" ? ({ ...element, colorId: "accent" } as CadElement) : element', 'element.name === "A" ? ({ ...element, activity: "disabled" } as CadElement) : element', 1)
text = text.replace('    expect(lines).toContain("  color: accent,  // 継続コメント");\n    expect(lines).not.toContain("  color: main  // 継続コメント");\n', '    expect(lines).toContain("  state: disabled,  // 継続コメント");\n    expect(lines).not.toContain("  state: hidden  // 継続コメント");\n', 1)
text = text.replace('"  color: main", ")"', '"  state: hidden", ")"', 1)
text, n = re.subn(r'\n  it\("palette line rewrites keep a full-source block-comment close before color code", \(\) => \{.*?\n  \}\);\n', '\n', text, count=1, flags=re.S)
if n != 1:
    raise SystemExit("src/document/textPatch.test.ts: palette comment test not found")
text = text.replace("    expect(diff.palette).toBe(false);\n", "", 1)
write(path, text)

# Compiler contract: legacy color statements are unsupported rather than compiled into palette state.
path = "src/dsl/dslCompiler.test.ts"
text = read(path)
text, n = re.subn(
    r'  it\("builds a palette from color statements", \(\) => \{.*?\n  \}\);\n\n  it\("rejects multiple default colors", \(\) => \{.*?\n  \}\);\n',
    '''  it("rejects legacy top-level color statements", () => {\n    const result = compileDslToElements(\n      ['color main ("#112233", name: "本体")', "point A = coordinate(x: 0,y: 0)"].join("\\n"),\n      { elements: [], mode: "document" }\n    );\n    expect(result.diagnostics.some((item) => item.severity === "error")).toBe(true);\n    expect(result).not.toHaveProperty("palette");\n  });\n''',
    text,
    count=1,
    flags=re.S,
)
if n != 1:
    raise SystemExit("src/dsl/dslCompiler.test.ts: palette tests not found")
write(path, text)

# Document contract and golden fixture no longer expose palette state.
path = "src/dsl/dslDocument.test.ts"
text = read(path).replace('import { defaultDocumentPalette } from "../palette/palette";\n', "", 1)
text, n = re.subn(
    r'\ndescribe\("dslDocument palette", \(\) => \{.*?\n\}\);\n',
    '''\ndescribe("dslDocument legacy palette syntax", () => {\n  it("rejects top-level color statements", () => {\n    const parsed = parseDslDocument('nui 4\\ncolor main ("#112233", name: "本体")');\n    expect(parsed.diagnostics.some((item) => item.severity === "error")).toBe(true);\n    expect(parsed.document).toBeNull();\n  });\n});\n''',
    text,
    count=1,
    flags=re.S,
)
if n != 1:
    raise SystemExit("src/dsl/dslDocument.test.ts: palette describe not found")
text = text.replace('    expect(document.palette.colors.map((color) => color.id)).toEqual(["pattern-black", "cut-red"]);\n    expect(document.palette.defaultColorId).toBe("pattern-black");\n', "", 1)
write(path, text)

path = "src/dsl/__fixtures__/sample.nui"
text = read(path)
text = text.replace('color pattern-black ("#31322f", name: "基本線", default: true)\ncolor cut-red ("#b42318", name: "裁断線")\n\n', "", 1)
write(path, text)

# Module-global-settings guard keeps testing role/view scoping without using removed palette syntax.
path = "src/dsl/dslModuleCompilationGuard.test.ts"
text = read(path)
text = text.replace('      "  color hidden (\\"#ff0000\\", default: true)",\n', "", 1)
text = text.replace('    expect(compiled.document?.palette.colors.some((color) => color.id === "hidden")).toBe(false);\n    expect(compiled.document?.palette.defaultColorId).toBe("pattern-black");\n', "", 1)
write(path, text)

# Legacy palette rendering tests use a palette-domain type and explicit historical colorId extras.
path = "src/palette/elementColors.test.ts"
text = read(path)
text = text.replace('import type { CadElement, DocumentPalette } from "../types/geometry";\n', 'import type { CadElement } from "../types/geometry";\nimport type { LegacyDocumentPalette } from "./palette";\n', 1)
text = text.replace("DocumentPalette", "LegacyDocumentPalette")
text = text.replace('const point = (id: string, patch: Partial<CadElement> = {}): CadElement => ({', 'const point = (id: string, patch: Partial<CadElement> & { colorId?: string } = {}): CadElement => ({', 1)
text = text.replace('const group = (id: string, patch: Partial<CadElement> = {}): CadElement => ({', 'const group = (id: string, patch: Partial<CadElement> & { colorId?: string } = {}): CadElement => ({', 1)
text = text.replace('  ...patch\n} as CadElement);', '  ...patch\n} as unknown as CadElement);', 2)
text = text.replace('      {\n        id: "module",', '      ({\n        id: "module",', 1)
text = text.replace('        colorId: "blue"\n      },\n      point("p", { parentGroupId: "module" })', '        colorId: "blue"\n      } as unknown as CadElement),\n      point("p", { parentGroupId: "module" })', 1)
write(path, text)

# Canonical store tests no longer rely on source color arguments.
path = "src/state/cadDocumentStore.canonical.test.ts"
text = read(path)
text = text.replace('      "point A = coordinate(x: 0, y: 0, color: missing-color)",\n', '      "point A = coordinate(x: 0, y: 0)",\n', 1)
text = text.replace('    expect(useCadDocumentStore.getState().sourceText).toContain("color: missing-color");\n    expect(useCadDocumentStore.getState().elements.find((element) => element.name === "A")?.colorId)\n      .toBe("missing-color");\n', "", 1)
write(path, text)

path = "src/state/cadDocumentStore.shadow.property.test.ts"
text = read(path).replace("            palette: document.palette,\n", "", 1)
write(path, text)

# Until SAY-129 removes it, palette UI state is explicitly non-canonical and not part of source history.
path = "src/state/cadDocumentStore.test.ts"
text = read(path)
text, n = re.subn(
    r'  it\("tracks palette edits in document history", \(\) => \{.*?\n  \}\);\n\n  it\("clears element color ids when deleting a palette color", \(\) => \{.*?\n  \}\);',
    '''  it("keeps legacy palette UI edits outside canonical document history", () => {\n    useCadDocumentStore.getState().setDefaultColorId("cut-red");\n    expect(useCadDocumentStore.getState().palette.defaultColorId).toBe("cut-red");\n    expect(useCadDocumentStore.getState().past).toHaveLength(0);\n\n    useCadDocumentStore.getState().deletePaletteColor("guide-blue");\n    expect(useCadDocumentStore.getState().palette.colors.some((color) => color.id === "guide-blue")).toBe(false);\n    expect(useCadDocumentStore.getState().past).toHaveLength(0);\n  });''',
    text,
    count=1,
    flags=re.S,
)
if n != 1:
    raise SystemExit("src/state/cadDocumentStore.test.ts: palette history tests not found")
write(path, text)

print("SAY-115 test fixup applied")
