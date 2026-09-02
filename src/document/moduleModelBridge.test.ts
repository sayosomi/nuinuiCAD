import { describe, expect, it } from "vitest";
import { AutomationDocument } from "./automationDocument";
import { applyLineSplices } from "./textPatch";
import { buildModuleOwnerElementPatch } from "./moduleModelBridge";
import { sourceOwnerForRuntimeElementId } from "../dsl/sourceOwnership";
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
