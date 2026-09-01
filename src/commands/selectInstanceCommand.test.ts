import { beforeEach, describe, expect, it } from "vitest";
import { materializedRuntimeElementId, type ModuleMaterialization, type ModuleOrigin } from "../dsl/moduleMaterialization";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import type { CadElement, ElementId } from "../types/geometry";
import { publishTestCanvasSelectionEligibility } from "../test/canvasSelectionTestUtils";
import { commands } from "./commands";
import {
  resolveOwningModuleInstanceId,
  selectInstance
} from "./selectionCommands";
import { selectionCommandDefinitions } from "./selectionCommandDefinitions";
import { vscodeCanvasRibbonCommandIds } from "../vscode/vscodeCanvasRibbonCatalog";

const directModuleSource = [
  "nui 1",
  "module M() {",
  "  point P = coordinate(x: 1, y: 2)",
  "}",
  "instance First = M()",
  "instance Second = M()",
  "point Outside = coordinate(x: 3, y: 4)"
].join("\n");

const nestedModuleSource = [
  "nui 1",
  "module Inner() {",
  "  point P = coordinate(x: 1, y: 2)",
  "}",
  "module Outer() {",
  "  instance Nested = Inner()",
  "}",
  "instance Root = Outer()"
].join("\n");

const loadDocument = (source: string) => {
  useCadDocumentStore.getState().commitText(source, "test");
  const state = useCadDocumentStore.getState();
  expect(state.doc.moduleMaterialization).toBeDefined();
  return state;
};

const elementNamed = (name: string, type?: CadElement["type"]) =>
  useCadDocumentStore.getState().elements.find((element) =>
    element.name === name && (type === undefined || element.type === type)
  )!;

const bodyOwnedBy = (owner: CadElement) =>
  useCadDocumentStore.getState().elements.find((element) =>
    element.name === "P" && element.parentGroupId === owner.id
  )!;

const withOrigins = (
  materialization: ModuleMaterialization,
  origins: ReadonlyMap<ElementId, ModuleOrigin>
) => ({
  ...materialization,
  originByRuntimeElementId: origins
});

beforeEach(() => {
  useCadDocumentStore.setState(initialCadDocumentState());
  useCadUiStore.setState(initialCadUiState());
});

describe("resolveOwningModuleInstanceId", () => {
  it("resolves a direct materialized Module body child to its concrete instance", () => {
    const state = loadDocument(directModuleSource);
    const owner = elementNamed("First", "moduleInstance");
    const body = bodyOwnedBy(owner);

    expect(resolveOwningModuleInstanceId({
      selectedElementId: body.id,
      elements: state.elements,
      moduleMaterialization: state.doc.moduleMaterialization
    })).toBe(owner.id);
  });

  it("resolves a nested Module body child to its innermost concrete instance", () => {
    const state = loadDocument(nestedModuleSource);
    const root = elementNamed("Root", "moduleInstance");
    const nested = elementNamed("Nested", "moduleInstance");
    const body = bodyOwnedBy(nested);

    expect(body.parentGroupId).toBe(nested.id);
    expect(nested.parentGroupId).toBe(root.id);
    expect(resolveOwningModuleInstanceId({
      selectedElementId: body.id,
      elements: state.elements,
      moduleMaterialization: state.doc.moduleMaterialization
    })).toBe(nested.id);
  });

  it("rejects ordinary geometry, reusable source elements, and an already-selected instance", () => {
    const state = loadDocument(directModuleSource);
    const owner = elementNamed("First", "moduleInstance");
    const body = bodyOwnedBy(owner);
    const ordinary = elementNamed("Outside");
    const materialization = state.doc.moduleMaterialization!;

    expect(resolveOwningModuleInstanceId({
      selectedElementId: ordinary.id,
      elements: state.elements,
      moduleMaterialization: materialization
    })).toBeNull();
    expect(resolveOwningModuleInstanceId({
      selectedElementId: owner.id,
      elements: state.elements,
      moduleMaterialization: materialization
    })).toBeNull();
    expect(resolveOwningModuleInstanceId({
      selectedElementId: body.id,
      elements: state.elements,
      moduleMaterialization: undefined
    })).toBeNull();
  });

  it("rejects missing and unprovable provenance", () => {
    const state = loadDocument(directModuleSource);
    const owner = elementNamed("First", "moduleInstance");
    const body = bodyOwnedBy(owner);
    const materialization = state.doc.moduleMaterialization!;
    const origin = materialization.originByRuntimeElementId.get(body.id)!;

    expect(resolveOwningModuleInstanceId({
      selectedElementId: body.id,
      elements: state.elements,
      moduleMaterialization: withOrigins(materialization, new Map())
    })).toBeNull();
    expect(resolveOwningModuleInstanceId({
      selectedElementId: body.id,
      elements: state.elements,
      moduleMaterialization: withOrigins(materialization, new Map([
        [body.id, { ...origin, instancePath: [], runtimeInstancePath: [] }]
      ]))
    })).toBeNull();
  });

  it("rejects a reconstructed owner that is missing or has the wrong element type", () => {
    const state = loadDocument(directModuleSource);
    const owner = elementNamed("First", "moduleInstance");
    const body = bodyOwnedBy(owner);
    const materialization = state.doc.moduleMaterialization!;

    expect(resolveOwningModuleInstanceId({
      selectedElementId: body.id,
      elements: state.elements.filter((element) => element.id !== owner.id),
      moduleMaterialization: materialization
    })).toBeNull();

    const wrongTypeElements = state.elements.map((element) =>
      element.id === owner.id
        ? { ...element, type: "freePoint" as const, x: 0, y: 0 } as CadElement
        : element
    );
    expect(resolveOwningModuleInstanceId({
      selectedElementId: body.id,
      elements: wrongTypeElements,
      moduleMaterialization: materialization
    })).toBeNull();
  });

  it("uses the runtime-qualified path when local statement identities collide", () => {
    const state = loadDocument(directModuleSource);
    const owner = elementNamed("First", "moduleInstance");
    const body = bodyOwnedBy(owner);
    const materialization = state.doc.moduleMaterialization!;
    const origin = materialization.originByRuntimeElementId.get(body.id)!;
    const runtimeInstancePath = ["module-document:file:///workspace/library.nui:live:instance"];
    const qualifiedOwnerId = materializedRuntimeElementId("moduleInstance", runtimeInstancePath);
    const qualifiedElements = state.elements
      .filter((element) => element.id !== owner.id)
      .map((element) => element.id === body.id
        ? { ...element, parentGroupId: qualifiedOwnerId }
        : element);
    qualifiedElements.push({ ...owner, id: qualifiedOwnerId });
    const origins = new Map(materialization.originByRuntimeElementId);
    origins.set(body.id, { ...origin, runtimeInstancePath });

    expect(resolveOwningModuleInstanceId({
      selectedElementId: body.id,
      elements: qualifiedElements,
      moduleMaterialization: withOrigins(materialization, origins)
    })).toBe(qualifiedOwnerId);
  });
});

describe("Select Instance command", () => {
  it("uses the primary selected child when multiple children are selected", () => {
    const state = loadDocument(directModuleSource);
    const first = elementNamed("First", "moduleInstance");
    const second = elementNamed("Second", "moduleInstance");
    const firstBody = bodyOwnedBy(first);
    const secondBody = bodyOwnedBy(second);
    publishTestCanvasSelectionEligibility(state.elements);
    useCadUiStore.getState().setSelectedElementIds([firstBody.id, secondBody.id], firstBody.id);

    expect(selectInstance()).toBe(true);
    expect(useCadUiStore.getState()).toMatchObject({
      selectedElementId: first.id,
      selectedElementIds: [first.id],
      selectionAnchorElementId: first.id
    });
  });

  it("replaces the full selection through the shared path and preserves its history/cleanup contracts", () => {
    const state = loadDocument(directModuleSource);
    const owner = elementNamed("First", "moduleInstance");
    const body = bodyOwnedBy(owner);
    const ordinary = elementNamed("Outside");
    publishTestCanvasSelectionEligibility(state.elements);
    useCadUiStore.getState().setSelectedElementIds([ordinary.id, body.id], body.id);
    useCadUiStore.getState().setActivePointPickTarget({
      elementId: body.id,
      parameterKey: "fromPoint" as never
    });
    useCadUiStore.getState().setActivePickCursor({ elementId: body.id, optionIndex: 0 });
    useCadUiStore.getState().setCanvasViewport({ panX: 42, panY: -7, zoom: 2 });
    const viewportBefore = useCadUiStore.getState().canvasViewport;

    expect(selectionCommandDefinitions.selectInstance.run({ recordSelectionHistory: true })).toBe(true);

    expect(useCadUiStore.getState()).toMatchObject({
      selectedElementId: owner.id,
      selectedElementIds: [owner.id],
      selectionAnchorElementId: owner.id,
      activePointPickTarget: null,
      activePickCursor: null,
      canvasViewport: viewportBefore
    });
    expect(useCadDocumentStore.getState().selectionPast).toHaveLength(1);
    expect(useCadDocumentStore.getState().selectionPast[0]).toEqual({
      selectedElementId: body.id,
      selectedElementIds: [ordinary.id, body.id],
      selectionAnchorElementId: body.id
    });
  });

  it("re-resolves current state and fails closed when provenance becomes stale", () => {
    const state = loadDocument(directModuleSource);
    const owner = elementNamed("First", "moduleInstance");
    const body = bodyOwnedBy(owner);
    publishTestCanvasSelectionEligibility(state.elements);
    useCadUiStore.getState().setSelectedElementId(body.id);
    useCadUiStore.getState().setCanvasViewport({ panX: 11, panY: 12, zoom: 1.5 });
    const selectionBefore = {
      selectedElementId: useCadUiStore.getState().selectedElementId,
      selectedElementIds: [...useCadUiStore.getState().selectedElementIds],
      selectionAnchorElementId: useCadUiStore.getState().selectionAnchorElementId
    };
    const viewportBefore = useCadUiStore.getState().canvasViewport;
    useCadDocumentStore.setState({
      doc: { ...state.doc, moduleMaterialization: undefined }
    });

    expect(selectionCommandDefinitions.selectInstance.run({ recordSelectionHistory: true })).toBe(false);
    expect(useCadUiStore.getState()).toMatchObject({
      ...selectionBefore,
      canvasViewport: viewportBefore
    });
    expect(useCadDocumentStore.getState().selectionPast).toEqual([]);
  });

  it("is registered as a host-neutral command without Palette or VS Code integration", () => {
    expect(commands.selectInstance).toMatchObject({ id: "selectInstance", label: "Select Instance" });
    expect(commands.selectInstance.palette).toBeUndefined();
    expect("palette" in selectionCommandDefinitions.selectInstance).toBe(false);
    expect(vscodeCanvasRibbonCommandIds).not.toContain("selectInstance");
  });
});
