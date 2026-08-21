from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one replacement target, found {count}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "vscode-extension/src/compilerDiagnostics.ts",
    '''export type CompilerDiagnosticRange = {
  start: CompilerDiagnosticPosition;
  end: CompilerDiagnosticPosition;
};

export type CompilerDiagnostic = {
  severity: DslDiagnostic["severity"];
  message: string;
  range: CompilerDiagnosticRange;
  code?: string;
  source: "nuinuiCAD";
};
''',
    '''export type CompilerDiagnosticRange = {
  start: CompilerDiagnosticPosition;
  end: CompilerDiagnosticPosition;
};

export type CompilerDiagnosticRelatedInformation = {
  message: string;
  range: CompilerDiagnosticRange;
};

export type CompilerDiagnostic = {
  severity: DslDiagnostic["severity"];
  message: string;
  range: CompilerDiagnosticRange;
  relatedInformation?: readonly CompilerDiagnosticRelatedInformation[];
  code?: string;
  source: "nuinuiCAD";
};
'''
)

replace_once(
    "vscode-extension/src/compilerDiagnostics.ts",
    '''const rangeForLegacyPosition = (
''',
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

const rangeForLegacyPosition = (
'''
)

replace_once(
    "vscode-extension/src/compilerDiagnostics.ts",
    '''  if (!range) range = rangeForLegacyPosition(index, diagnostic.line, diagnostic.column);
  if (!range) return null;

  return {
    severity: diagnostic.severity,
    message: diagnostic.message,
    range,
    ...(diagnostic.code === undefined ? {} : { code: diagnostic.code }),
    source: "nuinuiCAD"
  };
};
''',
    '''  if (!range) range = rangeForLegacyPosition(index, diagnostic.line, diagnostic.column);
  if (!range) return null;

  const relatedInformation = (diagnostic.relatedInformation ?? [])
    .map((related) => {
      const relatedRange = rangeForPhysicalSpan(index, normalizedSource, related.physicalSpan);
      return relatedRange ? { message: related.message, range: relatedRange } : null;
    })
    .filter((related): related is CompilerDiagnosticRelatedInformation => related !== null);

  return {
    severity: diagnostic.severity,
    message: diagnostic.message,
    range,
    ...(relatedInformation.length === 0 ? {} : { relatedInformation }),
    ...(diagnostic.code === undefined ? {} : { code: diagnostic.code }),
    source: "nuinuiCAD"
  };
};
'''
)

compiler_test = Path("vscode-extension/src/compilerDiagnostics.test.ts")
text = compiler_test.read_text()
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
    raise SystemExit("compilerDiagnostics.test.ts: describe close missing")
compiler_test.write_text(text[:pos] + insert + text[pos:])

replace_once(
    "vscode-extension/src/extension.ts",
    '''import {
  type CompilerDiagnostic
} from "./compilerDiagnostics";
''',
    '''import {
  type CompilerDiagnostic,
  type CompilerDiagnosticRange
} from "./compilerDiagnostics";
'''
)

replace_once(
    "vscode-extension/src/extension.ts",
    '''const toVscodeDiagnostic = (diagnostic: CompilerDiagnostic): vscode.Diagnostic => {
  const severity = diagnostic.severity === "error"
    ? vscode.DiagnosticSeverity.Error
    : vscode.DiagnosticSeverity.Warning;
  const result = new vscode.Diagnostic(
    new vscode.Range(
      new vscode.Position(diagnostic.range.start.line, diagnostic.range.start.character),
      new vscode.Position(diagnostic.range.end.line, diagnostic.range.end.character)
    ),
    diagnostic.message,
    severity
  );
  if (diagnostic.code !== undefined) result.code = diagnostic.code;
  result.source = diagnostic.source;
  return result;
};
''',
    '''const toVscodeDiagnosticRange = (range: CompilerDiagnosticRange): vscode.Range =>
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
};
'''
)

replace_once(
    "vscode-extension/src/extension.ts",
    "compilerDiagnosticCollection.set(document.uri, session.getDiagnostics().map(toVscodeDiagnostic));",
    "compilerDiagnosticCollection.set(document.uri, session.getDiagnostics().map((diagnostic) => toVscodeDiagnostic(document, diagnostic)));"
)

replace_once(
    "vscode-extension/src/extension.test.ts",
    '''  class Diagnostic {
    code?: string | number;
    source?: string;

    constructor(
      public readonly range: unknown,
      public readonly message: string,
      public readonly severity: number
    ) {}
  }
  class CompletionItem {
''',
    '''  class Diagnostic {
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
  class CompletionItem {
'''
)

replace_once(
    "vscode-extension/src/extension.test.ts",
    '''    Diagnostic,
    CompletionItem,
''',
    '''    Diagnostic,
    Location,
    DiagnosticRelatedInformation,
    CompletionItem,
'''
)

extension_test = Path("vscode-extension/src/extension.test.ts")
text = extension_test.read_text()
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
if text.count(marker) != 1:
    raise SystemExit(f"extension.test.ts: expected one insertion marker, found {text.count(marker)}")
extension_test.write_text(text.replace(marker, test, 1))
