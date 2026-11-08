import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "@nuinuicad/nui-language";
import { parseDslSnapshot } from "@nuinuicad/nui-language";
import { queryDslReferencePickTarget } from "@nuinuicad/nui-language";
import { reconcileStatements } from "@nuinuicad/nui-language/document";
import { evaluateElements } from "../geometry/evaluate";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import type { LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import type { EvaluationResult } from "../types/geometry";
import {
  cancelVscodeReferencePickCanvasSession,
  confirmVscodeReferencePickCanvasSession,
  moveVscodeReferencePickCanvasDraft,
  removeVscodeReferencePickCanvasDraft,
  referencePickCanvasResultMatchesSession,
  referencePickHoverForCanvasOption,
  selectVscodeReferencePickCanvasDraft,
  selectVscodeReferencePickCanvasNumericProperty,
  startVscodeReferencePickCanvasSession,
  type VscodeReferencePickCanvasSnapshot
} from "./referencePickCanvasSession";
import {
  referencePickTargetProofFor,
  type VscodeReferencePickStartRequest
} from "./referencePickProtocol";
import { planVscodeReferencePickSourceEdit } from "./referencePickSourceEdit";

const HOST_REVISION = 93;
const CANVAS_REVISION = 1093;
const DOCUMENT_URI = "file:///pick.nui";
const DOCUMENT_VERSION = 7;

const compile = (
  source: string,
  sourceRevision = HOST_REVISION,
  statementIdPrefix = "host-pick",
  previous?: CompiledDslDocument
): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  let nextId = 0;
  const reconciled = reconcileStatements({
    oldStatements: previous?.statements ?? [],
    oldLines: previous?.sourceLines ?? [],
    oldElementIds: previous?.statementMap?.elementIdByStatementIndex ?? new Map(),
    oldStatementIds: previous?.statementMap?.statementIdByStatementIndex ?? new Map(),
    newStatements: parsed.statements,
    newLines: source.split("\n")
  }, {
    createId: (type) => `${statementIdPrefix}:${type}:${++nextId}`,
    createStatementId: (kind) => `${statementIdPrefix}:${kind}:${++nextId}`
  });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedElementIds: reconciled.assignedIds,
    assignedStatementIds: reconciled.assignedIds
  });
};

const evaluate = (compiled: CompiledDslDocument): EvaluationResult => {
  if (!compiled.document || !compiled.statementMap) throw new Error("fixture did not compile");
  return evaluateElements(compiled.document.elements, buildEvaluationOptions({
    compiledDocument: compiled as LastGoodDslDocument, evaluationLimitIndex: compiled.document.evaluationLimitIndex
  }));
};

const setup = (source: string, fragment: string) => {
  const compiled = compile(source);
  if (!compiled.document || !compiled.statementMap) throw new Error("fixture did not compile");
  const start = source.indexOf(fragment);
  const position = start + Math.max(1, fragment.indexOf("@") + 2);
  const target = queryDslReferencePickTarget({
    source: { normalizedSource: source, sourceRevision: HOST_REVISION },
    position,
    semantic: { sourceRevision: HOST_REVISION, sourceText: source, compiled }
  });
  if (!target) throw new Error(`missing target: ${fragment}`);
  const proof = referencePickTargetProofFor(source, target);
  if (!proof) throw new Error(`missing proof: ${fragment}`);
  const request: VscodeReferencePickStartRequest = {
    type: "referencePickStartRequest",
    requestId: 44,
    documentUri: DOCUMENT_URI,
    documentVersion: DOCUMENT_VERSION,
    normalizedSourceOffset: position,
    targetProof: proof
  };
  return { compiled, evaluation: evaluate(compiled), request };
};

const startSession = ({
  source,
  compiled,
  evaluation,
  request,
  sourceRevision = HOST_REVISION,
  authoritativeDocumentUri = DOCUMENT_URI,
  authoritativeDocumentVersion = DOCUMENT_VERSION
}: ReturnType<typeof setup> & {
  source: string;
  sourceRevision?: number;
  authoritativeDocumentUri?: string;
  authoritativeDocumentVersion?: number;
}) => startVscodeReferencePickCanvasSession({
  request,
  authoritativeDocumentUri,
  authoritativeDocumentVersion,
  source: { normalizedSource: source, sourceRevision },
  compiled,
  evaluation,
  evaluationIsCurrent: true
});

const dualAuthorityFixture = (
  currentSource: string,
  canvasSource: string,
  normalizedSourceOffset: number,
  reconcileFromCanvas = false
) => {
  const canvasCompiled = compile(canvasSource, CANVAS_REVISION, "shared-pick");
  const currentCompiled = reconcileFromCanvas
    ? compile(currentSource, HOST_REVISION, "inserted-pick", canvasCompiled)
    : compile(currentSource, HOST_REVISION, "shared-pick");
  const target = queryDslReferencePickTarget({
    source: { normalizedSource: currentSource, sourceRevision: HOST_REVISION },
    position: normalizedSourceOffset,
    semantic: {
      sourceRevision: HOST_REVISION,
      sourceText: currentSource,
      compiled: currentCompiled
    }
  });
  if (!target) throw new Error("fixture did not produce a current Source target");
  const targetProof = referencePickTargetProofFor(currentSource, target);
  if (!targetProof) throw new Error("fixture did not produce a current Source proof");
  const request: VscodeReferencePickStartRequest = {
    type: "referencePickStartRequest",
    requestId: 144,
    documentUri: DOCUMENT_URI,
    documentVersion: DOCUMENT_VERSION,
    normalizedSourceOffset,
    targetProof
  };
  const canvasEvaluation = evaluate(canvasCompiled);
  const canvasSnapshot: VscodeReferencePickCanvasSnapshot = {
    source: {
      normalizedSource: canvasSource,
      sourceRevision: CANVAS_REVISION
    },
    compiled: canvasCompiled,
    evaluation: canvasEvaluation
  };
  return {
    currentSource,
    currentCompiled,
    canvasEvaluation,
    canvasSnapshot,
    request
  };
};

const startWithCanvasSnapshot = (
  fixture: ReturnType<typeof dualAuthorityFixture>
) => startVscodeReferencePickCanvasSession({
  request: fixture.request,
  authoritativeDocumentUri: DOCUMENT_URI,
  authoritativeDocumentVersion: DOCUMENT_VERSION,
  source: {
    normalizedSource: fixture.currentSource,
    sourceRevision: HOST_REVISION
  },
  compiled: fixture.currentCompiled,
  evaluation: fixture.canvasEvaluation,
  evaluationIsCurrent: false,
  candidateSnapshot: fixture.canvasSnapshot
});

const withCanvasStatementIds = (
  fixture: ReturnType<typeof dualAuthorityFixture>,
  update: (ids: Map<number, string>) => void
): ReturnType<typeof dualAuthorityFixture> => {
  const statementMap = fixture.canvasSnapshot.compiled.statementMap;
  if (!statementMap?.statementIdByStatementIndex) throw new Error("fixture has no statement identity map");
  const statementIdByStatementIndex = new Map(statementMap.statementIdByStatementIndex);
  update(statementIdByStatementIndex);
  return {
    ...fixture,
    canvasSnapshot: {
      ...fixture.canvasSnapshot,
      compiled: {
        ...fixture.canvasSnapshot.compiled,
        statementMap: {
          ...statementMap,
          statementIdByStatementIndex
        }
      }
    }
  };
};

describe("VS Code Canvas reference pick session bridge", () => {
  it("rejects a pinned value candidate authority after its source prefix or upstream recipe changes (#1567)", () => {
    const canvasSource = `nui 1
line L = segment(start: (0, 0), end: (100, 0))
move @L(from: (0, 0), to: (10, 0))
point P = from(source: @L.end)
reverse @L()`;
    for (const currentSource of [
      canvasSource.replace("to: (10, 0)", "to: (20, 0)"),
      canvasSource.replace("point P = from(source: @L.end)\nreverse @L()", "reverse @L()\npoint P = from(source: @L.end)")
    ]) {
      const fixture = dualAuthorityFixture(currentSource, canvasSource, currentSource.indexOf("@L.end") + 1, true);
      expect(startWithCanvasSnapshot(fixture).result.status).toBe("stale");
    }
  });

  it("retains pinned value picking when only the target reference is being edited (#1567)", () => {
    const canvasSource = `nui 1
line L = segment(start: (0, 0), end: (100, 0))
point P = from(source: @L.end)
reverse @L()`;
    const currentSource = canvasSource.replace("source: @L.end", "source: @");
    const fixture = dualAuthorityFixture(currentSource, canvasSource, currentSource.indexOf("source: @") + 9, true);
    const started = startWithCanvasSnapshot(fixture);
    expect(started.result.status).toBe("started");
    expect(started.session?.candidates.flatMap(candidate => candidate.options))
      .toContainEqual(expect.objectContaining({ reference: { base: "L", pointKey: "end" }, point: expect.objectContaining({ x: 100, y: 0 }) }));
  });
  it("uses coherent Canvas candidates for zero-width numeric targets while keeping the current Source target", () => {
    const declarationSource = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "const X: number = "
    ].join("\n");
    const declarationCanvasSource = declarationSource.replace(
      "const X: number = ",
      "const X: number = @Base.length"
    );
    const declarationPosition = declarationSource.length;
    const declaration = startWithCanvasSnapshot(
      dualAuthorityFixture(declarationSource, declarationCanvasSource, declarationPosition)
    );
    expect(declaration.result.status).toBe("started");
    if (declaration.result.status !== "started") return;
    expect(declaration.result.candidateReferences).toContainEqual({ base: "Base" });
    expect(declaration.session?.target.sourceAnchor.sourceRevision).toBe(HOST_REVISION);

    const coordinateSource = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "point P = coordinate(x: 0, y: )"
    ].join("\n");
    const coordinateCanvasSource = coordinateSource.replace("y: )", "y: @Base.length)");
    const coordinatePosition = coordinateSource.indexOf("y: )") + "y: ".length;
    const coordinate = startWithCanvasSnapshot(
      dualAuthorityFixture(coordinateSource, coordinateCanvasSource, coordinatePosition)
    );
    expect(coordinate.result.status).toBe("started");
    if (coordinate.result.status !== "started") return;
    expect(coordinate.result.candidateReferences).toContainEqual({ base: "Base" });
    expect(coordinate.session?.target.sourceAnchor.sourceRevision).toBe(HOST_REVISION);
  });

  it("restores an existing numeric property selection into the shared Pick draft", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "point P = offset(from: @A, dx: @Base.length, dy: 0)"
    ].join("\n");
    const host = setup(source, "@Base.length");
    const started = startSession({
      source,
      ...host,
      request: {
        ...host.request,
        initialNumericPropertyDraft: { reference: { base: "Base" }, property: "length" }
      }
    });

    expect(started.result.status).toBe("started");
    if (started.result.status !== "started" || !started.session) return;
    expect(started.session.draft.numericProperty).toMatchObject({
      stage: "draft",
      selectedGeometry: { reference: { base: "Base" } },
      draft: { reference: { base: "Base" }, property: "length" }
    });
  });

  it("preserves strict and broad Module candidate semantics from the pinned Canvas snapshot", () => {
    const currentSource = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 20, y: 0)",
      "line Straight = segment(start: @A, end: @B)",
      "curve Curve = bezier(start: @A, end: @B, startAngle: 0, startLength: 5, endAngle: 180, endLength: 5)",
      "module M(straight: line, broad: path) {",
      "}",
      "instance X = M(straight: @Straight, broad: )"
    ].join("\n");
    const canvasSource = currentSource.replace("broad: )", "broad: @Curve)");
    const position = currentSource.lastIndexOf("broad:") + "broad:".length;
    const started = startWithCanvasSnapshot(
      dualAuthorityFixture(currentSource, canvasSource, position)
    );

    expect(started.result.status).toBe("started");
    if (started.result.status !== "started") return;
    expect(started.result.candidateReferences).toEqual(
      expect.arrayContaining([{ base: "Straight" }, { base: "Curve" }])
    );
    expect(started.result.candidateReferences).not.toContainEqual({ base: "A" });
  });

  it("fails closed when the Canvas snapshot cannot be reconciled or is stale", () => {
    const currentSource = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "const X: number = "
    ].join("\n");
    const currentPosition = currentSource.length;
    const missingTargetCanvasSource = currentSource.slice(0, currentSource.lastIndexOf("\n"));
    const unmappable = startWithCanvasSnapshot(
      dualAuthorityFixture(currentSource, missingTargetCanvasSource, currentPosition)
    );
    expect(unmappable.session).toBeNull();
    expect(unmappable.result.status).toBe("stale");

    const candidateSource = currentSource.replace(
      "const X: number = ",
      "const X: number = @Base.length"
    );
    const staleFixture = dualAuthorityFixture(currentSource, candidateSource, currentPosition);
    const staleSnapshot = {
      ...staleFixture.canvasSnapshot,
      source: {
        ...staleFixture.canvasSnapshot.source,
        sourceRevision: CANVAS_REVISION + 1
      }
    };
    const stale = startVscodeReferencePickCanvasSession({
      request: staleFixture.request,
      authoritativeDocumentUri: DOCUMENT_URI,
      authoritativeDocumentVersion: DOCUMENT_VERSION,
      source: {
        normalizedSource: staleFixture.currentSource,
        sourceRevision: HOST_REVISION
      },
      compiled: staleFixture.currentCompiled,
      evaluation: staleFixture.canvasEvaluation,
      evaluationIsCurrent: false,
      candidateSnapshot: staleSnapshot
    });
    expect(stale.session).toBeNull();
    expect(stale.result.status).toBe("stale");
  });

  it("accepts an appended incomplete Source target using only the reconciled Canvas namespace as candidate authority", () => {
    const canvasSource = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)"
    ].join("\n");
    const currentSource = `${canvasSource}\npoint New = offset(from: @A, dx: 0, dy: )`;
    const position = currentSource.indexOf("dy: )") + "dy: ".length;
    const started = startWithCanvasSnapshot(
      dualAuthorityFixture(currentSource, canvasSource, position)
    );

    expect(started.result.status).toBe("started");
    expect(started.session?.target.sourceAnchor.sourceRevision).toBe(HOST_REVISION);
    if (started.result.status !== "started") return;
    expect(started.result.candidateReferences).toContainEqual({ base: "Base" });
  });

  it.each(["edge (index: )", "extend (to: )", "move (from: , to: )", "mirrorMove (axis1: , axis2: )", "reverse ()"])(
    "starts an appended transformation template against the coherent Canvas: %s", (header) => {
      const canvasSource = "nui 1\nline A = segment(start: (0, 0), end: (10, 0))\nline B = segment(start: (10, -10), end: (10, 10))";
      const currentSource = `${canvasSource}\n${header}`;
      const position = canvasSource.length + 1 + header.indexOf("(");
      const started = startWithCanvasSnapshot(dualAuthorityFixture(currentSource, canvasSource, position));
      expect(started.result.status).toBe("started");
      expect(started.session?.target.syntax).toBe("transformationTarget");
      if (started.result.status !== "started") return;
      expect(started.result.candidateReferences).toContainEqual(header.startsWith("edge") || header.startsWith("extend")
        ? { base: "A", pointKey: "end" } : { base: "A" });
    }
  );

  const middleTransformationFixture = (header = "reverse ()", before = "") => {
    const canvasSource = [
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "line B = segment(start: (10, 0), end: (20, 0))"
    ].join("\n");
    const currentSource = canvasSource.replace("line B =", `${before}${header}\nline B =`);
    const position = currentSource.indexOf(header) + (header.includes(", ]") ? header.indexOf("]") : header.indexOf("("));
    return dualAuthorityFixture(currentSource, canvasSource, position, true);
  };

  it.each(["edge (index: )", "extend (to: )", "move (from: , to: )", "mirrorMove (axis1: , axis2: )", "reverse ()", "reverse @()", "move [@A, ](from: , to: )"])(
    "starts a middle transformation template using reconciled Canvas candidates: %s", (header) => {
      const fixture = middleTransformationFixture(header);
      expect(fixture.currentCompiled.statementMap?.statementIdByStatementIndex?.get(3))
        .toBe(fixture.canvasSnapshot.compiled.statementMap?.statementIdByStatementIndex?.get(2));
      const started = startWithCanvasSnapshot(fixture);

      expect(started.result.status).toBe("started");
      expect(started.session?.target.sourceAnchor).toMatchObject({ sourceRevision: HOST_REVISION, statementIndex: 2 });
      expect(started.session?.target.syntax).toBe("transformationTarget");
      if (started.result.status !== "started") return;
      const endpoint = header.startsWith("edge") || header.startsWith("extend");
      expect(started.result.candidateReferences).toContainEqual(endpoint
        ? { base: "A", pointKey: "end" } : { base: "A" });
      expect(started.result.candidateReferences.some((reference) => reference.base === "B")).toBe(false);
    }
  );

  it("preserves the inserted target's lexical scope at a Canvas index occupied by the closing brace", () => {
    const canvasSource = [
      "nui 1",
      "group G {",
      "  line A = segment(start: (0, 0), end: (10, 0))",
      "}",
      "line B = segment(start: (10, 0), end: (20, 0))"
    ].join("\n");
    const currentSource = canvasSource.replace("\n}", "\n  reverse ()\n}");
    const fixture = dualAuthorityFixture(currentSource, canvasSource, currentSource.indexOf("reverse (") + "reverse ".length, true);
    const started = startWithCanvasSnapshot(fixture);
    expect(started.result.status).toBe("started");
    if (started.result.status !== "started") return;
    expect(started.result.candidateReferences).toContainEqual({ base: "A" });
    expect(started.result.candidateReferences.some((reference) => reference.base === "B")).toBe(false);
    expect(started.session?.target.sourceAnchor.scopeId).toMatch(/^group:/);

    const namespace = fixture.canvasSnapshot.compiled.sourceLexicalNamespace!;
    const scopeOfStatement = new Map(namespace.scopeIndex.scopeOfStatement);
    scopeOfStatement.set(2, "root");
    const mismatchedScope = {
      ...fixture,
      canvasSnapshot: {
        ...fixture.canvasSnapshot,
        compiled: {
          ...fixture.canvasSnapshot.compiled,
          sourceLexicalNamespace: { ...namespace, scopeIndex: { ...namespace.scopeIndex, scopeOfStatement } }
        }
      }
    };
    expect(startWithCanvasSnapshot(mismatchedScope).result.status).toBe("stale");
  });

  it("retains current Source proof for middle insertion confirmation, cancellation and revision guards", () => {
    const fixture = middleTransformationFixture();
    const started = startWithCanvasSnapshot(fixture);
    if (!started.session || started.result.status !== "started") throw new Error("session did not start");
    expect(cancelVscodeReferencePickCanvasSession(started.session).result.status).toBe("canceled");
    expect(fixture.currentSource).toContain("reverse ()\nline B");
    const candidate = started.session.candidates.find((entry) => entry.options.some((option) => option.reference.base === "A"))!;
    const option = candidate.options.find((entry) => entry.reference.base === "A")!;
    const selected = selectVscodeReferencePickCanvasDraft(started.session, referencePickHoverForCanvasOption(candidate, option));
    const confirmed = confirmVscodeReferencePickCanvasSession(selected);
    if (confirmed.result?.resultKind !== "geometry") throw new Error("geometry result missing");
    expect(confirmed.result.references).toEqual([{ base: "A" }]);
    const editInput = {
      source: { normalizedSource: fixture.currentSource, sourceRevision: HOST_REVISION },
      compiled: fixture.currentCompiled,
      normalizedSourceOffset: fixture.request.normalizedSourceOffset,
      targetProof: confirmed.result.targetProof,
      references: confirmed.result.references,
      allowedCandidateReferences: started.result.candidateReferences
    };
    const plan = planVscodeReferencePickSourceEdit(editInput)!;
    expect(plan).not.toBeNull();
    expect(fixture.currentSource.slice(0, plan.range.from) + plan.replacement + fixture.currentSource.slice(plan.range.to))
      .toBe(fixture.currentSource.replace("reverse ()", "reverse @A()"));
    expect(planVscodeReferencePickSourceEdit({ ...editInput, source: { ...editInput.source, sourceRevision: HOST_REVISION + 1 } })).toBeNull();
    expect(startWithCanvasSnapshot({ ...fixture, request: { ...fixture.request, documentVersion: DOCUMENT_VERSION - 1 } }).result.status).toBe("stale");
  });

  it("continues to reanchor an edit to an existing transformation by its reconciled identity", () => {
    const canvasSource = [
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "reverse @A()",
      "line B = segment(start: (10, 0), end: (20, 0))"
    ].join("\n");
    const currentSource = canvasSource.replace("reverse @A()", "reverse @()");
    const fixture = dualAuthorityFixture(currentSource, canvasSource, currentSource.indexOf("@()") + 1, true);
    expect(fixture.currentCompiled.statementMap?.statementIdByStatementIndex?.get(2))
      .toBe(fixture.canvasSnapshot.compiled.statementMap?.statementIdByStatementIndex?.get(2));
    const started = startWithCanvasSnapshot(fixture);
    expect(started.result.status).toBe("started");
    if (started.result.status !== "started") return;
    expect(started.result.candidateReferences).toContainEqual({ base: "A" });
    expect(started.result.candidateReferences.some((reference) => reference.base === "B")).toBe(false);
  });

  it("rejects changed or mismatched existing statements around a middle insertion", () => {
    for (const index of [1, 2]) {
      const fixture = middleTransformationFixture();
      for (const update of [
        (ids: Map<number, string>) => { ids.delete(index); },
        (ids: Map<number, string>) => { ids.set(index, "wrong-identity"); },
        (ids: Map<number, string>) => { ids.set(index, ids.get(index === 1 ? 2 : 1)!); }
      ]) {
        const rejected = startWithCanvasSnapshot(withCanvasStatementIds(fixture, update));
        expect(rejected.result.status).toBe("stale");
        expect(rejected.session).toBeNull();
      }
    }

    for (const name of ["A", "B"]) {
      const fixture = middleTransformationFixture();
      const currentSource = fixture.currentSource.replace(`line ${name} = segment(start: (`, `line ${name} = segment(start: (1 + `);
      const changed = dualAuthorityFixture(currentSource, fixture.canvasSnapshot.source.normalizedSource,
        currentSource.indexOf("reverse (") + "reverse ".length, true);
      expect(startWithCanvasSnapshot(changed).result.status).toBe("stale");
    }
  });

  it("rejects ambiguous middle insertions and stale Canvas revisions", () => {
    const multiple = middleTransformationFixture("reverse ()", "reverse @A()\n");
    expect(startWithCanvasSnapshot(multiple).result.status).toBe("stale");

    const fixture = middleTransformationFixture();
    fixture.canvasSnapshot.source = { ...fixture.canvasSnapshot.source, sourceRevision: CANVAS_REVISION + 1 };
    expect(startWithCanvasSnapshot(fixture).result.status).toBe("stale");
  });

  it("keeps the production identity fixture ID-less for the nui 1 version statement", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "line Base = segment(start: @A, end: (10, 0))"
    ].join("\n");
    const compiled = compile(source, HOST_REVISION, "production-pick");
    const statementIds = compiled.statementMap?.statementIdByStatementIndex;

    expect(statementIds?.get(0)).toBeUndefined();
    expect(statementIds?.get(1)).toBeDefined();
    expect(statementIds?.get(2)).toBeDefined();
    expect([...statementIds?.keys() ?? []]).not.toContain(0);
  });

  it("starts warm-pinned geometry-list picking with a production-style ID-less version prefix", () => {
    const canvasSource = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "line Existing = offset(sources: [@Base], distance: 1, side: right, closed: false, suppressTrimWarnings: false)"
    ].join("\n");
    const currentSource = [
      canvasSource,
      "line New = offset(",
      "  sources: ",
      "  distance: ",
      ")"
    ].join("\n");
    const position = currentSource.indexOf("sources: ") + "sources: ".length;
    const started = startWithCanvasSnapshot(
      dualAuthorityFixture(currentSource, canvasSource, position)
    );

    expect(started.result.status).toBe("started");
    if (started.result.status !== "started") return;
    expect(started.result.candidateReferences).toContainEqual({ base: "Base" });
  });

  it("starts warm-pinned numeric picking for the production Copy Line scale hole", () => {
    const canvasSource = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "line Copy = transformCopy(startPoint: @A, endPoint: @B, scale: 1, angleDeg: 0, baseLines: [@Base])"
    ].join("\n");
    const currentSource = [
      canvasSource,
      "line New = transformCopy(",
      "  startPoint: ",
      "  endPoint: ",
      "  scale: ",
      "  angleDeg: ",
      "  baseLines: ",
      ")"
    ].join("\n");
    const position = currentSource.indexOf("scale: ") + "scale: ".length;
    const started = startWithCanvasSnapshot(
      dualAuthorityFixture(currentSource, canvasSource, position)
    );

    expect(started.result.status).toBe("started");
    if (started.result.status !== "started") return;
    expect(started.result.numericCandidates).toEqual(
      expect.arrayContaining([{
        reference: { base: "Base" },
        properties: expect.arrayContaining(["length"])
      }])
    );
  });

  it("keeps one-sided and different shared-prefix identities stale", () => {
    const canvasSource = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "line Base = segment(start: @A, end: (10, 0))"
    ].join("\n");
    const currentSource = `${canvasSource}\npoint New = offset(from: @A, dx: 0, dy: )`;
    const position = currentSource.indexOf("dy: ") + "dy: ".length;
    const fixture = dualAuthorityFixture(currentSource, canvasSource, position);
    const pointIndex = 1;

    const oneSided = startWithCanvasSnapshot(withCanvasStatementIds(fixture, (ids) => {
      ids.delete(pointIndex);
    }));
    expect(oneSided.session).toBeNull();
    expect(oneSided.result.status).toBe("stale");

    const different = startWithCanvasSnapshot(withCanvasStatementIds(fixture, (ids) => {
      ids.set(pointIndex, "different-reconciler-identity");
    }));
    expect(different.session).toBeNull();
    expect(different.result.status).toBe("stale");
  });

  it("keeps a changed ID-less prefix statement stale despite matching statement shape", () => {
    const currentSource = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "line Base = segment(start: @A, end: (10, 0))",
      "point New = offset(from: @A, dx: 0, dy: )"
    ].join("\n");
    const canvasSource = [
      "nui 01",
      "point A = coordinate(x: 0, y: 0)",
      "line Base = segment(start: @A, end: (10, 0))"
    ].join("\n");
    const position = currentSource.indexOf("dy: ") + "dy: ".length;
    const changedPrefix = startWithCanvasSnapshot(
      dualAuthorityFixture(currentSource, canvasSource, position)
    );

    expect(changedPrefix.session).toBeNull();
    expect(changedPrefix.result.status).toBe("stale");
  });

  it("fails closed when an ID-less source continuity range is invalid", () => {
    const canvasSource = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "line Base = segment(start: @A, end: (10, 0))"
    ].join("\n");
    const currentSource = `${canvasSource}\npoint New = offset(from: @A, dx: 0, dy: )`;
    const position = currentSource.indexOf("dy: ") + "dy: ".length;
    const fixture = dualAuthorityFixture(currentSource, canvasSource, position);
    const currentVersion = fixture.currentCompiled.statements[0];
    if (!currentVersion) throw new Error("version statement missing");
    const invalidRange = {
      ...fixture,
      currentCompiled: {
        ...fixture.currentCompiled,
        statements: fixture.currentCompiled.statements.map((statement, index) =>
          index === 0
            ? { ...statement, documentRange: { ...statement.documentRange, from: -1 } }
            : statement
        )
      }
    };

    const started = startWithCanvasSnapshot(invalidRange);
    expect(started.session).toBeNull();
    expect(started.result.status).toBe("stale");
  });

  it("matches document/version proof across independent Host and Webview compiler sessions", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Straight = segment(start: @A, end: @B)",
      "curve Curve = bezier(start: @A, end: @B, startAngle: 0, startLength: 5, endAngle: 180, endLength: 5)",
      "module M(straight: line) {",
      "}",
      "instance X = M(straight: @Straight)"
    ].join("\n");
    const host = setup(source, "straight: @Straight");
    const canvasCompiled = compile(source, CANVAS_REVISION, "canvas-pick");
    const canvasEvaluation = evaluate(canvasCompiled);
    const started = startSession({
      source,
      ...host,
      compiled: canvasCompiled,
      evaluation: canvasEvaluation,
      sourceRevision: CANVAS_REVISION
    });

    expect(started.session).not.toBeNull();
    expect(started.result.status).toBe("started");
    if (started.result.status === "started") {
      expect(started.result.candidateReferences).toContainEqual({ base: "Straight" });
      expect(started.result.candidateReferences).not.toContainEqual({ base: "Curve" });
    }

    expect(startSession({
      source,
      ...host,
      compiled: canvasCompiled,
      evaluation: canvasEvaluation,
      sourceRevision: CANVAS_REVISION,
      authoritativeDocumentVersion: DOCUMENT_VERSION + 1
    }).result.status).toBe("stale");
    expect(startSession({
      source,
      ...host,
      compiled: canvasCompiled,
      evaluation: canvasEvaluation,
      sourceRevision: CANVAS_REVISION,
      authoritativeDocumentUri: "file:///other.nui"
    }).result.status).toBe("stale");

    const staleProof = startSession({
      source,
      ...host,
      compiled: canvasCompiled,
      evaluation: canvasEvaluation,
      sourceRevision: CANVAS_REVISION,
      request: {
        ...host.request,
        targetProof: { ...host.request.targetProof, oldText: "@Other" }
      }
    });
    expect(staleProof.session).toBeNull();
    expect(staleProof.result.status).toBe("stale");
  });

  it("revalidates restored draft references against the current candidates", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Straight = segment(start: @A, end: @B)",
      "module M(straight: line) {",
      "}",
      "instance X = M(straight: @Straight)"
    ].join("\n");
    const host = setup(source, "straight: @Straight");
    const canvasCompiled = compile(source, CANVAS_REVISION, "canvas-restore");
    const canvasEvaluation = evaluate(canvasCompiled);
    const restored = startSession({
      source,
      ...host,
      compiled: canvasCompiled,
      evaluation: canvasEvaluation,
      sourceRevision: CANVAS_REVISION,
      request: {
        ...host.request,
        requestId: host.request.requestId + 1,
        initialDraftReferences: [{ base: "Straight" }]
      }
    });

    expect(restored.result.status).toBe("started");
    expect(restored.session?.draft.draftReferences).toEqual([{ base: "Straight" }]);

    const missing = startSession({
      source,
      ...host,
      compiled: canvasCompiled,
      evaluation: canvasEvaluation,
      sourceRevision: CANVAS_REVISION,
      request: {
        ...host.request,
        requestId: host.request.requestId + 2,
        initialDraftReferences: [{ base: "Missing" }]
      }
    });
    expect(missing.session).toBeNull();
    expect(missing.result.status).toBe("rejected");
  });

  it("seeds a multiple draft, toggles candidates, and confirms without mutating Source", () => {
    const source = [
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "line B = segment(start: (0, 10), end: (10, 10))",
      "line C = segment(start: (0, 20), end: (10, 20))",
      "line Seam = offset(sources: [@A, @B], distance: 1, side: left, closed: false, suppressTrimWarnings: false)"
    ].join("\n");
    const setupResult = setup(source, "[@A, @B]");
    const started = startSession({ source, ...setupResult });
    if (!started.session) throw new Error("session did not start");
    expect(started.session.draft.draftReferences).toEqual([{ base: "A" }, { base: "B" }]);

    const optionFor = (base: string) => {
      for (const candidate of started.session!.candidates) {
        const option = candidate.options.find((entry) => entry.reference.base === base);
        if (option) return { candidate, option };
      }
      throw new Error(`missing candidate: ${base}`);
    };
    const c = optionFor("C");
    let session = selectVscodeReferencePickCanvasDraft(
      started.session,
      referencePickHoverForCanvasOption(c.candidate, c.option)
    );
    const b = optionFor("B");
    session = selectVscodeReferencePickCanvasDraft(
      session,
      referencePickHoverForCanvasOption(b.candidate, b.option)
    );
    const confirmed = confirmVscodeReferencePickCanvasSession(session);

    expect(source).toContain("sources: [@A, @B]");
    if (confirmed.result?.resultKind !== "geometry") throw new Error("geometry result missing");
    expect(confirmed.result.references).toEqual([{ base: "A" }, { base: "C" }]);
  });

  it("projects ordered draft controls and confirms the exact retained reference order", () => {
    const source = [
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "line B = segment(start: (0, 10), end: (10, 10))",
      "line C = segment(start: (0, 20), end: (10, 20))",
      "line Seam = offset(sources: [@A, @B], distance: 1, side: left, closed: false, suppressTrimWarnings: false)"
    ].join("\n");
    const setupResult = setup(source, "[@A, @B]");
    const started = startSession({ source, ...setupResult });
    if (!started.session) throw new Error("session did not start");

    let session = selectVscodeReferencePickCanvasDraft(
      started.session,
      referencePickHoverForCanvasOption(
        started.session.candidates.find((candidate) => candidate.options.some((option) => option.reference.base === "C"))!,
        started.session.candidates.flatMap((candidate) => candidate.options).find((option) => option.reference.base === "C")!
      )
    );
    session = moveVscodeReferencePickCanvasDraft(session, '["C",null]', 0);
    session = removeVscodeReferencePickCanvasDraft(session, '["A",null]');

    expect(session.draft.draftReferences).toEqual([{ base: "C" }, { base: "B" }]);
    const confirmed = confirmVscodeReferencePickCanvasSession(session);
    expect(confirmed.result).toMatchObject({
      status: "confirmed",
      resultKind: "geometry",
      references: [{ base: "C" }, { base: "B" }]
    });
  });

  it("moves from numeric geometry selection to a property chooser and explicit confirmation", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "point P = offset(from: @A, dx: 20, dy: 0)"
    ].join("\n");
    const setupResult = setup(source, "20");
    const started = startSession({ source, ...setupResult });
    if (!started.session || started.result.status !== "started") throw new Error("session did not start");
    expect(started.result.numericCandidates).toContainEqual({
      reference: { base: "Base" },
      properties: expect.arrayContaining([
        "length",
        "startAngleDeg",
        "endAngleDeg",
        "startPoint.x",
        "startPoint.y",
        "endPoint.x",
        "endPoint.y"
      ])
    });

    const candidate = started.session.candidates[0];
    const option = candidate?.options.find((entry) => entry.kind === "numericProperty");
    if (!candidate || !option || option.kind !== "numericProperty") throw new Error("numeric candidate missing");
    let session = selectVscodeReferencePickCanvasDraft(
      started.session,
      referencePickHoverForCanvasOption(candidate, option)
    );
    expect(session.draft.numericProperty?.stage).toBe("propertySelection");
    expect(confirmVscodeReferencePickCanvasSession(session).result).toBeNull();

    session = selectVscodeReferencePickCanvasNumericProperty(session, "length");
    const confirmed = confirmVscodeReferencePickCanvasSession(session);
    expect(confirmed.result).toMatchObject({
      status: "confirmed",
      resultKind: "numericProperty",
      reference: { base: "Base" },
      property: "length"
    });
  });

  it("keeps numeric options with one canonical base reference exact across selection", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 20, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "point P = offset(from: @A, dx: @Base.length, dy: 0)"
    ].join("\n");
    const setupResult = setup(source, "@Base.length");
    const started = startSession({ source, ...setupResult });
    if (!started.session) throw new Error("session did not start");
    const candidate = started.session.candidates.find((item) => item.options.some((option) =>
      option.kind === "numericProperty" && option.reference.base === "Base"
    ));
    if (!candidate) throw new Error("numeric candidate missing");
    const startOption = candidate.options.find((option) =>
      option.kind === "numericProperty" &&
      option.subgeometry.kind === "point" &&
      option.subgeometry.anchor.pointKey === "start"
    );
    const endOption = candidate.options.find((option) =>
      option.kind === "numericProperty" &&
      option.subgeometry.kind === "point" &&
      option.subgeometry.anchor.pointKey === "end"
    );
    if (!startOption || !endOption || startOption.kind !== "numericProperty" || endOption.kind !== "numericProperty") {
      throw new Error("endpoint numeric options missing");
    }

    const selectedStart = selectVscodeReferencePickCanvasDraft(
      started.session,
      referencePickHoverForCanvasOption(candidate, startOption)
    );
    expect(selectedStart.draft.numericProperty?.properties).toEqual([
      "startPoint.x", "startPoint.y", "startAngleDeg"
    ]);
    const rejectedEndProperty = selectVscodeReferencePickCanvasNumericProperty(selectedStart, "endPoint.x");
    expect(rejectedEndProperty.draft.numericProperty?.stage).toBe("propertySelection");
    expect(rejectedEndProperty.draft.numericProperty?.draft).toBeNull();

    const selectedEnd = selectVscodeReferencePickCanvasDraft(
      selectedStart,
      referencePickHoverForCanvasOption(candidate, endOption)
    );
    expect(selectedEnd.draft.numericProperty?.properties).toEqual([
      "endPoint.x", "endPoint.y", "endAngleDeg"
    ]);
    const confirmed = confirmVscodeReferencePickCanvasSession(
      selectVscodeReferencePickCanvasNumericProperty(selectedEnd, "endPoint.x")
    );
    expect(confirmed.result).toMatchObject({
      resultKind: "numericProperty",
      reference: { base: "Base" },
      property: "endPoint.x"
    });
  });

  it("keeps every numeric geometry candidate and exposes its actual computed properties", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "arc Arc = arc(center: @A, radius: 10, start: 0, end: 90)",
      "point P = offset(from: @A, dx: @Arc.radius, dy: 0)"
    ].join("\n");
    const setupResult = setup(source, "@Arc.radius");
    const started = startSession({ source, ...setupResult });
    if (!started.session || started.result.status !== "started") throw new Error("session did not start");
    const base = started.result.numericCandidates?.find((candidate) => candidate.reference.base === "Base");
    const arc = started.result.numericCandidates?.find((candidate) => candidate.reference.base === "Arc");
    expect(base?.properties).toContain("length");
    expect(base?.properties).not.toContain("radius");
    expect(arc?.properties).toContain("radius");
    expect(referencePickCanvasResultMatchesSession(started.session, started.result)).toBe(true);
  });

  it("rejects numeric confirmations and allowlists with unsupported geometry-property pairs", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "point P = offset(from: @A, dx: 20, dy: 0)"
    ].join("\n");
    const setupResult = setup(source, "20");
    const started = startSession({ source, ...setupResult });
    if (!started.session || started.result.status !== "started") throw new Error("session did not start");

    expect(referencePickCanvasResultMatchesSession(started.session, {
      ...started.result,
      numericCandidates: [{ reference: { base: "Base" }, properties: ["startHandleLength"] }]
    })).toBe(false);
    expect(referencePickCanvasResultMatchesSession(started.session, {
      type: "referencePickResult",
      requestId: setupResult.request.requestId,
      documentUri: setupResult.request.documentUri,
      documentVersion: setupResult.request.documentVersion,
      targetProof: setupResult.request.targetProof,
      status: "confirmed",
      resultKind: "numericProperty",
      reference: { base: "Base" },
      property: "startHandleLength"
    })).toBe(false);
  });

  it("retargets an existing numeric property through the property chooser", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "arc Arc = arc(center: @A, radius: 10, start: 0, end: 90)",
      "point P = offset(from: @A, dx: @Arc.radius, dy: 0)"
    ].join("\n");
    const setupResult = setup(source, "@Arc.radius");
    const started = startSession({ source, ...setupResult });
    if (!started.session) throw new Error("session did not start");
    const base = started.session.candidates.find((candidate) => candidate.options.some((option) => option.reference.base === "Base"));
    const option = base?.options.find((entry) => entry.kind === "numericProperty");
    if (!base || !option || option.kind !== "numericProperty") throw new Error("numeric candidate missing");
    let selected = selectVscodeReferencePickCanvasDraft(
      started.session,
      referencePickHoverForCanvasOption(base, option)
    );
    expect(selected.draft.numericProperty?.stage).toBe("propertySelection");
    expect(selected.draft.numericProperty?.draft).toBeNull();
    selected = selectVscodeReferencePickCanvasNumericProperty(selected, "length");
    expect(confirmVscodeReferencePickCanvasSession(selected).result).toMatchObject({
      resultKind: "numericProperty",
      reference: { base: "Base" },
      property: "length"
    });
  });
});
