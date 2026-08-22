from pathlib import Path


def repair(path: str, replacements: list[tuple[str, str]]) -> None:
    file = Path(path)
    text = file.read_text()
    for old, new in replacements:
        if old not in text:
            raise RuntimeError(f"expected escaped-text target not found in {path}: {old!r}")
        text = text.replace(old, new, 1)
    file.write_text(text)


repair(
    "src/dsl/dslCallParser.test.ts",
    [
        ('expect(messages(source).join("\n")).toContain', 'expect(messages(source).join("\\n")).toContain'),
    ],
)

repair(
    "src/dsl/dslDrawingModifier.test.ts",
    [
        ('"nui 4\npoint P = coordinate(x: 0, y: 0, state: hidden)"', '"nui 4\\npoint P = coordinate(x: 0, y: 0, state: hidden)"'),
        ('"nui 4\npoint P = coordinate(x: 0, y: 0, color: pattern-black)"', '"nui 4\\npoint P = coordinate(x: 0, y: 0, color: pattern-black)"'),
        (
            '    expect(withColor.diagnostics.filter((item) => item.severity === "error")).toEqual([\n'
            '      expect.objectContaining({ message: expect.stringContaining("引数「color」") })\n'
            '    ]);\n'
            '  });',
            '    expect(withColor.diagnostics.filter((item) => item.severity === "error")).toEqual([\n'
            '      expect.objectContaining({ message: expect.stringContaining("引数「color」") })\n'
            '    ]);\n\n'
            '    const containerColor = compileDslDocument(\n'
            '      "nui 4\\ngroup G (color: pattern-black) {\\n}"\n'
            '    );\n'
            '    expect(containerColor.diagnostics.filter((item) => item.severity === "error")).toEqual([\n'
            '      expect.objectContaining({ message: expect.stringContaining("引数「color」") })\n'
            '    ]);\n'
            '  });',
        ),
    ],
)

repair(
    "src/document/documentTestGenerators.ts",
    [
        (
            '    // nui 4の縦型call(未閉`(`による複数物理行statement)を1つ混ぜる。\n',
            '    // nui 4の縦型call(未閉`(`による複数物理行statement)を1つ混ぜる。\n'
            '    // common state引数を使い、旧Document Paletteには依存しない。\n',
        ),
    ],
)

repair(
    "src/components/DrawingCanvas.test.ts",
    [
        (
            'useCadDocumentStore.getState().commitText("nui 4\\npoint A = coordinate(x: 0, y: 0)\\npoint B = coordinate(x: 100, y: 0, color: cut-red)", "editor");',
            'useCadDocumentStore.getState().commitText("nui 4\\npoint A = coordinate(x: 1, y: 0)\\npoint B = coordinate(x: 100, y: 0)", "editor");',
        ),
    ],
)

print("SAY-115 generated test string escapes and regression checks repaired")
