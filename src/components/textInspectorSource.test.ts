import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { parseDsl } from "../dsl/dslParser";
import { textInspectorPresentation, textInspectorSource } from "./textInspectorSource";

const compileFor = (source: string) => {
  const statements = parseDsl(source).statements;
  const assignedStatementIds = new Map(statements.map((_, index) => [index, `stable-${index}`]));
  return compileDslDocument(source, { assignedStatementIds });
};

describe("textInspectorSource", () => {
  it("uses the compiled raw template text without adding escape characters", () => {
    const source = [
      "nui 3",
      "const label: string = \"front\"",
      "const length: number = 10",
      'text Label = label(text: "\\{draft\\} {@label} {@length}\\n", anchor: none, size: 3)',
    ].join("\n");
    const compiled = compileFor(source);
    if (!compiled.document || !compiled.statementMap) throw new Error("Expected a valid document");
    const element = compiled.document.elements.find((candidate) => candidate.type === "text");
    if (!element || element.type !== "text") throw new Error("Expected a text element");

    expect(textInspectorSource({
      element,
      textTemplates: compiled.textTemplates,
      statementMap: compiled.statementMap,
    })).toBe("\\{draft\\} {@label} {@length}\\n");
  });

  it("uses the fresh runtime payload only when it differs from source exactly", () => {
    const source = [
      "nui 3",
      "const label: string = \"front\"",
      'text Label = label(text: "\\{draft\\} {@label}\\n", anchor: none, size: 3)',
    ].join("\n");
    const compiled = compileFor(source);
    if (!compiled.document || !compiled.statementMap) throw new Error("Expected a valid document");
    const element = compiled.document.elements.find((candidate) => candidate.type === "text");
    if (!element || element.type !== "text") throw new Error("Expected a text element");
    const evaluation = {
      computedGeometry: new Map([[element.id, {
        kind: "text" as const, elementId: element.id, name: element.name,
        text: "{draft} 前身頃\\n", anchor: null, fontSize: 3,
      }]]),
      errors: [], warnings: [],
    };

    expect(textInspectorPresentation({
      element, textTemplates: compiled.textTemplates, statementMap: compiled.statementMap,
      evaluation, isRuntimeFresh: true,
    })).toEqual({ source: "\\{draft\\} {@label}\\n", evaluatedText: "{draft} 前身頃\\n" });
    expect(textInspectorPresentation({
      element, textTemplates: compiled.textTemplates, statementMap: compiled.statementMap,
      evaluation, isRuntimeFresh: false,
    }).evaluatedText).toBeNull();
    expect(textInspectorPresentation({
      element, textTemplates: compiled.textTemplates, statementMap: compiled.statementMap,
      evaluation: { ...evaluation, computedGeometry: new Map(), errors: [{
        elementId: element.id, elementName: element.name, missingDependencyId: element.id,
        message: "テキストを評価できません。",
      }] },
      isRuntimeFresh: true,
    }).evaluatedText).toBeNull();
  });

  it("does not create a duplicate result for an exactly matching literal", () => {
    const source = ["nui 3", 'text Label = label(text: "前身頃", anchor: none, size: 3)'].join("\n");
    const compiled = compileDslDocument(source);
    if (!compiled.document || !compiled.statementMap) throw new Error("Expected a valid document");
    const element = compiled.document.elements.find((candidate) => candidate.type === "text");
    if (!element || element.type !== "text") throw new Error("Expected a text element");
    const presentation = textInspectorPresentation({
      element, textTemplates: compiled.textTemplates, statementMap: compiled.statementMap,
      evaluation: {
        computedGeometry: new Map([[element.id, {
          kind: "text", elementId: element.id, name: element.name, text: "前身頃", anchor: null, fontSize: 3,
        }]]),
        errors: [], warnings: [],
      },
      isRuntimeFresh: true,
    });

    expect(presentation.source).toBe(presentation.evaluatedText);
  });

  it("keeps the existing model value when no template AST is available", () => {
    const source = ["nui 3", 'text Label = label(text: "plain text", anchor: none, size: 3)'].join("\n");
    const compiled = compileDslDocument(source);
    if (!compiled.document || !compiled.statementMap) throw new Error("Expected a valid document");
    const element = compiled.document.elements.find((candidate) => candidate.type === "text");
    if (!element || element.type !== "text") throw new Error("Expected a text element");

    expect(textInspectorSource({
      element,
      textTemplates: undefined,
      statementMap: compiled.statementMap,
    })).toBe("plain text");
  });
});
