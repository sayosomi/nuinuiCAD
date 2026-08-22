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
    ],
)

print("SAY-115 generated test string escapes repaired")
