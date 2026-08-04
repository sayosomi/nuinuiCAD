import type { CadElement, CadElementType } from "../types/geometry";

export type DslArgSpecial =
  | "vars"
  | "varIds"
  | "steps"
  | "roles"
  | "intermediates"
  | "id"
  | "parent"
  | "branch";

export type DslArgSpec = {
  arg: string;
  parameterKey?: string;
  required?: boolean;
  positional?: boolean;
  special?: DslArgSpecial;
};

export type DslConstructionCategory =
  | "point"
  | "line"
  | "curve"
  | "arc"
  | "text"
  | "image"
  | "group"
  | "if"
  | "for";

export type DslConstructionSpec = {
  category: DslConstructionCategory;
  construction: string;
  elementType: CadElementType;
  preset?: Partial<CadElement>;
  exclusiveGroups?: string[][];
  args: DslArgSpec[];
};

const arg = (argName: string, parameterKey?: string): DslArgSpec =>
  parameterKey ? { arg: argName, parameterKey } : { arg: argName };

const required = (argName: string, parameterKey?: string): DslArgSpec => ({
  ...arg(argName, parameterKey),
  required: true,
});

const positional = (argName: string, parameterKey?: string): DslArgSpec => ({
  ...arg(argName, parameterKey),
  positional: true,
});

const special = (argName: string, value: DslArgSpecial): DslArgSpec => ({
  arg: argName,
  special: value,
});

export const commonArgSpecs: DslArgSpec[] = [
  arg("state"),
  arg("color", "colorId"),
  special("steps", "steps"),
  special("vars", "vars"),
  special("varIds", "varIds"),
  special("id", "id"),
  special("roles", "roles"),
  special("parent", "parent"),
  special("branch", "branch"),
];

const constructionSpecs: DslConstructionSpec[] = [
  { category: "point", construction: "coordinate", elementType: "freePoint", args: [arg("x"), arg("y")] },
  { category: "point", construction: "offset", elementType: "offsetPoint", args: [required("from", "fromPoint"), arg("dx"), arg("dy")] },
  { category: "point", construction: "polar", elementType: "polarOffsetPoint", args: [required("from", "fromPoint"), arg("angle", "angleDeg"), arg("distance")] },
  {
    category: "point",
    construction: "between",
    elementType: "divisionPoint",
    exclusiveGroups: [["distance", "ratio"]],
    args: [required("start", "startPoint"), required("end", "endPoint"), arg("distance"), arg("ratio")],
  },
  {
    category: "point",
    construction: "onLine",
    elementType: "lineDivisionPoint",
    exclusiveGroups: [["distance", "ratio"]],
    args: [required("from", "endpoint"), arg("distance"), arg("ratio")],
  },
  {
    category: "point",
    construction: "intersection",
    elementType: "intersectionPoint",
    args: [required("line1", "line1Id"), required("line2", "line2Id"), arg("index", "intersectionIndex"), arg("extensions", "useExtensions")],
  },
  {
    category: "point",
    construction: "tangentOffset",
    elementType: "lineTangentOffsetPoint",
    args: [required("line", "baseLineId"), required("base", "basePoint"), arg("angle", "tangentAngleDeg"), arg("distance")],
  },
  { category: "line", construction: "segment", elementType: "line", args: [required("start", "startPoint"), required("end", "endPoint")] },
  { category: "line", construction: "polar", elementType: "angleLengthLine", args: [required("start", "startPoint"), arg("angle", "angleDeg"), arg("length")] },
  {
    category: "line",
    construction: "offset",
    elementType: "offsetLine",
    args: [required("sources", "baseLineIds"), arg("distance", "offset"), arg("side"), arg("closed"), arg("suppressTrimWarnings")],
  },
  { category: "line", construction: "split", elementType: "splitLine", args: [required("source", "baseLineId"), required("at", "splitPoint")] },
  { category: "line", construction: "extend", elementType: "extendTrim", args: [required("end", "endpoint"), required("to", "point")] },
  {
    category: "line",
    construction: "copy",
    elementType: "copyLine",
    args: [required("startPoint"), required("endPoint"), arg("scale"), arg("angleDeg"), arg("mirrorX"), required("baseLines", "baseLineIds")],
  },
  {
    category: "line",
    construction: "move",
    elementType: "move",
    args: [required("startPoint"), required("endPoint"), arg("scale"), arg("angleDeg"), arg("mirrorX"), required("baseLines", "baseLineIds")],
  },
  {
    category: "line",
    construction: "mirrorCopy",
    elementType: "symmetricCopyLine",
    args: [required("axis1", "axisPoint1"), required("axis2", "axisPoint2"), required("baseLines", "baseLineIds")],
  },
  {
    category: "line",
    construction: "mirrorMove",
    elementType: "symmetricMove",
    args: [required("axis1", "axisPoint1"), required("axis2", "axisPoint2"), required("baseLines", "baseLineIds")],
  },
  { category: "line", construction: "edge", elementType: "edge", args: [required("end1", "endpoint1"), required("end2", "endpoint2"), arg("index", "intersectionIndex")] },
  {
    category: "curve",
    construction: "bezier",
    elementType: "bezierCurve",
    args: [
      required("start", "startPoint"),
      required("end", "endPoint"),
      arg("startAngle", "startHandleAngleDeg"),
      arg("startLength", "startHandleLength"),
      arg("endAngle", "endHandleAngleDeg"),
      arg("endLength", "endHandleLength"),
      special("intermediates", "intermediates"),
    ],
  },
  { category: "arc", construction: "arc", elementType: "arcLine", args: [required("center", "centerPoint"), arg("radius"), arg("start", "startAngleDeg"), arg("end", "endAngleDeg")] },
  { category: "arc", construction: "through", elementType: "threePointArcLine", args: [required("point1"), required("point2"), required("point3"), arg("start", "startAngleDeg"), arg("end", "endAngleDeg")] },
  { category: "arc", construction: "corner", elementType: "cornerRadiusArcLine", args: [required("end1", "endpoint1"), required("end2", "endpoint2"), arg("radius"), arg("index", "intersectionIndex")] },
  { category: "text", construction: "label", elementType: "text", args: [required("text"), arg("anchor"), arg("size", "fontSize")] },
  {
    category: "image",
    construction: "image",
    elementType: "image",
    args: [
      required("source", "sourcePath"),
      required("origin", "originPoint"),
      arg("naturalWidthPx"),
      arg("naturalHeightPx"),
      arg("sourceDpi"),
      arg("targetPixelsPerMm"),
      arg("scale"),
      arg("angleDeg"),
      arg("mirrorX"),
    ],
  },
  { category: "group", construction: "", elementType: "group", args: [arg("printEnabled"), arg("printAnchor"), special("roles", "roles")] },
  { category: "if", construction: "", elementType: "conditionalGroup", args: [{ ...positional("condition"), required: true }] },
  {
    category: "for",
    construction: "",
    elementType: "forGroup",
    args: [{ ...positional("variable", "variableName"), required: true }, required("from", "start"), required("count"), arg("step"), arg("showGenerated")],
  },
];

const specsByCall = new Map(constructionSpecs.map((spec) => [`${spec.category}\u0000${spec.construction}`, spec]));
const specsByElementType = new Map<CadElementType, DslConstructionSpec>();

for (const spec of constructionSpecs) {
  if (!specsByElementType.has(spec.elementType)) specsByElementType.set(spec.elementType, spec);
}

export const constructionFor = (category: string, construction: string): DslConstructionSpec | null =>
  specsByCall.get(`${category}\u0000${construction}`) ?? null;

/** Read-only registry queries for parser diagnostics and completion. */
export const constructionCandidatesFor = (category: string): readonly DslConstructionSpec[] =>
  constructionSpecs.filter((spec) => spec.category === category);

/** Categories that define a construction spelling, in registry declaration order. */
export const categoriesForConstruction = (construction: string): readonly DslConstructionCategory[] =>
  [...new Set(constructionSpecs
    .filter((spec) => spec.construction === construction)
    .map((spec) => spec.category))];

export const constructionForElementType = (type: CadElementType): DslConstructionSpec => {
  const spec = specsByElementType.get(type);
  if (!spec) throw new Error(`Missing DSL construction for element type: ${type}`);
  return spec;
};

export const argNameForParameter = (type: CadElementType, parameterKey: string): string | null => {
  const specs = constructionSpecs.filter((spec) => spec.elementType === type);
  const match = [...specs.flatMap((spec) => spec.args), ...commonArgSpecs].find(
    (spec) => !spec.special && (spec.parameterKey ?? spec.arg) === parameterKey,
  );
  return match?.arg ?? null;
};
