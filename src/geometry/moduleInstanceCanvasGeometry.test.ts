import { describe, expect, it } from "vitest";
import type { ModuleMaterialization, ModuleMaterializationSnapshot } from "../dsl/moduleMaterialization";
import { defaultVisibilityProfile } from "../model/visibilityProfiles";
import type { CadElement, ComputedGeometry, EvaluationResult } from "../types/geometry";
import { moduleInstanceCanvasGeometry } from "./moduleInstanceCanvasGeometry";

const element = (
  id: string,
  type: CadElement["type"],
  activity: CadElement["activity"] = "visible"
) => ({ id, name: id, type, activity } as CadElement);

const evaluationFor = (geometry: readonly ComputedGeometry[]): EvaluationResult => ({
  computedGeometry: new Map(geometry.map((item) => [item.elementId, item])),
  errors: [],
  warnings: []
});

const materializationFor = (
  snapshots: readonly ModuleMaterializationSnapshot[]
): ModuleMaterialization => ({
  executionStatements: [],
  sourceExecutionUnits: [],
  elementIdBySourceStatementIndex: new Map(),
  sourceExecutionPositionByRuntimeElementId: new Map(),
  originByRuntimeElementId: new Map(),
  runtimeIdentityByElementId: new Map(),
  instanceBaseGeometrySnapshots: snapshots,
  evaluationLimitIndex: undefined
});

const point = (elementId: string, x: number, y: number): ComputedGeometry => ({
  kind: "point",
  elementId,
  name: elementId,
  x,
  y
});

const line = (elementId: string): ComputedGeometry => ({
  kind: "line",
  elementId,
  name: elementId,
  startPointId: null,
  endPointId: null,
  start: { kind: "point", elementId: `${elementId}-start`, name: "start", x: 0, y: 0 },
  end: { kind: "point", elementId: `${elementId}-end`, name: "end", x: 10, y: 10 },
  length: Math.sqrt(200),
  angleDeg: 45
});

const image = (elementId: string): ComputedGeometry => ({
  kind: "image",
  elementId,
  name: elementId,
  sourcePath: "reference.png",
  origin: { kind: "point", elementId: `${elementId}-origin`, name: "origin", x: 20, y: 20 },
  naturalWidthPx: 5,
  naturalHeightPx: 10,
  sourceDpi: 96,
  targetPixelsPerMm: 1,
  scale: 1,
  angleDeg: 0,
  mirrorX: false,
  widthMm: 5,
  heightMm: 10
});

const profiles = [defaultVisibilityProfile()];

const geometryFor = ({
  instanceId,
  elements,
  evaluation,
  materialization,
  measureCanvasTextWidth
}: {
  instanceId: string;
  elements: CadElement[];
  evaluation: EvaluationResult;
  materialization: ModuleMaterialization;
  measureCanvasTextWidth?: (text: string, fontSize: number) => number | null;
}) => moduleInstanceCanvasGeometry({
  instanceId,
  elements,
  evaluation,
  moduleMaterialization: materialization,
  visibilityProfiles: profiles,
  activeVisibilityProfileId: profiles[0]!.id,
  measureCanvasTextWidth
});

describe("moduleInstanceCanvasGeometry", () => {
  it("aggregates visible descendant geometry and includes reference images", () => {
    const result = geometryFor({
      instanceId: "instance",
      elements: [
        element("instance", "moduleInstance"),
        element("line", "line"),
        element("image", "image")
      ],
      evaluation: evaluationFor([line("line"), image("image")]),
      materialization: materializationFor([{
        instanceId: "instance",
        endRuntimeIndex: 2,
        descendantIds: ["line", "image"]
      }])
    });

    expect(result?.renderableDescendantIds).toEqual(["line", "image"]);
    expect(result?.bounds).toEqual({ minX: 0, minY: 0, maxX: 25, maxY: 20 });
  });

  it("excludes hidden, disabled, and unevaluated descendants", () => {
    const result = geometryFor({
      instanceId: "instance",
      elements: [
        element("instance", "moduleInstance"),
        element("visible", "freePoint"),
        element("hidden", "freePoint", "hidden"),
        element("disabled", "freePoint", "disabled"),
        element("missing", "freePoint")
      ],
      evaluation: evaluationFor([
        point("visible", 3, 4),
        point("hidden", -100, -100),
        point("disabled", 100, 100)
      ]),
      materialization: materializationFor([{
        instanceId: "instance",
        endRuntimeIndex: 4,
        descendantIds: ["visible", "hidden", "disabled", "missing"]
      }])
    });

    expect(result?.renderableDescendantIds).toEqual(["visible"]);
    expect(result?.bounds).toEqual({ minX: 3, minY: 4, maxX: 3, maxY: 4 });
  });

  it("uses each concrete instance snapshot as the recursive descendant boundary", () => {
    const materialization = materializationFor([
      {
        instanceId: "outer",
        endRuntimeIndex: 4,
        descendantIds: ["outer-line", "inner-line"]
      },
      {
        instanceId: "inner",
        endRuntimeIndex: 3,
        descendantIds: ["inner-line"]
      }
    ]);
    const elements = [
      element("outer", "moduleInstance"),
      element("inner", "moduleInstance"),
      element("outer-line", "line"),
      element("inner-line", "line")
    ];
    const evaluation = evaluationFor([line("outer-line"), line("inner-line")]);

    expect(geometryFor({
      instanceId: "outer",
      elements,
      evaluation,
      materialization
    })?.descendantIds).toEqual(["outer-line", "inner-line"]);
    expect(geometryFor({
      instanceId: "inner",
      elements,
      evaluation,
      materialization
    })?.descendantIds).toEqual(["inner-line"]);
  });

  it("fails bounds closed when a visible text descendant cannot be measured", () => {
    const text: ComputedGeometry = {
      kind: "text",
      elementId: "text",
      name: "text",
      text: "instance label",
      anchor: { kind: "point", elementId: "anchor", name: "anchor", x: 1, y: 2 },
      fontSize: 5
    };
    const result = geometryFor({
      instanceId: "instance",
      elements: [element("instance", "moduleInstance"), element("text", "text")],
      evaluation: evaluationFor([text]),
      materialization: materializationFor([{
        instanceId: "instance",
        endRuntimeIndex: 1,
        descendantIds: ["text"]
      }])
    });

    expect(result?.renderableDescendantIds).toEqual(["text"]);
    expect(result?.bounds).toBeNull();
  });

  it("returns null when the concrete instance has no materialization snapshot", () => {
    expect(geometryFor({
      instanceId: "instance",
      elements: [element("instance", "moduleInstance")],
      evaluation: evaluationFor([]),
      materialization: materializationFor([])
    })).toBeNull();
  });
});
