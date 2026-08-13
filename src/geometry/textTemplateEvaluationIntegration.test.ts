// End-to-end coverage for Task 27: compileDslDocument -> the same entry
// builders AppLayout.tsx uses -> the same evaluateElements/
// canUseRustEvaluationForElements functions useEvaluationEngine.ts calls for
// production evaluation routing. Proves escaped braces, typed string holes,
// && the bare `@binding` text.text property all evaluate via the AST path
// once wired the way the live document wires them, && that such documents
// are kept off the (not-yet-typed-template-aware) Rust path.
import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { canUseRustEvaluationForElements } from "./evaluationEngine";
import { evaluateElements, type EvaluateElementsOptions } from "./evaluate";
import { buildPropertyBindingRuntimeEntries } from "./propertyBindingRuntime";
import { buildTextPropertyBindingRuntimeEntries, buildTextTemplateEntriesByElementId } from "./textTemplateRuntime";

/** Mirrors AppLayout.tsx's evaluationOptions memo exactly - the same entry
 * builders, the same conditional spreads - so this test exercises the real
 * production wiring shape, not a hand-rolled substitute. */
const productionEvaluationOptions = (compiled: ReturnType<typeof compileDslDocument>): EvaluateElementsOptions => {
  const elementIdByStatementIndex = compiled.statementMap?.elementIdByStatementIndex ?? new Map();
  const textTemplateEntriesByElementId = compiled.textTemplates
    ? buildTextTemplateEntriesByElementId({ textTemplates: compiled.textTemplates, elementIdByStatementIndex })
    : undefined;
  const propertyBindingEntries =
    compiled.scalarProgram && compiled.propertyBindings
      ? buildPropertyBindingRuntimeEntries(
          { propertyBindings: compiled.propertyBindings, elementIdByStatementIndex },
          compiled.document?.elements ?? []
        )
      : undefined;
  const textPropertyBindingEntries =
    compiled.scalarProgram && compiled.propertyBindings
      ? buildTextPropertyBindingRuntimeEntries(
          { propertyBindings: compiled.propertyBindings, elementIdByStatementIndex },
          compiled.document?.elements ?? []
        )
      : undefined;
  return {
    ...(compiled.scalarProgram ? { scalarProgram: compiled.scalarProgram } : {}),
    ...(propertyBindingEntries?.length ? { propertyBindingEntries } : {}),
    ...(textTemplateEntriesByElementId?.size ? { textTemplateEntriesByElementId } : {}),
    ...(textPropertyBindingEntries?.length ? { textPropertyBindingEntries } : {})
  };
};

const evaluateSource = (source: string, assignedStatementIds?: Map<number, string>) => {
  const compiled = compileDslDocument(source, assignedStatementIds ? { assignedStatementIds } : undefined);
  expect(compiled.diagnostics).toEqual([]);
  expect(compiled.document).not.toBeNull();
  const elements = compiled.document!.elements;
  const options = productionEvaluationOptions(compiled);
  // Element ids are auto-generated unless assignedStatementIds supplies one
  // for that statement - look the text element up by type/name instead of
  // guessing its id, mirroring how the app itself never assumes a fixed id.
  const textElementId = elements.find((element) => element.type === "text" && element.name === "T")?.id;
  return { compiled, elements, options, textElementId, result: evaluateElements(elements, options) };
};

describe("Task 27 production routing: compileDslDocument -> evaluateElements/canUseRustEvaluationForElements", () => {
  it("前身頃を2枚カット: a typed string hole evaluates via the AST path", () => {
    const { result, textElementId } = evaluateSource(
      ["nui 4", 'const ラベル: string = "前身頃"', 'text T = label(text: "${@ラベル}を2枚カット", anchor: none, size: 3)'].join("\n"),
      new Map([[1, "test:label"]])
    );
    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get(textElementId!)).toMatchObject({ kind: "text", text: "前身頃を2枚カット" });
  });

  it("nui 4 numeric interpolation: a typed number hole formats to max 3 decimals", () => {
    const { result, textElementId } = evaluateSource(
      ["nui 4", "const 寸法: number = 12.3456", 'text T = label(text: "寸法=${@寸法}mm", anchor: none, size: 3)'].join("\n"),
      new Map([[1, "test:size"]])
    );
    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get(textElementId!)).toMatchObject({ kind: "text", text: "寸法=12.346mm" });
  });

  it("escaped braces are literal, not holes, even though the cooked element.text would fool the old regex evaluator", () => {
    const { result, textElementId } = evaluateSource(["nui 4", 'text T = label(text: "cost \\{5\\} yen", anchor: none, size: 3)'].join("\n"));
    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get(textElementId!)).toMatchObject({ kind: "text", text: "cost {5} yen" });
  });

  it("\\n escape produces a real newline in the evaluated text", () => {
    const { result, textElementId } = evaluateSource(["nui 4", 'text T = label(text: "line1\\nline2", anchor: none, size: 3)'].join("\n"));
    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get(textElementId!)).toMatchObject({ kind: "text", text: "line1\nline2" });
  });

  it("poison: a hole referencing a binding whose initializer fails evaluates to a fail-closed error, no computed geometry", () => {
    const { result, textElementId } = evaluateSource(
      ["nui 4", "const 割り算: number = 1 / 0", 'text T = label(text: "${@割り算}", anchor: none, size: 3)'].join("\n"),
      new Map([[1, "test:divide"]])
    );
    expect(result.computedGeometry.get(textElementId!)).toBeUndefined();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].elementId).toBe(textElementId);
  });

  it("multi-hole order: the first failing hole in source order is the one reported", () => {
    const { result, textElementId } = evaluateSource(
      [
        "nui 4",
        "const 割り算: number = 1 / 0",
        "const 有効: number = 5",
        'text T = label(text: "first=${@割り算} second=${@有効}", anchor: none, size: 3)'
      ].join("\n"),
      new Map([
        [1, "test:divide"],
        [2, "test:valid"]
      ])
    );
    expect(result.computedGeometry.get(textElementId!)).toBeUndefined();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("評価できません");
  });

  it("bare @binding text.text materializes the bound string, evaluated through the (holeless) AST path", () => {
    const { result, textElementId } = evaluateSource(
      ["nui 4", 'const ラベル: string = "前身頃"', "text T = label(text: @ラベル, anchor: none, size: 3)"].join("\n"),
      new Map([[1, "test:label"]])
    );
    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get(textElementId!)).toMatchObject({ kind: "text", text: "前身頃" });
  });

  it("evaluates the declarations/templates fixture while retaining typed template dependencies", () => {
    const { compiled, elements, options, result } = evaluateSource([
      "nui 4",
      "const length: number = 12.3456",
      'const label: string = "前身頃"',
      "const printed: boolean = true",
      "const side: choice(right, left) = left",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: @length, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      'text Label = label(text: "\\{draft\\} ${@label} ${@length}\\n", anchor: none, size: 3)',
      "text Bare = label(text: @label, anchor: none, size: 3)"
    ].join("\n"), new Map([
      [1, "fixture:length"],
      [2, "fixture:label"],
      [3, "fixture:printed"],
      [4, "fixture:side"]
    ]));
    const label = elements.find((element) => element.type === "text" && element.name === "Label")!;
    const bare = elements.find((element) => element.type === "text" && element.name === "Bare")!;
    const templateEdges = compiled.typedDependencyGraph?.edges.filter((edge) =>
      edge.kind === "template-hole" && edge.from.kind === "element" && edge.from.id === label.id
    ) ?? [];
    const templateBindingNames = templateEdges.map((edge) => {
      if (edge.to.kind !== "binding") {
        throw new Error(`Expected template dependency to target a binding, received ${edge.to.kind}.`);
      }
      return edge.to.name;
    });

    expect(result.errors.filter((error) => error.elementId === label.id || error.elementId === bare.id)).toEqual([]);
    expect(result.computedGeometry.get(label.id)).toMatchObject({ kind: "text", text: "{draft} 前身頃 12.346\n" });
    expect(result.computedGeometry.get(bare.id)).toMatchObject({ kind: "text", text: "前身頃" });
    expect(templateBindingNames.sort()).toEqual(["label", "length"]);
    expect(canUseRustEvaluationForElements(elements, options)).toBe(true);
  });

  it("makes a nui 4 document with a typed text hole Rust-eligible", () => {
    const { elements, options } = evaluateSource(
      ["nui 4", 'const ラベル: string = "前身頃"', 'text T = label(text: "${@ラベル}を2枚カット", anchor: none, size: 3)'].join("\n"),
      new Map([[1, "test:label"]])
    );
    expect(canUseRustEvaluationForElements(elements, options)).toBe(true);
  });

  it("makes a nui 4 document with a bare @binding text.text property Rust-eligible", () => {
    const { elements, options } = evaluateSource(
      ["nui 4", 'const ラベル: string = "前身頃"', "text T = label(text: @ラベル, anchor: none, size: 3)"].join("\n"),
      new Map([[1, "test:label"]])
    );
    expect(canUseRustEvaluationForElements(elements, options)).toBe(true);
  });

  it("makes literal-only nui 4 text Rust-eligible without a scalar program", () => {
    const { elements, options } = evaluateSource(["nui 4", 'text T = label(text: "plain text", anchor: none, size: 3)'].join("\n"));
    expect(options.scalarProgram).toBeUndefined();
    expect(canUseRustEvaluationForElements(elements, options)).toBe(true);
  });
});
