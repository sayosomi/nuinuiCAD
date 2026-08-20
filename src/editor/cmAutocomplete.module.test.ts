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
    statementRanges: () => new Map(),
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
    statementRanges: () => new Map(),
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
    const source = ["nui 4", "module First() {", "}", "instance Use = F", "module Forward() {", "}"].join("\n");
    const result = await completionFor(source, source.indexOf("F\n", source.indexOf("module Use")) + 1);
    expect(result?.options.map((option) => option.label)).toEqual(["First"]);
  });

  it("offers module callees through the formal nui4 instance spelling", async () => {
    const source = ["nui 4", "module First() {", "}", "instance Use = F", "module Forward() {", "}"].join("\n");
    const result = await completionFor(source, source.indexOf("F\n", source.indexOf("instance Use")) + 1);
    expect(result?.options.map((option) => option.label)).toEqual(["First"]);
  });

  it("offers unconsumed named labels and type-filters scalar, point, and line arguments", async () => {
    const source = [
      "nui 4",
      "point P = coordinate(x: 0, y: 0)",
      "line L = segment(start: @P, end: @P)",
      "curve C = bezier(start: @P, end: @P)",
      "module M(width: number, anchor: point, path: path, optional: number = 0) {",
      "}",
      "instance I = M(width: 1, anchor: @P, path: @L)"
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

  it("offers builtin functions for scalar module arguments", async () => {
    const source = [
      "nui 4",
      "module M(value: number) {",
      "}",
      "instance I = M(value: round(1))"
    ].join("\n");
    const result = await completionFor(source, source.indexOf("round") + 2);
    expect(result?.options).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "round",
        apply: "round(",
        detail: "round(number) -> number | round(number, number) -> number",
        type: "function"
      }),
      expect.objectContaining({ label: "roundTo", apply: "roundTo(", type: "function" }),
      expect.objectContaining({
        label: "sin",
        apply: "sin(",
        detail: "sin(number) -> number",
        type: "function"
      }),
      expect.objectContaining({
        label: "atan2",
        apply: "atan2(",
        detail: "atan2(number, number) -> number",
        type: "function"
      }),
      expect.objectContaining({
        label: "spreadAngle",
        apply: "spreadAngle(",
        detail: "spreadAngle(length: number, spread: number) -> number",
        type: "function"
      }),
      expect.objectContaining({
        label: "distance",
        apply: "distance(",
        detail: "distance(point, point) -> number",
        type: "function"
      }),
      expect.objectContaining({
        label: "angle",
        apply: "angle(",
        detail: "angle(point, point) -> number",
        type: "function"
      }),
      expect.objectContaining({
        label: "lineDistance",
        apply: "lineDistance(",
        detail: "lineDistance(point, line) -> number",
        type: "function"
      })
    ]));
  });

  it("uses nested builtin argument types for boolean module scalar arguments", async () => {
    const lastGood = [
      "nui 4",
      "module M(enabled: boolean) {",
      "}",
      "instance X = M(enabled: isClose(1, 2, 3))"
    ].join("\n");
    const source = lastGood.replace("isClose(1, 2, 3)", "isClose(1, )");
    const cursor = source.indexOf("isClose(1, ") + "isClose(1, ".length;
    const compiled = compileWithIds(lastGood);
    const statementIndex = compiled.statements.length - 1;
    const result = await completionForWithLastGoodMetadata(source, lastGood, cursor, {
      statementIndex,
      scopeId: "root",
      sourceOrderIndex: statementIndex
    });
    expect(result?.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "abs", type: "function" }),
      expect.objectContaining({
        label: "round",
        detail: "round(number) -> number | round(number, number) -> number",
        type: "function"
      }),
      expect.objectContaining({ label: "roundTo", type: "function" })
    ]));
    expect(result?.options.some((option) => option.label === "isClose")).toBe(false);
  });

  it("keeps the outer numeric argument type after a nested numeric builtin call", async () => {
    const lastGood = [
      "nui 4",
      "module M(enabled: boolean) {",
      "}",
      "instance X = M(enabled: isClose(round(1, 2), 3))"
    ].join("\n");
    const source = lastGood.replace("isClose(round(1, 2), 3)", "isClose(round(1, 2), )");
    const cursor = source.indexOf("isClose(round(1, 2), ") + "isClose(round(1, 2), ".length;
    const compiled = compileWithIds(lastGood);
    const statementIndex = compiled.statements.length - 1;
    const result = await completionForWithLastGoodMetadata(source, lastGood, cursor, {
      statementIndex,
      scopeId: "root",
      sourceOrderIndex: statementIndex
    });
    expect(result?.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "abs", type: "function" }),
      expect.objectContaining({ label: "round", type: "function" }),
      expect.objectContaining({ label: "roundTo", type: "function" })
    ]));
    expect(result?.options.some((option) => option.label === "isClose")).toBe(false);
  });

  it("preserves point Module argument endpoint completions", async () => {
    const source = [
      "nui 4",
      "point P = coordinate(x: 0, y: 0)",
      "line L = segment(start: @P, end: @P)",
      "curve C = bezier(start: @P, end: @P)",
      "arc A = arc(center: @P, radius: 5, start: 0, end: 90)",
      "module M(anchor: point) {",
      "}",
      "instance I = M(anchor: @)"
    ].join("\n");
    const cursor = source.indexOf("M(anchor: @") + "M(anchor: @".length;
    const result = await completionFor(source, cursor);
    expect(result?.options.map((option) => option.label)).toEqual([
      "P",
      "L.start",
      "L.end",
      "C.start",
      "C.end",
      "A.start",
      "A.end"
    ]);
  });

  it("forwards Module geometry parameters according to directional interfaces", async () => {
    const source = [
      "nui 4",
      "module PathConsumer(input: path) {",
      "}",
      "module LineConsumer(input: line) {",
      "}",
      "module Container(lineParam: line, pathParam: path) {",
      "  instance PathArg = PathConsumer(input: @)",
      "  instance LineArg = LineConsumer(input: @)",
      "}"
    ].join("\n");
    const pathCursor = source.indexOf("PathConsumer(input: @") + "PathConsumer(input: @".length;
    const lineCursor = source.indexOf("LineConsumer(input: @") + "LineConsumer(input: @".length;
    const path = await completionFor(source, pathCursor);
    const line = await completionFor(source, lineCursor);
    expect(path?.options.map((option) => option.label)).toContain("lineParam");
    expect(path?.options.map((option) => option.label)).toContain("pathParam");
    expect(line?.options.map((option) => option.label)).toContain("lineParam");
    expect(line?.options.map((option) => option.label)).not.toContain("pathParam");
  });

  it("filters direct geometry candidates by strict line versus broad path interfaces", async () => {
    const source = [
      "nui 4",
      "point P = coordinate(x: 0, y: 0)",
      "line L = segment(start: @P, end: @P)",
      "curve C = bezier(start: @P, end: @P)",
      "arc A = arc(center: @P, radius: 5, start: 0, end: 90)",
      "module Strict(input: line) {",
      "}",
      "module Broad(input: path) {",
      "}",
      "instance S = Strict(input: @)",
      "instance B = Broad(input: @)"
    ].join("\n");
    const strictCursor = source.indexOf("Strict(input: @") + "Strict(input: @".length;
    const broadCursor = source.indexOf("Broad(input: @") + "Broad(input: @".length;
    const strict = await completionFor(source, strictCursor);
    const broad = await completionFor(source, broadCursor);
    expect(strict?.options.map((option) => option.label)).toEqual(["L"]);
    expect(broad?.options.map((option) => option.label)).toEqual(["L", "C", "A"]);
  });

  it("filters qualified exported geometry candidates by the receiving interface", async () => {
    const source = [
      "nui 4",
      "module Producer() {",
      "  export line L = segment(start: (0, 0), end: (10, 0))",
      "  export curve C = bezier(start: (0, 0), end: (10, 0))",
      "  export arc A = arc(center: (0, 0), radius: 5, start: 0, end: 90)",
      "}",
      "module Strict(input: line) {",
      "}",
      "module Broad(input: path) {",
      "}",
      "instance Source = Producer()",
      "instance S = Strict(input: @Source::)",
      "instance B = Broad(input: @Source::)"
    ].join("\n");
    const strictCursor = source.indexOf("Strict(input: @Source::") + "Strict(input: @Source::".length;
    const broadCursor = source.indexOf("Broad(input: @Source::") + "Broad(input: @Source::".length;
    const strict = await completionFor(source, strictCursor);
    const broad = await completionFor(source, broadCursor);
    expect(strict?.options.map((option) => option.label)).toEqual(["L"]);
    expect(broad?.options.map((option) => option.label)).toEqual(["L", "C", "A"]);
  });

  it("offers path in Module signature type completion without adding geometry to scalar declarations", async () => {
    const moduleSource = "nui 4\nmodule M(input: pa";
    const moduleResult = await completionFor(moduleSource, moduleSource.length);
    expect(moduleResult?.options.map((option) => option.label)).toContain("path");

    const scalarSource = "nui 4\nconst value: pa";
    const scalarResult = await completionFor(scalarSource, scalarSource.length);
    expect(scalarResult?.options.map((option) => option.label)).not.toContain("path");
  });

  it("offers module-body parameters and exports only for a qualified instance", async () => {
    const source = [
      "nui 4",
      "module M(width: number) {",
      "  export point Public = coordinate(x: @width, y: 0)",
      "  point Private = coordinate(x: @width, y: 0)",
      "}",
      "instance I = M(width: 1)",
      "point X = offset(from: @I::Public, dx: 1, dy: 0)"
    ].join("\n");
    const body = await completionFor(source, source.indexOf("@width") + "@width".length);
    expect(body?.options.map((option) => option.label)).toContain("@width");
    const qualified = await completionFor(source, source.indexOf("@I::Public") + "@I::".length);
    expect(qualified?.options.map((option) => option.label)).toEqual(["Public"]);
    expect(qualified?.options.map((option) => option.label)).not.toContain("Private");
  });

  it("filters qualified scalar members by the scalar context and keeps geometry members separate", async () => {
    const source = [
      "nui 4",
      "module M() {",
      "  export const value: number = 1",
      "  export let label: string = \"\"",
      "  const privateValue: number = 2",
      "  export point P = coordinate(x: 0, y: 0)",
      "}",
      "instance foo = M()",
      "const result: number = @foo::value",
      "point X = offset(from: @foo::P, dx: 1, dy: 0)"
    ].join("\n");
    const scalarCursor = source.indexOf("@foo::value") + "@foo::".length;
    const scalar = await completionFor(source, scalarCursor);
    expect(scalar?.options.map((option) => option.label)).toContain("value");
    expect(scalar?.options.map((option) => option.label)).not.toContain("label");
    expect(scalar?.options.map((option) => option.label)).not.toContain("privateValue");
    expect(scalar?.options.map((option) => option.label)).not.toContain("P");

    const geometryCursor = source.indexOf("@foo::P") + "@foo::".length;
    const geometry = await completionFor(source, geometryCursor);
    expect(geometry?.options.map((option) => option.label)).toEqual(["P"]);
    expect(geometry?.options.map((option) => option.label)).not.toContain("value");
  });

  it("filters qualified module exports inside scalar arguments at the root and in nested module bodies", async () => {
    const source = [
      "nui 4",
      "module Producer() {",
      "  export const value: number = 1",
      "  export const label: string = \"\"",
      "  const privateValue: number = 2",
      "  export point P = coordinate(x: 0, y: 0)",
      "}",
      "module Consumer(input: number) {",
      "}",
      "instance A = Producer()",
      "instance B = Consumer(input: @A::)"
    ].join("\n");
    const rootCursor = source.indexOf("@A::") + "@A::".length;
    const root = await completionFor(source, rootCursor);
    expect(root?.options.map((option) => option.label)).toEqual(["value"]);

    const completeSource = source.replace("@A::", "@A::value");
    const memberCursor = completeSource.indexOf("@A::value") + "@A::".length;
    const member = await completionFor(completeSource, memberCursor);
    expect(member?.options.map((option) => option.label)).toEqual(["value"]);

    const nestedSource = [
      "nui 4",
      "module Producer() {",
      "  export const value: number = 1",
      "  export const label: string = \"\"",
      "  const privateValue: number = 2",
      "  export point P = coordinate(x: 0, y: 0)",
      "}",
      "module Consumer(input: number) {",
      "}",
      "module Parent() {",
      "  instance A = Producer()",
      "  instance B = Consumer(input: @A::)",
      "}"
    ].join("\n");
    const nestedCursor = nestedSource.indexOf("@A::") + "@A::".length;
    const nested = await completionFor(nestedSource, nestedCursor);
    expect(nested?.options.map((option) => option.label)).toEqual(["value"]);
  });

  it("filters qualified geometry exports inside geometry module arguments", async () => {
    const source = [
      "nui 4",
      "module Producer() {",
      "  export point P = coordinate(x: 0, y: 0)",
      "  export line L = segment(start: @P, end: @P)",
      "}",
      "module Consumer(anchor: point) {",
      "}",
      "instance A = Producer()",
      "instance B = Consumer(anchor: @A::)"
    ].join("\n");
    const cursor = source.indexOf("@A::") + "@A::".length;
    const result = await completionFor(source, cursor);
    expect(result?.options.map((option) => option.label)).toEqual(["P"]);
  });

  it("completes a member on an in-progress root scalar reference", async () => {
    const lastGood = [
      "nui 4",
      "module M() {",
      "  export const value: number = 1",
      "  export point P = coordinate(x: 0, y: 0)",
      "}",
      "instance foo = M()",
      "const result: number = @foo::value"
    ].join("\n");
    const source = lastGood.replace("@foo::value", "@foo::");
    const statementIndex = lastGood.split("\n").findIndex((line) => line.startsWith("const result"));
    const result = await completionForWithLastGoodMetadata(source, lastGood, source.length, {
      statementIndex,
      scopeId: "root",
      sourceOrderIndex: statementIndex
    });
    expect(result?.options.map((option) => option.label)).toEqual(["value"]);
  });

  it("uses the resolved lexical instance for qualified scalar completion in nested scopes", async () => {
    const source = [
      "nui 4",
      "module M1() {",
      "  export const first: number = 1",
      "}",
      "module M2() {",
      "  export const second: number = 2",
      "}",
      "group A {",
      "  instance foo = M1()",
      "  const resultA: number = @foo::first",
      "}",
      "group B {",
      "  instance foo = M2()",
      "  const resultB: number = @foo::second",
      "}"
    ].join("\n");
    const firstCursor = source.indexOf("@foo::first") + "@foo::".length;
    const secondStart = source.indexOf("@foo::second", firstCursor);
    const secondCursor = secondStart + "@foo::".length;
    expect((await completionFor(source, firstCursor))?.options.map((option) => option.label)).toEqual(["first"]);
    expect((await completionFor(source, secondCursor))?.options.map((option) => option.label)).toEqual(["second"]);
  });

  it("projects a multiline module call label completion through the logical statement map", async () => {
    const source = [
      "nui 4",
      "module M(width: number, optional: number = 0) {",
      "}",
      "instance I = M(",
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
    const source = ["nui 4", "module M() {", "}", "instance I = M()"].join("\n");
    const result = await completionFor(source, source.indexOf("M()", source.indexOf("module I")) + 1, false);
    expect(result?.options ?? []).toEqual([]);
  });

  it("keeps a mapped last-good module site completable during dirty authoring", async () => {
    const source = [
      "nui 4",
      "module M(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}",
      "instance I = M(width: 1)"
    ].join("\n");
    const cursor = source.indexOf("@width") + "@width".length;
    const compiled = compileWithIds(source);
    const statementIndex = compiled.statements.findIndex((statement) => cursor >= statement.documentRange.from && cursor <= statement.documentRange.to);
    const result = await completionFor(source, cursor, false, statementIndex);
    expect(result?.options.map((option) => option.label)).toContain("@width");
  });

  it("uses the shared DSL identifier grammar for Japanese module names, parameters, instances, and exports", async () => {
    const source = [
      "nui 4",
      "module 凸ノッチ(縫い代写し: number) {",
      "  export point 縫い代線 = coordinate(x: @縫い代写し, y: 0)",
      "}",
      "instance 日本語インスタンス = 凸ノッチ(縫い代写し: 1)",
      "point X = offset(from: @日本語インスタンス::縫い代線, dx: 1, dy: 0)"
    ].join("\n");
    const cursor = source.indexOf("@日本語インスタンス::") + "@日本語インスタンス::".length;
    const result = await completionFor(source, cursor);
    expect(result?.options.map((option) => option.label)).toEqual(["縫い代線"]);
  });

  it("unions Module candidates into typed initializers, template holes, and set RHS without leaking outer bindings", async () => {
    const source = [
      "nui 4",
      "const outer: number = 10",
      "module M(width: number, caption: string) {",
      "  const leaked: number = @outer",
      "  const first: number = 1",
      "  const second: number = @first",
      "  set first = @width",
      "  text Label = label(text: \"width=${@width}\", anchor: (0, 0))",
      "  text LabelLocal = label(text: \"first=${@first}\", anchor: (0, 0))",
      "  text Label2 = label(text: @caption, anchor: (0, 0))",
      "  point P = coordinate(x: @width, y: 0)",
      "}"
    ].join("\n");
    const typed = await completionFor(source, source.indexOf("@first") + 1);
    expect(typed?.options.map((option) => option.label)).toContain("width");
    expect(typed?.options.map((option) => option.label)).toContain("first");
    const set = await completionFor(source, source.indexOf("@width", source.indexOf("set first")) + 1);
    expect(set?.options.map((option) => option.label)).toContain("width");
    expect(set?.options.map((option) => option.label)).toContain("first");
    const template = await completionFor(source, source.indexOf("${@width") + 2);
    expect(template?.options.map((option) => option.label)).toContain("width");
    const localTemplate = await completionFor(source, source.indexOf("${@first") + 2);
    expect(localTemplate?.options.map((option) => option.label)).toContain("first");
    const property = await completionFor(source, source.indexOf("@caption") + 1);
    expect(property?.options.map((option) => option.label)).toContain("caption");
    const outer = await completionFor(source, source.indexOf("@outer") + 1);
    expect(outer?.options.map((option) => option.label)).not.toContain("outer");
  });

  it("filters Module body scalar references by boolean, string, and choice parameter type", async () => {
    const source = [
      "nui 4",
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
      "nui 4",
      "point P = coordinate(x: 0, y: 0)",
      "module M(pointValue: point, lineValue: line, textValue: string, flagValue: boolean, sideValue: choice(left, right), optional: number = 0) {",
      "}",
      "module First() {",
      "}",
      "module Forward() {",
      "}"
    ].join("\n");
    const forwardAt = lastGood.indexOf("module Forward");
    const newCall = `${lastGood.slice(0, forwardAt)}instance I = F\n${lastGood.slice(forwardAt)}`;
    const newCallCursor = newCall.indexOf("instance I = F") + "instance I = F".length;
    const callee = await completionForWithLastGoodMetadata(newCall, lastGood, newCallCursor, {
      statementIndex: 6,
      scopeId: "root",
      sourceOrderIndex: 6
    });
    expect(callee?.options.map((option) => option.label)).toContain("First");
    expect(callee?.options.map((option) => option.label)).not.toContain("Forward");

    const existingCall = [
      "nui 4",
      "module M(pointValue: point, lineValue: line, textValue: string, flagValue: boolean, sideValue: choice(left, right), optional: number = 0) {",
      "}",
      "instance I = M(pointValue: (0, 0), optional: )"
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
      "nui 4",
      "point P = coordinate(x: 0, y: 0)",
      "line L = segment(start: @P, end: @P)",
      "module T(pointValue: point, lineValue: line, textValue: string, flagValue: boolean, sideValue: choice(left, right), numberOptional: number = 0, textOptional: string = \"\", flagOptional: boolean = false, sideOptional: choice(left, right) = left) {",
      "}",
      "instance I = T(pointValue: @P, lineValue: @L, textValue: \"\", flagValue: true, sideValue: left)"
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
      "nui 4",
      "module First() {",
      "}",
      "group G {",
      "}",
      "module Forward() {",
      "}"
    ].join("\n");
    const nestedCompiled = compileWithIds(nestedLastGood);
    const groupScope = [...nestedCompiled.sourceLexicalNamespace!.scopeIndex.scopes.values()].find((scope) => scope.kind === "group")!;
    const groupClose = groupScope.exitStatementIndex;
    const groupCloseText = nestedCompiled.statements[groupClose].documentRange.from;
    const nestedLive = `${nestedLastGood.slice(0, groupCloseText)}  instance I = F\n${nestedLastGood.slice(groupCloseText)}`;
    const nestedCursor = nestedLive.indexOf("instance I = F") + "instance I = F".length;
    const nested = await completionForWithLastGoodMetadata(nestedLive, nestedLastGood, nestedCursor, {
      statementIndex: groupClose,
      scopeId: groupScope.id,
      sourceOrderIndex: groupClose
    });
    expect(nested?.options.map((option) => option.label)).toContain("First");
    expect(nested?.options.map((option) => option.label)).not.toContain("Forward");
  });
});
