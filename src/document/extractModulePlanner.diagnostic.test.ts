import { describe, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import {
  createDslSemanticOccurrenceIndex,
  dslSemanticIdentityKey
} from "../dsl/dslSemanticOccurrenceIndex";
import { parseDslSnapshot } from "../dsl/dslParser";
import { planExtractModule } from "./extractModulePlanner";

const REVISION = 73;

const compile = (source: string, ids?: ReadonlyMap<number, string>) => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: REVISION });
  const assigned = ids ?? new Map(parsed.statements.map((_, index) => [index, `extract:${index}`]));
  return compileDslDocument(source, {
    preparsed: parsed,
    sourceRevision: REVISION,
    assignedElementIds: assigned,
    assignedStatementIds: assigned
  });
};

const diagnose = (source: string, selectedIndexes: readonly number[]) => {
  const compiled = compile(source);
  const statementIds = selectedIndexes.map((index) => {
    const id = compiled.statementMap?.statementIdByStatementIndex?.get(index);
    if (!id) throw new Error(`missing statement id ${index}`);
    return id;
  });
  return planExtractModule({
    source: { normalizedSource: source, sourceRevision: REVISION },
    compiled,
    statementIds,
    moduleName: "Extracted",
    instanceName: "Part"
  });
};

const occurrencesForStatement = (source: string, compiled: ReturnType<typeof compile>, statementIndex: number) => {
  const statement = compiled.statements[statementIndex];
  if (!statement) return [];
  return createDslSemanticOccurrenceIndex(compiled).occurrences
    .filter((occurrence) => occurrence.kind === "reference" && occurrence.from >= statement.documentRange.from && occurrence.to <= statement.documentRange.to)
    .map((occurrence) => ({
      text: source.slice(occurrence.from, occurrence.to),
      key: dslSemanticIdentityKey(occurrence.identity),
      identity: occurrence.identity
    }));
};

describe("extract module remaining rejection diagnostics", () => {
  it("prints owner and dependency details", () => {
    const scalarSource = [
      "nui 4",
      "const width: number = 10",
      "const height: number = 20",
      "const inside: number = @height + @width",
      "const after: number = @inside * 2"
    ].join("\n");
    const scalar = diagnose(scalarSource, [3]);

    const scalarCandidate = [
      "nui 4",
      "const width: number = 10",
      "const height: number = 20",
      "module Extracted(width: number, height: number) {",
      "  export const inside: number = @height + @width",
      "}",
      "instance Part = Extracted(width: @width, height: @height)",
      "const after: number = @Part::inside * 2"
    ].join("\n");
    const candidateIds = new Map<number, string>([
      [0, "extract:0"],
      [1, "extract:1"],
      [2, "extract:2"],
      [3, "generated:module"],
      [4, "extract:3"],
      [5, "generated:end"],
      [6, "generated:instance"],
      [7, "extract:4"]
    ]);
    const scalarCompiled = compile(scalarCandidate, candidateIds);

    const geometrySource = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "curve Shape = bezier(start: @A, end: @B)",
      "point FromPoint = offset(from: @A, dx: 1, dy: 2)",
      "point FromLine = onLine(from: @Base, distance: 1)",
      "point FromPath = bezierExtremePoint(source: @Shape, direction: 0)"
    ].join("\n");
    const geometryCompiled = compile(geometrySource);
    const geometry = diagnose(geometrySource, [5, 6, 7]);

    throw new Error(JSON.stringify({
      scalar,
      scalarCandidateDiagnostics: scalarCompiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
      scalarOldRefs: occurrencesForStatement(scalarSource, compile(scalarSource), 4),
      scalarNewRefs: occurrencesForStatement(scalarCandidate, scalarCompiled, 7),
      geometry,
      geometrySelectedRefs: [5, 6, 7].flatMap((index) => occurrencesForStatement(geometrySource, geometryCompiled, index))
    }));
  });
});
