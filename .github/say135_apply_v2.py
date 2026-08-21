from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text().replace("\r\n", "\n")


def write(path: str, text: str) -> None:
    Path(path).write_text(text)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one target, found {count}")
    return text.replace(old, new, 1)


path = "vscode-extension/src/compilerDiagnostics.ts"
text = read(path)
text = replace_once(
    text,
    "export type CompilerDiagnostic = {",
    '''export type CompilerDiagnosticRelatedInformation = {
  message: string;
  range: CompilerDiagnosticRange;
};

export type CompilerDiagnostic = {''',
    "CompilerDiagnostic related type"
)
text = replace_once(
    text,
    '''  range: CompilerDiagnosticRange;
  code?: string;''',
    '''  range: CompilerDiagnosticRange;
  relatedInformation?: readonly CompilerDiagnosticRelatedInformation[];
  code?: string;''',
    "CompilerDiagnostic related property"
)
text = replace_once(
    text,
    "const rangeForLegacyPosition = (",
    '''const rangeForPhysicalSpan = (
  index: LineIndex,
  normalizedSource: string,
  physicalSpan: NonNullable<DslDiagnostic["physicalSpan"]>
): CompilerDiagnosticRange | null => {
  for (const segment of physicalSpan.segments) {
    const range = rangeForSegment(index, normalizedSource, segment);
    if (range) return range;
  }
  return null;
};

const rangeForLegacyPosition = (''',
    "related span helper"
)
text = replace_once(
    text,
    '''  if (!range) return null;

  return {
    severity: diagnostic.severity,''',
    '''  if (!range) return null;

  const relatedInformation = (diagnostic.relatedInformation ?? [])
    .map((related) => {
      const relatedRange = rangeForPhysicalSpan(index, normalizedSource, related.physicalSpan);
      return relatedRange ? { message: related.message, range: relatedRange } : null;
    })
    .filter((related): related is CompilerDiagnosticRelatedInformation => related !== null);

  return {
    severity: diagnostic.severity,''',
    "related projection"
)
text = replace_once(
    text,
    '''    range,
    ...(diagnostic.code === undefined ? {} : { code: diagnostic.code }),''',
    '''    range,
    ...(relatedInformation.length === 0 ? {} : { relatedInformation }),
    ...(diagnostic.code === undefined ? {} : { code: diagnostic.code }),''',
    "related return field"
)
write(path, text)

path = "vscode-extension/src/compilerDiagnostics.test.ts"
text = read(path)
insert = '''
  it("projects related ranges with CRLF/UTF-16 semantics and drops only invalid related entries", () => {
    const source = "nui 4\\r\\n😀required\\r\\n";
    const normalized = source.replace(/\\r\\n/g, "\\n");
    const from = normalized.indexOf("required");
    const projected = toCompilerDiagnostic(source, diagnostic({
      physicalSpan: { segments: [{ from: 0, to: 5 }], sourceRevision: 1 },
      exactSpanOnly: true,
      relatedInformation: [
        {
          message: "invalid cause",
          physicalSpan: { segments: [{ from: 999, to: 1000 }], sourceRevision: 1 }
        },
        {
          message: "valid cause",
          physicalSpan: {
            segments: [{ from, to: from + "required".length }],
            sourceRevision: 1
          }
        }
      ]
    }));

    expect(projected).not.toBeNull();
    expect(projected?.message).toBe("production message");
    expect(projected?.relatedInformation).toEqual([
      {
        message: "valid cause",
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 10 }
        }
      }
    ]);
  });
'''
closing = "\n});\n"
pos = text.rfind(closing)
if pos < 0:
    raise SystemExit("compilerDiagnostics.test describe close missing")
write(path, text[:pos] + insert + text[pos:])

path = "vscode-extension/src/extension.ts"
text = read(path)
text = replace_once(
    text,
    '''  type CompilerDiagnostic
} from "./compilerDiagnostics";''',
    '''  type CompilerDiagnostic,
  type CompilerDiagnosticRange
} from "./compilerDiagnostics";''',
    "extension diagnostic import"
)
start = text.find("const toVscodeDiagnostic = (")
end = text.find("\n\nconst webviewHtml", start)
if start < 0 or end < 0:
    raise SystemExit("extension diagnostic adapter block missing")
new_adapter = '''const toVscodeDiagnosticRange = (range: CompilerDiagnosticRange): vscode.Range =>
  new vscode.Range(
    new vscode.Position(range.start.line, range.start.character),
    new vscode.Position(range.end.line, range.end.character)
  );

const toVscodeDiagnostic = (
  document: vscode.TextDocument,
  diagnostic: CompilerDiagnostic
): vscode.Diagnostic => {
  const severity = diagnostic.severity === "error"
    ? vscode.DiagnosticSeverity.Error
    : vscode.DiagnosticSeverity.Warning;
  const result = new vscode.Diagnostic(
    toVscodeDiagnosticRange(diagnostic.range),
    diagnostic.message,
    severity
  );
  if (diagnostic.code !== undefined) result.code = diagnostic.code;
  result.source = diagnostic.source;
  if (diagnostic.relatedInformation && diagnostic.relatedInformation.length > 0) {
    result.relatedInformation = diagnostic.relatedInformation.map((related) =>
      new vscode.DiagnosticRelatedInformation(
        new vscode.Location(document.uri, toVscodeDiagnosticRange(related.range)),
        related.message
      )
    );
  }
  return result;
};'''
text = text[:start] + new_adapter + text[end:]
text = replace_once(
    text,
    "compilerDiagnosticCollection.set(document.uri, session.getDiagnostics().map(toVscodeDiagnostic));",
    "compilerDiagnosticCollection.set(document.uri, session.getDiagnostics().map((diagnostic) => toVscodeDiagnostic(document, diagnostic)));",
    "diagnostic publication"
)
write(path, text)

path = "vscode-extension/src/extension.test.ts"
text = read(path)
start = text.find("  class Diagnostic {")
end = text.find("  class CompletionItem {", start)
if start < 0 or end < 0:
    raise SystemExit("extension Diagnostic mock block missing")
new_mock = '''  class Diagnostic {
    code?: string | number;
    source?: string;
    relatedInformation?: unknown[];

    constructor(
      public readonly range: unknown,
      public readonly message: string,
      public readonly severity: number
    ) {}
  }
  class Location {
    constructor(public readonly uri: unknown, public readonly range: unknown) {}
  }
  class DiagnosticRelatedInformation {
    constructor(public readonly location: unknown, public readonly message: string) {}
  }
'''
text = text[:start] + new_mock + text[end:]
text = replace_once(
    text,
    '''    Diagnostic,
    CompletionItem,''',
    '''    Diagnostic,
    Location,
    DiagnosticRelatedInformation,
    CompletionItem,''',
    "extension mock exports"
)
marker = '''  it("registers and opens the Output Preview production surface", () => {
'''
test = '''  it("publishes Module diagnostic related information through the current document URI", () => {
    const source = [
      "nui 4",
      "module M(required: number) {",
      "}",
      "instance Use = M()"
    ].join("\\n");
    const document = documentFor("/tmp/related.nui", "file:///tmp/related.nui", source);
    setup(false, editorFor(document), [document]);

    const published = mocks.diagnosticCollections[0]!.set.mock.calls.at(-1)?.[1] as Array<{
      code?: string | number;
      relatedInformation?: Array<{
        message: string;
        location: { uri: unknown; range: { start: MockPosition; end: MockPosition } };
      }>;
    }>;
    const missing = published.find((item) => item.code === "module-missing-argument");

    expect(missing).toBeDefined();
    expect(missing?.relatedInformation).toHaveLength(1);
    expect(missing?.relatedInformation?.[0]).toMatchObject({
      location: {
        uri: document.uri,
        range: {
          start: { line: 1, character: 9 },
          end: { line: 1, character: 17 }
        }
      }
    });
    expect(missing?.relatedInformation?.[0]?.message).toEqual(expect.any(String));
  });

  it("registers and opens the Output Preview production surface", () => {
'''
text = replace_once(text, marker, test, "extension related information test")
write(path, text)
