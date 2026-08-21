import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { AutomationDocument } from "../../src/document/automationDocument";
import type { DslDiagnostic, DslDiagnosticRelatedInformation, DslStatement } from "../../src/dsl/dslTypes";
import type { DslPhysicalSpan } from "../../src/dsl/logicalStatementSourceMap";
import type { CadElement } from "../../src/types/geometry";

export type SourcePositionDto = {
  offset: number;
  line: number;
  column: number;
};

export type SourceRangeSegmentDto = {
  from: SourcePositionDto;
  to: SourcePositionDto;
};

export type SourceRangeDto = {
  sourceRevision: number;
  segments: SourceRangeSegmentDto[];
};

export type DiagnosticDto = Omit<DslDiagnostic, "sourceRevision" | "relatedInformation"> & {
  sourceRevision: number;
  range?: SourceRangeDto;
  relatedInformation?: Array<DslDiagnosticRelatedInformation & {
    range: SourceRangeDto;
  }>;
};

export type DeclarationSummaryDto = {
  kind: DslStatement["kind"];
  name: string | null;
  from: number;
  to: number;
  line: number;
  endLine: number;
  elementType?: string | null;
  category?: string;
  construction?: string;
  bindingKind?: "const" | "let";
  moduleName?: string;
};

export type ElementSummaryDto = Pick<CadElement, "id" | "name" | "type" | "activity"> & {
  parentGroupId?: string;
};

export type DocumentInspectDto = {
  path: string;
  sourceIdentity: {
    algorithm: "sha256";
    hash: string;
    byteLength: number;
    normalizedLength: number;
  };
  lifecycle: {
    sourceRevision: number;
    automationRevision: number;
    automationCompiledRevision: number;
    currentCompiledSourceRevision: number;
  };
  compileStatus: "valid" | "warning" | "fatal";
  currentSemantics: {
    available: boolean;
    sourceRevision: number | null;
  };
  diagnostics: {
    compile: DiagnosticDto[];
    binding: DiagnosticDto[];
  };
  summary: {
    declarations: DeclarationSummaryDto[];
    elements: ElementSummaryDto[];
  };
};

const normalizedSourceFor = (sourceText: string): string => sourceText.replace(/\r\n/g, "\n");

const lineStartsFor = (source: string): number[] => {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  return starts;
};

const positionAt = (
  lineStarts: readonly number[],
  sourceLength: number,
  offset: number
): SourcePositionDto => {
  const bounded = Math.max(0, Math.min(offset, sourceLength));
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle]! <= bounded) low = middle + 1;
    else high = middle - 1;
  }
  const lineIndex = Math.max(0, high);
  const lineStart = lineStarts[lineIndex] ?? 0;
  return {
    offset: bounded,
    line: lineIndex + 1,
    column: bounded - lineStart + 1
  };
};

const rangeDto = (
  span: DslPhysicalSpan,
  normalizedSource: string,
  lineStarts: readonly number[]
): SourceRangeDto => ({
  sourceRevision: span.sourceRevision,
  segments: span.segments.map((segment) => ({
    from: positionAt(lineStarts, normalizedSource.length, segment.from),
    to: positionAt(lineStarts, normalizedSource.length, segment.to)
  }))
});

const diagnosticDto = (
  diagnostic: DslDiagnostic,
  currentSourceRevision: number,
  normalizedSource: string,
  lineStarts: readonly number[]
): DiagnosticDto => {
  const { relatedInformation, sourceRevision, ...rest } = diagnostic;
  return {
    ...rest,
    sourceRevision: sourceRevision ?? currentSourceRevision,
    ...(diagnostic.physicalSpan
      ? { range: rangeDto(diagnostic.physicalSpan, normalizedSource, lineStarts) }
      : {}),
    ...(relatedInformation
      ? {
          relatedInformation: relatedInformation.map((related) => ({
            ...related,
            range: rangeDto(related.physicalSpan, normalizedSource, lineStarts)
          }))
        }
      : {})
  };
};

const declarationSummary = (statement: DslStatement): DeclarationSummaryDto | null => {
  if (["version", "set", "atStop", "activeView", "place", "modifierProfileBlock", "modifierProperty", "blockEnd", "blockElse"].includes(statement.kind)) {
    return null;
  }

  const base: DeclarationSummaryDto = {
    kind: statement.kind,
    name: statement.name || null,
    from: statement.documentRange.from,
    to: statement.documentRange.to,
    line: statement.line,
    endLine: statement.endLine
  };

  if (statement.kind === "element") {
    return {
      ...base,
      elementType: statement.type,
      category: statement.category,
      construction: statement.construction
    };
  }
  if (statement.kind === "typedDeclaration") {
    return { ...base, bindingKind: statement.bindingKind };
  }
  if (statement.kind === "moduleInstance") {
    return { ...base, moduleName: statement.moduleName };
  }
  return base;
};

const elementSummary = (element: CadElement): ElementSummaryDto => ({
  id: element.id,
  name: element.name,
  type: element.type,
  activity: element.activity,
  ...(element.parentGroupId ? { parentGroupId: element.parentGroupId } : {})
});

export class DocumentInspectInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentInspectInputError";
  }
}

export const inspectNuiDocument = async (requestedPath: string): Promise<DocumentInspectDto> => {
  if (!path.isAbsolute(requestedPath)) {
    throw new DocumentInspectInputError("document_inspect requires an absolute .nui path.");
  }
  if (path.extname(requestedPath).toLowerCase() !== ".nui") {
    throw new DocumentInspectInputError("document_inspect accepts only .nui files.");
  }

  let canonicalPath: string;
  try {
    canonicalPath = await realpath(requestedPath);
  } catch {
    throw new DocumentInspectInputError(`Document does not exist: ${requestedPath}`);
  }

  const fileStat = await stat(canonicalPath);
  if (!fileStat.isFile()) {
    throw new DocumentInspectInputError(`Document is not a file: ${requestedPath}`);
  }

  const bytes = await readFile(canonicalPath);
  const sourceText = bytes.toString("utf8");
  const normalizedSource = normalizedSourceFor(sourceText);
  const sourceHash = createHash("sha256").update(bytes).digest("hex");
  const document = AutomationDocument.fromSource(sourceText);
  const state = document.getState();
  const currentCompiled = state.currentCompiled;
  const currentSourceRevision = currentCompiled.spans.sourceMap.sourceRevision;
  const lineStarts = lineStartsFor(normalizedSource);
  const currentSemanticsAvailable =
    state.status !== "fatal" &&
    currentCompiled.document !== null &&
    currentCompiled.statementMap !== null;

  const declarations = currentCompiled.statements
    .map(declarationSummary)
    .filter((item): item is DeclarationSummaryDto => item !== null);

  return {
    path: canonicalPath,
    sourceIdentity: {
      algorithm: "sha256",
      hash: sourceHash,
      byteLength: bytes.byteLength,
      normalizedLength: normalizedSource.length
    },
    lifecycle: {
      sourceRevision: currentSourceRevision,
      automationRevision: state.revision,
      automationCompiledRevision: state.compiledRevision,
      currentCompiledSourceRevision: currentCompiled.spans.sourceMap.sourceRevision
    },
    compileStatus: state.status,
    currentSemantics: {
      available: currentSemanticsAvailable,
      sourceRevision: currentSemanticsAvailable
        ? currentCompiled.statementMap!.sourceRevision
        : null
    },
    diagnostics: {
      compile: currentCompiled.diagnostics.map((diagnostic) =>
        diagnosticDto(diagnostic, currentSourceRevision, normalizedSource, lineStarts)
      ),
      binding: (currentCompiled.bindingIssueDiagnostics ?? []).map((diagnostic) =>
        diagnosticDto(diagnostic, currentSourceRevision, normalizedSource, lineStarts)
      )
    },
    summary: {
      declarations,
      elements: currentSemanticsAvailable
        ? currentCompiled.document!.elements.map(elementSummary)
        : []
    }
  };
};
