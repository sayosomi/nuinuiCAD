import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  compileDslDocument,
  emptyDocument,
  materializeModuleExecution,
  parseDsl,
  serializeDocumentToDsl,
  type CompiledDslDocument
} from "@nuinuicad/nui-language";
import { compileCanonicalText, reconcileStatements, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import { effectiveCanvasVisibleElementIds } from "../src/geometry/canvasDrawingBounds";
import { projectCanvasLayerPresentation } from "../src/model/canvasLayerPresentation";

const parse = (source: string) => parseDsl(source);

const statementIds = (statements: ReturnType<typeof parse>["statements"]) =>
  new Map(statements.map((_, index) => [index, `issue1564:statement:${index}`] as const));

const compile = (source: string) => {
  const preparsed = parse(source);
  const ids = statementIds(preparsed.statements);
  return {
    ids,
    compiled: compileDslDocument(source, {
      preparsed,
      assignedStatementIds: ids,
      assignedElementIds: ids
    })
  };
};

const errors = (compiled: CompiledDslDocument) =>
  compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error");

const namespaceFor = (compiled: ReturnType<typeof compile>["compiled"]) => {
  assert.ok(compiled.sourceLexicalNamespace, "source lexical namespace is retained");
  return compiled.sourceLexicalNamespace;
};

describe("#1564 source layers", () => {
  it("parses layer ownership for every drawable category and keeps Style selection independent", () => {
    const source = [
      "nui 1",
      "layer fabric",
      "point O in @fabric = coordinate(x: 0, y: 0)",
      "point E in @fabric = coordinate(x: 10, y: 0)",
      "line L[Stitch] in @fabric = segment(start: @O, end: @E)",
      "path P in @fabric = from(source: @L)",
      "curve C in @fabric = bezier(start: @O, end: @E)",
      "arc A in @fabric = arc(center: @O, radius: 5, start: 0, end: 90)",
      'text T in @fabric = label(text: "mark", anchor: @O)',
      'image I in @fabric = image(source: "fabric.png", origin: @O)'
    ].join("\n");
    const parsed = parse(source);
    assert.deepEqual(parsed.diagnostics, []);

    const drawables = parsed.statements.filter((statement) => statement.kind === "element" &&
      ["point", "line", "path", "curve", "arc", "text", "image"].includes(statement.category));
    assert.deepEqual(drawables.map((statement) => statement.kind === "element" ? statement.category : ""), [
      "point", "point", "line", "path", "curve", "arc", "text", "image"
    ]);
    assert.ok(drawables.every((statement) => statement.kind === "element" && statement.layerReference === "fabric"));
    const styled = drawables.find((statement) => statement.kind === "element" && statement.name === "L");
    assert.ok(styled?.kind === "element");
    assert.deepEqual(styled.modifierNames, ["Stitch"]);
    assert.equal(styled.layerReference, "fabric");
  });

  it("does not accept a layer block", () => {
    const parsed = parse("nui 1\nlayer fabric {\n}");
    assert.ok(parsed.diagnostics.some((diagnostic) => diagnostic.code === "layer-invalid-name"));
  });

  it("uses the built-in default, accepts explicit @default, and rejects a declaration named default", () => {
    const accepted = compile([
      "nui 1",
      "point Plain = coordinate(x: 1, y: 2)",
      "point Explicit in @default = coordinate(x: 3, y: 4)"
    ].join("\n"));
    assert.deepEqual(errors(accepted.compiled), []);
    const memberships = [...namespaceFor(accepted.compiled).layerMembershipsByStatementIndex.values()];
    assert.deepEqual(memberships.map(({ layerIdentity, layerName, explicit }) => ({ layerIdentity, layerName, explicit })), [
      { layerIdentity: "source-layer:builtin:default", layerName: "default", explicit: false },
      { layerIdentity: "source-layer:builtin:default", layerName: "default", explicit: true }
    ]);

    const rejected = compile("nui 1\nlayer default\npoint P = coordinate(x: 0, y: 0)");
    assert.ok(errors(rejected.compiled).some((diagnostic) => diagnostic.code === "layer-default-name-reserved"));
  });

  it("rejects quoted layer names that decode to empty while preserving valid names and spans", () => {
    const invalidNames = [
      { declaration: 'layer ""', authoredName: '""', decodedName: "" },
      { declaration: 'layer "   "', authoredName: '"   "', decodedName: "   " },
      { declaration: 'layer "\\t"', authoredName: '"\\t"', decodedName: "\t" }
    ];

    for (const { declaration, authoredName, decodedName } of invalidNames) {
      const source = [
        "nui 1",
        declaration,
        "point A = coordinate(x: 0, y: 0)"
      ].join("\n");
      const parsed = parse(source);
      assert.deepEqual(parsed.diagnostics.map(({ code, line }) => ({ code, line })), [
        { code: "layer-missing-name", line: 2 }
      ]);
      const layer = parsed.statements.find((statement) => statement.kind === "layerDeclaration");
      assert.ok(layer?.kind === "layerDeclaration");
      assert.equal(layer.name, decodedName);
      assert.ok(layer.nameSpan && layer.namePhysicalSpan);
      const physicalSpan = layer.namePhysicalSpan.segments[0];
      assert.ok(physicalSpan);
      assert.equal(source.slice(physicalSpan.from, physicalSpan.to), authoredName);

      const compiled = compile(source).compiled;
      assert.equal(errors(compiled).filter((diagnostic) => diagnostic.code === "layer-missing-name").length, 1);
    }

    const valid = compile("nui 1\nlayer fabric\nlayer \"outer seam\"");
    assert.deepEqual(errors(valid.compiled), []);
    assert.deepEqual(namespaceFor(valid.compiled).layerDeclarations.map((declaration) => declaration.name), [
      "fabric", "outer seam"
    ]);
  });

  it("resolves a forward reference by declaration identity and keeps exact logical and physical spans", () => {
    const source = "nui 1\npoint P in @later = coordinate(x: 0, y: 0)\nlayer later";
    const parsed = parse(source);
    assert.deepEqual(parsed.diagnostics, []);
    const membershipStatementIndex = parsed.statements.findIndex((statement) => statement.kind === "element" && statement.name === "P");
    const layerStatementIndex = parsed.statements.findIndex((statement) => statement.kind === "layerDeclaration");
    const drawable = parsed.statements[membershipStatementIndex];
    const layer = parsed.statements[layerStatementIndex];
    assert.ok(drawable?.kind === "element" && drawable.layerReferenceSpan && drawable.layerReferencePhysicalSpan);
    assert.ok(layer?.kind === "layerDeclaration" && layer.nameSpan && layer.namePhysicalSpan);
    const membershipLogicalStart = drawable.documentRange.from + drawable.layerReferenceSpan.start;
    assert.equal(source.slice(membershipLogicalStart, membershipLogicalStart + drawable.layerReferenceSpan.end - drawable.layerReferenceSpan.start), "@later");
    const membershipPhysical = drawable.layerReferencePhysicalSpan.segments[0];
    assert.ok(membershipPhysical);
    assert.equal(source.slice(membershipPhysical.from, membershipPhysical.to), "@later");
    const declarationPhysical = layer.namePhysicalSpan.segments[0];
    assert.ok(declarationPhysical);
    assert.equal(source.slice(declarationPhysical.from, declarationPhysical.to), "later");

    const built = compile(source);
    assert.deepEqual(errors(built.compiled), []);
    const membership = namespaceFor(built.compiled).layerMembershipsByStatementIndex.get(membershipStatementIndex);
    assert.equal(membership?.layerIdentity, built.ids.get(layerStatementIndex));
  });

  it("reports undefined, non-layer, duplicate, ambiguous, and inaccessible references", () => {
    const undefinedLayer = compile("nui 1\npoint P in @missing = coordinate(x: 0, y: 0)");
    assert.ok(errors(undefinedLayer.compiled).some((diagnostic) => diagnostic.code === "layer-membership-undefined"));

    const wrongKind = compile([
      "nui 1",
      "point Guide = coordinate(x: 0, y: 0)",
      "point P in @Guide = coordinate(x: 1, y: 1)"
    ].join("\n"));
    assert.ok(errors(wrongKind.compiled).some((diagnostic) => diagnostic.code === "layer-membership-not-layer"));

    const duplicate = compile([
      "nui 1",
      "layer seams",
      "layer seams",
      "point P in @seams = coordinate(x: 0, y: 0)"
    ].join("\n"));
    assert.ok(errors(duplicate.compiled).some((diagnostic) => diagnostic.code === "layer-duplicate-declaration"));
    assert.ok(errors(duplicate.compiled).some((diagnostic) => diagnostic.code === "layer-membership-ambiguous"));

    const inaccessible = compile([
      "nui 1",
      "layer outer",
      "module Bodice() {",
      "  point P in @outer = coordinate(x: 0, y: 0)",
      "}",
      "instance One = Bodice()"
    ].join("\n"));
    assert.ok(errors(inaccessible.compiled).some((diagnostic) => diagnostic.code === "layer-membership-inaccessible"));
  });

  it("supports group-local shadowing and distinct same-name declarations in separate scopes", () => {
    const source = [
      "nui 1",
      "layer seams",
      "group Front {",
      "  layer seams",
      "  point A in @seams = coordinate(x: 0, y: 0)",
      "}",
      "group Back {",
      "  layer seams",
      "  point B in @seams = coordinate(x: 1, y: 1)",
      "}"
    ].join("\n");
    const parsed = parse(source);
    const built = compile(source);
    assert.deepEqual(errors(built.compiled), []);
    const namespace = namespaceFor(built.compiled);
    const named = (name: string) => built.compiled.statements.findIndex((statement) => statement.kind === "element" && statement.name === name);
    const frontGroupIndex = parsed.statements.findIndex((statement) => statement.kind === "group" && statement.name === "Front");
    const backGroupIndex = parsed.statements.findIndex((statement) => statement.kind === "group" && statement.name === "Back");
    const frontIndex = built.compiled.statements.findIndex((statement) => statement.kind === "layerDeclaration" && statement.enclosing?.statementIndex === frontGroupIndex);
    const backIndex = built.compiled.statements.findIndex((statement) => statement.kind === "layerDeclaration" && statement.enclosing?.statementIndex === backGroupIndex);
    const rootIndex = built.compiled.statements.findIndex((statement) => statement.kind === "layerDeclaration" && !statement.enclosing);
    const frontMembership = namespace.layerMembershipsByStatementIndex.get(named("A"));
    const backMembership = namespace.layerMembershipsByStatementIndex.get(named("B"));
    assert.equal(frontMembership?.layerIdentity, built.ids.get(frontIndex));
    assert.equal(backMembership?.layerIdentity, built.ids.get(backIndex));
    assert.notEqual(frontMembership?.layerIdentity, backMembership?.layerIdentity);
    assert.notEqual(frontMembership?.layerIdentity, built.ids.get(rootIndex));
  });

  it("resolves Module-local layers once for all occurrences while keeping runtime element identities separate", () => {
    const source = [
      "nui 1",
      "module Pattern() {",
      "  layer seam",
      "  point Mark in @seam = coordinate(x: 2, y: 3)",
      "}",
      "instance First = Pattern()",
      "instance Second = Pattern()"
    ].join("\n");
    const built = compile(source);
    assert.deepEqual(errors(built.compiled), []);
    assert.ok(built.compiled.moduleSemanticAnalysis);
    const drawableIndex = built.compiled.statements.findIndex((statement) => statement.kind === "element" && statement.name === "Mark");
    const layerIndex = built.compiled.statements.findIndex((statement) => statement.kind === "layerDeclaration");
    const sourceStatementId = built.ids.get(drawableIndex)!;
    const membership = built.compiled.document?.sourceLayerMembershipsBySourceStatementId?.get(sourceStatementId);
    assert.ok(membership);
    assert.equal(membership.layerIdentity, built.ids.get(layerIndex));

    const materialized = materializeModuleExecution({
      statements: built.compiled.statements,
      stableStatementIdByIndex: built.ids,
      assignedElementIds: built.ids,
      moduleSemanticAnalysis: built.compiled.moduleSemanticAnalysis!
    });
    const occurrences = materialized.executionStatements.filter((entry) => entry.sourceStatementId === sourceStatementId);
    assert.equal(occurrences.length, 2);
    assert.equal(new Set(occurrences.map((entry) => entry.runtimeElementId)).size, 2);
    assert.ok(occurrences.every(() => membership.layerIdentity === built.ids.get(layerIndex)));
  });

  it("leaves const geometry non-drawable and assigns membership to its from(source:) drawable", () => {
    const built = compile([
      "nui 1",
      "layer preview",
      "const Seed: point = coordinate(x: 4, y: 5)",
      "point Copy in @preview = from(source: @Seed)"
    ].join("\n"));
    assert.deepEqual(errors(built.compiled), []);
    const namespace = namespaceFor(built.compiled);
    const seedIndex = built.compiled.statements.findIndex((statement) => statement.kind === "typedDeclaration" && statement.name === "Seed");
    const copyIndex = built.compiled.statements.findIndex((statement) => statement.kind === "element" && statement.name === "Copy");
    assert.equal(namespace.layerMembershipsByStatementIndex.has(seedIndex), false);
    assert.equal(namespace.layerMembershipsByStatementIndex.get(copyIndex)?.layerName, "preview");
  });

  it("keeps layer identity stable through ordinary edits", () => {
    const beforeSource = "nui 1\nlayer bodice\npoint P in @bodice = coordinate(x: 0, y: 0)";
    const afterSource = "nui 1\nconst note: number = 1\nlayer bodice\npoint P in @bodice = coordinate(x: 0, y: 0)";
    const before = parse(beforeSource);
    const after = parse(afterSource);
    let nextIdentity = 0;
    const reconcile = (input: Parameters<typeof reconcileStatements>[0]) => reconcileStatements(input, {
      createStatementId: (kind) => `reconciled:${kind}:${++nextIdentity}`
    });
    const first = reconcile({
      oldStatements: [], oldLines: [], oldElementIds: new Map(),
      newStatements: before.statements, newLines: beforeSource.split("\n")
    });
    const second = reconcile({
      oldStatements: before.statements,
      oldLines: beforeSource.split("\n"),
      oldElementIds: new Map(),
      oldStatementIds: first.assignedIds,
      newStatements: after.statements,
      newLines: afterSource.split("\n")
    });
    const oldLayerIndex = before.statements.findIndex((statement) => statement.kind === "layerDeclaration");
    const newLayerIndex = after.statements.findIndex((statement) => statement.kind === "layerDeclaration");
    assert.equal(second.assignedIds.get(newLayerIndex), first.assignedIds.get(oldLayerIndex));
  });

  it("round-trips root and group declarations and authored memberships through canonical serialization", () => {
    const source = [
      "nui 1",
      "layer shell",
      "point A in @shell = coordinate(x: 0, y: 0)",
      "point Plain = coordinate(x: 1, y: 1)",
      "point Default in @default = coordinate(x: 2, y: 2)",
      "group Cuff {",
      "  layer seam",
      "  line B in @seam = segment(start: (0, 0), end: (10, 0))",
      "}"
    ].join("\n");
    const original = compile(source);
    assert.deepEqual(errors(original.compiled), []);
    const serialized = serializeDocumentToDsl(original.compiled.document!, 1);
    assert.match(serialized, /layer shell/);
    assert.match(serialized, /layer seam/);
    assert.match(serialized, /point A in @shell =/);
    assert.match(serialized, /line B in @seam =/);
    assert.match(serialized, /point Plain =/);
    assert.match(serialized, /point Default in @default =/);

    const reopened = compile(serialized);
    assert.deepEqual(errors(reopened.compiled), []);
    const namespace = namespaceFor(reopened.compiled);
    assert.deepEqual(namespace.layerDeclarations.map((declaration) => [declaration.name, namespace.scopeIndex.scopes.get(declaration.scopeId)?.kind]), [
      ["shell", "root"],
      ["seam", "group"]
    ]);
    assert.deepEqual([...namespace.layerMembershipsByStatementIndex.values()].map((membership) => [membership.layerName, membership.explicit]), [
      ["shell", true],
      ["default", false],
      ["default", true],
      ["seam", true]
    ]);

    const orderedSerialization = serializeDocumentToDsl(original.compiled.document!, 1, { preserveElementOrder: true });
    const orderedReopen = compile(orderedSerialization);
    assert.deepEqual(errors(orderedReopen.compiled), []);
    assert.deepEqual(
      orderedReopen.compiled.sourceLexicalNamespace?.layerDeclarations.map((declaration) => declaration.name),
      ["shell", "seam"]
    );
    assert.deepEqual(
      [...orderedReopen.compiled.sourceLexicalNamespace!.layerMembershipsByStatementIndex.values()].map((membership) => membership.layerName),
      ["shell", "default", "default", "seam"]
    );
  });

  it("preserves Module layer source and relationships when a canonical source is reopened", () => {
    const source = [
      "nui 1",
      "module Sleeve() {",
      "  layer seam",
      "  point Mark in @seam = coordinate(x: 3, y: 4)",
      "}",
      "instance One = Sleeve()"
    ].join("\n");
    const initial = regenerateCanonicalFromModel(emptyDocument(), 1);
    const current = compileCanonicalText(initial, source);
    assert.equal(current.status, "valid");
    assert.equal(current.sourceText, source);
    assert.equal(current.docText, source);
    const reopened = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), current.docText);
    assert.equal(reopened.status, "valid");
    const namespace = namespaceFor(reopened.currentCompiled);
    const membership = [...namespace.layerMembershipsByStatementIndex.values()].find((entry) => entry.layerName === "seam");
    const layer = namespace.layerDeclarations.find((entry) => entry.name === "seam");
    assert.ok(membership);
    assert.ok(layer);
    assert.equal(membership.layerIdentity, layer.statementId);
  });

  it("does not change evaluated geometry when equivalent drawables gain layer annotations", () => {
    const plainSource = [
      "nui 1",
      "point A = coordinate(x: 1, y: 2)",
      "point B = coordinate(x: 12, y: 7)",
      "line AB = segment(start: @A, end: @B)"
    ].join("\n");
    const layeredSource = [
      "nui 1",
      "layer pattern",
      "point A in @pattern = coordinate(x: 1, y: 2)",
      "point B in @pattern = coordinate(x: 12, y: 7)",
      "line AB in @pattern = segment(start: @A, end: @B)"
    ].join("\n");
    const compileCanonical = (source: string) => compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), source);
    const plain = compileCanonical(plainSource);
    const layered = compileCanonical(layeredSource);
    assert.equal(plain.status, "valid");
    assert.equal(layered.status, "valid");
    const evaluate = (value: typeof plain) => evaluateElementsReferencePayload(
      value.doc.document.elements,
      buildEvaluationOptions({
        compiledDocument: value.doc,
        evaluationLimitIndex: value.doc.document.evaluationLimitIndex
      })
    ).computedGeometry
      .map((geometry) => {
        const withoutIdentity = <T>(value: T): T => {
          if (Array.isArray(value)) return value.map((member) => withoutIdentity(member)) as T;
          if (value && typeof value === "object") {
            return Object.fromEntries(Object.entries(value)
              .filter(([key]) => !key.endsWith("Id") && !key.endsWith("Ids"))
              .map(([key, member]) => [key, withoutIdentity(member)])) as T;
          }
          return value;
        };
        return withoutIdentity(geometry);
      })
      .sort((left, right) => String(left.name).localeCompare(String(right.name)));
    assert.deepEqual(evaluate(layered), evaluate(plain));
  });

  it("keeps hidden geometry evaluated as a dependency of visible geometry", () => {
    const built = compile([
      "nui 1",
      "layer guide",
      "layer stitch",
      "point Guide in @guide = coordinate(x: 0, y: 0)",
      "point Endpoint in @stitch = coordinate(x: 40, y: 0)",
      "line Seam in @stitch = segment(start: @Guide, end: @Endpoint)"
    ].join("\n"));
    assert.deepEqual(errors(built.compiled), []);
    const document = built.compiled.document!;
    const evaluation = evaluationPayloadToResult(evaluateElementsReferencePayload(
      document.elements,
      buildEvaluationOptions({
        compiledDocument: built.compiled,
        evaluationLimitIndex: document.evaluationLimitIndex
      })
    ));
    const presentation = projectCanvasLayerPresentation({
      compiledDocument: built.compiled,
      elements: document.elements,
      evaluation
    });
    const guideLayer = presentation.layers.find((layer) => layer.name === "guide")!;
    const hiddenGuide = document.elements.find((element) => element.name === "Guide")!;
    const visibleSeam = document.elements.find((element) => element.name === "Seam")!;
    const filtered = projectCanvasLayerPresentation({
      compiledDocument: built.compiled,
      elements: document.elements,
      evaluation,
      hiddenLayerIds: new Set([guideLayer.id])
    });
    const visibleIds = effectiveCanvasVisibleElementIds({
      elements: document.elements,
      evaluation,
      visibilityProfiles: document.visibilityProfiles,
      activeVisibilityProfileId: document.activeVisibilityProfileId,
      canvasLayerPresentation: filtered
    });

    assert.ok(evaluation.computedGeometry.has(hiddenGuide.id));
    assert.ok(evaluation.computedGeometry.has(visibleSeam.id));
    assert.equal(visibleIds.has(hiddenGuide.id), false);
    assert.equal(visibleIds.has(visibleSeam.id), true);
  });
});
