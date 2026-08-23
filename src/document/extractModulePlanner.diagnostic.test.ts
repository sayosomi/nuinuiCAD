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

describe("extract module checkpoint 1 rejection diagnostics", () => {
  it("prints the remaining scalar-first rejection reasons", () => {
    const numericSource = [
      "nui 4",
      "const stepper: number(step: 0.5, min: 0, max: 10) = 2",
      "const inside: number = @stepper + 1"
    ].join("\n");
    const commentsSource = [
      "nui 4",
      "const width: number = 10",
      "const first: number = @width + 1",
      "// keep between selected statements",
      "",
      "const second: number = @first + 1"
    ].join("\n");

    throw new Error(JSON.stringify({
      numeric: diagnose(numericSource, [2]),
      comments: diagnose(commentsSource, [2, 3])
    }));
  });
});
