export type ElementId = string;

export type CadElementBase = {
  id: ElementId;
  name: string;
  visible: boolean;
  enabled: boolean;
};

export type FreePointElement = CadElementBase & {
  type: "freePoint";
  x: number;
  y: number;
};

export type OffsetPointElement = CadElementBase & {
  type: "offsetPoint";
  fromPointId: ElementId;
  dx: number;
  dy: number;
};

export type LineElement = CadElementBase & {
  type: "line";
  startPointId: ElementId;
  endPointId: ElementId;
};

export type CadElement = FreePointElement | OffsetPointElement | LineElement;
export type CadElementType = CadElement["type"];

export type ComputedPoint = {
  kind: "point";
  elementId: ElementId;
  name: string;
  x: number;
  y: number;
};

export type ComputedLine = {
  kind: "line";
  elementId: ElementId;
  name: string;
  startPointId: ElementId;
  endPointId: ElementId;
  start: ComputedPoint;
  end: ComputedPoint;
};

export type ComputedGeometry = ComputedPoint | ComputedLine;

export type DependencyError = {
  elementId: ElementId;
  elementName: string;
  missingDependencyId: ElementId;
  missingDependencyName?: string;
  message: string;
};

export type EvaluationResult = {
  computedGeometry: Map<ElementId, ComputedGeometry>;
  errors: DependencyError[];
};

export const elementTypeLabels: Record<CadElementType, string> = {
  freePoint: "free point",
  offsetPoint: "offset point",
  line: "line"
};
