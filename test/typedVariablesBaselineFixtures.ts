export const BASELINE_SIZES = [250, 1_000] as const;

export type StandardFixtureScale = {
  /** Parsed DSL statements excluding the version directive. This is the generator's `size` argument. */
  statementCount: number;
  bindingCount: number;
  geometryStatementCount: number;
  expectedComputedGeometryCount: number;
  expectedGeneratedRowCount: number;
};

export type ForGroupFixtureScale = {
  /** Generated rows. This is the generator's `generatedRowCount` argument, not its statement count. */
  generatedRowCount: number;
  statementCount: number;
  bindingCount: number;
  geometryStatementCount: number;
  expectedComputedGeometryCount: number;
};

export const buildStandardBaselineSource = (statementCount: number) => {
  if (!Number.isInteger(statementCount) || statementCount < 2 || statementCount % 2 !== 0) {
    throw new Error("standard baseline requires an even statement count of at least two");
  }

  const pairCount = statementCount / 2;
  const lines = ["nui 2"];
  for (let index = 0; index < pairCount; index += 1) {
    lines.push(`var V${index} = ${index + 1}`);
    lines.push(`point P${index} = coordinate(x: @V${index} y: ${index % 37})`);
  }

  return {
    source: lines.join("\n"),
    scale: {
      statementCount,
      bindingCount: pairCount,
      geometryStatementCount: pairCount,
      expectedComputedGeometryCount: pairCount,
      expectedGeneratedRowCount: 0
    } satisfies StandardFixtureScale
  };
};

export const buildForGroupBaselineSource = (generatedRowCount: number) => {
  if (!Number.isInteger(generatedRowCount) || generatedRowCount < 1) {
    throw new Error("forGroup baseline requires at least one generated row");
  }

  return {
    source: [
      "nui 2",
      `for Loop (i from: 0 count: ${generatedRowCount} step: 1 showGenerated: true) {`,
      "  point Repeated = coordinate(x: 1 y: 0)",
      "}"
    ].join("\n"),
    scale: {
      generatedRowCount,
      statementCount: 3,
      bindingCount: 0,
      geometryStatementCount: 1,
      expectedComputedGeometryCount: generatedRowCount
    } satisfies ForGroupFixtureScale
  };
};

export const semanticV2BaselineSource = [
  "nui 2",
  "var Global = 12",
  "point A = coordinate(x: 0 y: 0)",
  "point B = coordinate(x: 10 y: -10)",
  "point C = coordinate(x: 10 y: 0)",
  "line AC = segment(start: A end: C)",
  "var Long = expression(value: @Global + 3 scope: global)",
  "var Distance = pointDistance(point1: A point2: B)",
  "var Angle = pointAngle(point1: A point2: B)",
  "var LineDistance = pointLineDistance(point: B line: AC)",
  "group Outer {",
  "  var GroupValue = expression(value: @Global + 3 scope: group)",
  "  group Inner {",
  "    point Scoped = coordinate(x: @GroupValue y: 0)",
  "  }",
  "}",
  "point ByRatio = between(start: A end: C ratio: 0.5)",
  "point ByDistance = between(start: A end: C distance: 5)",
  "text Note = label(text: \"値 {@Global} / {AC.length}\" anchor: A size: 4)",
  "point Hidden = coordinate(x: 30 y: 0 visible: false)",
  "point HiddenConsumer = offset(from: Hidden dx: 1 dy: 0)"
].join("\n");

export const forwardReferenceBaselineSource = [
  "nui 2",
  "point Before = coordinate(x: @Later y: 0)",
  "var Later = 20"
].join("\n");

export const outOfScopeBaselineSource = [
  "nui 2",
  "group Outer {",
  "  var GroupValue = expression(value: 10 scope: group)",
  "}",
  "point Outside = coordinate(x: @GroupValue y: 0)"
].join("\n");

export const disabledActivityBaselineSource = [
  "nui 2",
  "point Disabled = coordinate(x: 0 y: 0 enabled: false)",
  "point DisabledConsumer = offset(from: Disabled dx: 1 dy: 0)"
].join("\n");
