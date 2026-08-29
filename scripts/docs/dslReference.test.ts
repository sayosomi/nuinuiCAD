import { describe, expect, it } from "vitest";
import {
  REFERENCE_DOCUMENTS,
  applyGeneratedRegions,
  buildDslReferenceFacts,
  checkDslReference,
  extractNuiExamples,
  generatedRegionsFor,
  readReferenceDocuments,
  renderBuiltinRegion,
  renderConstructionRegion,
  renderStatementRegion,
  validateDslExamples,
} from "./dslReference";

const messages = (issues: readonly { message: string }[]) => issues.map((issue) => issue.message);

describe("English DSL reference generator", () => {
  it("renders deterministic regions from the semantic authorities", () => {
    const firstFacts = buildDslReferenceFacts();
    const secondFacts = buildDslReferenceFacts();

    expect(firstFacts).toEqual(secondFacts);
    expect(renderConstructionRegion(firstFacts)).toBe(renderConstructionRegion(secondFacts));
    expect(renderStatementRegion(firstFacts)).toBe(renderStatementRegion(secondFacts));
    expect(renderBuiltinRegion(firstFacts)).toBe(renderBuiltinRegion(secondFacts));
  });

  it("applies generated regions without mutating the input documents", () => {
    const facts = buildDslReferenceFacts();
    const documents = readReferenceDocuments();
    const before = new Map(documents);
    const generated = applyGeneratedRegions(documents, facts);

    expect(new Map(documents)).toEqual(before);
    expect(checkDslReference(generated, facts)).toEqual([]);
  });

  it("preserves human-authored prose outside generated regions", () => {
    const facts = buildDslReferenceFacts();
    const documents = new Map(readReferenceDocuments());
    const path = "docs/dsl/en/constructions.md";
    const source = documents.get(path)!;
    documents.set(path, source.replace("## Points", "## Points\n\nHuman-authored note: keep this sentence."));

    const generated = applyGeneratedRegions(documents, facts);

    expect(generated.get(path)).toContain("Human-authored note: keep this sentence.");
    expect(checkDslReference(generated, facts)).toEqual([]);
  });

  it("detects generated-region drift without writing", () => {
    const facts = buildDslReferenceFacts();
    const documents = new Map(readReferenceDocuments());
    const original = documents.get("docs/dsl/en/builtins.md")!;
    documents.set("docs/dsl/en/builtins.md", original.replace("| `abs` |", "| `changed` |"));

    const issues = checkDslReference(documents, facts);

    expect(messages(issues)).toContain("generated region builtins is stale or has drifted.");
    expect(documents.get("docs/dsl/en/builtins.md")).toBe(original.replace("| `abs` |", "| `changed` |"));
  });

  it("detects missing, stale, duplicate, and unknown reference IDs", () => {
    const facts = buildDslReferenceFacts();
    const documents = new Map(readReferenceDocuments());
    const constructionsPath = "docs/dsl/en/constructions.md";
    const builtinsPath = "docs/dsl/en/builtins.md";
    const syntaxPath = "docs/dsl/en/syntax.md";
    documents.set(
      constructionsPath,
      documents.get(constructionsPath)!.replace("<!-- dsl-ref:construction:point/coordinate -->\n", ""),
    );
    documents.set(
      builtinsPath,
      documents.get(builtinsPath)!.replace("<!-- dsl-ref:builtin:abs -->", "<!-- dsl-ref:builtin:removed -->"),
    );
    documents.set(
      syntaxPath,
      `${documents.get(syntaxPath)}\n<!-- dsl-ref:statement:module -->\n<!-- dsl-ref:statement:unknown -->\n`,
    );

    const issues = checkDslReference(documents, facts);
    const issueText = messages(issues);

    expect(issueText.some((message) => message.includes("missing DSL reference ID dsl-ref:construction:point/coordinate"))).toBe(true);
    expect(issueText.some((message) => message.includes("missing DSL reference ID dsl-ref:builtin:abs"))).toBe(true);
    expect(issueText.some((message) => message.includes("stale or unknown DSL reference ID dsl-ref:builtin:removed"))).toBe(true);
    expect(issueText.some((message) => message.includes("duplicate DSL reference ID dsl-ref:statement:module"))).toBe(true);
    expect(issueText.some((message) => message.includes("stale or unknown DSL reference ID dsl-ref:statement:unknown"))).toBe(true);
  });

  it("keeps the generated document set explicit", () => {
    expect([...generatedRegionsFor(buildDslReferenceFacts()).keys()]).toEqual([
      "docs/dsl/en/constructions.md",
      "docs/dsl/en/syntax.md",
      "docs/dsl/en/builtins.md",
    ]);
    expect(REFERENCE_DOCUMENTS).toHaveLength(12);
  });
});

describe("English DSL reference examples", () => {
  it("classifies only the supported fence metadata", () => {
    const source = [
      "<!-- dsl-example: compile-success -->",
      "```nui",
      "nui 4",
      "```",
      "<!-- dsl-example: expected-diagnostic code=missing-declared-type -->",
      "```nui",
      "nui 4",
      "const x = 1",
      "```",
      "<!-- dsl-example: syntax-fragment -->",
      "```nui",
      "point Name = construction(...)",
      "```",
      "```nui",
      "nui 4",
      "```",
    ].join("\n");

    const examples = extractNuiExamples("fixture.md", source);

    expect(examples.map((example) => example.classification)).toEqual([
      { kind: "compile-success" },
      { kind: "expected-diagnostic", code: "missing-declared-type" },
      { kind: "syntax-fragment" },
      null,
    ]);
  });

  it("validates compile-success, expected-diagnostic, and syntax-fragment examples", () => {
    const source = [
      "<!-- dsl-example: compile-success -->",
      "```nui",
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "```",
      "<!-- dsl-example: expected-diagnostic code=missing-declared-type -->",
      "```nui",
      "nui 4",
      "const x = 1",
      "```",
      "<!-- dsl-example: syntax-fragment -->",
      "```nui",
      "point Name = construction(...) ",
      "```",
    ].join("\n");

    expect(validateDslExamples(extractNuiExamples("fixture.md", source))).toEqual([]);
  });

  it("rejects an unclassified fence and a failed compile-success example", () => {
    const examples = extractNuiExamples("fixture.md", [
      "```nui",
      "nui 4",
      "```",
      "<!-- dsl-example: compile-success -->",
      "```nui",
      "nui 4",
      "const x = 1",
      "```",
    ].join("\n"));

    const issueText = messages(validateDslExamples(examples));

    expect(issueText.some((message) => message.includes("missing a valid dsl-example classification"))).toBe(true);
    expect(issueText.some((message) => message.includes("compile-success example has errors"))).toBe(true);
  });
});
