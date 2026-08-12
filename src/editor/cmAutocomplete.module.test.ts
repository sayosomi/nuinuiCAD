import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { createDslCompletionSource } from "./cmAutocomplete";
import type { ModuleCompletionSite } from "../dsl/moduleCompletionCandidates";

const compileWithIds = (source: string) => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 0 });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `statement:test:${index}`]))
  });
};

const completionFor = async (source: string, cursor: number, fresh = true, mappedStatementIndex?: number) => {
  const compiled = compileWithIds(source);
  const state = EditorState.create({ doc: source, selection: { anchor: cursor } });
  const sourceFn = createDslCompletionSource({
    elements: () => compiled.document?.elements ?? [],
    statementRanges: () => new Map(), printLayouts: () => [], printLayoutRanges: () => new Map(),
    isComposing: () => false, computedGeometry: () => undefined,
    effectiveEnabledElementIds: () => undefined, evaluationErrors: () => undefined,
    bindingAnalysis: () => compiled.bindingAnalysis,
    typedDeclarationRanges: () => new Map(), scopeBodyRanges: () => [], statementInfoByElementId: () => undefined,
    moduleSemanticMetadata: () => compiled, semanticMetadataFresh: () => fresh,
    moduleCompletionStatementIndexAt: () => mappedStatementIndex ?? null
  });
  return sourceFn({ state, pos: cursor, explicit: true } as never);
};

const completionForWithLastGoodMetadata = async (
  liveSource: string,
  lastGoodSource: string,
  cursor: number,
  site: ModuleCompletionSite | null
) => {
  const compiled = compileWithIds(lastGoodSource);
  const state = EditorState.create({ doc: liveSource, selection: { anchor: cursor } });
  const sourceFn = createDslCompletionSource({
    elements: () => compiled.document?.elements ?? [],
    statementRanges: () => new Map(), printLayouts: () => [], printLayoutRanges: () => new Map(),
    isComposing: () => false, computedGeometry: () => undefined,
    effectiveEnabledElementIds: () => undefined, evaluationErrors: () => undefined,
    bindingAnalysis: () => compiled.bindingAnalysis,
    typedDeclarationRanges: () => new Map(), scopeBodyRanges: () => [], statementInfoByElementId: () => undefined,
    moduleSemanticMetadata: () => compiled, semanticMetadataFresh: () => false,
    moduleCompletionSiteAt: () => site
  });
  return sourceFn({ state, pos: cursor, explicit: true } as never);
};

describe("module completion through the existing CodeMirror pipeline", () => {
  it("keeps generic module keyword completion available", async () => {
    const result = await completionFor("mod", 3);
    expect(result?.options.map((option) => option.label)).toContain("module");
  });

  it("offers only source-order visible module callees and excludes forward definitions", async () => {
    const source = ["nui 3", "module First() {", "}", "module Use = F", "module Forward() {", "}"].join("\n");
    const result = await completionFor(source, source.indexOf("F\n", source.indexOf("module Use")) + 1);
    expect(result?.options.map((option) => option.label)).toEqual(["First"]);
  });

  it("offers unconsumed named labels and type-filters scalar, point, and line arguments", async () => {
    const source = [
      "nui 3",
      "point P = coordinate(x: 0, y: 0)",
      "line L = segment(start: @P, end: @P)",
      "curve C = bezier(start: @P, end: @P)",
      "module M(width: number, anchor: point, path: line, optional: number = 0) {",
      "}",
      "module I = M(width: 1, anchor: @P, path: @L)"
    ].join("\n");
    const label = await completionFor(source, source.indexOf("anchor: @P") + "anchor".length);
    expect(label?.options.map((option) => option.label)).toContain("optional");
    expect(label?.options.map((option) => option.label)).not.toContain("width");
    const scalar = await completionFor(source, source.indexOf("1, anchor") + 1);
    expect(scalar?.options.map((option) => option.label)).toContain("0");
    expect(scalar?.options.map((option) => option.label)).not.toContain("P");
    const point = await completionFor(source, source.indexOf("@P, path") + 2);
    expect(point?.options.map((option) => option.label)).toContain("P");
    expect(point?.options.map((option) => option.label)).not.toContain("L");
    const line = await completionFor(source, source.indexOf("@L)") + 2);
    expect(line?.options.map((option) => option.label)).toContain("L");
    expect(line?.options.map((option) => option.label)).toContain("C");
    expect(line?.options.map((option) => option.label)).not.toContain("P");
  });

  it("offers module-body parameters and exports only for a qualified instance", async () => {
    const source = [
      "nui 3",
      "module M(width: number) {",
      "  export point Public = coordinate(x: @width, y: 0)",
      "  point Private = coordinate(x: @width, y: 0)",
      "}",
      "module I = M(width: 1)",
      "point X = offset(from: @I::Public, dx: 1, dy: 0)"
    ].join("\n");
    const body = await completionFor(source, source.indexOf("@width") + "@width".length);
    expect(body?.options.map((option) => option.label)).toContain("@width");
    const qualified = await completionFor(source, source.indexOf("@I::Public") + "@I::".length);
    expect(qualified?.options.map((option) => option.label)).toEqual(["Public"]);
    expect(qualified?.options.map((option) => option.label)).not.toContain("Private");
  });

  it("projects a multiline module call label completion through the logical statement map", async () => {
    const source = [
      "nui 3",
      "module M(width: number, optional: number = 0) {",
      "}",
      "module I = M(",
      "  width: 1",
      ")"
    ].join("\n");
    const cursor = source.indexOf("width: 1") + "width".length;
    const result = await completionFor(source, cursor);
    expect(result?.from).toBe(cursor - "width".length);
    expect(result?.to).toBe(cursor);
    expect(result?.options.map((option) => option.label)).toContain("optional");
  });

  it("fails closed for module candidates while the semantic metadata is stale", async () => {
    const source = ["nui 3", "module M() {", "}", "module I = M()"].join("\n");
    const result = await completionFor(source, source.indexOf("M()", source.indexOf("module I")) + 1, false);
    expect(result?.options ?? []).toEqual([]);
  });

  it("keeps a mapped last-good module site completable during dirty authoring", async () => {
    const source = [
      "nui 3",
      "module M(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}",
      "module I = M(width: 1)"
    ].join("\n");
    const cursor = source.indexOf("@width") + "@width".length;
    const compiled = compileWithIds(source);
    const statementIndex = compiled.statements.findIndex((statement) => cursor >= statement.documentRange.from && cursor <= statement.documentRange.to);
    const result = await completionFor(source, cursor, false, statementIndex);
    expect(result?.options.map((option) => option.label)).toContain("@width");
  });

  it("uses the shared DSL identifier grammar for Japanese module names, parameters, instances, and exports", async () => {
    const source = [
      "nui 3",
      "module 凸ノッチ(縫い代写し: number) {",
      "  export point 縫い代線 = coordinate(x: @縫い代写し, y: 0)",
      "}",
      "module 日本語インスタンス = 凸ノッチ(縫い代写し: 1)",
      "point X = offset(from: @日本語インスタンス::縫い代線, dx: 1, dy: 0)"
    ].join("\n");
    const cursor = source.indexOf("@日本語インスタンス::") + "@日本語インスタンス::".length;
    const result = await completionFor(source, cursor);
    expect(result?.options.map((option) => option.label)).toEqual(["縫い代線"]);
  });

  it("unions Module candidates into typed initializers, template holes, and set RHS without leaking outer bindings", async () => {
    const source = [
      "nui 3",
      "const outer: number = 10",
      "module M(width: number, caption: string) {",
      "  const leaked: number = @outer",
      "  const first: number = 1",
      "  const second: number = @first",
      "  set first = @width",
      "  text Label = label(text: \"width={@width}\", anchor: (0, 0))",
      "  text LabelLocal = label(text: \"first={@first}\", anchor: (0, 0))",
      "  text Label2 = label(text: @caption, anchor: (0, 0))",
      "  point P = coordinate(x: @width, y: 0, vars: [early: 10; late: @])",
      "}"
    ].join("\n");
    const typed = await completionFor(source, source.indexOf("@first") + 1);
    expect(typed?.options.map((option) => option.label)).toContain("width");
    expect(typed?.options.map((option) => option.label)).toContain("first");
    const set = await completionFor(source, source.indexOf("@width", source.indexOf("set first")) + 1);
    expect(set?.options.map((option) => option.label)).toContain("width");
    expect(set?.options.map((option) => option.label)).toContain("first");
    const template = await completionFor(source, source.indexOf("{@width") + 2);
    expect(template?.options.map((option) => option.label)).toContain("width");
    const localTemplate = await completionFor(source, source.indexOf("{@first") + 2);
    expect(localTemplate?.options.map((option) => option.label)).toContain("first");
    const property = await completionFor(source, source.indexOf("@caption") + 1);
    expect(property?.options.map((option) => option.label)).toContain("caption");
    const local = await completionFor(source, source.lastIndexOf("@") + 1);
    expect(local?.options.map((option) => option.label)).toContain("@early");
    expect(local?.options.map((option) => option.label)).not.toContain("@late");
    const outer = await completionFor(source, source.indexOf("@outer") + 1);
    expect(outer?.options.map((option) => option.label)).not.toContain("outer");
  });

  it("filters Module body scalar references by boolean, string, and choice parameter type", async () => {
    const source = [
      "nui 3",
      "module M(flag: boolean, label: string, side: choice(left, right)) {",
      "  const flagCopy: boolean = @flag",
      "  const labelCopy: string = @label",
      "  const sideCopy: choice(left, right) = @side",
      "}"
    ].join("\n");
    const flag = await completionFor(source, source.indexOf("@flag") + 1);
    expect(flag?.options.map((option) => option.label)).toContain("flag");
    expect(flag?.options.map((option) => option.label)).not.toContain("label");
    const label = await completionFor(source, source.indexOf("@label") + 1);
    expect(label?.options.map((option) => option.label)).toContain("label");
    expect(label?.options.map((option) => option.label)).not.toContain("flag");
    const side = await completionFor(source, source.indexOf("@side") + 1);
    expect(side?.options.map((option) => option.label)).toContain("side");
    expect(side?.options.map((option) => option.label)).not.toContain("label");
  });

  it("completes dirty new Module calls and newly added arguments from last-good identities", async () => {
    const lastGood = [
      "nui 3",
      "point P = coordinate(x: 0, y: 0)",
      "module M(pointValue: point, lineValue: line, textValue: string, flagValue: boolean, sideValue: choice(left, right), optional: number = 0) {",
      "}",
      "module First() {",
      "}",
      "module Forward() {",
      "}"
    ].join("\n");
    const forwardAt = lastGood.indexOf("module Forward");
    const newCall = `${lastGood.slice(0, forwardAt)}module I = F\n${lastGood.slice(forwardAt)}`;
    const newCallCursor = newCall.indexOf("module I = F") + "module I = F".length;
    const callee = await completionForWithLastGoodMetadata(newCall, lastGood, newCallCursor, {
      statementIndex: 6,
      scopeId: "root",
      sourceOrderIndex: 6
    });
    expect(callee?.options.map((option) => option.label)).toContain("First");
    expect(callee?.options.map((option) => option.label)).not.toContain("Forward");

    const existingCall = [
      "nui 3",
      "module M(pointValue: point, lineValue: line, textValue: string, flagValue: boolean, sideValue: choice(left, right), optional: number = 0) {",
      "}",
      "module I = M(pointValue: (0, 0), optional: )"
    ].join("\n");
    const oldCall = existingCall.replace(", optional: )", ")");
    const optionalCursor = existingCall.indexOf("optional: )") + "optional: ".length;
    const optional = await completionForWithLastGoodMetadata(existingCall, oldCall, optionalCursor, {
      statementIndex: 3,
      scopeId: "root",
      sourceOrderIndex: 3
    });
    expect(optional?.options.map((option) => option.label)).toContain("0");
    expect(optional?.options.map((option) => option.label)).toContain("1");

    const unsafe = await completionForWithLastGoodMetadata(newCall, lastGood, newCallCursor, null);
    expect(unsafe?.options ?? []).toEqual([]);

    const typedLastGood = [
      "nui 3",
      "point P = coordinate(x: 0, y: 0)",
      "line L = segment(start: @P, end: @P)",
      "module T(pointValue: point, lineValue: line, textValue: string, flagValue: boolean, sideValue: choice(left, right), numberOptional: number = 0, textOptional: string = \"\", flagOptional: boolean = false, sideOptional: choice(left, right) = left) {",
      "}",
      "module I = T(pointValue: @P, lineValue: @L, textValue: \"\", flagValue: true, sideValue: left)"
    ].join("\n");
    for (const [label, expected] of [["numberOptional", "0"], ["textOptional", '""'], ["flagOptional", "true"], ["sideOptional", "left"]] as const) {
      const live = typedLastGood.replace("sideValue: left)", `sideValue: left, ${label}: `);
      const cursor = live.lastIndexOf(`${label}: `) + `${label}: `.length;
      const value = await completionForWithLastGoodMetadata(live, typedLastGood, cursor, {
        statementIndex: 5,
        scopeId: "root",
        sourceOrderIndex: 5
      });
      expect(value?.options.map((option) => option.label)).toContain(expected);
    }

    const nestedLastGood = [
      "nui 3",
      "module First() {",
      "}",
      "group G (printEnabled: true) {",
      "}",
      "module Forward() {",
      "}"
    ].join("\n");
    const nestedCompiled = compileWithIds(nestedLastGood);
    const groupScope = [...nestedCompiled.sourceLexicalNamespace!.scopeIndex.scopes.values()].find((scope) => scope.kind === "group")!;
    const groupClose = groupScope.exitStatementIndex;
    const groupCloseText = nestedCompiled.statements[groupClose].documentRange.from;
    const nestedLive = `${nestedLastGood.slice(0, groupCloseText)}  module I = F\n${nestedLastGood.slice(groupCloseText)}`;
    const nestedCursor = nestedLive.indexOf("module I = F") + "module I = F".length;
    const nested = await completionForWithLastGoodMetadata(nestedLive, nestedLastGood, nestedCursor, {
      statementIndex: groupClose,
      scopeId: groupScope.id,
      sourceOrderIndex: groupClose
    });
    expect(nested?.options.map((option) => option.label)).toContain("First");
    expect(nested?.options.map((option) => option.label)).not.toContain("Forward");
  });
});
