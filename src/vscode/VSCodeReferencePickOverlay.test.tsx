import { act, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { compileFreshCanonicalText } from "@nuinuicad/nui-language/document";
import type { LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import { evaluateElements } from "../geometry/evaluate";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { emptyEvaluationResult } from "../geometry/evaluationEngine";
import { LEGACY_CANVAS_THEME } from "../components/canvasTheme";
import { candidateWheelDeltaFor } from "../components/canvasCandidateWheel";
import type { ReferencePickCandidate } from "../model/referencePickCandidates";
import type { ReferencePickHover, ReferencePickNumericPropertySession } from "../model/referencePickSession";
import type { NumericComputedGeometryProperty } from "../geometry/numericExpressions";
import type { CadElement, ComputedJoinedPath, ComputedLine, EvaluationResult } from "../types/geometry";
import { webviewPresentationFor } from "../../vscode-extension/src/webviewPresentationLocalization";
import type { VscodeReferencePickCanvasSession } from "./referencePickCanvasSession";
import { webviewCanvasPresentationFor } from "./webviewCanvasPresentation";
import { VSCodeReferencePickOverlay } from "./VSCodeReferencePickOverlay";
import {
  compositeCssColorOver,
  contrastRatio,
  parseCssColor,
  resolveVSCodeCanvasTheme
} from "./vscodeCanvasTheme";

const stylesheet = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
const cssRules = [...stylesheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, declarations]) => ({
  selectors: selectors?.split(",").map((selector) => selector.trim()) ?? [],
  declarations: declarations ?? ""
}));

const cssValue = (selector: string, property: string): string | null => {
  const propertyPattern = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "i");
  const matchingRule = [...cssRules].reverse().find((rule) =>
    rule.selectors.includes(selector) && propertyPattern.test(rule.declarations)
  );
  return matchingRule?.declarations.match(propertyPattern)?.[1]?.trim() ?? null;
};

const sessionFor = ({
  expectedGeometryInterface = "line",
  role = "geometry",
  multiplicity = "single",
  draftReferences = [],
  candidates = [],
  syntax,
  requestId = 1,
  numericProperty,
  hover = null,
  status = "active",
  preserveSourceFocus = false
}: {
  expectedGeometryInterface?: "point" | "line" | "path";
  role?: "geometry" | "endpoint" | "numericPropertyBase";
  multiplicity?: "single" | "multiple";
  draftReferences?: readonly { base: string; pointKey?: string }[];
  candidates?: readonly ReferencePickCandidate[];
  syntax?: "transformationTarget";
  requestId?: number;
  numericProperty?: ReferencePickNumericPropertySession | null;
  hover?: ReferencePickHover | null;
  status?: "active" | "confirmed" | "canceled";
  preserveSourceFocus?: boolean;
} = {}): VscodeReferencePickCanvasSession => ({
  request: { requestId, ...(preserveSourceFocus ? { preserveSourceFocus: true } : {}) },
  target: {
    ...(syntax ? { syntax } : {}),
    expectedGeometryInterface,
    role,
    multiplicity,
    ...(numericProperty ? { numericProperty: numericProperty.target } : role === "numericPropertyBase"
      ? { numericProperty: { kind: "propertySelectionRequired" as const } }
      : {})
  },
  candidates,
  draft: {
    expectedGeometryInterface,
    role,
    multiplicity,
    hover,
    draftReferences,
    numericProperty: numericProperty ?? (role === "numericPropertyBase" ? {
      target: { kind: "propertySelectionRequired" },
      stage: "geometrySelection",
      selectedGeometry: null,
      properties: [],
      draft: null
    } : null),
    status
  }
} as unknown as VscodeReferencePickCanvasSession);

const pointCandidate = ({
  elementId,
  reference,
  label = reference.pointKey ?? reference.base,
  x = 0,
  y = 0,
  anchor = { mode: "reference", pointId: elementId }
}: {
  elementId: string;
  reference: { base: string; pointKey?: string };
  label?: string;
  x?: number;
  y?: number;
  anchor?: { mode: "reference"; pointId: string } | { mode: "derived"; elementId: string; pointKey: string };
}): ReferencePickCandidate => ({
  elementId,
  actualGeometryInterface: "point",
  options: [{
    kind: "point",
    label,
    anchor,
    point: { kind: "point", elementId, name: label, x, y },
    reference
  }]
});

type OverlayCallbacks = {
  onHover: (hover: ReferencePickHover | null) => void;
  onSelect: (selection: ReferencePickHover | null) => void;
  onSelectNumericProperty: (property: NumericComputedGeometryProperty) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

const renderOverlay = (
  session: VscodeReferencePickCanvasSession,
  overrides: Partial<OverlayCallbacks> = {},
  surface: {
    elements?: CadElement[];
    evaluation?: EvaluationResult;
    canvasTheme?: typeof LEGACY_CANVAS_THEME;
    showCanvasGeometryNames?: boolean;
  } = {},
  presentation?: ReturnType<typeof webviewCanvasPresentationFor>
) => {
  const viewport = document.createElement("div");
  viewport.tabIndex = 0;
  document.body.append(viewport);
  const callbacks: OverlayCallbacks = {
    onHover: overrides.onHover ?? vi.fn<(hover: ReferencePickHover | null) => void>(),
    onSelect: overrides.onSelect ?? vi.fn<(selection: ReferencePickHover | null) => void>(),
    onSelectNumericProperty: overrides.onSelectNumericProperty ?? vi.fn<(property: NumericComputedGeometryProperty) => void>(),
    onConfirm: overrides.onConfirm ?? vi.fn<() => void>(),
    onCancel: overrides.onCancel ?? vi.fn<() => void>()
  };
  const view = render(
    createElement(VSCodeReferencePickOverlay, ({
      canvasFocusRef: { current: viewport },
      viewportSize: { width: 640, height: 480 },
      canvasViewport: { panX: 0, panY: 0, zoom: 1 },
      canvasTheme: surface.canvasTheme ?? LEGACY_CANVAS_THEME,
      elements: surface.elements ?? [],
      evaluation: surface.evaluation ?? emptyEvaluationResult(surface.elements ?? []),
      visibilityProfiles: [],
      activeVisibilityProfileId: null,
      session,
      onHover: callbacks.onHover,
      onSelect: callbacks.onSelect,
      onSelectNumericProperty: callbacks.onSelectNumericProperty,
      onConfirm: callbacks.onConfirm,
      onCancel: callbacks.onCancel,
      presentation,
      showCanvasGeometryNames: surface.showCanvasGeometryNames ?? false
    } as unknown) as Parameters<typeof VSCodeReferencePickOverlay>[0]),
    { container: viewport }
  );
  return { viewport, callbacks, view };
};

const numericLineElement: CadElement = {
  id: "Base",
  name: "Base",
  type: "line",
  activity: "visible",
  startPoint: { mode: "coordinate", x: -100, y: 0 },
  endPoint: { mode: "coordinate", x: 100, y: 0 }
};

const numericLineGeometry: ComputedLine = {
  kind: "line",
  elementId: "Base",
  name: "Base",
  startPointId: null,
  endPointId: null,
  start: { kind: "point", elementId: "Base:start", name: "start", x: -100, y: 0 },
  end: { kind: "point", elementId: "Base:end", name: "end", x: 100, y: 0 },
  length: 200,
  startAngleDeg: 0,
  endAngleDeg: 180,
  startTangentAngleDeg: 0,
  endTangentAngleDeg: 180
};

const numericLineEvaluation: EvaluationResult = {
  ...emptyEvaluationResult([numericLineElement]),
  computedGeometry: new Map([["Base", numericLineGeometry]]),
  evaluatedElementIds: new Set(["Base"]),
  effectiveVisibleElementIds: new Set(["Base"]),
  effectiveEnabledElementIds: new Set(["Base"])
};

const numericLineCandidate: ReferencePickCandidate = {
  elementId: "Base",
  actualGeometryInterface: "line",
  options: [{
    kind: "numericProperty",
    label: "Base",
    reference: { base: "Base" },
    subgeometry: { kind: "body" },
    properties: ["length", "startAngleDeg"]
  }]
};

const numericLineStartCandidate: ReferencePickCandidate = {
  elementId: "Base",
  actualGeometryInterface: "line",
  options: [
    {
      kind: "numericProperty",
      label: "Base",
      reference: { base: "Base" },
      subgeometry: { kind: "body" },
      properties: ["length"]
    },
    {
      kind: "numericProperty",
      label: "Base.始点",
      reference: { base: "Base" },
      subgeometry: {
        kind: "point",
        anchor: { mode: "derived", elementId: "Base", pointKey: "start" }
      },
      properties: ["startPoint.x", "startPoint.y", "startAngleDeg"],
      point: numericLineGeometry.start
    },
    {
      kind: "numericProperty",
      label: "Base.終点",
      reference: { base: "Base" },
      subgeometry: {
        kind: "point",
        anchor: { mode: "derived", elementId: "Base", pointKey: "end" }
      },
      properties: ["endPoint.x", "endPoint.y", "endAngleDeg"],
      point: numericLineGeometry.end
    }
  ]
};

const generatedPickNameSource = [
  "nui 1",
  "for i in range(min: 0, max: 2, step: 1, showGenerated: true) {",
  "  line Mark = segment(start: (@i * 30 + 10, @i * 18 + 12), end: (@i * 30 + 22, @i * 18 + 12))",
  "}"
].join("\n");

const generatedPickNameSurface = () => {
  const compiled = compileFreshCanonicalText(generatedPickNameSource).currentCompiled;
  const elements = compiled.document?.elements ?? [];
  const evaluation = evaluateElements(elements, buildEvaluationOptions({
    compiledDocument: compiled as LastGoodDslDocument,
    evaluationLimitIndex: undefined
  }));
  const lines = [...evaluation.computedGeometry.values()]
    .filter((geometry): geometry is ComputedLine => geometry.kind === "line")
    .sort((left, right) => left.name.localeCompare(right.name));
  const candidates: ReferencePickCandidate[] = lines.map((line, index) => ({
    elementId: line.elementId,
    actualGeometryInterface: "line",
    options: [
      { kind: "geometry", label: `@Mark[${index}]`, reference: { base: "Mark", occurrenceIndex: index } },
      {
        kind: "geometry",
        label: `@Mark[${index}].end`,
        reference: { base: "Mark", occurrenceIndex: index, pointKey: "end" }
      }
    ]
  }));
  return { elements, evaluation, lines, candidates };
};

const vscodeThemeFor = (foreground: string, background: string, accent: string, muted = "#616161") =>
  resolveVSCodeCanvasTheme({
    getPropertyValue: (name) => ({
      "--vscode-editor-foreground": foreground,
      "--vscode-editor-background": background,
      "--vscode-focusBorder": accent,
      "--vscode-descriptionForeground": muted
    })[name as "--vscode-editor-foreground" | "--vscode-editor-background" | "--vscode-focusBorder" | "--vscode-descriptionForeground"] ?? ""
  });

const mixColor = (foreground: string, background: string, amount: number) => {
  const from = parseCssColor(foreground);
  const to = parseCssColor(background);
  if (!from || !to) throw new Error("Expected theme colors to parse");
  return {
    red: from.red * amount + to.red * (1 - amount),
    green: from.green * amount + to.green * (1 - amount),
    blue: from.blue * amount + to.blue * (1 - amount),
    alpha: 1,
    hasExplicitAlpha: false
  };
};

const effectivePickContrast = (theme: typeof LEGACY_CANVAS_THEME, opacity: number) => {
  const pick = parseCssColor(theme.pickCandidate);
  const background = parseCssColor(theme.background);
  if (!pick || !background) throw new Error("Expected pick theme colors to parse");
  const visiblePick = compositeCssColorOver({
    ...pick,
    alpha: pick.alpha * opacity,
    hasExplicitAlpha: true
  }, background);
  return contrastRatio(visiblePick, background);
};

const joinedPathElement: CadElement = {
  id: "Joined",
  name: "Joined",
  type: "joinedPath",
  activity: "visible",
  pathIds: ["Source"],
  closed: false
};

const joinedPathGeometry: ComputedJoinedPath = {
  kind: "joinedPath",
  elementId: "Joined",
  name: "Joined",
  pathIds: ["Source"],
  start: { kind: "point", elementId: "Joined:start", name: "start", x: -20, y: 20 },
  end: { kind: "point", elementId: "Joined:end", name: "end", x: 20, y: 20 },
  segments: [{
    kind: "line",
    start: { kind: "point", elementId: "Joined:start", name: "start", x: -20, y: 20 },
    end: { kind: "point", elementId: "Joined:end", name: "end", x: 20, y: 20 },
    length: 40
  }],
  closed: false,
  length: 40,
  startTangentAngleDeg: 0,
  endTangentAngleDeg: 0
};

describe("VSCodeReferencePickOverlay", () => {
  it("selects an unambiguous geometry option in one click", () => {
    const candidate: ReferencePickCandidate = { elementId: "Base", actualGeometryInterface: "line",
      options: [{ kind: "geometry", label: "@Base", reference: { base: "Base" } }] };
    const { viewport, callbacks, view } = renderOverlay(sessionFor({ candidates: [candidate] }), {}, {
      elements: [numericLineElement], evaluation: numericLineEvaluation
    });
    fireEvent.pointerDown(viewport, { button: 0, clientX: 320, clientY: 240 });
    expect(callbacks.onSelect).toHaveBeenCalledExactlyOnceWith({ candidateElementId: "Base", reference: { base: "Base" } });
    expect(screen.queryByRole("listbox")).toBeNull();
    view.unmount();
    viewport.remove();
  });

  it("uses canonical geometry alternatives, deduplicates options, and dismisses the menu without selecting", () => {
    const candidate: ReferencePickCandidate = { elementId: "Base", actualGeometryInterface: "line",
      options: [
        { kind: "geometry", label: "@Base", reference: { base: "Base" } },
        { kind: "geometry", label: "@Base.end", reference: { base: "Base", pointKey: "end" } },
        { kind: "geometry", label: "@Base", reference: { base: "Base" } }
      ] };
    const { viewport, callbacks, view } = renderOverlay(sessionFor({ candidates: [candidate] }), {}, {
      elements: [numericLineElement], evaluation: numericLineEvaluation
    });
    fireEvent.pointerDown(viewport, { button: 0, clientX: 320, clientY: 240 });
    expect(screen.getAllByRole("option").map(option => option.querySelector("strong")!.textContent))
      .toEqual(["@Base", "@Base.end"]);
    expect(callbacks.onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(callbacks.onCancel).not.toHaveBeenCalled();
    expect(callbacks.onSelect).not.toHaveBeenCalled();
    expect(callbacks.onConfirm).not.toHaveBeenCalled();
    fireEvent.pointerDown(viewport, { button: 0, clientX: 320, clientY: 240 });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(callbacks.onSelect).toHaveBeenCalledExactlyOnceWith({ candidateElementId: "Base", reference: { base: "Base", pointKey: "end" } });
    expect(callbacks.onConfirm).not.toHaveBeenCalled();
    view.unmount();
    viewport.remove();
  });

  it("keeps bulk selection in Details and never activates a hidden option on collapse", () => {
    const candidate: ReferencePickCandidate = {
      elementId: "Base",
      actualGeometryInterface: "line",
      options: [
        { kind: "geometry", label: "@Mark", reference: { base: "Mark" } },
        { kind: "geometry", label: "@Mark.end", reference: { base: "Mark", pointKey: "end" } },
        { kind: "geometry", label: "@Mark[1]", reference: { base: "Mark", occurrenceIndex: 1 } },
        { kind: "geometry", label: "@Mark[1].end", reference: { base: "Mark", occurrenceIndex: 1, pointKey: "end" } }
      ]
    };
    const { viewport, callbacks, view } = renderOverlay(
      sessionFor({ syntax: "transformationTarget", candidates: [candidate] }),
      {},
      { elements: [numericLineElement], evaluation: numericLineEvaluation },
      webviewCanvasPresentationFor(webviewPresentationFor("en"))
    );

    fireEvent.pointerDown(viewport, { button: 0, clientX: 320, clientY: 240 });
    const listbox = screen.getByRole("listbox", { name: "Reference Pick geometry candidates" });
    const labels = () => screen.getAllByRole("option").map(option => option.querySelector("strong")!.textContent);
    expect(labels()).toEqual(["@Mark[1]", "@Mark[1].end"]);
    const disclosure = screen.getByRole("button", { name: "Other candidates / Details" });
    expect(disclosure).not.toHaveAttribute("role", "option");
    expect(listbox).not.toContainElement(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(callbacks.onSelect).not.toHaveBeenCalled();

    fireEvent.keyDown(disclosure, { key: "Enter" });
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(labels()).toEqual(["@Mark[1]", "@Mark[1].end", "@Mark", "@Mark.end"]);
    expect(document.activeElement).toBe(viewport);

    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[3]).toHaveAttribute("aria-selected", "true");
    disclosure.focus();
    fireEvent.keyDown(disclosure, { key: " " });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(labels()).toEqual(["@Mark[1]", "@Mark[1].end"]);
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(viewport);

    fireEvent.keyDown(window, { key: "Enter" });
    expect(callbacks.onSelect).toHaveBeenCalledExactlyOnceWith({
      candidateElementId: "Base",
      reference: { base: "Mark", occurrenceIndex: 1 }
    });
    expect(callbacks.onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
    view.unmount();
    viewport.remove();
  });

  it.each([
    {
      group: "primary",
      expanded: false,
      optionLabel: "@Mark[1].end",
      expectedReference: { base: "Mark", occurrenceIndex: 1, pointKey: "end" }
    },
    {
      group: "expanded details",
      expanded: true,
      optionLabel: "@Mark",
      expectedReference: { base: "Mark" }
    }
  ])("Enter activates the focused non-active $group option", ({ expanded, optionLabel, expectedReference }) => {
    const candidate: ReferencePickCandidate = {
      elementId: "Base",
      actualGeometryInterface: "line",
      options: [
        { kind: "geometry", label: "@Mark", reference: { base: "Mark" } },
        { kind: "geometry", label: "@Mark.end", reference: { base: "Mark", pointKey: "end" } },
        { kind: "geometry", label: "@Mark[1]", reference: { base: "Mark", occurrenceIndex: 1 } },
        { kind: "geometry", label: "@Mark[1].end", reference: { base: "Mark", occurrenceIndex: 1, pointKey: "end" } }
      ]
    };
    const { viewport, callbacks, view } = renderOverlay(
      sessionFor({ syntax: "transformationTarget", candidates: [candidate] }),
      {},
      { elements: [numericLineElement], evaluation: numericLineEvaluation }
    );
    fireEvent.pointerDown(viewport, { button: 0, clientX: 320, clientY: 240 });
    if (expanded) fireEvent.click(screen.getByRole("button", { name: "Other candidates / Details" }));

    const focusedOption = screen.getAllByRole("option").find(option =>
      option.querySelector("strong")?.textContent === optionLabel
    );
    expect(focusedOption).toBeDefined();
    focusedOption!.focus();
    expect(document.activeElement).toBe(focusedOption);
    fireEvent.keyDown(focusedOption!, { key: "Enter" });

    expect(callbacks.onSelect).toHaveBeenCalledExactlyOnceWith({
      candidateElementId: "Base",
      reference: expectedReference
    });
    expect(callbacks.onConfirm).not.toHaveBeenCalled();
    view.unmount();
    viewport.remove();
  });

  it("allows pointer selection of an explicitly expanded bulk detail", () => {
    const candidate: ReferencePickCandidate = {
      elementId: "Base",
      actualGeometryInterface: "line",
      options: [
        { kind: "geometry", label: "@Mark", reference: { base: "Mark" } },
        { kind: "geometry", label: "@Mark.end", reference: { base: "Mark", pointKey: "end" } },
        { kind: "geometry", label: "@Mark[1]", reference: { base: "Mark", occurrenceIndex: 1 } },
        { kind: "geometry", label: "@Mark[1].end", reference: { base: "Mark", occurrenceIndex: 1, pointKey: "end" } }
      ]
    };
    const { viewport, callbacks, view } = renderOverlay(
      sessionFor({ syntax: "transformationTarget", candidates: [candidate] }),
      {},
      { elements: [numericLineElement], evaluation: numericLineEvaluation }
    );
    fireEvent.pointerDown(viewport, { button: 0, clientX: 320, clientY: 240 });
    const disclosure = screen.getByRole("button", { name: "Other candidates / Details" });
    fireEvent.click(disclosure);
    const bulk = screen.getAllByRole("option").find(option => option.querySelector("strong")?.textContent === "@Mark");
    expect(bulk).toBeDefined();
    fireEvent.click(bulk!);
    expect(callbacks.onSelect).toHaveBeenCalledExactlyOnceWith({ candidateElementId: "Base", reference: { base: "Mark" } });
    expect(callbacks.onConfirm).not.toHaveBeenCalled();
    view.unmount();
    viewport.remove();
  });

  it("keeps overlapping real owners in hit priority even when their canonical options are equal", () => {
    const other = { ...numericLineElement, id: "Other", name: "Other" };
    const evaluation: EvaluationResult = { ...numericLineEvaluation,
      computedGeometry: new Map([
        ["Base", numericLineGeometry],
        ["Other", { ...numericLineGeometry, elementId: "Other", name: "Other" }]
      ]),
      effectiveVisibleElementIds: new Set(["Base", "Other"]),
      effectiveEnabledElementIds: new Set(["Base", "Other"]),
      evaluatedElementIds: new Set(["Base", "Other"]) };
    const candidates: ReferencePickCandidate[] = ["Base", "Other"].map(elementId => ({
      elementId,
      actualGeometryInterface: "line",
      options: [{ kind: "geometry", label: "@Mark[1]", reference: { base: "Mark", occurrenceIndex: 1 } }]
    }));
    const { viewport, callbacks, view } = renderOverlay(
      sessionFor({ syntax: "transformationTarget", candidates }),
      {},
      { elements: [numericLineElement, other], evaluation }
    );

    fireEvent.pointerDown(viewport, { button: 0, clientX: 320, clientY: 240 });
    expect(screen.getAllByRole("option").map(option => option.querySelector("small")!.textContent)).toEqual([
      "This generated occurrence · Other",
      "This generated occurrence · Base"
    ]);
    fireEvent.click(screen.getAllByRole("option")[1]!);
    expect(callbacks.onSelect).toHaveBeenCalledExactlyOnceWith({
      candidateElementId: "Base",
      reference: { base: "Mark", occurrenceIndex: 1 }
    });
    view.unmount();
    viewport.remove();
  });

  it("cycles candidates with popup wheel and scrolls the active option into view", () => {
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
    const scrolledLabels: string[] = [];
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(function (this: HTMLElement) {
        scrolledLabels.push(this.querySelector("strong")?.textContent ?? "");
      })
    });
    try {
      const candidate: ReferencePickCandidate = {
        elementId: "Base",
        actualGeometryInterface: "line",
        options: [
          { kind: "geometry", label: "@Mark", reference: { base: "Mark" } },
          { kind: "geometry", label: "@Mark.end", reference: { base: "Mark", pointKey: "end" } },
          { kind: "geometry", label: "@Mark[1]", reference: { base: "Mark", occurrenceIndex: 1 } },
          { kind: "geometry", label: "@Mark[1].end", reference: { base: "Mark", occurrenceIndex: 1, pointKey: "end" } }
        ]
      };
      const { viewport, callbacks, view } = renderOverlay(
        sessionFor({ syntax: "transformationTarget", candidates: [candidate] }),
        {},
        { elements: [numericLineElement], evaluation: numericLineEvaluation }
      );
      fireEvent.pointerDown(viewport, { button: 0, clientX: 320, clientY: 240 });
      const labels = () => screen.getAllByRole("option").map(option => option.querySelector("strong")!.textContent);
      expect(labels()).toEqual(["@Mark[1]", "@Mark[1].end"]);

      const popup = document.querySelector<HTMLElement>(".canvas-overlap-candidate-menu");
      if (!popup) throw new Error("Missing Reference Pick candidate popup");
      fireEvent.wheel(popup, { deltaY: 24, deltaMode: 0 });
      expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
      fireEvent.wheel(popup, { deltaY: 24, deltaMode: 0 });
      expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
      expect(labels()).toEqual(["@Mark[1]", "@Mark[1].end"]);
      expect(callbacks.onSelect).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Other candidates / Details" }));
      fireEvent.wheel(popup, { deltaY: 24, deltaMode: 0 });
      fireEvent.wheel(popup, { deltaY: 24, deltaMode: 0 });
      fireEvent.wheel(popup, { deltaY: 24, deltaMode: 0 });
      const detailBase = screen.getAllByRole("option").find(option =>
        option.querySelector("strong")?.textContent === "@Mark.end"
      );
      expect(detailBase).toHaveAttribute("aria-selected", "true");
      expect(scrolledLabels).toContain("@Mark.end");
      expect(document.querySelector(".canvas-overlap-candidate-menu__contents")).toHaveStyle({ overflowY: "auto" });
      expect(document.querySelector(".canvas-overlap-candidate-menu__contents")).toHaveStyle({ maxHeight: "418px" });
      view.unmount();
      viewport.remove();
    } finally {
      if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView);
      else delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it("lets a long candidate popup consume wheel for scrolling and leaves outside wheel to Canvas", () => {
    const { viewport, view } = renderOverlay(sessionFor({
      expectedGeometryInterface: "point",
      candidates: [
        pointCandidate({ elementId: "A", reference: { base: "A" } }),
        pointCandidate({ elementId: "B", reference: { base: "B" } })
      ]
    }));
    fireEvent.pointerDown(viewport, { button: 0, clientX: 320, clientY: 240 });
    const popup = document.querySelector<HTMLElement>(".canvas-overlap-candidate-menu");
    if (!popup) throw new Error("Missing Reference Pick candidate popup");
    Object.defineProperties(popup, {
      clientHeight: { configurable: true, value: 40 },
      scrollHeight: { configurable: true, value: 160 },
      scrollTop: { configurable: true, value: 0, writable: true }
    });
    const canvasWheel = vi.fn();
    viewport.addEventListener("wheel", canvasWheel);

    const popupWheel = new WheelEvent("wheel", { deltaY: 24, deltaMode: 0, cancelable: true, bubbles: true });
    act(() => popup.querySelector("button")!.dispatchEvent(popupWheel));
    expect(popupWheel.defaultPrevented).toBe(false);
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    expect(canvasWheel).not.toHaveBeenCalled();

    const outsideWheel = new WheelEvent("wheel", { deltaY: 24, deltaMode: 0, cancelable: true, bubbles: true });
    act(() => viewport.dispatchEvent(outsideWheel));
    expect(outsideWheel.defaultPrevented).toBe(false);
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    expect(canvasWheel).toHaveBeenCalledTimes(1);

    viewport.removeEventListener("wheel", canvasWheel);
    view.unmount();
    viewport.remove();
  });

  it("retains shared geometry hit priority when offering overlapping owners", () => {
    const other = { ...numericLineElement, id: "Other", name: "Other" };
    const evaluation: EvaluationResult = { ...numericLineEvaluation,
      computedGeometry: new Map([["Base", numericLineGeometry], ["Other", { ...numericLineGeometry, elementId: "Other", name: "Other" }]]),
      effectiveVisibleElementIds: new Set(["Base", "Other"]),
      effectiveEnabledElementIds: new Set(["Base", "Other"]), evaluatedElementIds: new Set(["Base", "Other"]) };
    const candidates: ReferencePickCandidate[] = ["Base", "Other"].map(elementId => ({ elementId,
      actualGeometryInterface: "line", options: [{ kind: "geometry", label: `@${elementId}`, reference: { base: elementId } }] }));
    const { viewport, callbacks, view } = renderOverlay(sessionFor({ candidates }), {}, { elements: [numericLineElement, other], evaluation });
    fireEvent.pointerDown(viewport, { button: 0, clientX: 320, clientY: 240 });
    expect(screen.getAllByRole("option").map(option => option.querySelector("strong")!.textContent)).toEqual(["@Other", "@Base"]);
    fireEvent.click(screen.getAllByRole("option")[1]!);
    expect(callbacks.onSelect).toHaveBeenCalledExactlyOnceWith({ candidateElementId: "Base", reference: { base: "Base" } });
    view.unmount();
    viewport.remove();
  });
  it("leaves the shared Pick Mode shell as the owner of outer mode chrome", () => {
    renderOverlay(
      sessionFor({ expectedGeometryInterface: "line" }),
      {},
      {},
      webviewCanvasPresentationFor(webviewPresentationFor("en"))
    );

    expect(screen.queryByText("Pick · Line")).not.toBeInTheDocument();
    expect(screen.queryByText("Line target")).not.toBeInTheDocument();
    expect(screen.queryByText("Enter Done")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
  });

  it("keeps the Canvas frame and theme contract", () => {
    const { viewport, view } = renderOverlay(sessionFor());
    const frame = document.querySelector("[data-reference-pick-frame='true']");
    expect(frame).toHaveAttribute("style", expect.stringContaining("border: 4px solid var(--canvas-accent)"));
    expect(document.activeElement).toBe(viewport);

    view.unmount();
    viewport.remove();
  });

  it("keeps candidate popup content and interaction states readable in Light and Monokai themes", () => {
    expect(cssValue(".canvas-overlap-candidate-menu", "background")).toBe("var(--canvas-background)");
    expect(cssValue(".canvas-overlap-candidate-menu", "color")).toBe("var(--canvas-foreground)");
    expect(cssValue(".canvas-overlap-candidate-menu", "border")).toMatch(/var\(--canvas-foreground\)/);
    expect(cssValue(".canvas-overlap-candidate-menu", "border-radius")).toBe("6px");
    expect(cssValue(".canvas-overlap-candidate-menu", "box-shadow")).toBe("0 10px 28px rgb(37 38 34 / 18%)");
    expect(cssValue(".canvas-overlap-candidate-menu button", "color")).toBe("var(--canvas-foreground)");
    expect(cssValue(".canvas-overlap-candidate-menu button small", "color")).toBe("var(--canvas-muted)");
    expect(cssValue(".canvas-overlap-candidate-menu__disclosure", "color")).toBe("var(--canvas-foreground) !important");
    expect(cssValue(".canvas-overlap-candidate-menu__disclosure", "border-top")).toMatch(/var\(--canvas-foreground\)/);
    expect(cssValue(".canvas-overlap-candidate-menu button:hover", "background")).toMatch(/color-mix.*--canvas-accent.*--canvas-background/);
    expect(cssValue(".canvas-overlap-candidate-menu button:focus-visible", "outline")).toMatch(/var\(--canvas-accent\)/);
    expect(cssValue(".canvas-overlap-candidate-menu button.is-active", "background")).toMatch(/color-mix.*--canvas-accent.*--canvas-background/);
    expect(cssValue(".canvas-overlap-candidate-menu button.is-active small", "color")).toBe("var(--canvas-foreground)");
    expect(cssValue(".canvas-overlap-candidate-menu__disclosure[aria-expanded=\"true\"]", "background")).toMatch(/color-mix.*--canvas-accent.*--canvas-background/);

    const themes = [
      ["Light", vscodeThemeFor("#333333", "#ffffff", "#0066cc", "#595959")],
      ["Monokai", vscodeThemeFor("#f8f8f2", "#272822", "#66d9ef", "#a6a6a6")]
    ] as const;
    for (const [name, theme] of themes) {
      const foreground = parseCssColor(theme.foreground);
      const muted = parseCssColor(theme.muted);
      const background = parseCssColor(theme.background);
      if (!foreground || !muted || !background) throw new Error(`Expected ${name} theme colors to parse`);
      expect(contrastRatio(foreground, background), `${name} option and disclosure`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(muted, background), `${name} explanation`).toBeGreaterThanOrEqual(4.5);

      const hover = mixColor(theme.accent, theme.background, 0.1);
      const active = mixColor(theme.accent, theme.background, 0.18);
      const expandedDisclosure = mixColor(theme.accent, theme.background, 0.08);
      const popupBorder = mixColor(theme.foreground, theme.background, 0.54);
      expect(contrastRatio(muted, hover), `${name} hover explanation`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(foreground, hover), `${name} hover option`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(foreground, active), `${name} active option`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(foreground, expandedDisclosure), `${name} expanded disclosure`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(popupBorder, background), `${name} popup and disclosure border`).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(parseCssColor(theme.accent)!, hover), `${name} keyboard focus`).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps Source focus when a restored Reference Pick session is mounted", () => {
    const sourceEditor = document.createElement("textarea");
    document.body.append(sourceEditor);
    sourceEditor.focus();
    const { viewport, callbacks, view } = renderOverlay(sessionFor({
      requestId: 2,
      expectedGeometryInterface: "point",
      preserveSourceFocus: true,
      candidates: [
        pointCandidate({ elementId: "A", reference: { base: "A" } }),
        pointCandidate({ elementId: "B", reference: { base: "B" } })
      ]
    }));

    expect(document.activeElement).toBe(sourceEditor);
    expect(document.activeElement).not.toBe(viewport);

    viewport.focus();
    fireEvent.pointerDown(viewport, { button: 0, clientX: 320, clientY: 240 });
    expect(screen.getAllByRole("option")).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("option")[1]!);
    expect(callbacks.onSelect).toHaveBeenCalledTimes(1);
    expect(callbacks.onConfirm).not.toHaveBeenCalled();

    view.unmount();
    sourceEditor.remove();
    viewport.remove();
  });

  it.each([
    ["light", vscodeThemeFor("#333333", "#ffffff", "#0066cc")],
    ["dark", vscodeThemeFor("#d4d4d4", "#1e1e1e", "#007fd4")]
  ])("keeps an idle candidate at 3:1 effective contrast in the %s theme", (_label, theme) => {
    const { viewport, view } = renderOverlay(
      sessionFor({ candidates: [numericLineCandidate] }),
      {},
      { elements: [numericLineElement], evaluation: numericLineEvaluation, canvasTheme: theme }
    );
    const line = viewport.querySelector("[data-reference-pick-visuals] line");
    expect(line).not.toBeNull();
    const opacity = Number(line?.getAttribute("opacity") ?? "1");

    expect(effectivePickContrast(theme, opacity)).toBeGreaterThanOrEqual(3);

    view.unmount();
    viewport.remove();
  });

  it("keeps idle, hover, and selected draft candidate styles distinct", () => {
    const candidates = [numericLineCandidate];
    const renderLine = (session: VscodeReferencePickCanvasSession) => {
      const rendered = renderOverlay(session, {}, {
        elements: [numericLineElement], evaluation: numericLineEvaluation
      });
      const line = rendered.viewport.querySelector("[data-reference-pick-visuals] line");
      if (!line) throw new Error("Expected candidate line to render");
      const style = {
        stroke: line.getAttribute("stroke"),
        strokeWidth: line.getAttribute("stroke-width"),
        opacity: line.getAttribute("opacity"),
        dash: line.getAttribute("stroke-dasharray")
      };
      rendered.view.unmount();
      rendered.viewport.remove();
      return style;
    };
    const idle = renderLine(sessionFor({ candidates }));
    const hover = renderLine(sessionFor({
      candidates,
      hover: { candidateElementId: "Base", reference: { base: "Base" } }
    }));
    const selected = renderLine(sessionFor({
      candidates,
      draftReferences: [{ base: "Base" }]
    }));

    expect(idle).not.toEqual(hover);
    expect(hover).not.toEqual(selected);
    expect(selected).not.toEqual(idle);
    expect(hover).toMatchObject({ strokeWidth: "4", dash: "8 4" });
    expect(selected).toMatchObject({ stroke: "var(--canvas-selection)", strokeWidth: "5" });
  });

  it("shows one intrinsic generated name per drawable candidate when names are enabled", () => {
    const { elements, evaluation, lines, candidates } = generatedPickNameSurface();
    expect(lines.map((line) => line.name)).toEqual(["[i=0] Mark", "[i=1] Mark", "[i=2] Mark"]);

    const hidden = renderOverlay(sessionFor({ candidates }), {}, {
      elements,
      evaluation,
      showCanvasGeometryNames: false
    });
    expect(hidden.viewport.querySelectorAll("[data-reference-pick-geometry-identity]")).toHaveLength(0);
    hidden.view.unmount();
    hidden.viewport.remove();

    const shown = renderOverlay(sessionFor({ candidates }), {}, {
      elements,
      evaluation,
      showCanvasGeometryNames: true
    });
    const labels = [...shown.viewport.querySelectorAll("[data-reference-pick-geometry-identity]")];
    expect(labels.map((label) => label.textContent)).toEqual(["[i=0] Mark", "[i=1] Mark", "[i=2] Mark"]);
    expect(labels.every((label) => (label as SVGTextElement).style.pointerEvents === "none")).toBe(true);

    shown.view.unmount();
    shown.viewport.remove();
  });

  it("renders and hit-tests a joinedPath candidate through the shared geometry path", () => {
    const evaluation: EvaluationResult = {
      ...emptyEvaluationResult([joinedPathElement]),
      computedGeometry: new Map([[joinedPathGeometry.elementId, joinedPathGeometry]]),
      evaluatedElementIds: new Set([joinedPathGeometry.elementId]),
      effectiveVisibleElementIds: new Set([joinedPathGeometry.elementId]),
      effectiveEnabledElementIds: new Set([joinedPathGeometry.elementId])
    };
    const candidate: ReferencePickCandidate = {
      elementId: joinedPathGeometry.elementId,
      actualGeometryInterface: "path",
      options: [{ kind: "geometry", label: "@Joined", reference: { base: "Joined" } }]
    };
    const { viewport, callbacks, view } = renderOverlay(
      sessionFor({ expectedGeometryInterface: "path", candidates: [candidate] }),
      {},
      { elements: [joinedPathElement], evaluation }
    );

    expect(viewport.querySelectorAll("[data-reference-pick-visuals] polyline")).toHaveLength(1);
    fireEvent.pointerDown(viewport, { button: 0, clientX: 320, clientY: 220 });
    expect(callbacks.onSelect).toHaveBeenCalledExactlyOnceWith({
      candidateElementId: "Joined",
      reference: { base: "Joined" }
    });

    view.unmount();
    viewport.remove();
  });

  it("routes Enter confirm and Escape cancel through the active Canvas session", () => {
    const onConfirm = vi.fn<() => void>();
    const onCancel = vi.fn<() => void>();
    const { viewport, view } = renderOverlay(
      sessionFor({ draftReferences: [{ base: "Straight" }] }),
      { onConfirm, onCancel }
    );

    fireEvent.keyDown(window, { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);

    view.unmount();
    viewport.remove();
  });

  it("cancels on initial Escape after focus moves away from the Canvas viewport", () => {
    const onCancel = vi.fn<() => void>();
    const { viewport, view } = renderOverlay(sessionFor(), { onCancel });
    const hostFocusedElement = document.createElement("button");
    hostFocusedElement.type = "button";
    document.body.append(hostFocusedElement);
    hostFocusedElement.focus();

    expect(document.activeElement).toBe(hostFocusedElement);
    expect(document.activeElement).not.toBe(viewport);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onCancel).toHaveBeenCalledTimes(1);

    view.unmount();
    hostFocusedElement.remove();
    viewport.remove();
  });

  it("does not render target labels or a property chooser in the subordinate overlay", () => {
    const first = renderOverlay(sessionFor({
      expectedGeometryInterface: "point",
      role: "endpoint"
    }));
    expect(screen.queryByText("Endpoint target")).not.toBeInTheDocument();
    first.view.unmount();
    first.viewport.remove();

    const second = renderOverlay(sessionFor({
      expectedGeometryInterface: "path",
      role: "numericPropertyBase"
    }));
    expect(screen.queryByText("Geometry base target")).not.toBeInTheDocument();
    expect(screen.queryByText(/length|angle/i)).not.toBeInTheDocument();
    second.view.unmount();
    second.viewport.remove();
  });

  it("opens an exact-reference popup for overlapping point hits without changing the draft", () => {
    const onSelect = vi.fn<(hover: ReferencePickHover | null) => void>();
    const { viewport, view } = renderOverlay(
      sessionFor({
        expectedGeometryInterface: "point",
        candidates: [
          pointCandidate({ elementId: "C", reference: { base: "C" } }),
          pointCandidate({
            elementId: "Arc",
            reference: { base: "Arc", pointKey: "center" },
            anchor: { mode: "derived", elementId: "Arc", pointKey: "center" },
            label: "center"
          })
        ]
      }),
      { onSelect }
    );

    fireEvent.pointerDown(viewport, { button: 0, clientX: 320, clientY: 240 });

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox", { name: "Reference Pick point candidates" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /@C/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /@Arc\.center/ })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "Reference Pick point candidates" })).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.pointerDown(viewport, { button: 0, clientX: 320, clientY: 240 });
    const arcOption = screen.getByRole("option", { name: /@Arc\.center/ });
    fireEvent.pointerDown(arcOption, { button: 0 });
    fireEvent.click(arcOption);
    expect(onSelect).toHaveBeenCalledWith({
      candidateElementId: "Arc",
      reference: { base: "Arc", pointKey: "center" }
    });

    view.unmount();
    viewport.remove();
  });

  it("opens the numeric-property chooser after a geometry hit and keeps Pick active on Escape", () => {
    const onSelect = vi.fn<(hover: ReferencePickHover | null) => void>();
    const onSelectNumericProperty = vi.fn<(property: NumericComputedGeometryProperty) => void>();
    const { viewport, view } = renderOverlay(
      sessionFor({
        expectedGeometryInterface: "path",
        role: "numericPropertyBase",
        requestId: 17,
        candidates: [numericLineCandidate]
      }),
      { onSelect, onSelectNumericProperty },
      { elements: [numericLineElement], evaluation: numericLineEvaluation }
    );

    fireEvent.pointerMove(viewport, { clientX: 320, clientY: 240 });
    expect(viewport.style.cursor).toBe("pointer");
    fireEvent.pointerDown(viewport, { button: 0, clientX: 320, clientY: 240 });
    expect(screen.getByRole("listbox", { name: "Reference Pick numeric properties" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /length/ })).toBeInTheDocument();
    expect(onSelect).toHaveBeenCalledWith({
      candidateElementId: "Base",
      reference: { base: "Base" },
      numericSubgeometry: { kind: "body" }
    });

    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onSelectNumericProperty).toHaveBeenCalledWith("startAngleDeg");
    expect(screen.queryByRole("listbox", { name: "Reference Pick numeric properties" })).toBeNull();

    fireEvent.pointerDown(viewport, { button: 0, clientX: 320, clientY: 240 });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole("listbox", { name: "Reference Pick numeric properties" })).toBeNull();

    fireEvent.pointerMove(viewport, { clientX: 20, clientY: 20 });
    expect(viewport.style.cursor).toBe("");
    view.unmount();
    viewport.remove();
  });

  it("restores the normal Canvas cursor when the active Pick overlay is removed", () => {
    const { viewport, view } = renderOverlay(
      sessionFor({ expectedGeometryInterface: "path", candidates: [numericLineCandidate] }),
      {},
      { elements: [numericLineElement], evaluation: numericLineEvaluation }
    );
    viewport.style.cursor = "crosshair";
    fireEvent.pointerMove(viewport, { clientX: 320, clientY: 240 });
    expect(viewport.style.cursor).toBe("pointer");
    view.unmount();
    expect(viewport.style.cursor).toBe("crosshair");
    viewport.remove();
  });

  it("prioritizes a numeric semantic endpoint over its body and opens that endpoint's properties", () => {
    const onHover = vi.fn<(hover: ReferencePickHover | null) => void>();
    const onSelect = vi.fn<(hover: ReferencePickHover | null) => void>();
    const { viewport, view } = renderOverlay(
      sessionFor({
        expectedGeometryInterface: "path",
        role: "numericPropertyBase",
        candidates: [numericLineStartCandidate]
      }),
      { onHover, onSelect },
      { elements: [numericLineElement], evaluation: numericLineEvaluation }
    );

    fireEvent.pointerMove(viewport, { clientX: 220, clientY: 240 });
    expect(onHover).toHaveBeenCalledWith({
      candidateElementId: "Base",
      reference: { base: "Base" },
      numericSubgeometry: {
        kind: "point",
        anchor: { mode: "derived", elementId: "Base", pointKey: "start" }
      }
    });
    fireEvent.pointerDown(viewport, { button: 0, clientX: 220, clientY: 240 });

    expect(onSelect).toHaveBeenCalledWith({
      candidateElementId: "Base",
      reference: { base: "Base" },
      numericSubgeometry: {
        kind: "point",
        anchor: { mode: "derived", elementId: "Base", pointKey: "start" }
      }
    });
    expect(screen.getByRole("listbox", { name: "Reference Pick numeric properties" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /startPoint\.x/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /長さ/ })).toBeNull();

    view.unmount();
    viewport.remove();
  });

  it("cycles overlapping point candidates with shared wheel normalization and consumes the wheel event", () => {
    const { viewport, view } = renderOverlay(
      sessionFor({
        expectedGeometryInterface: "point",
        candidates: [
          pointCandidate({ elementId: "A", reference: { base: "A" } }),
          pointCandidate({ elementId: "B", reference: { base: "B" } })
        ]
      })
    );
    fireEvent.pointerDown(viewport, { button: 0, clientX: 320, clientY: 240 });
    const canvasWheel = vi.fn();
    viewport.addEventListener("wheel", canvasWheel);
    const popup = document.querySelector<HTMLElement>(".canvas-overlap-candidate-menu");
    if (!popup) throw new Error("Missing Reference Pick candidate popup");

    const first = candidateWheelDeltaFor({ remainder: 0, deltaY: 12, deltaMode: 0, viewportHeight: 480 });
    const firstEvent = new WheelEvent("wheel", { deltaY: 12, deltaMode: 0, cancelable: true, bubbles: true });
    act(() => popup.dispatchEvent(firstEvent));
    expect(first.cycles).toBe(0);
    expect(firstEvent.defaultPrevented).toBe(true);
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");

    const second = candidateWheelDeltaFor({ ...first, deltaY: 12, deltaMode: 0, viewportHeight: 480 });
    const secondEvent = new WheelEvent("wheel", { deltaY: 12, deltaMode: 0, cancelable: true, bubbles: true });
    act(() => popup.dispatchEvent(secondEvent));
    expect(second.cycles).toBe(1);
    expect(secondEvent.defaultPrevented).toBe(true);
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    expect(canvasWheel).not.toHaveBeenCalled();

    const wrapped = candidateWheelDeltaFor({ remainder: 0, deltaY: 24, deltaMode: 0, viewportHeight: 480 });
    act(() => popup.dispatchEvent(new WheelEvent("wheel", { deltaY: 24, deltaMode: 0, cancelable: true, bubbles: true })));
    expect(wrapped.cycles).toBe(1);
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");

    viewport.removeEventListener("wheel", canvasWheel);
    view.unmount();
    viewport.remove();
  });

  it("accumulates numeric-property wheel deltas by line and page mode and wraps candidates", () => {
    const { viewport, view } = renderOverlay(
      sessionFor({
        expectedGeometryInterface: "path",
        role: "numericPropertyBase",
        candidates: [numericLineCandidate]
      }),
      {},
      { elements: [numericLineElement], evaluation: numericLineEvaluation }
    );
    fireEvent.pointerDown(viewport, { button: 0, clientX: 320, clientY: 240 });
    const popup = document.querySelector<HTMLElement>(".canvas-overlap-candidate-menu");
    if (!popup) throw new Error("Missing Reference Pick numeric property popup");

    const first = candidateWheelDeltaFor({ remainder: 0, deltaY: 1, deltaMode: 1, viewportHeight: 480 });
    act(() => popup.dispatchEvent(new WheelEvent("wheel", { deltaY: 1, deltaMode: 1, cancelable: true, bubbles: true })));
    expect(first.cycles).toBe(0);
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");

    const second = candidateWheelDeltaFor({ ...first, deltaY: 1, deltaMode: 1, viewportHeight: 480 });
    act(() => popup.dispatchEvent(new WheelEvent("wheel", { deltaY: 1, deltaMode: 1, cancelable: true, bubbles: true })));
    expect(second.cycles).toBe(1);
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerDown(viewport, { button: 0, clientX: 320, clientY: 240 });
    const page = candidateWheelDeltaFor({ remainder: 0, deltaY: 1, deltaMode: 2, viewportHeight: 480 });
    const pageEvent = new WheelEvent("wheel", { deltaY: 1, deltaMode: 2, cancelable: true, bubbles: true });
    const reopenedPopup = document.querySelector<HTMLElement>(".canvas-overlap-candidate-menu");
    if (!reopenedPopup) throw new Error("Missing reopened Reference Pick numeric property popup");
    act(() => reopenedPopup.dispatchEvent(pageEvent));
    expect(page.cycles).toBe(1);
    expect(pageEvent.defaultPrevented).toBe(true);
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");

    view.unmount();
    viewport.remove();
  });

  it("resets partial wheel motion on direction reversal and when a menu lifecycle restarts", () => {
    const { viewport, view } = renderOverlay(
      sessionFor({
        expectedGeometryInterface: "point",
        candidates: [
          pointCandidate({ elementId: "A", reference: { base: "A" } }),
          pointCandidate({ elementId: "B", reference: { base: "B" } })
        ]
      })
    );
    fireEvent.pointerDown(viewport, { button: 0, clientX: 320, clientY: 240 });
    const popup = document.querySelector<HTMLElement>(".canvas-overlap-candidate-menu");
    if (!popup) throw new Error("Missing Reference Pick candidate popup");

    const forward = candidateWheelDeltaFor({ remainder: 0, deltaY: 20, deltaMode: 0, viewportHeight: 480 });
    act(() => popup.dispatchEvent(new WheelEvent("wheel", { deltaY: 20, deltaMode: 0, cancelable: true, bubbles: true })));
    expect(forward.cycles).toBe(0);
    const reversed = candidateWheelDeltaFor({ ...forward, deltaY: -1, deltaMode: 0, viewportHeight: 480 });
    act(() => popup.dispatchEvent(new WheelEvent("wheel", { deltaY: -1, deltaMode: 0, cancelable: true, bubbles: true })));
    expect(reversed.remainder).toBe(-1);
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    const reverseThreshold = candidateWheelDeltaFor({ ...reversed, deltaY: -23, deltaMode: 0, viewportHeight: 480 });
    act(() => popup.dispatchEvent(new WheelEvent("wheel", { deltaY: -23, deltaMode: 0, cancelable: true, bubbles: true })));
    expect(reverseThreshold.cycles).toBe(-1);
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerDown(viewport, { button: 0, clientX: 320, clientY: 240 });
    act(() => document.querySelector<HTMLElement>(".canvas-overlap-candidate-menu")?.dispatchEvent(new WheelEvent("wheel", { deltaY: 12, deltaMode: 0, cancelable: true, bubbles: true })));
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");

    view.unmount();
    viewport.remove();
  });

  it("shows canonical numeric property keys in English and inline help in Japanese", () => {
    const english = renderOverlay(
      sessionFor({
        expectedGeometryInterface: "path",
        role: "numericPropertyBase",
        candidates: [numericLineStartCandidate]
      }),
      {},
      { elements: [numericLineElement], evaluation: numericLineEvaluation },
      webviewCanvasPresentationFor(webviewPresentationFor("en"))
    );
    fireEvent.pointerDown(english.viewport, { button: 0, clientX: 220, clientY: 240 });
    expect(screen.getByRole("option", { name: /startPoint\.x/ })).toBeInTheDocument();
    expect(screen.queryByText("始点のX座標")).toBeNull();
    english.view.unmount();
    english.viewport.remove();

    const japanese = renderOverlay(
      sessionFor({
        expectedGeometryInterface: "path",
        role: "numericPropertyBase",
        candidates: [{
          ...numericLineCandidate,
          options: [{
            kind: "numericProperty",
            label: "Base",
            reference: { base: "Base" },
            subgeometry: { kind: "body" },
            properties: ["sweepAngleDeg", "intermediatePoints[2].outgoingHandleLength"]
          }]
        }]
      }),
      {},
      { elements: [numericLineElement], evaluation: numericLineEvaluation },
      webviewCanvasPresentationFor(webviewPresentationFor("ja-JP"))
    );
    fireEvent.pointerDown(japanese.viewport, { button: 0, clientX: 320, clientY: 240 });
    expect(screen.getByRole("option", { name: /sweepAngleDeg — 円弧の中心角/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /intermediatePoints\[2\]\.outgoingHandleLength — 中間点2の出側ハンドル長/ })).toBeInTheDocument();
    japanese.view.unmount();
    japanese.viewport.remove();
  });

  it("keeps a selectable canonical property visible when Reference Pick has no help text", () => {
    const onSelectNumericProperty = vi.fn<(property: NumericComputedGeometryProperty) => void>();
    const { viewport, view } = renderOverlay(
      sessionFor({
        expectedGeometryInterface: "path",
        role: "numericPropertyBase",
        candidates: [{
          ...numericLineCandidate,
          options: [{
            kind: "numericProperty",
            label: "Base",
            reference: { base: "Base" },
            subgeometry: { kind: "body" },
            properties: ["x"]
          }]
        }]
      }),
      { onSelectNumericProperty },
      { elements: [numericLineElement], evaluation: numericLineEvaluation },
      webviewCanvasPresentationFor(webviewPresentationFor("ja-JP"))
    );
    fireEvent.pointerDown(viewport, { button: 0, clientX: 320, clientY: 240 });
    expect(screen.getByRole("option", { name: /^x@Base$/ })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onSelectNumericProperty).toHaveBeenCalledWith("x");

    view.unmount();
    viewport.remove();
  });

  it("leaves the numeric draft's outer status presentation to the shared Pick Mode shell", () => {
    const draft = {
      candidateElementId: "Base",
      reference: { base: "Base" },
      property: "length" as const
    };
    const { viewport, view } = renderOverlay(
      sessionFor({
        expectedGeometryInterface: "path",
        role: "numericPropertyBase",
        numericProperty: {
          target: { kind: "propertySelectionRequired" },
          stage: "draft",
          selectedGeometry: { candidateElementId: "Base", reference: { base: "Base" }, numericSubgeometry: { kind: "body" } },
          properties: ["length"],
          draft
        },
        candidates: [numericLineCandidate]
      }),
      {},
      { elements: [numericLineElement], evaluation: numericLineEvaluation },
      webviewCanvasPresentationFor(webviewPresentationFor("en"))
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText("@Base.length")).toBeNull();

    view.unmount();
    viewport.remove();
  });

  it("does not install a Webview keyboard owner for a terminal session", () => {
    const onCancel = vi.fn<() => void>();
    const { viewport, view } = renderOverlay(sessionFor({ status: "canceled" }), { onCancel });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onCancel).not.toHaveBeenCalled();

    view.unmount();
    viewport.remove();
  });

  it("selects a single point hit directly", () => {
    const onSelect = vi.fn<(hover: ReferencePickHover | null) => void>();
    const { viewport, view } = renderOverlay(
      sessionFor({
        expectedGeometryInterface: "point",
        candidates: [pointCandidate({ elementId: "C", reference: { base: "C" } })]
      }),
      { onSelect }
    );

    fireEvent.pointerDown(viewport, { button: 0, clientX: 320, clientY: 240 });

    expect(onSelect).toHaveBeenCalledWith({ candidateElementId: "C", reference: { base: "C" } });
    expect(screen.queryByRole("listbox", { name: "Reference Pick point candidates" })).toBeNull();

    view.unmount();
    viewport.remove();
  });

  it("does not render Pick chrome after the session is terminal", () => {
    const { viewport, view } = renderOverlay(sessionFor({ status: "canceled" }));

    expect(document.querySelector("[data-reference-pick-frame='true']")).toBeNull();
    expect(document.querySelector("[data-reference-pick-badge='true']")).toBeNull();

    view.unmount();
    viewport.remove();
  });
});
