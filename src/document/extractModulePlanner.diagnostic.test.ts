import { describe, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { planExtractModule } from "./extractModulePlanner";

const REVISION = 73;

describe("extract module planner diagnostic", () => {
  it("prints the simple scalar rejection", () => {
    const source = [
      "nui 4",
      "const width: number = 10",
      "const height: number = 20",
      "const inside: number = @height + @width",
      "const after: number = @inside * 2"
    ].join("\n");
    const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: REVISION });
    const ids = new Map(parsed.statements.map((_, index) => [index, `extract:${index}`]));
    const compiled = compileDslDocument(source, {
      preparsed: parsed,
      sourceRevision: REVISION,
      assignedElementIds: ids,
      assignedStatementIds: ids
    });
    const statementId = compiled.statementMap?.statementIdByStatementIndex?.get(3);
    if (!statementId) throw new Error("missing statement id");
    const result = planExtractModule({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      statementIds: [statementId],
      moduleName: "Extracted",
      instanceName: "Part"
    });
    if (result.status === "rejected") throw new Error(JSON.stringify(result));
  });
});
