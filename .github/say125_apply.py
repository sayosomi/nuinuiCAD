from pathlib import Path
import re


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one target, found {count}")
    file.write_text(text.replace(old, new, 1))


def replace_regex_once(path: str, pattern: str, replacement: str, label: str) -> None:
    file = Path(path)
    text = file.read_text()
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected one regex target, found {count}")
    file.write_text(updated)


def insert_before_last(path: str, marker: str, addition: str, label: str) -> None:
    file = Path(path)
    text = file.read_text()
    index = text.rfind(marker)
    if index < 0:
        raise SystemExit(f"{label}: final marker not found")
    file.write_text(text[:index] + addition + text[index:])


Path("src/components/moduleInstanceSelectionFrame.ts").write_text(r'''import type { ModuleMaterialization } from "../dsl/moduleMaterialization";
import type { CanvasTextWidthMeasurer } from "../geometry/canvasDrawingBounds";
import { moduleInstanceCanvasGeometry } from "../geometry/moduleInstanceCanvasGeometry";
import type { CanvasViewport } from "../state/cadUiStore";
import type { CadElement, ElementId, EvaluationResult, VisibilityProfile } from "../types/geometry";
import { worldToScreen, type ViewportSize } from "./canvasViewport";

export type ModuleInstanceSelectionFrameOverlay = {
  instanceId: ElementId;
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

const FRAME_PADDING_PX = 8;

export const moduleInstanceSelectionFrameOverlays = ({
  selectedElementIds,
  elements,
  evaluation,
  moduleMaterialization,
  visibilityProfiles,
  activeVisibilityProfileId,
  viewportSize,
  canvasViewport,
  measureCanvasTextWidth
}: {
  selectedElementIds: readonly ElementId[];
  elements: readonly CadElement[];
  evaluation: EvaluationResult;
  moduleMaterialization?: ModuleMaterialization;
  visibilityProfiles: readonly VisibilityProfile[];
  activeVisibilityProfileId: string | null;
  viewportSize: ViewportSize;
  canvasViewport: CanvasViewport;
  measureCanvasTextWidth?: CanvasTextWidthMeasurer;
}): ModuleInstanceSelectionFrameOverlay[] => {
  if (!moduleMaterialization) return [];
  const elementById = new Map(elements.map((element) => [element.id, element]));

  return selectedElementIds.flatMap((instanceId) => {
    const element = elementById.get(instanceId);
    if (!element || element.type !== "moduleInstance") return [];
    const geometry = moduleInstanceCanvasGeometry({
      instanceId,
      elements,
      evaluation,
      moduleMaterialization,
      visibilityProfiles,
      activeVisibilityProfileId,
      measureCanvasTextWidth
    });
    if (!geometry?.bounds || geometry.renderableDescendantIds.length === 0) return [];

    const { minX, minY, maxX, maxY } = geometry.bounds;
    const corners = [
      worldToScreen({ x: minX, y: minY }, viewportSize, canvasViewport),
      worldToScreen({ x: minX, y: maxY }, viewportSize, canvasViewport),
      worldToScreen({ x: maxX, y: minY }, viewportSize, canvasViewport),
      worldToScreen({ x: maxX, y: maxY }, viewportSize, canvasViewport)
    ];
    const xs = corners.map((point) => point.x);
    const ys = corners.map((point) => point.y);
    const left = Math.min(...xs) - FRAME_PADDING_PX;
    const right = Math.max(...xs) + FRAME_PADDING_PX;
    const top = Math.min(...ys) - FRAME_PADDING_PX;
    const bottom = Math.max(...ys) + FRAME_PADDING_PX;

    return [{
      instanceId,
      name: element.name,
      left,
      top,
      width: right - left,
      height: bottom - top
    }];
  });
};
''')

Path("src/components/moduleInstanceSelectionFrame.test.ts").write_text(r'''import { describe, expect, it } from "vitest";
import type { ModuleMaterialization } from "../dsl/moduleMaterialization";
import { defaultVisibilityProfile } from "../model/visibilityProfiles";
import type { CadElement, EvaluationResult } from "../types/geometry";
import { moduleInstanceSelectionFrameOverlays } from "./moduleInstanceSelectionFrame";

const materialization = (instanceId: string, descendantIds: string[]): ModuleMaterialization => ({
  executionStatements: [],
  sourceExecutionUnits: [],
  elementIdBySourceStatementIndex: new Map(),
  sourceExecutionPositionByRuntimeElementId: new Map(),
  originByRuntimeElementId: new Map(),
  runtimeIdentityByElementId: new Map(),
  instanceBaseGeometrySnapshots: [{ instanceId, endRuntimeIndex: descendantIds.length, descendantIds }],
  evaluationLimitIndex: undefined
});

const element = (id: string, name: string, type: CadElement["type"]): CadElement => ({
  id,
  name,
  type,
  activity: "visible"
} as CadElement);

const evaluationForPoint = (elementId: string): EvaluationResult => ({
  computedGeometry: new Map([[elementId, {
    kind: "point",
    elementId,
    name: elementId,
    x: 5,
    y: 10
  }]]),
  errors: [],
  warnings: []
});

const profile = defaultVisibilityProfile();

const framesFor = (selectedElementIds: string[]) => moduleInstanceSelectionFrameOverlays({
  selectedElementIds,
  elements: [
    element("instance", "InstanceOne", "moduleInstance"),
    element("child", "Child", "freePoint")
  ],
  evaluation: evaluationForPoint("child"),
  moduleMaterialization: materialization("instance", ["child"]),
  visibilityProfiles: [profile],
  activeVisibilityProfileId: profile.id,
  viewportSize: { width: 200, height: 100 },
  canvasViewport: { panX: 0, panY: 0, zoom: 2 }
});

describe("Module instance selection frame presentation", () => {
  it("keeps the instance as the only presentation identity and gives zero-area bounds a visible frame", () => {
    expect(framesFor(["instance"])).toEqual([{
      instanceId: "instance",
      name: "InstanceOne",
      left: 102,
      top: 22,
      width: 16,
      height: 16
    }]);
  });

  it("does not create an instance frame for an ordinary selected child", () => {
    expect(framesFor(["child"])).toEqual([]);
  });
});
''')

replace_once(
    "src/components/CanvasOverlay.tsx",
    'import type { ViewportSize } from "./canvasViewport";\n',
    'import type { ViewportSize } from "./canvasViewport";\nimport type { ModuleInstanceSelectionFrameOverlay } from "./moduleInstanceSelectionFrame";\n',
    "CanvasOverlay frame import"
)
replace_once(
    "src/components/CanvasOverlay.tsx",
    '''type CanvasOverlayProps = {\n  viewportSize: ViewportSize;\n''',
    '''type CanvasOverlayProps = {\n  viewportSize: ViewportSize;\n  moduleInstanceSelectionFrames?: readonly ModuleInstanceSelectionFrameOverlay[];\n''',
    "CanvasOverlay frame prop"
)
replace_once(
    "src/components/CanvasOverlay.tsx",
    '''export const CanvasOverlay = ({\n  viewportSize,\n  overlayLines,\n''',
    '''export const CanvasOverlay = ({\n  viewportSize,\n  moduleInstanceSelectionFrames = [],\n  overlayLines,\n''',
    "CanvasOverlay frame default"
)
replace_once(
    "src/components/CanvasOverlay.tsx",
    '''    {selectedBezierEditingHelper ? (\n''',
    '''    {moduleInstanceSelectionFrames.map((frame) => (\n      <g\n        key={`module-instance-frame-${frame.instanceId}`}\n        data-module-instance-selection-frame={frame.instanceId}\n        style={{ pointerEvents: "none" }}\n      >\n        <rect\n          x={frame.left}\n          y={frame.top}\n          width={frame.width}\n          height={frame.height}\n          fill="none"\n          stroke="var(--canvas-selection)"\n          strokeWidth={1.5}\n          strokeDasharray="6 4"\n          vectorEffect="non-scaling-stroke"\n          style={{ pointerEvents: "none" }}\n        />\n        <text\n          x={frame.left + 2}\n          y={Math.max(12, frame.top - 4)}\n          data-module-instance-selection-label={frame.instanceId}\n          fill="var(--canvas-selection)"\n          style={{ fontSize: 12, fontWeight: 700, pointerEvents: "none" }}\n        >\n          {frame.name}\n        </text>\n      </g>\n    ))}\n    {selectedBezierEditingHelper ? (\n''',
    "CanvasOverlay frame rendering"
)

replace_once(
    "src/components/canvasHostAdapter.ts",
    'import type { ReactNode } from "react";\n',
    'import type { ReactNode } from "react";\nimport type { CanvasTextWidthMeasurer } from "../geometry/canvasDrawingBounds";\n',
    "host adapter measurer import"
)
replace_once(
    "src/components/canvasHostAdapter.ts",
    '''  moduleSemanticContext: ModuleSemanticCandidateContext;\n  selectedElementId: ElementId | null;\n''',
    '''  moduleSemanticContext: ModuleSemanticCandidateContext;\n  measureCanvasTextWidth?: CanvasTextWidthMeasurer;\n  selectedElementId: ElementId | null;\n''',
    "host adapter measurer property"
)

replace_once(
    "src/vscode/VSCodeDrawingCanvas.tsx",
    '''      moduleSemanticContext: canvasPresentation.moduleSemanticContext,\n      selectedElementId,\n''',
    '''      moduleSemanticContext: canvasPresentation.moduleSemanticContext,\n      measureCanvasTextWidth,\n      selectedElementId,\n''',
    "VSCode host adapter measurer"
)
replace_once(
    "src/vscode/VSCodeDrawingCanvas.tsx",
    '''      moduleSemanticContext,\n      palette,\n''',
    '''      moduleSemanticContext,\n      measureCanvasTextWidth,\n      palette,\n''',
    "VSCode host adapter measurer dependency"
)

replace_once(
    "src/components/DrawingCanvas.tsx",
    'import { CanvasOverlay } from "./CanvasOverlay";\n',
    'import { CanvasOverlay } from "./CanvasOverlay";\nimport { moduleInstanceSelectionFrameOverlays } from "./moduleInstanceSelectionFrame";\n',
    "DrawingCanvas frame import"
)
replace_once(
    "src/components/DrawingCanvas.tsx",
    '''  const interactiveOverlayLines = useMemo(\n''',
    '''  const moduleInstanceSelectionFrames = useMemo(() => moduleInstanceSelectionFrameOverlays({\n    selectedElementIds,\n    elements,\n    evaluation,\n    moduleMaterialization: moduleSemanticContext.moduleMaterialization,\n    visibilityProfiles,\n    activeVisibilityProfileId,\n    viewportSize,\n    canvasViewport,\n    measureCanvasTextWidth: hostAdapter.measureCanvasTextWidth\n  }), [\n    activeVisibilityProfileId,\n    canvasViewport,\n    elements,\n    evaluation,\n    hostAdapter.measureCanvasTextWidth,\n    moduleSemanticContext.moduleMaterialization,\n    selectedElementIds,\n    viewportSize,\n    visibilityProfiles\n  ]);\n  const interactiveOverlayLines = useMemo(\n''',
    "DrawingCanvas frame computation"
)
replace_once(
    "src/components/DrawingCanvas.tsx",
    '''        <CanvasOverlay\n          viewportSize={viewportSize}\n          overlayLines={overlayLines}\n''',
    '''        <CanvasOverlay\n          viewportSize={viewportSize}\n          moduleInstanceSelectionFrames={moduleInstanceSelectionFrames}\n          overlayLines={overlayLines}\n''',
    "DrawingCanvas frame projection"
)

replace_once(
    "src/vscode/protocol.ts",
    '''  | { type: "canvasNavigationResult"; requestId: number; status: "ready" | "no-target" | "stale" | "focused" }\n''',
    '''  | { type: "canvasNavigationResult"; requestId: number; status: "ready" | "no-target" | "no-renderable-geometry" | "stale" | "focused" }\n''',
    "protocol navigation status"
)

replace_once(
    "src/vscode/VSCodeApp.tsx",
    'import { canvasElementDrawingBounds } from "../geometry/canvasDrawingBounds";\n',
    'import { canvasElementDrawingBounds } from "../geometry/canvasDrawingBounds";\nimport { moduleInstanceCanvasGeometry } from "../geometry/moduleInstanceCanvasGeometry";\n',
    "VSCodeApp instance geometry import"
)
replace_regex_once(
    "src/vscode/VSCodeApp.tsx",
    r'''        const owners = sourceOwnerByRuntimeElementId\(current\.compiled\);.*?        api\.postMessage\(\{ type: "canvasNavigationResult", requestId: message\.requestId, status: "ready" \}\);''',
    '''        const owners = sourceOwnerByRuntimeElementId(current.compiled);\n        const runtimeElements = effectiveElements(current.state);\n        const runtimeElementIds = current.state.elements\n          .filter((element) => owners.get(element.id)?.sourceStatementIndex === target.sourceStatementIndex)\n          .map((element) => element.id);\n        if (runtimeElementIds.length === 0) {\n          api.postMessage({ type: "canvasNavigationResult", requestId: message.requestId, status: "no-target" });\n          return;\n        }\n\n        const runtimeElementById = new Map(runtimeElements.map((element) => [element.id, element]));\n        const instanceId = runtimeElementIds.find((id) => runtimeElementById.get(id)?.type === "moduleInstance") ?? null;\n        const currentEvaluation = evaluationRef.current;\n        const currentEvaluationIsCurrent = evaluationStateIsCurrentFor(\n          evaluationStateRef.current,\n          current.state.compiledDocumentRevision\n        );\n        let selectionIds = runtimeElementIds;\n        let primarySelectionId = runtimeElementIds[0]!;\n        let revealBounds = null;\n\n        if (instanceId) {\n          if (!currentEvaluationIsCurrent || !(currentEvaluation.computedGeometry instanceof Map)) {\n            api.postMessage({ type: "canvasNavigationResult", requestId: message.requestId, status: "stale" });\n            return;\n          }\n          const instanceGeometry = moduleInstanceCanvasGeometry({\n            instanceId,\n            elements: runtimeElements,\n            evaluation: currentEvaluation,\n            moduleMaterialization: current.state.doc.moduleMaterialization,\n            visibilityProfiles: current.state.visibilityProfiles,\n            activeVisibilityProfileId: current.state.activeVisibilityProfileId,\n            measureCanvasTextWidth\n          });\n          if (!instanceGeometry?.bounds || instanceGeometry.renderableDescendantIds.length === 0) {\n            api.postMessage({\n              type: "canvasNavigationResult",\n              requestId: message.requestId,\n              status: "no-renderable-geometry"\n            });\n            return;\n          }\n          selectionIds = [instanceId];\n          primarySelectionId = instanceId;\n          revealBounds = instanceGeometry.bounds;\n        }\n\n        if (!replaceCanvasSelection(selectionIds, primarySelectionId, true)) {\n          api.postMessage({ type: "canvasNavigationResult", requestId: message.requestId, status: "no-target" });\n          return;\n        }\n\n        const viewport = canvasFocusRef.current;\n        if (viewport) {\n          const rect = viewport.getBoundingClientRect();\n          const bounds = revealBounds ?? (\n            currentEvaluation &&\n            currentEvaluationIsCurrent &&\n            currentEvaluation.computedGeometry instanceof Map\n              ? canvasElementDrawingBounds({\n                  elementId: primarySelectionId,\n                  elements: runtimeElements,\n                  evaluation: currentEvaluation,\n                  visibilityProfiles: current.state.visibilityProfiles,\n                  activeVisibilityProfileId: current.state.activeVisibilityProfileId,\n                  measureCanvasTextWidth\n                })\n              : null\n          );\n          if (bounds && Number.isFinite(rect.width) && Number.isFinite(rect.height)) {\n            const pan = minimumCanvasPanForBounds(bounds, useCadUiStore.getState().canvasViewport, {\n              width: rect.width,\n              height: rect.height\n            });\n            if (pan && (pan.dx !== 0 || pan.dy !== 0)) {\n              useCadUiStore.getState().panCanvasViewport(pan.dx, pan.dy);\n            }\n          }\n        }\n        api.postMessage({ type: "canvasNavigationResult", requestId: message.requestId, status: "ready" });''',
    "VSCodeApp module instance reveal"
)

replace_once(
    "vscode-extension/src/extension.ts",
    '''    if (message.status === "focused") {\n      session.pendingCanvasFocus = null;\n      session.inFlightCanvasNavigation = null;\n      return;\n    }\n''',
    '''    if (message.status === "no-renderable-geometry") {\n      session.pendingCanvasFocus = null;\n      session.inFlightCanvasNavigation = null;\n      void vscode.window.showErrorMessage(\n        "nuinuiCAD: このModule instanceには現在表示できるgeometryがありません。"\n      );\n      deliverPendingCanvasNavigation(session);\n      return;\n    }\n    if (message.status === "focused") {\n      session.pendingCanvasFocus = null;\n      session.inFlightCanvasNavigation = null;\n      return;\n    }\n''',
    "extension no-renderable feedback"
)

replace_once(
    "src/vscode/VSCodeApp.test.tsx",
    'import { sourceOwnerByRuntimeElementId } from "../dsl/sourceOwnership";\n',
    'import { sourceOwnerByRuntimeElementId } from "../dsl/sourceOwnership";\nimport type { EvaluationResult } from "../types/geometry";\n',
    "VSCodeApp test evaluation import"
)
replace_once(
    "src/vscode/VSCodeApp.test.tsx",
    '''  bakeSandboxPromise: null as Promise<unknown> | null\n}));\n''',
    '''  bakeSandboxPromise: null as Promise<unknown> | null,\n  evaluation: { computedGeometry: new Map(), errors: [], warnings: [] } as EvaluationResult\n}));\n''',
    "VSCodeApp test evaluation fixture"
)
replace_once(
    "src/vscode/VSCodeApp.test.tsx",
    '''  useEvaluationEngine: () => ({\n    evaluation: {},\n    evaluationState: { evaluation: {} }\n  })\n''',
    '''  useEvaluationEngine: () => ({\n    evaluation: drawingCanvasProps.evaluation\n  })\n''',
    "VSCodeApp test evaluation mock"
)
replace_once(
    "src/vscode/VSCodeApp.test.tsx",
    '''    drawingCanvasProps.bakeSandboxPromise = null;\n  });\n''',
    '''    drawingCanvasProps.bakeSandboxPromise = null;\n    drawingCanvasProps.evaluation = { computedGeometry: new Map(), errors: [], warnings: [] };\n  });\n''',
    "VSCodeApp test evaluation reset"
)
replace_once(
    "src/vscode/VSCodeApp.test.tsx",
    '''    ["disabled", "nui 4\\npoint A = coordinate(x: 0, y: 0, state: disabled)", "A", false],\n    ["non-renderable", "nui 4\\nmodule M() {\\n  point P = coordinate(x: 0, y: 0)\\n}\\ninstance A = M()", "A", true]\n''',
    '''    ["disabled", "nui 4\\npoint A = coordinate(x: 0, y: 0, state: disabled)", "A", false],\n    ["non-renderable", "nui 4\\nmodule M() {\\n  point P = coordinate(x: 0, y: 0)\\n}\\ninstance A = M()", "A", false]\n''',
    "VSCodeApp old instance expectation"
)

insert_before_last(
    "src/vscode/VSCodeApp.test.tsx",
    "\n});",
    r'''

  it("reveals a concrete Module instance as one identity and minimally pans its descendant bounds without zooming", async () => {
    const source = [
      "nui 4",
      "module M() {",
      "  point P = coordinate(x: 80, y: 0)",
      "}",
      "instance A = M()"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 31 }
      }));
    });
    const state = useCadDocumentStore.getState();
    const instance = state.elements.find((element) => element.type === "moduleInstance" && element.name === "A")!;
    const child = state.elements.find((element) => element.parentGroupId === instance.id && element.name === "P")!;
    drawingCanvasProps.evaluation.computedGeometry.set(child.id, {
      kind: "point",
      elementId: child.id,
      name: child.name,
      x: 80,
      y: 0
    });
    const canvas = screen.getByTestId("canvas");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      toJSON: () => ({})
    } as DOMRect);
    useCadUiStore.getState().setCanvasViewport({ panX: 0, panY: 0, zoom: 1 });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasNavigationRequest",
          requestId: 311,
          documentVersion: 31,
          normalizedSourceOffset: source.indexOf("A = M")
        }
      }));
    });

    expect(useCadUiStore.getState().selectedElementIds).toEqual([instance.id]);
    expect(useCadUiStore.getState().selectedElementId).toBe(instance.id);
    expect(useCadUiStore.getState().selectedElementIds).not.toContain(child.id);
    expect(useCadUiStore.getState().canvasViewport).toEqual({ panX: -30, panY: 0, zoom: 1 });
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasNavigationResult",
      requestId: 311,
      status: "ready"
    });
  });

  it("preserves selection and viewport when a Module instance has no currently renderable descendants", async () => {
    const source = [
      "nui 4",
      "point Existing = coordinate(x: 0, y: 0)",
      "module M() {",
      "  point P = coordinate(x: 80, y: 0, state: hidden)",
      "}",
      "instance A = M()"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 32 }
      }));
    });
    const state = useCadDocumentStore.getState();
    const existing = state.elements.find((element) => element.name === "Existing")!;
    const instance = state.elements.find((element) => element.type === "moduleInstance" && element.name === "A")!;
    const child = state.elements.find((element) => element.parentGroupId === instance.id && element.name === "P")!;
    drawingCanvasProps.evaluation.computedGeometry.set(child.id, {
      kind: "point",
      elementId: child.id,
      name: child.name,
      x: 80,
      y: 0
    });
    selectElement(existing.id, "replace", true);
    useCadUiStore.getState().setCanvasViewport({ panX: 17, panY: -9, zoom: 2 });
    const selectionBefore = {
      selectedElementId: useCadUiStore.getState().selectedElementId,
      selectedElementIds: [...useCadUiStore.getState().selectedElementIds],
      selectionAnchorElementId: useCadUiStore.getState().selectionAnchorElementId
    };
    const viewportBefore = { ...useCadUiStore.getState().canvasViewport };

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasNavigationRequest",
          requestId: 321,
          documentVersion: 32,
          normalizedSourceOffset: source.indexOf("A = M")
        }
      }));
    });

    expect(useCadUiStore.getState()).toMatchObject(selectionBefore);
    expect(useCadUiStore.getState().canvasViewport).toEqual(viewportBefore);
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasNavigationResult",
      requestId: 321,
      status: "no-renderable-geometry"
    });
  });
''',
    "VSCodeApp SAY-125 tests"
)

Path("src/components/CanvasOverlay.test.tsx").write_text(
    Path("src/components/CanvasOverlay.test.tsx").read_text() + r'''

describe("Module instance selection frame", () => {
  it("renders the frame and name with the Canvas selection semantic and no pointer target", () => {
    const { container } = render(
      <CanvasOverlay
        viewportSize={{ width: 500, height: 400 }}
        moduleInstanceSelectionFrames={[{
          instanceId: "instance",
          name: "InstanceOne",
          left: 10,
          top: 20,
          width: 120,
          height: 80
        }]}
        overlayLines={[]}
        overlayArcs={[]}
        overlayCurves={[]}
        overlayOffsetLines={[]}
        overlayPoints={[]}
        overlayTexts={[]}
        selectedBezierEditingHelper={null}
        selectedBezierHandles={[]}
        overlayPointPickCandidates={[]}
        selectedElementIdSet={new Set(["instance"])}
        draftLinePickElementIds={new Set()}
        pickCandidateLineIds={new Set()}
        selectedElementId="instance"
        canvasTheme={LEGACY_CANVAS_THEME}
        elementColors={new Map()}
        showCanvasPointNames={false}
        showCanvasGeometryNames={false}
        showCanvasPoints={false}
        isPointPickActive={false}
        isNumericReferencePickActive={false}
        isLinePickActive={false}
        hoveredElementIds={new Set()}
        hoverRepresentativeElementId={null}
      />
    );

    const frame = container.querySelector("[data-module-instance-selection-frame='instance']");
    const rect = frame?.querySelector("rect");
    const label = container.querySelector("[data-module-instance-selection-label='instance']");
    expect(frame).toHaveStyle({ pointerEvents: "none" });
    expect(rect).toHaveAttribute("stroke", "var(--canvas-selection)");
    expect(rect).toHaveStyle({ pointerEvents: "none" });
    expect(label).toHaveTextContent("InstanceOne");
    expect(label).toHaveAttribute("fill", "var(--canvas-selection)");
  });
});
'''
)

Path("vscode-extension/src/extension.test.ts").write_text(
    Path("vscode-extension/src/extension.test.ts").read_text() + r'''

describe("SAY-125 Module instance Reveal feedback", () => {
  it("reports a no-renderable result without asking the Canvas to take focus", async () => {
    const source = [
      "nui 4",
      "module M() {",
      "  point P = coordinate(x: 0, y: 0, state: hidden)",
      "}",
      "instance A = M()"
    ].join("\n");
    const document = documentFor("/tmp/instance.nui", "file:///tmp/instance.nui", source);
    const editor = editorFor(document);
    editor.selection.active = document.positionAt(source.indexOf("A = M"));
    setup(false, editor, [document]);
    const panel = openPanelFor(editor);
    await messageHandlerFor(panel)({ type: "webviewReady" });
    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });
    panel.webview.postMessage.mockClear();
    mocks.showErrorMessage.mockClear();

    commandHandlerFor("nuinuiCAD.revealInCanvas")?.();
    const request = panel.webview.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "canvasNavigationRequest") as { requestId: number } | undefined;
    expect(request).toBeDefined();

    await messageHandlerFor(panel)({
      type: "canvasNavigationResult",
      requestId: request!.requestId,
      status: "no-renderable-geometry"
    });

    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      "nuinuiCAD: このModule instanceには現在表示できるgeometryがありません。"
    );
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "focusCanvas", requestId: request!.requestId })
    );
  });
});
'''
)
