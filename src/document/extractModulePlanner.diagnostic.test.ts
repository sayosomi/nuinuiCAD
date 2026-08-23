import { describe, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { planExtractModule } from "./extractModulePlanner";

const REVISION = 73;

const diagnose = (source: string, selectedIndexes: readonly number[]) => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: REVISION });
  const ids = new Map(parsed.statements.map((_, index) => [index, `extract:${index}`]));
  const compiled = compileDslDocument(source, {
    preparsed: parsed,
    sourceRevision: REVISION,
    assignedElementIds: ids,
    assignedStatementIds: ids
  });
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

describe("extract module remaining rejection diagnostics", () => {
  it("prints the three remaining happy-path rejection results", () => {
    const scalar = diagnose([
      "nui 4",
      "const width: number = 10",
      "const height: number = 20",
      "const inside: number = @height + @width",
      "const after: number = @inside * 2"
    ].join("\n"), [3]);
    const geometry = diagnose([
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "curve Shape = bezier(start: @A, end: @B)",
      "point FromPoint = offset(from: @A, dx: 1, dy: 2)",
      "point FromLine = onLine(from: @Base, distance: 1)",
      "point FromPath = bezierExtremePoint(source: @Shape, direction: 0)"
    ].join("\n"), [5, 6, 7]);
    const group = diagnose([
      "nui 4",
      "const width: number = 10",
      "group G {",
      "  const inside: number = @width + 1",
      "}",
      "const after: number = 0"
    ].join("\n"), [2]);
    throw new Error(JSON.stringify({ scalar, geometry, group }));
  });
});
