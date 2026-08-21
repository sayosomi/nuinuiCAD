from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one replacement target, found {count}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "mcp-server/src/documentSnapshot.ts",
    'import type { DslDiagnostic, DslStatement } from "../../src/dsl/dslTypes";',
    'import type { DslDiagnostic, DslDiagnosticRelatedInformation, DslStatement } from "../../src/dsl/dslTypes";'
)

replace_once(
    "mcp-server/src/documentSnapshot.ts",
    '''export type DiagnosticDto = {
  severity: DslDiagnostic["severity"];
  message: string;
  line: number;
  column: number;
  sourceRevision: number;
  code?: string;
  range?: SourceRangeDto;
  relatedInformation?: Array<{
    message: string;
    range: SourceRangeDto;
  }>;
  bindingId?: string;
  elementId?: string;
  propertyKey?: string;
  origin?: "runtime";
  expectedType?: DslDiagnostic["expectedType"];
  actualType?: DslDiagnostic["actualType"];
};''',
    '''export type DiagnosticDto = Omit<DslDiagnostic, "sourceRevision" | "relatedInformation"> & {
  sourceRevision: number;
  range?: SourceRangeDto;
  relatedInformation?: Array<DslDiagnosticRelatedInformation & {
    range: SourceRangeDto;
  }>;
};'''
)

replace_once(
    "mcp-server/src/documentSnapshot.ts",
    '''const diagnosticDto = (
  diagnostic: DslDiagnostic,
  currentSourceRevision: number,
  normalizedSource: string,
  lineStarts: readonly number[]
): DiagnosticDto => ({
  severity: diagnostic.severity,
  message: diagnostic.message,
  line: diagnostic.line,
  column: diagnostic.column,
  sourceRevision: diagnostic.sourceRevision ?? currentSourceRevision,
  ...(diagnostic.code ? { code: diagnostic.code } : {}),
  ...(diagnostic.physicalSpan
    ? { range: rangeDto(diagnostic.physicalSpan, normalizedSource, lineStarts) }
    : {}),
  ...(diagnostic.relatedInformation
    ? {
        relatedInformation: diagnostic.relatedInformation.map((related) => ({
          message: related.message,
          range: rangeDto(related.physicalSpan, normalizedSource, lineStarts)
        }))
      }
    : {}),
  ...(diagnostic.bindingId ? { bindingId: diagnostic.bindingId } : {}),
  ...(diagnostic.elementId ? { elementId: diagnostic.elementId } : {}),
  ...(diagnostic.propertyKey ? { propertyKey: diagnostic.propertyKey } : {}),
  ...(diagnostic.origin ? { origin: diagnostic.origin } : {}),
  ...(diagnostic.expectedType ? { expectedType: diagnostic.expectedType } : {}),
  ...(diagnostic.actualType ? { actualType: diagnostic.actualType } : {})
});''',
    '''const diagnosticDto = (
  diagnostic: DslDiagnostic,
  currentSourceRevision: number,
  normalizedSource: string,
  lineStarts: readonly number[]
): DiagnosticDto => ({
  ...diagnostic,
  sourceRevision: diagnostic.sourceRevision ?? currentSourceRevision,
  ...(diagnostic.physicalSpan
    ? { range: rangeDto(diagnostic.physicalSpan, normalizedSource, lineStarts) }
    : {}),
  ...(diagnostic.relatedInformation
    ? {
        relatedInformation: diagnostic.relatedInformation.map((related) => ({
          ...related,
          range: rangeDto(related.physicalSpan, normalizedSource, lineStarts)
        }))
      }
    : {})
});'''
)

replace_once(
    "mcp-server/test/documentSnapshot.test.ts",
    '    expect(rangeText(source, related.range)).toBe("required");',
    '    expect(related.physicalSpan.segments).toHaveLength(1);\n    expect(rangeText(source, related.range)).toBe("required");'
)

classifier_test = Path("scripts/ci/classifyChanges.node-test.mjs")
classifier_text = classifier_test.read_text()
classifier_marker = '  {\n    name: "ordinary Canvas/UI TypeScript",'
if classifier_text.count(classifier_marker) != 1:
    raise SystemExit(f"classifier test marker count={classifier_text.count(classifier_marker)}")
classifier_insertion = (
    '  {\n'
    '    name: "MCP server source and tests",\n'
    '    paths: ["mcp-server/src/server.ts", "mcp-server/test/stdio.test.ts"],\n'
    '    expected: flags({ node: true })\n'
    '  },\n'
)
classifier_test.write_text(classifier_text.replace(classifier_marker, classifier_insertion + classifier_marker, 1))

architecture = Path("ARCHITECTURE.md")
architecture_text = architecture.read_text()
old_owner = (
    '`AutomationDocument` は既存の parser、statement reconciler、compiler、Module\n'
    'semantic / materialization path をそのまま利用し、materialized Module children\n'
    'を source representation に flatten しない。Future Evaluation Context や\n'
    'Headless Rust はこの architecture の current component ではない。'
)
new_owner = (
    '`AutomationDocument` は既存の parser、statement reconciler、compiler、Module\n'
    'semantic / materialization path をそのまま利用し、materialized Module children\n'
    'を source representation に flatten しない。Headless MCP の fresh file snapshot\n'
    'もこの facade を利用し、fatal current source では `currentCompiled` の diagnostics\n'
    'だけを返して last-good `doc` を current semantics として公開しない。'
)
if architecture_text.count(old_owner) != 1:
    raise SystemExit(f"architecture owner target count={architecture_text.count(old_owner)}")
architecture_text = architecture_text.replace(old_owner, new_owner, 1)
section_marker = "### Compilation / source mutation"
if architecture_text.count(section_marker) != 1:
    raise SystemExit(f"architecture section marker count={architecture_text.count(section_marker)}")
section = '''### Headless MCP

Primary:

- `mcp-server/src/server.ts`
- `mcp-server/src/documentSnapshot.ts`

Repository-owned MCP server は Node の直接 entry
`mcp-server/dist/server.js` を stdio transport で起動する。stdout は MCP protocol
専用で、server diagnostics は stderr に出す。`document_inspect` は absolute
file-backed `.nui` を call ごとに disk から fresh read し、SHA-256 source identity、
exact-current compile status / diagnostics、compact declaration / element summary を
JSON-friendly DTO として返す。Mutable document registry、Rust evaluation、VS Code
attached observation、source mutation はこの boundary の owner ではない。

'''
architecture.write_text(architecture_text.replace(section_marker, section + section_marker, 1))
