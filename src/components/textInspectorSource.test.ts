import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { textInspectorPresentation, textInspectorSource } from "./textInspectorSource";

describe("textInspectorSource", () => {
  it("uses the compiled raw template text without adding escape characters", () => {
    const source = [
      "nui 3",
      'text Label = label(text: "\\{draft\\} {@label} {@length}\\n" anchor: none size: 3)',
    ].join("\n");
    const compiled = compileDslDocument(source);
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
      'text Label = label(text: "\\{draft\\} {@label}\\n" anchor: none size: 3)',
    ].join("\n");
    const compiled = compileDslDocument(source);
    if (!compiled.document || !compiled.statementMap) throw new Error("Expected a valid document");
    const element = compiled.document.elements.find((candidate) => candidate.type === "text");
    if (!element || element.type !== "text") throw new Error("Expected a text element");
    const evaluation = {
      computedGeometry: new Map([[element.id, {
        kind: "text" as const, elementId: element.id, name: element.name,
        text: "{draft} 前身頃\\n", anchor: null, fontSize: 3,
      }]]),
      computedVariables: new Map(), errors: [], warnings: [],
    };

    expect(textInspectorPresentation({
      element, textTemplates: compiled.textTemplates, statementMap: compiled.statementMap,
      evaluation, isRuntimeFresh: true,
    })).toEqual({ source: "\\{draft\\} {@label}\\n", evaluatedText: "{draft} 前身頃\\n" });
    expect(textInspectorPresentation({
      element, textTemplates: compiled.textTemplates, statementMap: compiled.statementMap,
      evaluation, isRuntimeFresh: false,
    }).evaluatedText).toBeNull();
  });

  it("does not create a duplicate result for an exactly matching literal", () => {
    const source = ["nui 3", 'text Label = label(text: "前身頃" anchor: none size: 3)'].join("\n");
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
        computedVariables: new Map(), errors: [], warnings: [],
      },
      isRuntimeFresh: true,
    });

    expect(presentation.source).toBe(presentation.evaluatedText);
  });

  it("keeps the existing model value when no template AST is available", () => {
    const source = ["nui 2", 'text Label = label(text: "plain text" anchor: none size: 3)'].join("\n");
    const compiled = compileDslDocument(source);
    if (!compiled.document || !compiled.statementMap) throw new Error("Expected a valid document");
    const element = compiled.document.elements.find((candidate) => candidate.type === "text");
    if (!element || element.type !== "text") throw new Error("Expected a text element");

    expect(textInspectorSource({
      element,
      textTemplates: compiled.textTemplates,
      statementMap: compiled.statementMap,
    })).toBe("plain text");
  });
});
