import { buildRustEvaluationInput } from "../../../src/geometry/rustEvaluationInput";
import { fixtureFromSource, isRustEligibleFixture, optionsFor } from "../../evaluationParitySupport";

const lines = ["nui 1"];
for (let index = 0; index < 150; index += 1) {
  lines.push(
    `point Base${index} = coordinate(x: ${index}, y: 4)`,
    `const Alias${index}: point = @Base${index}`,
    `point Use${index} = from(source: @Alias${index})`,
  );
}
const fixture = fixtureFromSource(lines.join("\n"));
const errors = fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
if (!errors || errors.length || !isRustEligibleFixture(fixture)) {
  throw new Error(`Invalid readiness benchmark input: ${JSON.stringify(errors)}`);
}
process.stdout.write(JSON.stringify(buildRustEvaluationInput(fixture.elements, optionsFor(fixture))));
