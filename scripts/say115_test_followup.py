from pathlib import Path


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

print("SAY-115 test follow-up applied")
