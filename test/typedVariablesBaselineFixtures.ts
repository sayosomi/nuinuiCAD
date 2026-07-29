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

export type DeclarationFixtureScale = {
  /** Parsed nui 3 declaration statements. This is the generator's `count` argument. */
  declarationCount: number;
};

// Task 10 (typed declaration syntax) baseline: pure v3 parse-cost fixture,
// no elements/bindings/geometry - unlike buildStandardBaselineSource, which
// emits v2 var/point pairs for the pre-typed-variables compiler/evaluator.
export const buildTypedDeclarationBaselineSource = (declarationCount: number) => {
  if (!Number.isInteger(declarationCount) || declarationCount < 1) {
    throw new Error("typed declaration baseline requires at least one declaration");
  }

  const lines = ["nui 3"];
  for (let index = 0; index < declarationCount; index += 1) {
    const cycle = index % 4;
    if (cycle === 0) lines.push(`const N${index}: number = ${index} + 1`);
    else if (cycle === 1) lines.push(`let S${index}: string = "value ${index}"`);
    else if (cycle === 2) lines.push(`const B${index}: boolean = true`);
    else lines.push(`let C${index}: choice(right, left, center) = right`);
  }

  return {
    source: lines.join("\n"),
    scale: { declarationCount } satisfies DeclarationFixtureScale
  };
};

export type ScopeFixtureScale = {
  /** Top-level scope-opening constructs generated (group / if-else / forGroup, cycled). This is the generator's `scopeCount` argument. */
  scopeCount: number;
};

// Task 11 (lexical scope index) baseline: a repeating group/if-else/forGroup
// cycle at scale, nui 3 only, matching BASELINE_SIZES directly as scopeCount
// (unlike buildStandardBaselineSource's statementCount, since a single
// "scope" here spans a variable number of source lines).
export const buildLexicalScopeBaselineSource = (scopeCount: number) => {
  if (!Number.isInteger(scopeCount) || scopeCount < 1) {
    throw new Error("lexical scope baseline requires at least one scope");
  }

  const lines = ["nui 3"];
  for (let index = 0; index < scopeCount; index += 1) {
    const cycle = index % 3;
    if (cycle === 0) {
      lines.push(`group G${index} {`);
      lines.push(`  const V${index}: number = ${index}`);
      lines.push(`}`);
    } else if (cycle === 1) {
      lines.push(`if C${index} (1) {`);
      lines.push(`  const A${index}: number = ${index}`);
      lines.push(`} else {`);
      lines.push(`  const B${index}: number = ${index}`);
      lines.push(`}`);
    } else {
      lines.push(`for F${index} (i from: 0 count: 3 step: 1) {`);
      lines.push(`  const W${index}: number = ${index}`);
      lines.push(`}`);
    }
  }

  return {
    source: lines.join("\n"),
    scale: { scopeCount } satisfies ScopeFixtureScale
  };
};

export type BindingAnalysisFixtureScale = {
  /** Typed declarations generated. This is the generator's `bindingCount` argument. */
  bindingCount: number;
  /** `@V(n-1)` references generated (one per binding after the first). */
  referenceCount: number;
};

// Task 13 (binding diagnostics / initializer graph) baseline: a linear chain
// where each const references only the immediately preceding one. Every
// reference resolves ("resolved" kind, Task 12's own document-order rule
// guarantees no forward/cycle here), so this isolates analyzeBindings's own
// O(bindings+references) graph/SCC/issue-classification cost from the
// cycle/duplicate/forward-suppression correctness already covered by
// src/scalars/bindingAnalysis.test.ts's small, targeted fixtures.
export const buildBindingAnalysisChainBaselineSource = (bindingCount: number) => {
  if (!Number.isInteger(bindingCount) || bindingCount < 1) {
    throw new Error("binding analysis baseline requires at least one binding");
  }

  const lines = ["nui 3", "const V0: number = 0"];
  for (let index = 1; index < bindingCount; index += 1) {
    lines.push(`const V${index}: number = @V${index - 1} + 1`);
  }

  return {
    source: lines.join("\n"),
    scale: {
      bindingCount,
      referenceCount: Math.max(0, bindingCount - 1)
    } satisfies BindingAnalysisFixtureScale
  };
};

/**
 * Task 50's blocking binding-analysis fixture. Unlike the Task 13R-5 mixed
 * legacy fixture below, this is pure nui 3: only typed `const`/`let`
 * declarations and their immediately preceding typed references appear.
 */
export const buildPureNui3BindingAnalysisBaselineSource = (bindingCount: number) => {
  if (!Number.isInteger(bindingCount) || bindingCount < 1) {
    throw new Error("pure nui 3 binding analysis baseline requires at least one binding");
  }

  const lines = ["nui 3", "const V0: number = 0"];
  for (let index = 1; index < bindingCount; index += 1) {
    const declarationKind = index % 2 === 0 ? "const" : "let";
    lines.push(`${declarationKind} V${index}: number = @V${index - 1} + 1`);
  }

  return {
    source: lines.join("\n"),
    scale: {
      bindingCount,
      referenceCount: Math.max(0, bindingCount - 1)
    } satisfies BindingAnalysisFixtureScale
  };
};

export type MixedBindingAnalysisFixtureScale = {
  bindingCount: number;
  referenceCount: number;
  duplicateReferenceCount: number;
};

/**
 * Task 13R-5's production-path fixture. The requested size is a binding
 * budget, not a raw statement count: each unit mixes compact legacy
 * visibility forms, nested lexical scopes, an iteration slot, and typed
 * initializer references. A sparse subset deliberately emits duplicate
 * candidates so E is measured without making the ordinary case duplicate
 * dominated.
 */
export const buildMixedBindingAnalysisBaselineSource = (bindingBudget: number) => {
  if (!Number.isInteger(bindingBudget) || bindingBudget < 10) {
    throw new Error("mixed binding analysis baseline requires a binding budget of at least ten");
  }
  const unitCount = Math.floor(bindingBudget / 10);
  const lines = ["nui 3"];
  const references: { ownerName: string; name: string }[] = [];
  let duplicateReferenceCount = 0;

  for (let index = 0; index < unitCount; index += 1) {
    const outside = `Outside${index}`;
    const global = `Global${index}`;
    const scoped = `Scoped${index}`;
    const iteration = `i${index}`;
    const rootUse = `RootUse${index}`;
    const groupUse = `GroupUse${index}`;
    const groupOutsideUse = `GroupOutsideUse${index}`;
    const nestedUse = `NestedUse${index}`;
    const siblingUse = `SiblingUse${index}`;
    const iterationUse = `IterationUse${index}`;

    lines.push(`var ${outside} = expression(value: ${index} id: outside-${index} scope: group)`);
    lines.push(`var ${global} = expression(value: ${index} id: global-${index} scope: global)`);
    lines.push(`const ${rootUse}: number = @${outside}`);
    references.push({ ownerName: rootUse, name: outside });
    lines.push(`group Outer${index} {`);
    lines.push(`  var ${scoped} = expression(value: ${index} id: scoped-${index} scope: group)`);
    lines.push(`  const ${groupUse}: number = @${global}`);
    references.push({ ownerName: groupUse, name: global });
    lines.push(`  const ${groupOutsideUse}: number = @${outside}`);
    references.push({ ownerName: groupOutsideUse, name: outside });
    lines.push(`  group Nested${index} {`);
    lines.push(`    const ${nestedUse}: number = @${scoped}`);
    references.push({ ownerName: nestedUse, name: scoped });
    lines.push("  }");
    lines.push(`  group Sibling${index} {`);
    lines.push(`    const ${siblingUse}: number = @${scoped}`);
    references.push({ ownerName: siblingUse, name: scoped });
    lines.push("  }");
    lines.push(`  for Loop${index} (${iteration} from: 0 count: 2 step: 1) {`);
    lines.push(`    const ${iterationUse}: number = @${iteration}`);
    references.push({ ownerName: iterationUse, name: iteration });
    lines.push("  }");
    lines.push("}");

    if (index % 25 === 0) {
      const duplicate = `Duplicate${index}`;
      const duplicateUse = `DuplicateUse${index}`;
      lines.push(`var ${duplicate} = expression(value: ${index} id: duplicate-global-${index} scope: global)`);
      lines.push(`var ${duplicate} = expression(value: ${index} id: duplicate-outside-${index} scope: group)`);
      lines.push(`const ${duplicateUse}: number = @${duplicate}`);
      references.push({ ownerName: duplicateUse, name: duplicate });
      duplicateReferenceCount += 1;
    }
  }

  return {
    source: lines.join("\n"),
    references,
    scale: {
      bindingCount: unitCount * 10 + duplicateReferenceCount * 3,
      referenceCount: references.length,
      duplicateReferenceCount
    } satisfies MixedBindingAnalysisFixtureScale
  };
};

export type ScalarExpressionFixtureScale = {
  /** Binary `+` operators chained in the flat expression. This is the generator's `operatorCount` argument. */
  operatorCount: number;
};

// Task 14 (TS expression parser) baseline: a flat `1 + 1 + 1 + ...` chain,
// all at the same (additive) precedence tier - this isolates parseTier's
// same-tier while-loop chaining cost (expected O(operatorCount)) from
// unrelated precedence-ladder or depth-guard costs, which are already
// covered by src/scalars/expressionParser.test.ts's targeted correctness
// fixtures. Unlike the DSL-source builders above, this feeds
// parseScalarExpression directly - there is no compiler/statement layer
// between the fixture and the function under measurement.
export const buildScalarExpressionBaselineSource = (operatorCount: number) => {
  if (!Number.isInteger(operatorCount) || operatorCount < 1) {
    throw new Error("scalar expression baseline requires at least one operator");
  }

  const source = Array.from({ length: operatorCount + 1 }, () => "1").join(" + ");

  return {
    source,
    scale: { operatorCount } satisfies ScalarExpressionFixtureScale
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
