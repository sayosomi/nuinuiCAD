import { describe, expect, it } from "vitest";
import { AutomationDocument } from "@nuinuicad/nui-language/document";
import { applyLineSplices } from "@nuinuicad/nui-language/document";
import { buildModuleOwnerElementPatch } from "@nuinuicad/nui-language/document";
import { buildModuleModelPatch } from "@nuinuicad/nui-language/document";
import { sourceOwnerForRuntimeElementId } from "@nuinuicad/nui-language";
import { buildIssue1651ImportedModuleCanvasEditFixture } from "../vscode/testSupport/issue1651ImportedModuleCanvasEditFixture";
import { moveBezierHandleByDeltaInElements, movePointElementByDeltaInElements } from "../model/elementDragTransforms";
import type { CadElement } from "../types/geometry";

const ownerFixture = (source: string, name: string) => {
  const document = AutomationDocument.fromSource(source);
  const state = document.getState();
  const element = state.doc.document.elements.find((candidate) => candidate.name === name);
  if (!element) throw new Error(`missing fixture element ${name}`);
  const owner = sourceOwnerForRuntimeElementId({
    statementMap: state.doc.statementMap,
    moduleRuntimeContext: state.doc.moduleRuntimeContext
  }, element.id);
  if (!owner) throw new Error(`missing fixture owner ${name}`);
  return { document, state, element, owner };
};

describe("Module source owner patch", () => {
  it("#1651 ignores an unchanged external Module instance while patching a changed root point", async () => {
    const fixture = await buildIssue1651ImportedModuleCanvasEditFixture(false);
    const transportedCompiled = { ...fixture.compiled };
    delete transportedCompiled.moduleRuntimeContext;
    const current = {
      sourceText: fixture.source,
      docText: fixture.source,
      doc: transportedCompiled,
      diagnostics: [],
      bindingIssueDiagnostics: []
    };
    const instance = fixture.runtimePresentation.elements.find((element) => element.name === "S");
    const point = fixture.runtimePresentation.elements.find((element) => element.name === "A");
    expect(instance?.type).toBe("moduleInstance");
    expect(point?.type).toBe("freePoint");
    if (instance?.type !== "moduleInstance" || point?.type !== "freePoint") return;
    expect(sourceOwnerForRuntimeElementId(transportedCompiled, instance.id)).toBeNull();
    expect(sourceOwnerForRuntimeElementId(transportedCompiled, point.id)?.kind).toBe("ordinary");

    const movedElements = movePointElementByDeltaInElements(
      fixture.runtimePresentation.elements,
      point.id,
      { dx: 4, dy: 0, angleLocked: false, distanceLocked: false }
    );
    expect(movedElements).not.toBeNull();
    const afterDocument = {
      ...fixture.compiled.document,
      elements: movedElements!.map((element) => {
        if (element.id === instance.id) return { ...element };
        return element;
      })
    };
    const changedInstance = afterDocument.elements.find((element) => element.id === instance.id);
    expect(changedInstance).not.toBe(instance);
    expect(changedInstance).toEqual(instance);
    const patch = buildModuleModelPatch(current, afterDocument);

    expect(patch.status).toBe("ready");
    if (patch.status !== "ready") return;
    expect(applyLineSplices(fixture.source, patch.splices)).toContain("point A = coordinate(x: 4, y: 0)");
    expect(applyLineSplices(fixture.source, patch.splices)).toContain("instance S = lib::Sample()");
  });

  it.each([
    ["enabled", { enabled: false, activity: "disabled" as const }, "enabled: false"],
    ["visible", { visible: false, activity: "hidden" as const }, "visible: false"]
  ] as const)("preserves true external Module instance %s gate edits", async (_gate, gateChange, expectedOption) => {
    const fixture = await buildIssue1651ImportedModuleCanvasEditFixture(false);
    const current = {
      sourceText: fixture.source,
      docText: fixture.source,
      doc: fixture.compiled,
      diagnostics: [],
      bindingIssueDiagnostics: []
    };
    const instance = fixture.compiled.document.elements.find((element) => element.name === "S");
    if (instance?.type !== "moduleInstance") throw new Error("missing external Module instance S");
    const afterDocument = {
      ...fixture.compiled.document,
      elements: fixture.compiled.document.elements.map((element) =>
        element.id === instance.id ? { ...element, ...gateChange } : element
      )
    };

    const patch = buildModuleModelPatch(current, afterDocument);
    expect(patch.status).toBe("ready");
    if (patch.status !== "ready") return;
    expect(applyLineSplices(fixture.source, patch.splices)).toContain(expectedOption);
  });

  it("detects supported nested Bezier knot edits in a Module document", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 1, y: 2)",
      "point D = coordinate(x: 12, y: 3)",
      "module Sample() {",
      "}",
      "instance S = Sample()",
      "curve Curve = bezier(start: @A, end: @D, startAngle: 0, startLength: 2, endAngle: 90, endLength: 3, intermediates: [knot(point: @A, angle: 90, incoming: 2, outgoing: 4)])"
    ].join("\n");
    const document = AutomationDocument.fromSource(source);
    const current = document.getState();
    const curve = current.doc.document.elements.find((element) => element.type === "bezierCurve");
    if (curve?.type !== "bezierCurve") throw new Error("missing Bezier curve");
    const afterDocument = {
      ...current.doc.document,
      elements: current.doc.document.elements.map((element) =>
        element.id === curve.id && element.type === "bezierCurve"
          ? {
              ...element,
              intermediatePoints: element.intermediatePoints.map((knot) => ({
                ...knot,
                outgoingHandleLength: 7
              }))
            }
          : element
      )
    };

    const patch = buildModuleModelPatch(current, afterDocument);
    expect(patch.status).toBe("ready");
    if (patch.status !== "ready") return;
    expect(applyLineSplices(source, patch.splices)).toContain("outgoing: 7");
  });

  it("rejects ambiguous unsupported element data instead of skipping it", async () => {
    const fixture = await buildIssue1651ImportedModuleCanvasEditFixture(false);
    const instance = fixture.compiled.document.elements.find((element) => element.name === "S");
    if (instance?.type !== "moduleInstance") throw new Error("missing external Module instance S");
    const opaqueBefore = new Map([["flag", true]]);
    const opaqueAfter = new Map([["flag", true]]);
    const currentElement = { ...instance, opaque: opaqueBefore } as unknown as CadElement;
    const afterInstance = { ...instance, opaque: opaqueAfter } as unknown as CadElement;
    const currentDocument = {
      ...fixture.compiled.document,
      elements: fixture.compiled.document.elements.map((element) =>
        element.id === instance.id ? currentElement : element
      )
    };
    const afterDocument = {
      ...fixture.compiled.document,
      elements: fixture.compiled.document.elements.map((element) =>
        element.id === instance.id ? afterInstance : element
      )
    };
    const transportedCompiled = { ...fixture.compiled };
    delete transportedCompiled.moduleRuntimeContext;
    const current = {
      sourceText: fixture.source,
      docText: fixture.source,
      doc: { ...transportedCompiled, document: currentDocument },
      diagnostics: [],
      bindingIssueDiagnostics: []
    };

    expect(buildModuleModelPatch(current, afterDocument)).toEqual({
      status: "unapplied",
      reason: "要素 S のsource ownerを解決できません。"
    });
  });

  it("produces one authored point LineSplice from the shared point transform", () => {
    const source = [
      "nui 1",
      "point P = coordinate(x: 1, y: 2)"
    ].join("\n");
    const fixture = ownerFixture(source, "P");
    const afterElements = movePointElementByDeltaInElements(
      fixture.state.doc.document.elements,
      fixture.element.id,
      { dx: 2, dy: 0 }
    );
    expect(afterElements).not.toBeNull();
    const after = afterElements!.find((element) => element.id === fixture.element.id)!;
    const patch = buildModuleOwnerElementPatch(fixture.state, fixture.owner, fixture.element, after);

    expect(patch.status).toBe("ready");
    if (patch.status !== "ready") return;
    expect(applyLineSplices(source, patch.splices)).toBe(
      "nui 1\npoint P = coordinate(x: 3, y: 2)"
    );
  });

  it("produces one authored Bezier LineSplice from the shared handle transform", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 100, y: 0)",
      "curve C = bezier(start: @A, end: @B, startAngle: 0, startLength: 20, endAngle: 180, endLength: 30)"
    ].join("\n");
    const fixture = ownerFixture(source, "C");
    const afterElements = moveBezierHandleByDeltaInElements(
      fixture.state.doc.document.elements,
      fixture.element.id,
      { dx: 0, dy: 20, role: "start" }
    );
    expect(afterElements).not.toBeNull();
    const after = afterElements!.find((element) => element.id === fixture.element.id)!;
    const patch = buildModuleOwnerElementPatch(fixture.state, fixture.owner, fixture.element, after);

    expect(patch.status).toBe("ready");
    if (patch.status !== "ready") return;
    const patchedSource = applyLineSplices(source, patch.splices);
    expect(patchedSource).toContain("startAngle: 45");
    expect(patchedSource).not.toContain("startLength: 20");
  });

  it("rejects source-owned expressions and stale source spans without regeneration", () => {
    const source = [
      "nui 1",
      "const X: number = 1",
      "// keep this comment",
      "point P = coordinate(x: @X, y: 2)"
    ].join("\n");
    const fixture = ownerFixture(source, "P");
    const after = { ...fixture.element, x: 2 } as CadElement;
    const unsupported = buildModuleOwnerElementPatch(fixture.state, fixture.owner, fixture.element, after);
    expect(unsupported.status).toBe("unapplied");
    expect(fixture.document.getSource()).toBe(source);

    const stale = buildModuleOwnerElementPatch(
      { ...fixture.state, docText: `${source}\n` },
      fixture.owner,
      fixture.element,
      after
    );
    expect(stale.status).toBe("unapplied");
    expect(fixture.document.getSource()).toBe(source);
  });
});
