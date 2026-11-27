import { describe, expect, it } from "vitest";
import { compileFreshCanonicalText } from "@nuinuicad/nui-language/document";
import { evaluateElementsReference } from "../geometry/evaluationEngine";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { useCadUiStore } from "../state/cadUiStore";
import {
  OUTPUT_PALETTE,
  OUTPUT_TEXT_ASCENT,
  OUTPUT_TEXT_DESCENT,
  OUTPUT_TEXT_LINE_HEIGHT,
  PX_TO_MM,
  buildOutputPlan,
  deterministicTextLayout,
  evaluateOutputPlan,
  outputDrawableBounds,
  OutputPlanError,
  type OutputDrawable
} from "./outputCore";

const sourceFor = (lines: string[]) => {
  const compiled = compileFreshCanonicalText(lines.join("\n"));
  if (compiled.status === "fatal") throw new Error(JSON.stringify(compiled.diagnostics));
  return compiled.doc;
};

const simpleSource = (extra: string[] = []) => sourceFor([
  "nui 1",
  ...extra,
  "group G {",
  "  point A = coordinate(x: 0, y: 0)",
  "  point B = coordinate(x: 10, y: 0)",
  "  line AB = segment(start: A, end: B)",
  "  text Label = label(text: \"AB\", anchor: A, size: 10)",
  "}",
  "layout L {",
  "  place G(at: (0, 0))",
  "}",
  "print P(layout: L, layers: [default], paper: a4, overlap: 10)",
  "svg S(layout: L, layers: [default], margin: 5)"
]);

const output = (doc: ReturnType<typeof simpleSource>, name: "P" | "S") => {
  const candidate = name === "P" ? doc.document.printOutputs[0] : doc.document.svgOutputs[0];
  if (!candidate) throw new Error(`missing ${name}`);
  return candidate;
};

const evaluationFor = (doc: ReturnType<typeof simpleSource>) =>
  evaluateElementsReference(doc.document.elements, buildEvaluationOptions({
    compiledDocument: doc,
    evaluationLimitIndex: doc.document.evaluationLimitIndex
  }));

const printPlanForLine = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  overlap = 10,
  paper: "a4" | "a3" = "a4",
  orientation: "portrait" | "landscape" = "portrait"
) => {
  const doc = sourceFor([
    "nui 1",
    "group G {",
    `  line Test = segment(start: (${start.x}, ${start.y}), end: (${end.x}, ${end.y}))`,
    "}",
    "layout L {",
    "  place G(at: (0, 0))",
    "}",
    `print P(layout: L, layers: [default], paper: ${paper}, orientation: ${orientation}, overlap: ${overlap})`
  ]);
  return buildOutputPlan({
    compiledDocument: doc,
    output: doc.document.printOutputs[0]!,
    evaluation: evaluationFor(doc)
  });
};

const mirrorPaths = (drawables: readonly OutputDrawable[]) => drawables.filter(
  (drawable): drawable is Extract<OutputDrawable, { kind: "joinedPath" }> => drawable.kind === "joinedPath"
);

describe("SAY-64 output core", () => {
  it("uses inherited Group membership for SVG and print layer selectors", () => {
    const doc = sourceFor([
      "nui 1",
      "layer finished",
      "layer outline",
      "group Pattern in finished {",
      "  line Inherited = segment(start: (0, 0), end: (10, 0))",
      "  line Explicit in outline = segment(start: (0, 10), end: (10, 10))",
      "  line ExplicitDefault in default = segment(start: (0, 20), end: (10, 20))",
      "}",
      "layout L {",
      "  place Pattern(at: (0, 0))",
      "}",
      "svg Finished(layout: L, layers: [finished], margin: 0)",
      "svg Outline(layout: L, layers: [outline], margin: 0)",
      "print FinishedAndDefault(layout: L, layers: [finished, default], paper: a4, overlap: 0)"
    ]);
    const evaluation = evaluationFor(doc);
    const outputNames = (index: number) => buildOutputPlan({
      compiledDocument: doc,
      output: [...doc.document.svgOutputs, ...doc.document.printOutputs][index]!,
      evaluation
    }).drawables.map(drawable => drawable.name);

    expect(outputNames(0)).toEqual(["Inherited"]);
    expect(outputNames(1)).toEqual(["Explicit"]);
    expect(outputNames(2)).toEqual(["Inherited", "ExplicitDefault"]);
  });

  it("selects existing Module instance drawables by their caller Group layer", () => {
    const doc = sourceFor([
      "nui 1",
      "layer finished",
      "module Pattern() {",
      "  line Body = segment(start: (0, 0), end: (10, 0))",
      "}",
      "group Caller in finished {",
      "  instance One = Pattern()",
      "}",
      "layout L {",
      "  place Caller(at: (0, 0))",
      "}",
      "svg Finished(layout: L, layers: [finished], margin: 0)",
      "svg Default(layout: L, layers: [default], margin: 0)"
    ]);
    const bodySourceIndex = doc.statements.findIndex(statement => statement.kind === "element" && statement.name === "Body");
    const bodySourceId = doc.statementMap.statementIdByStatementIndex?.get(bodySourceIndex);
    const runtimeBodyId = [...(doc.moduleMaterialization?.originByRuntimeElementId ?? [])]
      .find(([, origin]) => origin.kind === "moduleBody" && origin.sourceStatementId === bodySourceId)?.[0];
    const runtimeBody = doc.document.elements.find(element => element.id === runtimeBodyId);
    expect(runtimeBody).toBeDefined();
    const evaluation = evaluationFor(doc);
    const outputFor = (index: number) => buildOutputPlan({
      compiledDocument: doc,
      output: doc.document.svgOutputs[index]!,
      evaluation
    });
    expect(outputFor(0).drawables.map(drawable => drawable.name)).toEqual([runtimeBody!.name]);
    expect(outputFor(1).drawables).toEqual([]);
  });

  it("selects an instance body by lexical Layer identity when caller and Module names match", () => {
    const doc = sourceFor([
      "nui 1",
      "layer seam",
      "module Pattern() {",
      "  layer seam",
      "  line Body in seam = segment(start: (0, 0), end: (10, 0))",
      "}",
      "group Caller {",
      "  instance One in seam = Pattern()",
      "}",
      "layout L {",
      "  place Caller(at: (0, 0))",
      "}",
      "svg CallerLayer(layout: L, layers: [seam], margin: 0)"
    ]);
    const runtimeBody = [...(doc.moduleMaterialization?.originByRuntimeElementId ?? [])]
      .find(([, origin]) => origin.kind === "moduleBody")?.[0];
    expect(runtimeBody).toBeDefined();
    const bodyIndex = doc.statements.findIndex(statement => statement.kind === "element" && statement.name === "Body");
    const instanceIndex = doc.statements.findIndex(statement => statement.kind === "moduleInstance");
    const bodyMembership = doc.sourceLexicalNamespace!.layerMembershipsByStatementIndex.get(bodyIndex)!;
    const instanceMembership = doc.sourceLexicalNamespace!.layerMembershipsByStatementIndex.get(instanceIndex)!;
    expect(bodyMembership.layerName).toBe(instanceMembership.layerName);
    expect(bodyMembership.layerIdentity).not.toBe(instanceMembership.layerIdentity);
    const plan = buildOutputPlan({
      compiledDocument: doc,
      output: doc.document.svgOutputs[0]!,
      evaluation: evaluationFor(doc)
    });
    expect(plan.drawables).toEqual([]);
  });

  it("includes evaluated mirrorCopy previews in SVG and physical print plans", () => {
    const doc = sourceFor([
      "nui 1",
      "group G {",
      "  line Base = segment(start: (0, 0), end: (100, 0))",
      "  line Preview = mirrorCopy(axis1: (0, 0), axis2: (0, 100), baseLines: [Base])",
      "}",
      "layout L {",
      "  place G(at: (0, 0))",
      "}",
      "print P(layout: L, layers: [default], paper: a4, overlap: 0)",
      "svg S(layout: L, layers: [default], margin: 0)"
    ]);
    const evaluation = evaluationFor(doc);
    const preview = doc.document.elements.find((element) => element.name === "Preview")!;
    expect(doc.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(evaluation.errors).toEqual([]);
    expect(evaluation.geometryValueErrors ?? []).toEqual([]);
    expect(evaluation.mirrorCopyPreviews?.has(preview.id)).toBe(true);
    expect(evaluation.effectiveVisibleElementIds?.has(preview.id)).toBe(true);
    expect(evaluation.computedGeometry.has(preview.id)).toBe(false);
    expect(doc.document.layouts[0]?.placements[0]?.groupId).toBe(preview.parentGroupId);

    for (const output of [...doc.document.printOutputs, ...doc.document.svgOutputs]) {
      const plan = buildOutputPlan({ compiledDocument: doc, output, evaluation });
      expect(plan.drawables.map((drawable) => drawable.name)).toEqual(["Base", "Preview"]);
      expect(plan.rustPayload.drawables.map((drawable) => drawable.name)).toEqual(["Base", "Preview"]);
      expect(plan.drawables[0]).toMatchObject({ kind: "line", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } });
      expect(plan.drawables[1]).toMatchObject({
        kind: "joinedPath",
        segments: [{ kind: "line", start: { x: 0, y: 0 }, end: { x: -100, y: 0 } }]
      });
      expect(plan.renderedBounds.minX).toBe(-100 - PX_TO_MM / 2);
      expect(plan.renderedBounds.maxX).toBe(100 + PX_TO_MM / 2);
    }
  });

  it("fails closed when a selected visible placed mirrorCopy owner has no current result", () => {
    const doc = sourceFor([
      "nui 1",
      "group G {",
      "  line Base = segment(start: (0, 0), end: (100, 0))",
      "  line Preview = mirrorCopy(axis1: (0, 0), axis2: (0, 100), baseLines: [Base])",
      "}",
      "layout L {",
      "  place G(at: (0, 0))",
      "}",
      "print P(layout: L, layers: [default], paper: a4, overlap: 0)",
      "svg S(layout: L, layers: [default], margin: 0)"
    ]);
    const evaluation = evaluationFor(doc);
    const previewOwner = doc.document.elements.find((element) => element.name === "Preview")!;
    const missingPreviewEvaluation = {
      ...evaluation,
      mirrorCopyPreviews: new Map(evaluation.mirrorCopyPreviews ?? [])
    };
    missingPreviewEvaluation.mirrorCopyPreviews.delete(previewOwner.id);

    expect(doc.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(evaluation.errors).toEqual([]);
    expect(evaluation.effectiveVisibleElementIds?.has(previewOwner.id)).toBe(true);
    expect(evaluation.mirrorCopyPreviews?.has(previewOwner.id)).toBe(true);
    expect(missingPreviewEvaluation.errors).toEqual([]);
    expect(missingPreviewEvaluation.mirrorCopyPreviews.has(previewOwner.id)).toBe(false);
    for (const output of [...doc.document.svgOutputs, ...doc.document.printOutputs]) {
      expect(() => buildOutputPlan({ compiledDocument: doc, output, evaluation: missingPreviewEvaluation }))
        .toThrow(OutputPlanError);
    }
  });

  it("allows missing previews for hidden, inactive, unselected, unplaced, and zero-iteration owners", () => {
    const doc = sourceFor([
      "nui 1",
      "const active: boolean = false",
      "layer draft",
      "style Hidden {",
      "  visible: false,",
      "}",
      "group Placed {",
      "  line Base = segment(start: (0, 0), end: (100, 0))",
      "  line HiddenPreview[Hidden] = mirrorCopy(axis1: (0, 0), axis2: (0, 100), baseLines: [Base])",
      "  line DisabledPreview = mirrorCopy(axis1: (0, 0), axis2: (0, 100), baseLines: [Base], enabled: false)",
      "  line UnselectedPreview in draft = mirrorCopy(axis1: (0, 0), axis2: (0, 100), baseLines: [Base])",
      "  if (active) {",
      "    line ConditionalPreview = mirrorCopy(axis1: (0, 0), axis2: (0, 100), baseLines: [Base])",
      "  } else {",
      "    line ActiveControl = segment(start: (0, 10), end: (10, 10))",
      "  }",
      "  const empty: number[] = []",
      "  for i in empty {",
      "    line ZeroIterationPreview = mirrorCopy(axis1: (0, 0), axis2: (0, 100), baseLines: [Base])",
      "  }",
      "}",
      "line UnplacedPreview = mirrorCopy(axis1: (0, 0), axis2: (0, 100), baseLines: [Placed::Base])",
      "layout L {",
      "  place Placed(at: (0, 0))",
      "}",
      "svg S(layout: L, layers: [default], margin: 0)"
    ]);
    const evaluation = evaluationFor(doc);
    const ownerNames = ["HiddenPreview", "DisabledPreview", "UnselectedPreview", "ConditionalPreview", "ZeroIterationPreview", "UnplacedPreview"];
    const owners = ownerNames.map((name) => doc.document.elements.find((element) => element.name === name));
    expect(owners.every(Boolean)).toBe(true);
    const ownerIds = new Set(owners.map((owner) => owner!.id));
    const missingExcludedPreviews = {
      ...evaluation,
      mirrorCopyPreviews: new Map([...(evaluation.mirrorCopyPreviews ?? [])].filter(([ownerId]) => !ownerIds.has(ownerId)))
    };
    const activeOwner = (name: string) => evaluation.effectiveVisibleElementIds?.has(owners[ownerNames.indexOf(name)]!.id);

    expect(doc.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(evaluation.errors).toEqual([]);
    expect(activeOwner("HiddenPreview")).toBe(false);
    expect(activeOwner("DisabledPreview")).toBe(false);
    expect(evaluation.conditionInactiveElementIds?.has(owners[ownerNames.indexOf("ConditionalPreview")]!.id)).toBe(true);
    expect(activeOwner("UnselectedPreview")).toBe(true);
    expect(activeOwner("UnplacedPreview")).toBe(true);
    const zeroTemplateId = owners[ownerNames.indexOf("ZeroIterationPreview")]!.id;
    expect(evaluation.forGroupGeneratedRows?.filter((row) => row.templateElementId === zeroTemplateId)).toEqual([]);
    expect(missingExcludedPreviews.errors).toEqual([]);
    expect([...missingExcludedPreviews.mirrorCopyPreviews!.keys()].some((ownerId) => ownerIds.has(ownerId))).toBe(false);

    const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0]!, evaluation: missingExcludedPreviews });
    expect(plan.drawables.map((drawable) => drawable.name)).toEqual(["Base", "ActiveControl"]);
  });

  it("preserves mirrorCopy line, arc, Bezier, composite path, selector, and input order", () => {
    const doc = sourceFor([
      "nui 1",
      "line Straight = segment(start: (2, 3), end: (6, 5))",
      "arc Arc = arc(center: (10, 0), radius: 5, start: 90, end: 0, direction: @clockwise)",
      "curve Bezier = bezier(start: (20, 10), end: (30, 10), startAngle: 90, startLength: 2, endAngle: 90, endLength: 4)",
      "line Composite = polyline(points: [(40, 0), (45, 0), (40, 0)], closed: false)",
      "const Paths: path[] = [Straight, Arc, Bezier, Composite]",
      "group Selectors {",
      "  line GroupLine = segment(start: (50, 0), end: (60, 0))",
      "}",
      "group Placed {",
      "  line PreviewPaths = mirrorCopy(axis1: (0, 0), axis2: (0, 100), baseLines: Paths)",
      "  line PreviewMixed = mirrorCopy(axis1: (0, 0), axis2: (0, 100), baseLines: [@Selectors, Straight, Composite])",
      "}",
      "layout L {",
      "  place Placed(at: (0, 0))",
      "}",
      "svg S(layout: L, layers: [default], margin: 0)"
    ]);
    const evaluation = evaluationFor(doc);
    expect(doc.diagnostics).toEqual([]);
    expect(evaluation.errors).toEqual([]);
    const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0]!, evaluation });
    const paths = mirrorPaths(plan.drawables);

    expect(paths).toHaveLength(7);
    expect(paths.map((path) => path.name)).toEqual([
      "PreviewPaths", "PreviewPaths", "PreviewPaths", "PreviewPaths",
      "PreviewMixed", "PreviewMixed", "PreviewMixed"
    ]);
    expect(paths.map((path) => path.segments)).toEqual([
      [{ kind: "line", start: { x: -2, y: 3 }, end: { x: -6, y: 5 } }],
      [{ kind: "arc", center: { x: -10, y: 0 }, radius: 5, startAngleDeg: 90, sweepAngleDeg: 90 }],
      [{ kind: "bezier", start: { x: -20, y: 10 }, control1: { x: -20, y: 12 }, control2: { x: -30, y: 6 }, end: { x: -30, y: 10 } }],
      [
        { kind: "line", start: { x: -40, y: 0 }, end: { x: -45, y: 0 } },
        { kind: "line", start: { x: -45, y: 0 }, end: { x: -40, y: 0 } }
      ],
      [{ kind: "line", start: { x: -50, y: 0 }, end: { x: -60, y: 0 } }],
      [{ kind: "line", start: { x: -2, y: 3 }, end: { x: -6, y: 5 } }],
      [
        { kind: "line", start: { x: -40, y: 0 }, end: { x: -45, y: 0 } },
        { kind: "line", start: { x: -45, y: 0 }, end: { x: -40, y: 0 } }
      ]
    ]);
    expect(paths.every((path) => !("fill" in path))).toBe(true);
  });

  it("transforms each reflected group once for every independent placement", () => {
    const doc = sourceFor([
      "nui 1",
      "line Base = segment(start: (2, 3), end: (6, 5))",
      "group Placed {",
      "  point Origin = coordinate(x: 1, y: 1)",
      "  line Preview = mirrorCopy(axis1: (0, 0), axis2: (0, 100), baseLines: [Base])",
      "}",
      "layout L {",
      "  place Placed(origin: Placed::Origin, at: (10, 20), scale: 2, angle: 90, mirror: true)",
      "  place Placed(origin: Placed::Origin, at: (0, 0))",
      "}",
      "svg S(layout: L, layers: [default], margin: 0)"
    ]);
    const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0]!, evaluation: evaluationFor(doc) });
    const paths = mirrorPaths(plan.drawables);

    expect(plan.placements).toHaveLength(2);
    expect(paths).toHaveLength(2);
    const transformed = paths[0]!.segments[0]!;
    if (transformed.kind !== "line") throw new Error("missing transformed mirror line");
    expect(transformed.start).toEqual({ x: 6, y: 26 });
    expect(transformed.end.x).toBeCloseTo(2, 12);
    expect(transformed.end.y).toBeCloseTo(34, 12);
    expect(paths[1]!.segments).toEqual([{ kind: "line", start: { x: -3, y: 2 }, end: { x: -7, y: 4 } }]);
    expect(plan.placements.map((placement) => placement.drawables)).toEqual([[paths[0]], [paths[1]]]);
  });

  it("includes both 180 mm halves in stroke bounds, SVG margin, and A4 tiling", () => {
    const doc = sourceFor([
      "nui 1",
      "group Placed {",
      "  line Base = segment(start: (10, 0), end: (190, 0))",
      "  line Preview = mirrorCopy(axis1: (0, 0), axis2: (0, 100), baseLines: [Base])",
      "}",
      "layout L {",
      "  place Placed(at: (0, 0))",
      "}",
      "print P(layout: L, layers: [default], paper: a4, orientation: landscape, overlap: 10)",
      "svg S(layout: L, layers: [default], margin: 2)"
    ]);
    const evaluation = evaluationFor(doc);
    const print = buildOutputPlan({ compiledDocument: doc, output: doc.document.printOutputs[0]!, evaluation });
    const svg = buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0]!, evaluation });
    const halfStroke = PX_TO_MM / 2;

    expect(print.renderedBounds.minX).toBeCloseTo(-190 - halfStroke, 10);
    expect(print.renderedBounds.maxX).toBeCloseTo(190 + halfStroke, 10);
    expect(print.print).toMatchObject({ columns: 1, rows: 1, pages: [expect.anything()] });
    expect(svg.svg?.widthMm).toBeCloseTo(380 + PX_TO_MM + 4, 10);
    expect(svg.svg?.heightMm).toBeCloseTo(PX_TO_MM + 4, 10);
    expect(svg.drawables.map((drawable) => drawable.kind)).toEqual(["line", "joinedPath"]);
  });

  it("selects mirrorCopy by owner layer independently from its source layer", () => {
    const selectors = [
      "svg OwnerOnly(layout: L, layers: [owner])",
      "svg SourceOnly(layout: L, layers: [source])",
      "svg Both(layout: L, layers: [source, owner])",
      "svg Neither(layout: L, layers: [default])"
    ];
    const doc = sourceFor([
      "nui 1",
      "layer source",
      "layer owner",
      "line Base in source = segment(start: (2, 3), end: (6, 5))",
      "group Placed {",
      "  line Preview in owner = mirrorCopy(axis1: (0, 0), axis2: (0, 100), baseLines: [Base])",
      "}",
      "layout L {",
      "  place Placed(at: (0, 0))",
      "}",
      ...selectors
    ]);
    const evaluation = evaluationFor(doc);
    const expected = [true, false, true, false];
    for (const [index, included] of expected.entries()) {
      const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[index]!, evaluation });
      expect(plan.drawables.some((drawable) => drawable.name === "Preview")).toBe(included);
      expect(plan.drawables.some((drawable) => drawable.name === "Base")).toBe(false);
      expect(plan.rustPayload.drawables).toEqual(plan.drawables);
    }
  });

  it("uses the owner style and default stroke without fill for reflected groups", () => {
    const doc = sourceFor([
      "nui 1",
      "style Reflected {",
      "  width: 4px,",
      "  color: info,",
      "  lineType: dotted,",
      "  fill: #abcdef,",
      "}",
      "group Placed {",
      "  line Base = segment(start: (0, 0), end: (10, 0))",
      "  line Preview[Reflected] = mirrorCopy(axis1: (0, 0), axis2: (0, 100), baseLines: [Base])",
      "  line Outline[Reflected] = polyline(points: [(20, 0), (30, 0), (30, 10)], closed: true)",
      "}",
      "layout L {",
      "  place Placed(at: (0, 0))",
      "}",
      "svg S(layout: L, layers: [default], margin: 0)"
    ]);
    const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0]!, evaluation: evaluationFor(doc) });
    const reflected = plan.drawables.find((drawable) => drawable.name === "Preview");
    const outline = plan.drawables.find((drawable) => drawable.name === "Outline");

    expect(reflected).toMatchObject({
      kind: "joinedPath",
      stroke: { widthMm: 4 * PX_TO_MM, style: "dotted", colorHex: OUTPUT_PALETTE.info }
    });
    expect(reflected).not.toHaveProperty("fill");
    expect(outline).toMatchObject({ kind: "polyline", fill: { colorHex: "#abcdef", opacity: 1 } });
  });

  it("uses Group inheritance unless a mirrorCopy owner has an explicit default assignment", () => {
    const doc = sourceFor([
      "nui 1",
      "layer owner",
      "line Base = segment(start: (0, 0), end: (10, 0))",
      "group Placed in owner {",
      "  line Inherited = mirrorCopy(axis1: (0, 0), axis2: (0, 10), baseLines: [Base])",
      "  line ExplicitDefault in default = mirrorCopy(axis1: (0, 0), axis2: (0, 10), baseLines: [Base])",
      "}",
      "layout L {",
      "  place Placed(at: (0, 0))",
      "}",
      "svg Owner(layout: L, layers: [owner], margin: 0)",
      "svg Default(layout: L, layers: [default], margin: 0)"
    ]);
    const evaluation = evaluationFor(doc);

    expect(buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0]!, evaluation }).drawables.map((drawable) => drawable.name)).toEqual(["Inherited"]);
    expect(buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[1]!, evaluation }).drawables.map((drawable) => drawable.name)).toEqual(["ExplicitDefault"]);
  });

  it("applies the owner gate to source groups without source element identity", () => {
    const doc = sourceFor([
      "nui 1",
      "line Base = segment(start: (2, 3), end: (6, 5))",
      "const Value: path = transformCopy(startPoint: (0, 0), endPoint: (10, 0), baseLines: [Base])",
      "group Placed {",
      "  line Preview = mirrorCopy(axis1: (0, 0), axis2: (0, 10), baseLines: [Value])",
      "}",
      "layout L {",
      "  place Placed(at: (0, 0))",
      "}",
      "svg S(layout: L, layers: [default], margin: 0)"
    ]);
    const evaluation = evaluationFor(doc);
    const owner = doc.document.elements.find((element) => element.name === "Preview")!;
    const preview = evaluation.mirrorCopyPreviews?.get(owner.id);
    expect(preview?.groups).toHaveLength(1);
    expect(preview?.groups[0]?.sourceElementId).toBeUndefined();
    const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0]!, evaluation });
    expect(mirrorPaths(plan.drawables)[0]?.segments).toEqual([
      { kind: "line", start: { x: -12, y: 3 }, end: { x: -16, y: 5 } }
    ]);
    const ownerHidden = {
      ...evaluation,
      effectiveVisibleElementIds: new Set([...evaluation.effectiveVisibleElementIds ?? []].filter((id) => id !== owner.id))
    };
    expect(buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0]!, evaluation: ownerHidden }).drawables).toEqual([]);
  });

  it("uses nearest owner layer inheritance and keeps same-name lexical layers distinct", () => {
    const doc = sourceFor([
      "nui 1",
      "layer seam",
      "module Pattern() {",
      "  layer seam",
      "  point AxisA = coordinate(x: 0, y: 0)",
      "  point AxisB = coordinate(x: 10, y: 0)",
      "  point Start = coordinate(x: 0, y: 3)",
      "  point End = coordinate(x: 10, y: 3)",
      "  line Base in seam = segment(start: Start, end: End)",
      "  line Preview = mirrorCopy(axis1: AxisA, axis2: AxisB, baseLines: [Base])",
      "}",
      "group Placed {",
      "  instance One in seam = Pattern()",
      "}",
      "layout L {",
      "  place Placed(at: (0, 0))",
      "}",
      "svg Caller(layout: L, layers: [seam], margin: 0)",
      "svg Default(layout: L, layers: [default], margin: 0)"
    ]);
    const sourceIndex = doc.statements.findIndex((statement) => statement.kind === "element" && statement.name === "Base");
    const bodyLayer = doc.sourceLexicalNamespace!.layerMembershipsByStatementIndex.get(sourceIndex)!;
    const instanceIndex = doc.statements.findIndex((statement) => statement.kind === "moduleInstance");
    const instanceLayer = doc.sourceLexicalNamespace!.layerMembershipsByStatementIndex.get(instanceIndex)!;
    expect(bodyLayer.layerName).toBe(instanceLayer.layerName);
    expect(bodyLayer.layerIdentity).not.toBe(instanceLayer.layerIdentity);
    const evaluation = evaluationFor(doc);

    const caller = buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0]!, evaluation });
    const defaultLayer = buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[1]!, evaluation });
    expect(caller.drawables.map((drawable) => drawable.name)).toEqual([expect.stringMatching(/Preview/)]);
    expect(caller.drawables[0]).toMatchObject({ kind: "joinedPath", segments: [{ kind: "line", start: { x: 0, y: -3 }, end: { x: 10, y: -3 } }] });
    expect(defaultLayer.drawables).toEqual([]);
  });

  it("preserves independent mirrorCopy owners and order across repeated Module instances", () => {
    const doc = sourceFor([
      "nui 1",
      "module Pattern() {",
      "  point AxisA = coordinate(x: 0, y: 0)",
      "  point AxisB = coordinate(x: 10, y: 0)",
      "  point Start = coordinate(x: 0, y: 3)",
      "  point End = coordinate(x: 10, y: 3)",
      "  line Base = segment(start: Start, end: End)",
      "  line Preview = mirrorCopy(axis1: AxisA, axis2: AxisB, baseLines: [Base])",
      "}",
      "group Placed {",
      "  instance First = Pattern()",
      "  instance Second = Pattern()",
      "}",
      "layout L {",
      "  place Placed(at: (0, 0))",
      "}",
      "svg S(layout: L, layers: [default], margin: 0)"
    ]);
    const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0]!, evaluation: evaluationFor(doc) });
    const paths = mirrorPaths(plan.drawables);

    expect(plan.drawables.map((drawable) => drawable.name)).toEqual(["Base", "Preview", "Base", "Preview"]);
    expect(paths).toHaveLength(2);
    expect(new Set(paths.map((path) => path.elementId)).size).toBe(2);
    expect(paths.map((path) => path.segments)).toEqual([
      [{ kind: "line", start: { x: 0, y: -3 }, end: { x: 10, y: -3 } }],
      [{ kind: "line", start: { x: 0, y: -3 }, end: { x: 10, y: -3 } }]
    ]);
  });

  it("gates mirrorCopy owner and source activity independently and ignores Canvas filters", () => {
    const doc = sourceFor([
      "nui 1",
      "layer finished",
      "group Sources {",
      "  line Base in finished = segment(start: (0, 10), end: (10, 10))",
      "}",
      "group Placed {",
      "  line Preview in finished = mirrorCopy(axis1: (0, 0), axis2: (10, 0), baseLines: [Sources::Base])",
      "  line DisabledOwner in finished = mirrorCopy(axis1: (0, 0), axis2: (10, 0), baseLines: [Sources::Base], enabled: false)",
      "}",
      "layout L {",
      "  place Placed(at: (0, 0))",
      "}",
      "svg S(layout: L, layers: [finished], margin: 0)"
    ]);
    const evaluation = evaluationFor(doc);
    const output = doc.document.svgOutputs[0]!;
    expect(buildOutputPlan({ compiledDocument: doc, output, evaluation }).drawables.map((drawable) => drawable.name)).toEqual(["Preview"]);
    const baseId = doc.document.elements.find((element) => element.name === "Base")!.id;
    const ownerId = doc.document.elements.find((element) => element.name === "Preview")!.id;
    const visibleSourceEvaluation = {
      ...evaluation,
      effectiveVisibleElementIds: new Set([...evaluation.effectiveVisibleElementIds ?? []].filter((id) => id !== baseId))
    };
    const before = buildOutputPlan({ compiledDocument: doc, output, evaluation: visibleSourceEvaluation });
    const layerId = output.layers[0]!.identity;
    const previous = useCadUiStore.getState().hiddenCanvasLayerIds;
    try {
      useCadUiStore.setState({ hiddenCanvasLayerIds: new Set([...previous, layerId]) });
      const after = buildOutputPlan({ compiledDocument: doc, output, evaluation: visibleSourceEvaluation });
      expect(after.drawables).toEqual(before.drawables);
      expect(after.rustPayload).toEqual(before.rustPayload);
    } finally {
      useCadUiStore.setState({ hiddenCanvasLayerIds: previous });
    }
    expect(before.drawables).toEqual([]);
    const visibleOwnerEvaluation = {
      ...evaluation,
      effectiveVisibleElementIds: new Set([...evaluation.effectiveVisibleElementIds ?? []].filter((id) => id !== ownerId))
    };
    expect(buildOutputPlan({ compiledDocument: doc, output, evaluation: visibleOwnerEvaluation }).drawables).toEqual([]);
  });

  it("follows the active conditional branch for mirrorCopy owners", () => {
    const source = [
      "nui 1",
      "const active: boolean = false",
      "line Base = segment(start: (0, 0), end: (10, 0))",
      "group Placed {",
      "  if (active) {",
      "    line ConditionalPreview = mirrorCopy(axis1: (0, 0), axis2: (0, 10), baseLines: [Base])",
      "  } else {",
      "    line Alternate = mirrorCopy(axis1: (0, 0), axis2: (0, 10), baseLines: [Base])",
      "  }",
      "}",
      "layout L {",
      "  place Placed(at: (0, 0))",
      "}",
      "svg S(layout: L, layers: [default], margin: 0)"
    ];
    const planForSource = (currentSource: string[]) => {
      const doc = sourceFor(currentSource);
      return buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0]!, evaluation: evaluationFor(doc) });
    };
    const inactive = planForSource(source);
    const active = planForSource(source.map((line) => line.replace("active: boolean = false", "active: boolean = true")));

    expect(inactive.drawables.map((drawable) => drawable.name)).toEqual(["Alternate"]);
    expect(active.drawables.map((drawable) => drawable.name)).toEqual(["ConditionalPreview"]);
  });

  it("keeps generated mirrorCopy occurrence order at authored forGroup positions", () => {
    const doc = sourceFor([
      "nui 1",
      "group Placed {",
      "  for i in range(min: 1, max: 2, step: 1, showGenerated: true) {",
      "    line Base = segment(start: (i, 0), end: (i + 5, 0))",
      "    line Preview = mirrorCopy(axis1: (0, 0), axis2: (0, 100), baseLines: [Base])",
      "  }",
      "}",
      "layout L {",
      "  place Placed(at: (0, 0))",
      "}",
      "svg S(layout: L, layers: [default], margin: 0)"
    ]);
    const evaluation = evaluationFor(doc);
    const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0]!, evaluation });

    expect(evaluation.forGroupGeneratedRows).toHaveLength(4);
    expect(evaluation.mirrorCopyPreviews?.size).toBe(2);
    const ownerTemplateId = doc.document.elements.find((element) => element.name === "Preview")!.id;
    expect([...evaluation.mirrorCopyPreviews!.keys()]).toEqual(
      evaluation.forGroupGeneratedRows!.filter((row) => row.templateElementId === ownerTemplateId).map((row) => row.generatedElementId)
    );
    expect(plan.drawables.map((drawable) => drawable.name)).toEqual(["Base", "Preview", "Base", "Preview"]);
    expect(plan.drawables.filter((drawable) => drawable.kind === "line").map((drawable) => drawable.kind === "line" ? [drawable.start, drawable.end] : [])).toEqual([
      [{ x: 1, y: 0 }, { x: 6, y: 0 }],
      [{ x: 2, y: 0 }, { x: 7, y: 0 }]
    ]);
    expect(mirrorPaths(plan.drawables).map((path) => path.segments)).toEqual([
      [{ kind: "line", start: { x: -1, y: 0 }, end: { x: -6, y: 0 } }],
      [{ kind: "line", start: { x: -2, y: 0 }, end: { x: -7, y: 0 } }]
    ]);

    const visibleOwnerOccurrences = evaluation.forGroupGeneratedRows!.filter(
      (row) => row.templateElementId === ownerTemplateId && evaluation.effectiveVisibleElementIds?.has(row.generatedElementId)
    );
    expect(visibleOwnerOccurrences).toHaveLength(2);
    const missingOccurrenceId = visibleOwnerOccurrences[0]!.generatedElementId;
    const missingOccurrenceEvaluation = {
      ...evaluation,
      mirrorCopyPreviews: new Map(evaluation.mirrorCopyPreviews ?? [])
    };
    missingOccurrenceEvaluation.mirrorCopyPreviews.delete(missingOccurrenceId);
    expect(missingOccurrenceEvaluation.errors).toEqual([]);
    expect(missingOccurrenceEvaluation.effectiveVisibleElementIds?.has(missingOccurrenceId)).toBe(true);
    expect(missingOccurrenceEvaluation.mirrorCopyPreviews.has(missingOccurrenceId)).toBe(false);
    expect(() => buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0]!, evaluation: missingOccurrenceEvaluation }))
      .toThrow(OutputPlanError);
  });

  it("updates mirrorCopy geometry for source, axis, and selector membership changes", () => {
    const base = [
      "nui 1",
      "point AxisA = coordinate(x: 0, y: 0)",
      "point AxisB = coordinate(x: 0, y: 100)",
      "group Sources {",
      "  line First = segment(start: (2, 3), end: (6, 5))",
      "}",
      "group Placed {",
      "  line Preview = mirrorCopy(axis1: AxisA, axis2: AxisB, baseLines: [@Sources])",
      "}",
      "layout L {",
      "  place Placed(at: (0, 0))",
      "}",
      "svg S(layout: L, layers: [default], margin: 0)"
    ];
    const planFrom = (lines: string[]) => {
      const doc = sourceFor(lines);
      const evaluation = evaluationFor(doc);
      return buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0]!, evaluation });
    };
    const original = planFrom(base);
    const sourceChanged = planFrom(base.map((line) => line.replace("(2, 3)", "(4, 9)")));
    const axisChanged = planFrom(base.map((line) => line.includes("AxisA =") ? line.replace("x: 0", "x: 1") : line.includes("AxisB =") ? line.replace("x: 0", "x: 1") : line));
    const memberAdded = planFrom(base.map((line, index) => index === 5 ? "  line Second = segment(start: (20, 4), end: (30, 4))\n  }" : line));

    expect(mirrorPaths(original.drawables)).toHaveLength(1);
    expect(mirrorPaths(sourceChanged.drawables)[0]!.segments).toEqual([{ kind: "line", start: { x: -4, y: 9 }, end: { x: -6, y: 5 } }]);
    expect(mirrorPaths(axisChanged.drawables)[0]!.segments).toEqual([{ kind: "line", start: { x: 0, y: 3 }, end: { x: -4, y: 5 } }]);
    expect(mirrorPaths(memberAdded.drawables)).toHaveLength(2);
    expect(mirrorPaths(memberAdded.drawables)[1]!.segments).toEqual([{ kind: "line", start: { x: -20, y: 4 }, end: { x: -30, y: 4 } }]);
  });

  it("fails closed for selected invalid mirrorCopy owners and isolates unrelated owners", () => {
    const doc = sourceFor([
      "nui 1",
      "layer finished",
      "layer draft",
      "line Base = segment(start: (0, 0), end: (10, 0))",
      "group Placed {",
      "  line Good in finished = mirrorCopy(axis1: (0, 0), axis2: (0, 10), baseLines: [Base])",
      "  line Bad in draft = mirrorCopy(axis1: (0, 0), axis2: (0, 0), baseLines: [Base])",
      "}",
      "layout L {",
      "  place Placed(at: (0, 0))",
      "}",
      "svg Finished(layout: L, layers: [finished], margin: 0)",
      "svg Draft(layout: L, layers: [draft], margin: 0)"
    ]);
    const evaluation = evaluationFor(doc);
    const bad = doc.document.elements.find((element) => element.name === "Bad")!;
    expect(evaluation.errors).toEqual(expect.arrayContaining([expect.objectContaining({ elementId: bad.id })]));
    expect(evaluation.mirrorCopyPreviews?.has(bad.id)).toBe(false);
    expect(buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0]!, evaluation }).drawables.map((drawable) => drawable.name)).toEqual(["Good"]);
    expect(() => buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[1]!, evaluation })).toThrow(OutputPlanError);
  });

  it("uses independent print and SVG layer selectors", () => {
    const doc = sourceFor([
      "nui 1",
      "layer finished",
      "layer draft",
      "style Outline {",
      "  width: 3px,",
      "  color: #123456,",
      "  fill: #abcdef,",
      "}",
      "group G {",
      "  line Cut[Outline] in finished = polyline(points: [(0, 0), (10, 0), (10, 10)], closed: true)",
      "  line Draft in draft = segment(start: (1000, 1000), end: (2000, 1000))",
      "}",
      "layout L {",
      "  place G(at: (0, 0))",
      "}",
      "print P(layout: L, layers: [finished], paper: a4, overlap: 10)",
      "svg S(layout: L, layers: [draft], margin: 0)"
    ]);
    const print = buildOutputPlan({ compiledDocument: doc, output: doc.document.printOutputs[0], evaluation: evaluationFor(doc) });
    const svg = buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0], evaluation: evaluationFor(doc) });

    expect(print.drawables.map((drawable) => drawable.name)).toEqual(["Cut"]);
    expect(svg.drawables.map((drawable) => drawable.name)).toEqual(["Draft"]);
    expect(print.drawables[0]).toMatchObject({
      stroke: { widthMm: 3 * PX_TO_MM, colorHex: "#123456" },
      fill: { colorHex: "#abcdef", opacity: 1 }
    });
    expect(print.rustPayload.drawables).toEqual(print.drawables);
    expect(svg.rustPayload.drawables).toEqual(svg.drawables);
  });

  it("includes implicit default members only when default is selected", () => {
    const doc = sourceFor([
      "nui 1",
      "layer finished",
      "group G {",
      "  line Ordinary = segment(start: (0, 0), end: (10, 0))",
      "  line Finished in finished = segment(start: (0, 10), end: (10, 10))",
      "}",
      "layout L {",
      "  place G(at: (0, 0))",
      "}",
      "svg OnlyFinished(layout: L, layers: [finished], margin: 0)",
      "svg DefaultAndFinished(layout: L, layers: [default, finished], margin: 0)"
    ]);

    expect(buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0], evaluation: evaluationFor(doc) }).drawables.map((drawable) => drawable.name)).toEqual(["Finished"]);
    expect(buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[1], evaluation: evaluationFor(doc) }).drawables.map((drawable) => drawable.name)).toEqual(["Ordinary", "Finished"]);
  });

  it("filters far draft geometry before rendered bounds and print tiling", () => {
    const doc = sourceFor([
      "nui 1",
      "layer finished",
      "layer draft",
      "group G {",
      "  line Cut in finished = segment(start: (0, 0), end: (20, 0))",
      "  line Draft in draft = segment(start: (1000, 0), end: (2000, 0))",
      "}",
      "layout L {",
      "  place G(at: (0, 0))",
      "}",
      "print P(layout: L, layers: [finished], paper: a4, overlap: 0)"
    ]);
    const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.printOutputs[0], evaluation: evaluationFor(doc) });

    expect(plan.drawables.map((drawable) => drawable.name)).toEqual(["Cut"]);
    expect(plan.renderedBounds.maxX).toBeLessThan(21);
    expect(plan.print).toMatchObject({ columns: 1, rows: 1, pages: [expect.objectContaining({ column: 0, row: 0 })] });
  });

  it("returns a valid explicit empty result without inventing geometry", () => {
    const doc = sourceFor([
      "nui 1",
      "layer finished",
      "group G {",
      "  line Cut = segment(start: (0, 0), end: (10, 0))",
      "}",
      "layout L {",
      "  place G(at: (0, 0))",
      "}",
      "print P(layout: L, layers: [finished], paper: a4, overlap: 0)",
      "svg S(layout: L, layers: [finished], margin: 5)"
    ]);
    const print = buildOutputPlan({ compiledDocument: doc, output: doc.document.printOutputs[0], evaluation: evaluationFor(doc) });
    const svg = buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0], evaluation: evaluationFor(doc) });

    expect(print.empty).toBe(true);
    expect(print.drawables).toEqual([]);
    expect(print.renderedBounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 });
    expect(print.print?.pages).toEqual([]);
    expect(svg.empty).toBe(true);
    expect(svg.svg).toMatchObject({ widthMm: 0, heightMm: 0 });
    expect(svg.rustPayload.drawables).toEqual([]);
  });

  it("ignores Canvas hidden-layer state when planning physical output", () => {
    const doc = simpleSource();
    const evaluation = evaluationFor(doc);
    const selected = output(doc, "S");
    const layerIdentity = selected.layers[0]!.identity;
    const before = buildOutputPlan({ compiledDocument: doc, output: selected, evaluation });
    const previous = useCadUiStore.getState().hiddenCanvasLayerIds;
    try {
      useCadUiStore.setState({ hiddenCanvasLayerIds: new Set([...previous, layerIdentity]) });
      const after = buildOutputPlan({ compiledDocument: doc, output: selected, evaluation });
      expect(after.drawables).toEqual(before.drawables);
      expect(after.bounds).toEqual(before.bounds);
      expect(after.rustPayload).toEqual(before.rustPayload);
    } finally {
      useCadUiStore.setState({ hiddenCanvasLayerIds: previous });
    }
  });

  it("preserves visible and enabled gates inside a selected layer", () => {
    const doc = sourceFor([
      "nui 1",
      "layer finished",
      "style Suppress {",
      "  visible: false,",
      "}",
      "group G {",
      "  line Cut in finished = segment(start: (0, 0), end: (10, 0))",
      "  line Hidden[Suppress] in finished = segment(start: (0, 10), end: (10, 10))",
      "  line Disabled in finished = segment(start: (0, 20), end: (10, 20), enabled: false)",
      "}",
      "layout L {",
      "  place G(at: (0, 0))",
      "}",
      "svg S(layout: L, layers: [finished], margin: 0)"
    ]);
    const evaluation = evaluationFor(doc);
    const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0], evaluation });

    expect(plan.drawables.map((drawable) => drawable.name)).toEqual(["Cut"]);
    expect(evaluation.effectiveEnabledElementIds).not.toContain(doc.document.elements.find((element) => element.name === "Disabled")?.id);
    expect(evaluation.effectiveVisibleElementIds).not.toContain(doc.document.elements.find((element) => element.name === "Hidden")?.id);
  });

  it("allows proven unrelated excluded failures and keeps selected failures blocking", () => {
    const doc = sourceFor([
      "nui 1",
      "layer finished",
      "layer draft",
      "group G {",
      "  line Cut in finished = segment(start: (0, 0), end: (10, 0))",
      "  text Invalid in draft = label(text: \"invalid\", anchor: (500, 500), size: 0)",
      "}",
      "layout L {",
      "  place G(at: (0, 0))",
      "}",
      "svg Finished(layout: L, layers: [finished], margin: 0)",
      "svg Draft(layout: L, layers: [draft], margin: 0)"
    ]);
    const evaluation = evaluationFor(doc);
    const invalid = doc.document.elements.find((element) => element.name === "Invalid")!;

    expect(evaluation.errors).toEqual(expect.arrayContaining([expect.objectContaining({ elementId: invalid.id })]));
    expect(buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0], evaluation }).drawables.map((drawable) => drawable.name)).toEqual(["Cut"]);
    expect(() => buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[1], evaluation })).toThrow(OutputPlanError);
    expect(evaluation.errors).toEqual(expect.arrayContaining([expect.objectContaining({ elementId: invalid.id })]));
  });

  it("blocks a selected drawable when a required excluded-layer dependency has an error", () => {
    const doc = sourceFor([
      "nui 1",
      "layer finished",
      "layer draft",
      "group G {",
      "  point DraftPoint in draft = coordinate(x: 0, y: 0)",
      "  line Cut in finished = segment(start: DraftPoint, end: (10, 0))",
      "}",
      "layout L {",
      "  place G(at: (0, 0))",
      "}",
      "svg S(layout: L, layers: [finished], margin: 0)"
    ]);
    const base = evaluationFor(doc);
    const draftPoint = doc.document.elements.find((element) => element.name === "DraftPoint")!;
    const evaluation = {
      ...base,
      errors: [...base.errors, {
        elementId: draftPoint.id,
        elementName: draftPoint.name,
        missingDependencyId: draftPoint.id,
        message: "required dependency failed"
      }]
    };

    expect(() => buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0], evaluation })).toThrow("required dependency failed");
  });

  it("fails closed for unresolved evaluation owners and placement targets", () => {
    const doc = simpleSource();
    const base = evaluationFor(doc);
    const unresolved = {
      ...base,
      errors: [...base.errors, { elementId: "missing-owner", elementName: "?", missingDependencyId: "missing-owner", message: "unattributed failure" }]
    };
    expect(() => buildOutputPlan({ compiledDocument: doc, output: output(doc, "S"), evaluation: unresolved })).toThrow("unresolved owner");

    const line = doc.document.elements.find((element) => element.name === "AB")!;
    const graph = doc.typedDependencyGraph!;
    const graphWithoutOwner = {
      ...doc,
      typedDependencyGraph: { ...graph, evaluationOrder: graph.evaluationOrder.filter((elementId) => elementId !== line.id) }
    };
    const ambiguousOwner = {
      ...base,
      errors: [...base.errors, {
        elementId: line.id,
        elementName: line.name,
        missingDependencyId: line.id,
        message: "owner is absent from the dependency graph"
      }]
    };
    expect(() => buildOutputPlan({ compiledDocument: graphWithoutOwner, output: output(doc, "S"), evaluation: ambiguousOwner })).toThrow("unresolved owner");

    const malformed = simpleSource();
    malformed.document.elements.find((element) => element.name === "AB")!.parentGroupId = "missing-parent";
    expect(() => buildOutputPlan({ compiledDocument: malformed, output: output(malformed, "S"), evaluation: evaluationFor(malformed) })).toThrow("unresolved parent ownership");

    doc.document.layouts[0]!.placements[0]!.groupId = "missing-group";
    expect(() => buildOutputPlan({ compiledDocument: doc, output: output(doc, "S"), evaluation: base })).toThrow("unresolved group ownership");
  });

  it("uses mirror, scale, rotation, and translation in a stable transform order", () => {
    const doc = sourceFor([
      "nui 1",
      "group G {",
      "  point A = coordinate(x: 0, y: 0)",
      "  point B = coordinate(x: 10, y: 0)",
      "  line AB = segment(start: A, end: B)",
      "}",
      "layout L(scale: 2) {",
      "  place G(origin: G::A, at: (10, 20), angle: 90, mirror: true)",
      "}",
      "svg S(layout: L, layers: [default], margin: 0)"
    ]);
    const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0], evaluation: evaluationFor(doc) });
    const line = plan.drawables.find((drawable) => drawable.kind === "line");
    expect(line?.start.x).toBeCloseTo(10);
    expect(line?.start.y).toBeCloseTo(20);
    expect(line?.end.x).toBeCloseTo(10);
    expect(line?.end.y).toBeCloseTo(0);
  });

  it("emits supported final geometry from alternate and derived constructions", () => {
    const doc = sourceFor([
      "nui 1",
      "group G {",
      "  point A = coordinate(x: 0, y: 0)",
      "  point B = coordinate(x: 10, y: 0)",
      "  point C = coordinate(x: 5, y: 5)",
      "  line Polar = polar(start: A, angle: 0, length: 10)",
      "  arc Through = through(point1: A, point2: B, point3: C, start: 0, end: 180)",
      "  line Copy = transformCopy(startPoint: A, endPoint: B, scale: 1, angleDeg: 0, mirrorX: false, baseLines: [Polar])",
      "}",
      "layout L {",
      "  place G(at: (0, 0))",
      "}",
      "svg S(layout: L, layers: [default])"
    ]);
    const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0], evaluation: evaluationFor(doc) });

    expect(plan.drawables.some((drawable) => drawable.name === "Polar" && drawable.kind === "line")).toBe(true);
    expect(plan.drawables.some((drawable) => drawable.name === "Through" && drawable.kind === "arc")).toBe(true);
    expect(plan.drawables.some((drawable) => drawable.name === "Copy" && drawable.kind === "offsetLine")).toBe(true);
  });

  it("emits a positive direct arc as output geometry", () => {
    const doc = sourceFor([
      "nui 1",
      "group G {",
      "  arc A = arc(center: (0, 0), radius: 12, start: 30, end: 150)",
      "}",
      "layout L {",
      "  place G(at: (0, 0))",
      "}",
      "svg S(layout: L, layers: [default])"
    ]);
    const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0], evaluation: evaluationFor(doc) });

    expect(plan.drawables).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "A", kind: "arc", radius: 12 })
    ]));
  });

  it("emits a polyline as one ordered output drawable", () => {
    const doc = sourceFor([
      "nui 1",
      "group G {",
      "  line Outline = polyline(points: [(0, 0), (10, 0), (10, 10)], closed: true)",
      "}",
      "layout L {",
      "  place G(at: (0, 0))",
      "}",
      "svg S(layout: L, layers: [default])"
    ]);
    const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0], evaluation: evaluationFor(doc) });
    const drawable = plan.drawables.find((candidate) => candidate.name === "Outline");
    expect(drawable).toMatchObject({ kind: "polyline", closed: true, segments: expect.any(Array) });
    if (!drawable || drawable.kind !== "polyline") throw new Error("missing polyline output");
    expect(drawable.segments).toHaveLength(3);
    expect(drawable.segments.at(-1)).toMatchObject({ start: { x: 10, y: 10 }, end: { x: 0, y: 0 } });
  });

  it("carries fill and opacity on the same closed-path drawable while preserving stroke and placement", () => {
    const doc = sourceFor([
      "nui 1",
      "style Fill {",
      "  color: warning,",
      "  width: 2px,",
      "  fill: #123456,",
      "  fillOpacity: 0.25,",
      "}",
      "group G {",
      "  line Outline [Fill] = polyline(points: [(0, 0), (10, 0), (10, 10)], closed: true)",
      "  line Open [Fill] = polyline(points: [(20, 0), (30, 0), (20, 0)], closed: false)",
      "  line StrokeOnly [Fill] = segment(start: (40, 0), end: (50, 0))",
      "}",
      "layout L {",
      "  place G(at: (100, 20), scale: 2, angle: 90, mirror: true)",
      "}",
      "svg S(layout: L, layers: [default], margin: 0)"
    ]);
    const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0], evaluation: evaluationFor(doc) });
    const outline = plan.drawables.find((drawable) => drawable.name === "Outline");
    const open = plan.drawables.find((drawable) => drawable.name === "Open");
    const strokeOnly = plan.drawables.find((drawable) => drawable.name === "StrokeOnly");

    expect(outline).toMatchObject({
      kind: "polyline",
      stroke: { widthMm: 2 * PX_TO_MM, colorHex: "#73320d" },
      fill: { colorHex: "#123456", opacity: 0.25 }
    });
    expect(open).not.toHaveProperty("fill");
    expect(strokeOnly).not.toHaveProperty("fill");
    expect(outline?.elementId).toBe(doc.document.elements.find((element) => element.name === "Outline")?.id);
    expect(plan.placements[0]?.drawables).toContain(outline);
    expect(plan.placements[0]?.at).toEqual({ x: 100, y: 20 });
    expect(plan.rustPayload.drawables.find((drawable) => drawable.name === "Outline")).toMatchObject({
      fill: { colorHex: "#123456", opacity: 0.25 },
      stroke: { colorHex: "#73320d" }
    });
  });

  it("carries fill on closed joined and offset paths and suppresses it for self-intersection", () => {
    const doc = sourceFor([
      "nui 1",
      "group G {",
      "  line Base = polyline(points: [(0, 0), (10, 0), (10, 10), (0, 10)], closed: true)",
      "  line Offset = offset(sources: [Base], distance: 1, side: @left, closed: true, suppressTrimWarnings: false)",
      "  line A = segment(start: (20, 0), end: (30, 10))",
      "  line B = segment(start: (30, 10), end: (20, 10))",
      "  line C = segment(start: (20, 10), end: (30, 0))",
      "  line D = segment(start: (30, 0), end: (20, 0))",
      "  line Crossing = join(paths: [A, B, C, D], closed: true)",
      "}",
      "layout L {",
      "  place G(at: (0, 0))",
      "}",
      "svg S(layout: L, layers: [default], margin: 0)"
    ]);
    doc.document.modifiers = [{ name: "Fill", fill: { kind: "themeRole", role: "accent" }, fillOpacity: 0.5 }];
    for (const name of ["Base", "Offset", "Crossing"]) {
      doc.document.elements.find((element) => element.name === name)!.modifierNames = ["Fill"];
    }

    const evaluation = evaluationFor(doc);
    const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0], evaluation });
    expect(plan.drawables.find((drawable) => drawable.name === "Base")).toMatchObject({ fill: { colorHex: "#0f766e", opacity: 0.5 } });
    expect(plan.drawables.find((drawable) => drawable.name === "Offset")).toMatchObject({ fill: { colorHex: "#0f766e", opacity: 0.5 } });
    expect(plan.drawables.find((drawable) => drawable.name === "Crossing")).not.toHaveProperty("fill");
    expect(evaluation.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ elementId: expect.any(String), message: expect.stringContaining("自己交差") })
    ]));
  });

  it("supports nested targets and repeated independent placements", () => {
    const doc = sourceFor([
      "nui 1",
      "group Outer {",
      "  group Inner {",
      "    point A = coordinate(x: 0, y: 0)",
      "    point B = coordinate(x: 10, y: 0)",
      "    line AB = segment(start: A, end: B)",
      "  }",
      "}",
      "layout L {",
      "  place Outer::Inner(at: (0, 0))",
      "  place Outer::Inner(at: (100, 0))",
      "}",
      "svg S(layout: L, layers: [default])"
    ]);
    const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0], evaluation: evaluationFor(doc) });
    const lines = plan.drawables.filter((drawable) => drawable.kind === "line");
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.start.x)).toEqual([0, 100]);
  });

  it("resolves layout and output numbers from compiled typed scalar runtime values", async () => {
    const doc = sourceFor([
      "nui 1",
      "const unit: number = 2",
      "group G {",
      "  line AB = segment(start: (0, 0), end: (10, 0))",
      "}",
      "layout L(scale: unit) {",
      "  place G(at: (unit, unit), scale: unit)",
      "}",
      "svg S(layout: L, layers: [default], margin: unit)"
    ]);
    const plan = await evaluateOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0] });
    expect(plan.placements[0]).toMatchObject({ scale: 2, at: { x: 2, y: 2 } });
    expect(plan.svg?.widthMm).toBe(plan.renderedBounds.width + 4);
  });

  it("normalizes typed runtime placement angles for geometry and text output", async () => {
    const doc = sourceFor([
      "nui 1",
      "const negative: number = -90",
      "const over: number = 450",
      "group G {",
      "  point A = coordinate(x: 0, y: 0)",
      "  point B = coordinate(x: 10, y: 0)",
      "  line AB = segment(start: A, end: B)",
      "  text Label = label(text: \"AB\", anchor: A, size: 3)",
      "}",
      "layout L {",
      "  place G(at: (0, 0), angle: negative)",
      "  place G(at: (20, 0), angle: over)",
      "}",
      "svg S(layout: L, layers: [default])"
    ]);
    const plan = await evaluateOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0] });

    expect(plan.placements.map((placement) => placement.angleDeg)).toEqual([270, 90]);
    const lines = plan.placements.map((placement) => {
      const line = placement.drawables.find((drawable) => drawable.kind === "line");
      if (!line || line.kind !== "line") throw new Error("missing output line");
      return line;
    });
    expect(lines[0].end.x).toBeCloseTo(0);
    expect(lines[0].end.y).toBeCloseTo(-10);
    expect(lines[1].end.x).toBeCloseTo(20);
    expect(lines[1].end.y).toBeCloseTo(10);
    const texts = plan.placements.map((placement) => {
      const text = placement.drawables.find((drawable) => drawable.kind === "text");
      if (!text || text.kind !== "text") throw new Error("missing output text");
      return text;
    });
    expect(texts.map((text) => text.rotationDeg)).toEqual([270, 90]);
  });

  it("includes final stroke width and deterministic text bounds", () => {
    const doc = simpleSource(["style Heavy {", "  width: 4px,", "  color: #FF3355,", "}"]);
    const line = doc.document.elements.find((element) => element.name === "AB")!;
    line.modifierNames = ["Heavy"];
    const plan = buildOutputPlan({ compiledDocument: doc, output: output(doc, "S"), evaluation: evaluationFor(doc) });
    expect(plan.renderedBounds.minX).toBeLessThan(0);
    expect(plan.renderedBounds.maxX).toBeGreaterThan(10);
    expect(plan.drawables.find((drawable) => drawable.kind === "line")).toMatchObject({
      stroke: { widthMm: 4 * PX_TO_MM, colorHex: "#ff3355" }
    });
    expect(plan.drawables.find((drawable) => drawable.kind === "text")).toBeDefined();
  });

  it.each([0, -1])("fails Output closed for Text geometry with a non-positive font size (%s)", (fontSize) => {
    const doc = sourceFor([
      "nui 1",
      "group G {",
      "  point A = coordinate(x: 0, y: 0)",
      "  point B = coordinate(x: 10, y: 0)",
      "  line AB = segment(start: A, end: B)",
      `  text Invalid = label(text: "invalid", anchor: A, size: ${fontSize})`,
      "}",
      "layout L {",
      "  place G(at: (0, 0))",
      "}",
      "svg S(layout: L, layers: [default], margin: 0)"
    ]);
    const invalid = doc.document.elements.find((element) => element.name === "Invalid")!;
    const evaluation = evaluationFor(doc);

    expect(evaluation.computedGeometry.has(invalid.id)).toBe(false);
    expect(evaluation.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ elementId: invalid.id, missingDependencyId: invalid.id })
    ]));
    expect(() => buildOutputPlan({
      compiledDocument: doc,
      output: doc.document.svgOutputs[0],
      evaluation
    })).toThrow(`Output evaluation failed: ${invalid.name} の文字サイズは0より大きい値で指定してください。`);
  });

  it("keeps a styled stroke physical across placement scales while transforming geometry", () => {
    const doc = sourceFor([
      "nui 1",
      "style Styled {",
      "  width: 1px,",
      "}",
      "group G {",
      "  point A = coordinate(x: 0, y: 0)",
      "  point B = coordinate(x: 10, y: 0)",
      "  line AB [Styled] = segment(start: A, end: B)",
      "}",
      "layout L {",
      "  place G(at: (0, 0), scale: 0.5)",
      "  place G(at: (0, 20), scale: 1)",
      "  place G(at: (0, 40), scale: 2)",
      "}",
      "svg S(layout: L, layers: [default])"
    ]);
    const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0], evaluation: evaluationFor(doc) });
    const lines = plan.placements.map((placement) => {
      const line = placement.drawables.find((drawable) => drawable.kind === "line");
      if (!line || line.kind !== "line") throw new Error("missing styled output line");
      return line;
    });

    expect(lines.map((line) => Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y))).toEqual([5, 10, 20]);
    for (const line of lines) {
      expect(line.stroke.widthMm).toBeCloseTo(PX_TO_MM);
      const bounds = outputDrawableBounds(line);
      const length = Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y);
      expect(bounds.width).toBeCloseTo(length + PX_TO_MM);
      expect(bounds.height).toBeCloseTo(PX_TO_MM);
    }
  });

  it("keeps an empty layout empty and inflates populated SVG bounds by margin", () => {
    const doc = sourceFor([
      "nui 1",
      "layout Empty {",
      "}",
      "svg S(layout: Empty, layers: [default], margin: 5)"
    ]);
    const empty = buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0], evaluation: evaluationFor(doc) });
    expect(empty.empty).toBe(true);
    expect(empty.drawables).toEqual([]);
    expect(empty.svg).toMatchObject({ widthMm: 0, heightMm: 0 });

    const populated = simpleSource();
    const plan = buildOutputPlan({ compiledDocument: populated, output: output(populated, "S"), evaluation: evaluationFor(populated) });
    const svg = plan.svg!;
    expect(svg.widthMm).toBe(plan.renderedBounds.width + 10);
    expect(svg.heightMm).toBe(plan.renderedBounds.height + 10);
    expect(svg.viewBox).toEqual({ x: 0, y: 0, width: svg.widthMm, height: svg.heightMm });
  });

  it("starts print pagination at the fixed usable origin and counts positive extents", () => {
    const doc = sourceFor([
      "nui 1",
      "group G {",
      "  line Remote = segment(start: (500, 50), end: (1000, 50))",
      "}",
      "layout L {",
      "  place G(at: (0, 0))",
      "}",
      "print P(layout: L, layers: [default], paper: a4, orientation: portrait, overlap: 10)"
    ]);
    const plan = buildOutputPlan({
      compiledDocument: doc,
      output: doc.document.printOutputs[0]!,
      evaluation: evaluationFor(doc)
    });

    // The line reaches x=1000 mm, so six 190 mm strides are needed. These
    // expectations are derived from the authored coordinates and A4 dimensions.
    expect(plan.renderedBounds.minX).toBeGreaterThan(0);
    expect(plan.print).toMatchObject({ strideXmm: 190, strideYmm: 277, columns: 6, rows: 1 });
    expect(plan.print!.pages).toHaveLength(6);
    expect(plan.print!.pages[0]!.origin).toEqual({ x: -10, y: -10 });
    expect(plan.print!.pages[1]!.origin).toEqual({ x: 180, y: -10 });
  });

  it("computes physical first-page areas, strides, and page counts for every A4/A3 orientation", () => {
    const cases = [
      { paper: "a4", orientation: "portrait", paperWidthMm: 210, paperHeightMm: 297, columns: 4, rows: 2 },
      { paper: "a4", orientation: "landscape", paperWidthMm: 297, paperHeightMm: 210, columns: 3, rows: 3 },
      { paper: "a3", orientation: "portrait", paperWidthMm: 297, paperHeightMm: 420, columns: 3, rows: 2 },
      { paper: "a3", orientation: "landscape", paperWidthMm: 420, paperHeightMm: 297, columns: 2, rows: 2 }
    ] as const;

    for (const testCase of cases) {
      const doc = sourceFor([
        "nui 1",
        "group G {",
        "  line Large = segment(start: (0, 0), end: (650, 500))",
        "}",
        "layout L {",
        "  place G(at: (0, 0))",
        "}",
        `print P(layout: L, layers: [default], paper: ${testCase.paper}, orientation: ${testCase.orientation}, overlap: 10)`
      ]);
      const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.printOutputs[0], evaluation: evaluationFor(doc) });
      const print = plan.print!;
      const usableWidthMm = testCase.paperWidthMm - 20;
      const usableHeightMm = testCase.paperHeightMm - 20;
      const strideXmm = usableWidthMm;
      const strideYmm = usableHeightMm;
      const expectedColumns = testCase.columns;
      const expectedRows = testCase.rows;

      expect(print).toMatchObject({
        paperWidthMm: testCase.paperWidthMm,
        paperHeightMm: testCase.paperHeightMm,
        strideXmm,
        strideYmm,
        columns: expectedColumns,
        rows: expectedRows
      });
      expect(expectedColumns).toBe(testCase.columns);
      expect(expectedRows).toBe(testCase.rows);
      expect(print.pages).toHaveLength(expectedColumns * expectedRows);
      expect(plan.rustPayload).toMatchObject({ overlapMm: 10, stride: { x: strideXmm, y: strideYmm } });
      expect(plan.rustPayload).not.toHaveProperty("marginMm");
      expect(plan.rustPayload).not.toHaveProperty("stride.xMm");
      expect(plan.rustPayload).not.toHaveProperty("stride.yMm");
      expect(print.pages.map((page) => page.index)).toEqual(print.pages.map((_, index) => index));
      expect(print.pages[0].origin).toEqual({ x: -10, y: -10 });
      if (testCase.columns > 1) {
        const first = print.pages[0];
        const adjacent = print.pages[1];
        expect(adjacent.origin.x).toBe(strideXmm - 10);
        expect(adjacent.origin.x - first.origin.x).toBe(strideXmm);
        expect(first.origin.x + testCase.paperWidthMm - adjacent.origin.x).toBe(20);
      }
      if (testCase.rows > 1) {
        const first = print.pages[0];
        const adjacent = print.pages[testCase.columns];
        expect(adjacent.origin.y).toBe(strideYmm - 10);
        expect(adjacent.origin.y - first.origin.y).toBe(strideYmm);
        expect(first.origin.y + testCase.paperHeightMm - adjacent.origin.y).toBe(20);
      }
    }
  });

  it("emits unique matching labels, resolved centers, and rotated shrink-to-fit guides", () => {
    const doc = sourceFor([
      "nui 1",
      "group G {",
      "  line Large = segment(start: (0, 0), end: (2500, 2500))",
      "}",
      "layout L {",
      "  place G(at: (0, 0))",
      "}",
      "print P(layout: L, layers: [default], paper: a4, overlap: 1)"
    ]);
    const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.printOutputs[0], evaluation: evaluationFor(doc) });
    const guides = plan.print!.pages.flatMap((page) => page.guides);
    expect(guides.some((guide) => guide.label?.text === "10")).toBe(true);
    expect(guides.some((guide) => guide.label?.text === "AA")).toBe(true);
    expect(guides.filter((guide) => guide.label && guide.axis === "vertical").every((guide) => guide.label!.rotationDeg === 90)).toBe(true);
    expect(guides.filter((guide) => guide.label && guide.axis === "horizontal").every((guide) => guide.label!.rotationDeg === 0)).toBe(true);
    expect(new Set(guides.filter((guide) => guide.axis === "vertical").map((guide) => guide.positionMm))).toEqual(new Set([1, 209]));
    expect(new Set(guides.filter((guide) => guide.axis === "horizontal").map((guide) => guide.positionMm))).toEqual(new Set([1, 296]));
    const verticalPairs = new Map<string, string[]>();
    const horizontalPairs = new Map<string, string[]>();
    for (const page of plan.print!.pages) {
      for (const guide of page.guides) {
        if (!guide.label) continue;
        if (guide.axis === "vertical") {
          const boundary = guide.positionMm === plan.print!.overlapMm ? page.column - 1 : page.column;
          const key = `${page.row}:${boundary}`;
          verticalPairs.set(key, [...(verticalPairs.get(key) ?? []), guide.label.text]);
        } else {
          const boundary = guide.positionMm === plan.print!.overlapMm ? page.row - 1 : page.row;
          const key = `${boundary}:${page.column}`;
          horizontalPairs.set(key, [...(horizontalPairs.get(key) ?? []), guide.label.text]);
        }
      }
    }
    expect([...verticalPairs.values()].every((labels) => labels.length === 2 && labels[0] === labels[1])).toBe(true);
    expect([...horizontalPairs.values()].every((labels) => labels.length === 2 && labels[0] === labels[1])).toBe(true);
    expect(new Set([...verticalPairs.values(), ...horizontalPairs.values()].map(([label]) => label)).size).toBe(verticalPairs.size + horizontalPairs.size);
    expect(verticalPairs.get("0:0")).toEqual(["1", "1"]);
    expect(verticalPairs.get("1:0")).toEqual([`${plan.print!.columns - 1 + 1}`, `${plan.print!.columns - 1 + 1}`]);
    expect(guides.filter((guide) => guide.label).every((guide) => guide.label!.fontSizeMm <= 3)).toBe(true);
    expect(guides.every((guide) => {
      if (!guide.label) return true;
      if (guide.axis === "vertical") {
        const expectedX = guide.positionMm === plan.print!.overlapMm
          ? plan.print!.overlapMm / 2
          : plan.print!.paperWidthMm - plan.print!.overlapMm / 2;
        return guide.label.center.x === expectedX && guide.label.center.y === plan.print!.paperHeightMm / 2;
      }
      const expectedY = guide.positionMm === plan.print!.overlapMm
        ? plan.print!.overlapMm / 2
        : plan.print!.paperHeightMm - plan.print!.overlapMm / 2;
      return guide.label.center.x === plan.print!.paperWidthMm / 2 && guide.label.center.y === expectedY;
    })).toBe(true);
    for (const page of plan.print!.pages) {
      expect(page.guides).toHaveLength(4);
      const left = page.guides.find((guide) => guide.axis === "vertical" && guide.positionMm === 1)!;
      const right = page.guides.find((guide) => guide.axis === "vertical" && guide.positionMm === 209)!;
      const bottom = page.guides.find((guide) => guide.axis === "horizontal" && guide.positionMm === 1)!;
      const top = page.guides.find((guide) => guide.axis === "horizontal" && guide.positionMm === 296)!;
      expect(left.label !== undefined).toBe(page.column > 0);
      expect(right.label !== undefined).toBe(page.column < plan.print!.columns - 1);
      expect(bottom.label !== undefined).toBe(page.row > 0);
      expect(top.label !== undefined).toBe(page.row < plan.print!.rows - 1);
      if (page.column < plan.print!.columns - 1) {
        const adjacent = plan.print!.pages.find((candidate) => candidate.column === page.column + 1 && candidate.row === page.row)!;
        const adjacentLeft = adjacent.guides.find((guide) => guide.axis === "vertical" && guide.positionMm === 1)!;
        expect(page.origin.x + right.positionMm).toBeCloseTo(adjacent.origin.x + adjacentLeft.positionMm);
        expect(right.label?.text).toBe(adjacentLeft.label?.text);
      }
      if (page.row < plan.print!.rows - 1) {
        const adjacent = plan.print!.pages.find((candidate) => candidate.column === page.column && candidate.row === page.row + 1)!;
        const adjacentBottom = adjacent.guides.find((guide) => guide.axis === "horizontal" && guide.positionMm === 1)!;
        expect(page.origin.y + top.positionMm).toBeCloseTo(adjacent.origin.y + adjacentBottom.positionMm);
        expect(top.label?.text).toBe(adjacentBottom.label?.text);
      }
    }
  });

  it("keeps a long joining label inside the physical overlap strip", () => {
    const overlapMm = 1.99;
    const paperWidthMm = 297;
    const paperHeightMm = 420;
    const doc = sourceFor([
      "nui 1",
      "group G {",
      "  line Large = segment(start: (0, 0), end: (2.3, 500))",
      "}",
      "layout L {",
      "  place G(at: (0, 0))",
      "}",
      `print P(layout: L, layers: [default], paper: a3, orientation: portrait, overlap: ${overlapMm})`
    ]);
    const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.printOutputs[0], evaluation: evaluationFor(doc) });
    const guide = plan.print!.pages
      .flatMap((page) => page.guides)
      .find((candidate) => candidate.axis === "horizontal" && candidate.label);
    if (!guide) throw new Error("missing long horizontal joining label");
    if (!guide.label) throw new Error("missing joining label metadata");

    const relativeBounds = outputDrawableBounds({
      kind: "text",
      elementId: "joining-label",
      name: guide.label.text,
      text: guide.label.text,
      anchor: { x: 0, y: 0 },
      fontSizeMm: guide.label.fontSizeMm,
      widthMm: guide.label.widthMm,
      lineWidthsMm: [guide.label.widthMm],
      lineAdvancesMm: [guide.label.advancesMm],
      lineHeightMm: guide.label.fontSizeMm * OUTPUT_TEXT_LINE_HEIGHT,
      rotationDeg: guide.label.rotationDeg,
      mirrorX: false,
      colorHex: OUTPUT_PALETTE.foreground
    });
    const centeredAnchor = {
      x: guide.label.center.x - (relativeBounds.minX + relativeBounds.maxX) / 2,
      y: guide.label.center.y - (relativeBounds.minY + relativeBounds.maxY) / 2
    };
    const absoluteBounds = {
      minX: relativeBounds.minX + centeredAnchor.x,
      minY: relativeBounds.minY + centeredAnchor.y,
      maxX: relativeBounds.maxX + centeredAnchor.x,
      maxY: relativeBounds.maxY + centeredAnchor.y
    };
    const stripMinY = guide.positionMm === overlapMm
      ? 0
      : paperHeightMm - overlapMm;

    expect(absoluteBounds.minX).toBeGreaterThanOrEqual(-1e-9);
    expect(absoluteBounds.maxX).toBeLessThanOrEqual(paperWidthMm + 1e-9);
    expect(absoluteBounds.minY).toBeGreaterThanOrEqual(stripMinY - 1e-9);
    expect(absoluteBounds.maxY).toBeLessThanOrEqual(stripMinY + overlapMm + 1e-9);
  });

  it("uses stroke-inclusive rendered bounds at the one-page threshold", () => {
    const exactThresholdDoc = (epsilonMm: number) => sourceFor([
      "nui 1",
      "group G {",
      `  line Large = segment(start: (0, 0), end: (${190 - PX_TO_MM / 2 + epsilonMm}, ${277 - PX_TO_MM / 2 + epsilonMm}))`,
      "}",
      "layout L {",
      "  place G(at: (0, 0))",
      "}",
      "print P(layout: L, layers: [default], paper: a4, overlap: 10)"
    ]);
    const exactThresholdSource = exactThresholdDoc(0);
    const exactThreshold = buildOutputPlan({
      compiledDocument: exactThresholdSource,
      output: exactThresholdSource.document.printOutputs[0],
      evaluation: evaluationFor(exactThresholdSource)
    });
    expect(exactThreshold.renderedBounds.maxX).toBe(190);
    expect(exactThreshold.renderedBounds.maxY).toBe(277);
    expect(exactThreshold.print).toMatchObject({ columns: 1, rows: 1, strideXmm: 190, strideYmm: 277 });
    expect(exactThreshold.print!.pages).toHaveLength(1);

    const justBelowDoc = exactThresholdDoc(-1e-6);
    const justBelow = buildOutputPlan({
      compiledDocument: justBelowDoc,
      output: justBelowDoc.document.printOutputs[0],
      evaluation: evaluationFor(justBelowDoc)
    });
    expect(justBelow.renderedBounds.maxX).toBeLessThan(190);
    expect(justBelow.renderedBounds.maxY).toBeLessThan(277);
    expect(justBelow.print).toMatchObject({ columns: 1, rows: 1 });

    const justOverThresholdDoc = exactThresholdDoc(1e-6);
    const justOverThreshold = buildOutputPlan({
      compiledDocument: justOverThresholdDoc,
      output: justOverThresholdDoc.document.printOutputs[0],
      evaluation: evaluationFor(justOverThresholdDoc)
    });
    expect(justOverThreshold.renderedBounds.maxX).toBeGreaterThan(190);
    expect(justOverThreshold.renderedBounds.maxY).toBeGreaterThan(277);
    expect(justOverThreshold.print).toMatchObject({ columns: 2, rows: 2, strideXmm: 190, strideYmm: 277 });
    expect(justOverThreshold.print!.pages).toHaveLength(4);
    expect(justOverThreshold.print!.pages[1].origin.x - justOverThreshold.print!.pages[0].origin.x).toBe(190);
    expect(justOverThreshold.print!.pages[2].origin.y - justOverThreshold.print!.pages[0].origin.y).toBe(277);
  });

  it("keeps one fixed-origin page for negative geometry and warns only from selected rendered bounds", () => {
    const negativeOnly = printPlanForLine({ x: -8, y: -8 }, { x: -2, y: -2 });
    expect(negativeOnly.empty).toBe(false);
    expect(negativeOnly.print).toMatchObject({ columns: 1, rows: 1, warning: { kind: "negative-rendered-bounds" } });
    expect(negativeOnly.print!.pages).toHaveLength(1);
    expect(negativeOnly.print!.pages[0]!.origin).toEqual({ x: -10, y: -10 });
    expect(negativeOnly.drawables[0]).toMatchObject({ start: { x: -8, y: -8 }, end: { x: -2, y: -2 } });
    expect(negativeOnly.rustPayload).not.toHaveProperty("warning");

    const mixed = printPlanForLine({ x: -50, y: -60 }, { x: 200, y: 300 });
    expect(mixed.print).toMatchObject({ columns: 2, rows: 2, warning: { kind: "negative-rendered-bounds" } });
    expect(mixed.print!.pages.map((page) => page.origin)).toEqual([
      { x: -10, y: -10 }, { x: 180, y: -10 }, { x: -10, y: 267 }, { x: 180, y: 267 }
    ]);

    const allOffPaper = printPlanForLine({ x: -30, y: -30 }, { x: -20, y: -20 });
    expect(allOffPaper.empty).toBe(false);
    expect(allOffPaper.drawables).toHaveLength(1);
    expect(allOffPaper.print).toMatchObject({ columns: 1, rows: 1, pages: [{ origin: { x: -10, y: -10 } }] });
    expect(allOffPaper.print?.warning).toEqual({ kind: "negative-rendered-bounds" });

    const emptyDoc = sourceFor([
      "nui 1",
      "group Empty {",
      "}",
      "layout L {",
      "  place Empty(at: (0, 0))",
      "}",
      "print P(layout: L, layers: [default], paper: a4, overlap: 10)"
    ]);
    const empty = buildOutputPlan({
      compiledDocument: emptyDoc,
      output: emptyDoc.document.printOutputs[0]!,
      evaluation: evaluationFor(emptyDoc)
    });
    expect(empty).toMatchObject({ empty: true, drawables: [], print: { columns: 0, rows: 0, pages: [], warning: null } });
  });

  it("warns when stroke width crosses zero and clears at an exact zero rendered minimum", () => {
    const strokeHalfWidthMm = PX_TO_MM / 2;
    const strokeCrossing = printPlanForLine(
      { x: strokeHalfWidthMm / 2, y: strokeHalfWidthMm / 2 },
      { x: 5, y: 5 }
    );
    expect(strokeCrossing.drawables[0]).toMatchObject({ start: { x: strokeHalfWidthMm / 2, y: strokeHalfWidthMm / 2 } });
    expect(strokeCrossing.renderedBounds.minX).toBeLessThan(0);
    expect(strokeCrossing.renderedBounds.minY).toBeLessThan(0);
    expect(strokeCrossing.print?.warning).toEqual({ kind: "negative-rendered-bounds" });

    const exactlyAtOrigin = printPlanForLine(
      { x: strokeHalfWidthMm, y: strokeHalfWidthMm },
      { x: 5, y: 5 }
    );
    expect(exactlyAtOrigin.renderedBounds.minX).toBe(0);
    expect(exactlyAtOrigin.renderedBounds.minY).toBe(0);
    expect(exactlyAtOrigin.print?.warning).toBeNull();
  });

  it("does not warn for negative unselected drawables or translate origins when overlap changes", () => {
    const doc = sourceFor([
      "nui 1",
      "layer selected",
      "layer ignored",
      "group G {",
      "  line Good in selected = segment(start: (1, 1), end: (20, 20))",
      "  line OffSheet in ignored = segment(start: (-30, -30), end: (-20, -20))",
      "}",
      "layout L {",
      "  place G(at: (0, 0))",
      "}",
      "print P(layout: L, layers: [selected], paper: a4, overlap: 10)"
    ]);
    const selected = buildOutputPlan({
      compiledDocument: doc,
      output: doc.document.printOutputs[0]!,
      evaluation: evaluationFor(doc)
    });
    expect(selected.drawables.map(({ name }) => name)).toEqual(["Good"]);
    expect(selected.print?.warning).toBeNull();
    expect(selected.print?.pages[0]?.origin).toEqual({ x: -10, y: -10 });

    const noOverlap = printPlanForLine({ x: 300, y: 100 }, { x: 400, y: 200 }, 0);
    const withOverlap = printPlanForLine({ x: 300, y: 100 }, { x: 400, y: 200 }, 10);
    expect(noOverlap.print).toMatchObject({ strideXmm: 210, strideYmm: 297, warning: null });
    expect(withOverlap.print).toMatchObject({ strideXmm: 190, strideYmm: 277, warning: null });
    expect(noOverlap.print!.pages[0]!.origin).toEqual({ x: 0, y: 0 });
    expect(withOverlap.print!.pages[0]!.origin).toEqual({ x: -10, y: -10 });
  });

  it("emits no joining guides or labels when physical overlap is zero", () => {
    const doc = sourceFor([
      "nui 1",
      "group G {",
      "  line Large = segment(start: (0, 0), end: (500, 500))",
      "}",
      "layout L {",
      "  place G(at: (0, 0))",
      "}",
      "print P(layout: L, layers: [default], paper: a4, overlap: 0)"
    ]);
    const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.printOutputs[0], evaluation: evaluationFor(doc) });
    expect(plan.print!.pages.length).toBeGreaterThan(1);
    expect(plan.print).toMatchObject({ strideXmm: 210, strideYmm: 297 });
    expect(plan.print!.pages.every((page) => page.guides.length === 0)).toBe(true);
  });

  it("owns the fixed output palette and preserves fixed style colors", () => {
    expect(OUTPUT_PALETTE).toEqual({
      foreground: "#31322f",
      muted: "#53564f",
      accent: "#0f766e",
      info: "#2563eb",
      warning: "#73320d",
      error: "#b91c1c"
    });
    const doc = simpleSource(["style Fixed {", "  color: #Ab12Ef,", "}"]);
    const line = doc.document.elements.find((element) => element.name === "AB")!;
    line.modifierNames = ["Fixed"];
    const plan = buildOutputPlan({ compiledDocument: doc, output: output(doc, "S"), evaluation: evaluationFor(doc) });
    const fixedDrawable = plan.drawables.find((drawable) => drawable.elementId === line.id);
    if (!fixedDrawable || fixedDrawable.kind === "text") throw new Error("missing fixed-color line");
    expect(fixedDrawable.stroke.colorHex).toBe("#ab12ef");
  });

  it("uses one baseline-anchor text layout for Latin, Japanese, multiline, rotation, and mirroring", () => {
    const doc = sourceFor([
      "nui 1",
      "group G {",
      "  text Label = label(text: \"AB\\n日本\", anchor: (0, 0), size: 4)",
      "}",
      "layout L {",
      "  place G(at: (0, 0), angle: 30, mirror: true)",
      "}",
      "svg S(layout: L, layers: [default], margin: 0)"
    ]);
    const plan = buildOutputPlan({ compiledDocument: doc, output: doc.document.svgOutputs[0], evaluation: evaluationFor(doc) });
    const text = plan.drawables.find((drawable) => drawable.kind === "text");
    if (!text || text.kind !== "text") throw new Error("missing output text");
    const layout = deterministicTextLayout("AB\n日本", 4);
    expect(text).toMatchObject({
      anchor: { x: 0, y: 0 },
      fontSizeMm: 4,
      widthMm: 8,
      lineWidthsMm: [4.96, 8],
      lineAdvancesMm: [[2.48, 2.48], [4, 4]],
      lineHeightMm: 4.8,
      rotationDeg: 30,
      mirrorX: true
    });
    expect(layout).toEqual({ lineWidthsMm: text.lineWidthsMm, lineAdvancesMm: text.lineAdvancesMm, widthMm: text.widthMm });
    const ascent = text.fontSizeMm * OUTPUT_TEXT_ASCENT;
    const descent = text.fontSizeMm * OUTPUT_TEXT_DESCENT;
    expect(outputDrawableBounds(text)).toEqual(plan.renderedBounds);
    expect(plan.renderedBounds.width).toBeGreaterThan(Math.max(...text.lineWidthsMm));
    expect(plan.renderedBounds.height).toBeGreaterThan(text.lineHeightMm + ascent - descent);
    expect(ascent + descent).toBe(text.fontSizeMm);
  });
});
