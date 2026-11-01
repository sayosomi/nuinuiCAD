import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  textDocuments: [] as TestDocument[],
  applyEdit: vi.fn()
}));

vi.mock("vscode", () => {
  class Position {
    constructor(public readonly line: number, public readonly character: number) {}
  }
  class Range {
    constructor(public readonly start: Position, public readonly end: Position) {}
  }
  class Diagnostic {
    code?: string | number;
    source?: string;

    constructor(
      public readonly range: Range,
      public message: string,
      public readonly severity: number
    ) {}
  }
  class CodeAction {
    diagnostics?: Diagnostic[];
    isPreferred?: boolean;
    command?: { command: string; title: string; arguments?: unknown[] };

    constructor(public readonly title: string, public readonly kind: string) {}
  }
  class WorkspaceEdit {
    readonly edits: Array<{ uri: unknown; range: Range; newText: string }> = [];

    replace(uri: unknown, range: Range, newText: string): void {
      this.edits.push({ uri, range, newText });
    }
  }
  return {
    env: { language: "en" },
    workspace: {
      get textDocuments() {
        return mocks.textDocuments;
      },
      applyEdit: mocks.applyEdit
    },
    CodeActionKind: { QuickFix: "quickfix" },
    Position,
    Range,
    Diagnostic,
    CodeAction,
    WorkspaceEdit
  };
// @ts-expect-error Vitest's runtime supports the virtual-module options used here.
}, { virtual: true });

import * as vscode from "vscode";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createNuiLanguageSession, type NuiLanguageSession, type NuiQuickFixInput } from "@nuinuicad/nui-language";
import { createNuiChoiceQuickFixApplyHandler, createNuiChoiceQuickFixProvider } from "../../../vscode-extension/src/choiceQuickFixProvider";
import { rawOffsetFromNormalized } from "../../../vscode-extension/src/sourceOffsetAdapter";
import { buildEvaluationOptions } from "../../../src/geometry/productionEvaluationContext";
import { prepareRustEvaluation } from "../../../src/geometry/rustEvaluationRunner";
import { evaluationPayloadToResult, type EvaluationPayload } from "../../../src/geometry/evaluationPayload";
import oracle from "./oracle-v2.json";
import moduleOracle from "./module-controls.json";
import { compileDslDocument, createModuleRuntimeContext, queryDslCompletion, queryDslTypoSuggestions, toNuiDiagnostic, moduleSemanticIdentityKey } from "@nuinuicad/nui-language";
import { currentCompiledSemanticSnapshotFor, analyzeMultiDocumentModuleSemantics, buildMultiDocumentImportGraph, moduleDeclarationContributor, documentIdFromHost, savedSourceFingerprintFromHost } from "@nuinuicad/nui-language/workspace";

type Case = typeof oracle.rows[number]["cases"][number];
type TestDocument = {
  fileName: string; version: number;
  uri: { scheme: string; toString: () => string };
  getText: () => string;
  positionAt: (offset: number) => vscode.Position;
  setSource: (source: string) => void;
};
type Edit = { uri: { toString: () => string }; range: vscode.Range; newText: string };
const observations: unknown[] = [];
const sessions = new Map<string, NuiLanguageSession>();
const position = (source: string, offset: number): vscode.Position => {
  const lines = source.slice(0, offset).split("\n");
  return new vscode.Position(lines.length - 1, lines.at(-1)!.length);
};
const offset = (source: string, pos: { line: number; character: number }): number => {
  const lines = source.split("\n");
  return lines.slice(0, pos.line).reduce((n, line) => n + line.length + 1, 0) + pos.character;
};
const documentFor = (source: string, uri: string): TestDocument => {
  let text = source;
  const document: TestDocument = {
    fileName: uri.slice("file://".length), version: 1,
    uri: { scheme: "file", toString: () => uri },
    getText: () => text,
    positionAt: (at) => position(text, at),
    setSource: (next) => { text = next; document.version++; }
  };
  mocks.textDocuments.push(document);
  sessions.set(uri, createNuiLanguageSession(source));
  return document;
};
const sessionFor = (doc: vscode.TextDocument): NuiLanguageSession => sessions.get(doc.uri.toString())!;
const sessionOf = (doc: TestDocument) => sessions.get(doc.uri.toString())!;
const fingerprint = (c: Case): NuiQuickFixInput => c.diagnostic as NuiQuickFixInput;
const nativeDiagnostic = (f: NuiQuickFixInput): vscode.Diagnostic => {
  const diagnostic = new vscode.Diagnostic(new vscode.Range(
    new vscode.Position(f.range.start.line, f.range.start.character),
    new vscode.Position(f.range.end.line, f.range.end.character)
  ), "message deliberately irrelevant", 0);
  diagnostic.source = f.source;
  diagnostic.code = f.code;
  return diagnostic;
};
const actionsFor = (doc: TestDocument, f: NuiQuickFixInput) => createNuiChoiceQuickFixProvider(sessionFor).provideCodeActions!(
  doc as unknown as vscode.TextDocument, nativeDiagnostic(f).range,
  { diagnostics: [nativeDiagnostic(f)] } as vscode.CodeActionContext, undefined as never
) as vscode.CodeAction[];
const payloadFor = (a: vscode.CodeAction): Record<string, unknown> => structuredClone(a.command!.arguments![0]);
const apply = createNuiChoiceQuickFixApplyHandler(sessionFor);
const applyNormalized = (raw: string, e: { from: number; to: number; newText: string }) =>
  raw.slice(0, rawOffsetFromNormalized(raw, e.from)) + e.newText + raw.slice(rawOffsetFromNormalized(raw, e.to));
const count = (session: NuiLanguageSession, code: string) => session.diagnostics().filter(d => d.code === code).length;

beforeEach(() => {
  mocks.textDocuments.length = 0;
  sessions.clear();
  mocks.applyEdit.mockReset();
  mocks.applyEdit.mockImplementation(async (workspaceEdit: { edits: Edit[] }) => {
    for (const e of workspaceEdit.edits) {
      const doc = mocks.textDocuments.find(d => d.uri.toString() === e.uri.toString())!;
      const raw = doc.getText();
      doc.setSource(raw.slice(0, offset(raw, e.range.start)) + e.newText + raw.slice(offset(raw, e.range.end)));
    }
    return true;
  });
});
afterAll(() => {
  if (process.env.ISSUE1523_RECORD) writeFileSync(process.env.ISSUE1523_RECORD,
    JSON.stringify({ base: oracle.base, oracleSha256: createHash("sha256").update(JSON.stringify(oracle)).digest("hex"), observations }, null, 2) + "\n");
});

function assertControls(c: Case): void {
  const positive = createNuiLanguageSession(c.positiveControl.rawSource);
  expect(count(positive, c.diagnostic.code), `${c.name} independent positive control`).toBe(c.positiveControl.expectedTargetCount);
  const negative = createNuiLanguageSession(c.negativeControl.rawSource);
  const matching = negative.diagnostics().filter(d => d.code === c.negativeControl.code);
  const diagnostics = "targetOnly" in c.negativeControl && c.negativeControl.targetOnly ? matching.slice(-1) : matching;
  expect(diagnostics.length, `${c.name} discriminating negative diagnostic`).toBeGreaterThan(0);
  for (const d of diagnostics) expect(negative.quickFixes(d as NuiQuickFixInput)).toEqual([]);
}

async function ordinaryCase(c: Case, record: Record<string, unknown>): Promise<void> {
  expect(createHash("sha256").update(c.rawSource).digest("hex")).toBe(c.sha256);
  const doc = documentFor(c.rawSource, c.uri);
  const session = sessionOf(doc);
  expect(session.getSourceRevision()).toBe(c.sourceRevision);
  const diagnostics = session.diagnostics();
  record.diagnostics = diagnostics;
  expect(diagnostics).toEqual(expect.arrayContaining([expect.objectContaining(c.diagnostic)]));
  const plans = session.quickFixes(fingerprint(c));
  record.plans = plans;
  if (c.name === "apply-module") {
    const currentDefinition = currentCompiledSemanticSnapshotFor(session)!.compiled.moduleSemanticAnalysis!.definitions.find(d => d.name === "Pocket")!;
    expect(plans[0].kind === "typo-suggestion" && plans[0].candidate.identity).toBe(currentDefinition.statementId);
    record.offerDefinitionIdentity = currentDefinition.statementId;
  }
  expect(plans.map(p => p.edit)).toEqual(c.expectedEdits);
  for (const p of plans) {
    expect(p.sourceRevision).toBe(c.sourceRevision);
    expect(c.forbiddenCandidates).not.toContain(p.edit.newText);
    if (p.kind === "typo-suggestion" && ["binding", "geometry", "module"].includes(p.candidate.kind)) {
      expect(p.candidate.identity).toBeTruthy();
    }
  }
  assertControls(c);
  const actions = actionsFor(doc, fingerprint(c));
  expect(actions).toHaveLength(c.expectedEdits.length);
  if (c.preferred !== null) expect(actions.every(a => Boolean(a.isPreferred) === c.preferred)).toBe(true);
  record.actualApplies = [];
  // Every offered choice/category candidate is physically applied in a fresh document.
  for (const [i, action] of actions.entries()) {
    doc.setSource(c.rawSource);
    session.replaceSource(c.rawSource);
    const fresh = actionsFor(doc, fingerprint(c));
    const payload = payloadFor(fresh[i]);
    const before = mocks.applyEdit.mock.calls.length;
    await apply(payload);
    expect(mocks.applyEdit.mock.calls.length).toBe(before + 1);
    const expected = applyNormalized(c.rawSource, c.expectedEdits[i]);
    expect(doc.getText()).toBe(expected);
    session.replaceSource(doc.getText());
    expect(count(session, c.diagnostic.code)).toBe(c.afterTargetCount);
    const actualEdit = mocks.applyEdit.mock.calls.at(-1)![0] as { edits: Edit[] };
    expect(actualEdit.edits).toHaveLength(1);
    const edits = record.actualApplies as unknown[];
    edits.push({ edit: actualEdit.edits, rawAfter: doc.getText(), diagnosticsAfter: session.diagnostics() });
    if (c.name === "apply-module") {
      const semantic = session.runtimeEvaluationSnapshot()!.compiled.moduleSemanticAnalysis!;
      const definition = semantic.definitions.find(d => d.name === "Pocket")!;
      const instance = semantic.instances.find(d => d.name === "Use")!;
      expect(instance.callee?.definitionStatementId).toBe(definition.statementId);
      expect(instance.callee?.name).toBe("Pocket");
      expect(instance.parameterBindings).toHaveLength(1);
      record.resolvedIdentity = { definition: definition.statementId, callee: instance.callee, bindings: instance.parameterBindings };
    }
    if (c.name === "apply-choice-same-line") {
      const otherBefore = diagnostics.find(d => d.code === "invalid-choice-literal" && d.range.start.character > c.diagnostic.range.start.character)!;
      const delta = c.expectedEdits[i].newText.length - c.expectedEdits[i].expectedText.length;
      const remaining = session.diagnostics().find(d => d.code === "invalid-choice-literal")!;
      expect(remaining.range).toEqual({
        start: { line: otherBefore.range.start.line, character: otherBefore.range.start.character + delta },
        end: { line: otherBefore.range.end.line, character: otherBefore.range.end.character + delta }
      });
      expect(doc.getText().slice(offset(doc.getText(), remaining.range.start), offset(doc.getText(), remaining.range.end))).toBe("wrong");
    }
    if (c.name === "missing-type") {
      const e = c.expectedEdits[i];
      doc.setSource(applyNormalized(expected, { from: e.from + 2, to: e.from + 2, newText: "number" }));
      session.replaceSource(doc.getText());
      expect(session.diagnostics().filter(d => d.severity === "error")).toEqual([]);
    }
    if (c.name === "apply-skeleton-same-line") {
      const beforeOther = diagnostics.filter(d => d.code === "missing-declaration-initializer");
      expect(beforeOther).toHaveLength(1);
      expect(session.diagnostics().filter(d => d.code === "missing-declaration-initializer")).toEqual(beforeOther);
    }
    // The provider must reject the exact payload after the actual source/version changes.
    const after = mocks.applyEdit.mock.calls.length;
    await apply(payload);
    expect(mocks.applyEdit.mock.calls.length).toBe(after);
    // action itself is used only to ensure it really came from the production provider.
    expect(action.command?.command).toBe("nuinuiCAD.applyChoiceQuickFix");
  }
}

async function revisionCycle(c: Case): Promise<void> {
  const doc = documentFor(c.rawSource, c.uri + ".cycle.nui");
  const session = sessionOf(doc);
  const old = payloadFor(actionsFor(doc, fingerprint(c))[0]);
  doc.setSource(c.rawSource.replace("5", "6")); session.replaceSource(doc.getText());
  expect(session.getSourceRevision()).toBe(2);
  doc.setSource(c.rawSource); session.replaceSource(doc.getText());
  expect(doc.version).toBe(3); expect(session.getSourceRevision()).toBe(3);
  const before = mocks.applyEdit.mock.calls.length;
  await apply(old);
  expect(mocks.applyEdit.mock.calls.length).toBe(before);
  expect(doc.getText()).toBe(c.rawSource);
  const sourceRevisionOnly = { ...old, documentVersion: 3 };
  await apply(sourceRevisionOnly);
  expect(mocks.applyEdit.mock.calls.length).toBe(before);
  await apply(payloadFor(actionsFor(doc, fingerprint(c))[0]));
  expect(doc.getText()).toBe(applyNormalized(c.rawSource, c.expectedEdits[0]));
}

async function recovery(c: Case): Promise<void> {
  const data = c as Case & { validSource: string; incompleteSource: string };
  const doc = documentFor(data.validSource, c.uri + ".recover.nui");
  const session = sessionOf(doc);
  expect(count(session, c.diagnostic.code)).toBe(0);
  doc.setSource(data.incompleteSource); session.replaceSource(doc.getText());
  expect(session.getSourceRevision()).toBe(2);
  expect(session.diagnostics().some(d => d.severity === "error")).toBe(true);
  expect(session.quickFixes(fingerprint(c))).toEqual([]);
  doc.setSource(c.rawSource); session.replaceSource(doc.getText());
  expect(session.getSourceRevision()).toBe(3);
  expect(session.quickFixes(fingerprint(c)).map(p => p.edit)).toEqual(c.expectedEdits);
  await apply(payloadFor(actionsFor(doc, fingerprint(c))[0]));
  session.replaceSource(doc.getText());
  expect(session.getSourceRevision()).toBe(4);
  expect(doc.getText()).toBe(data.validSource);
  expect(session.diagnostics().filter(d => d.severity === "error")).toEqual([]);
}

async function routing(c: Case): Promise<void> {
  const a = documentFor(c.rawSource, c.uri + ".a.nui");
  const b = documentFor(c.rawSource, c.uri + ".b.nui");
  const session = sessionOf(a);
  const ds = session.diagnostics().filter(d => d.code === c.diagnostic.code);
  expect(ds).toHaveLength(2);
  const onlyLast = actionsFor(a, fingerprint(c));
  expect(onlyLast).toHaveLength(1);
  const payload = payloadFor(onlyLast[0]);
  const before = mocks.applyEdit.mock.calls.length;
  // Range of another real diagnostic with the original replacement range is rejected.
  const wrongDiagnostic = { ...payload, targetDiagnostic: ds[0] };
  await apply(wrongDiagnostic);
  expect(mocks.applyEdit.mock.calls.length).toBe(before);
  await apply({ ...payload, uri: b.uri.toString() });
  expect(mocks.applyEdit.mock.calls.length).toBe(before);
  expect(b.getText()).toBe(c.rawSource);
  await apply(payload);
  expect(a.getText()).toBe(applyNormalized(c.rawSource, c.expectedEdits[0]));
  expect(b.getText()).toBe(c.rawSource);
  const bActions = actionsFor(b, fingerprint(c));
  expect(payloadFor(bActions[0]).uri).toBe(b.uri.toString());
  // A closed URI cannot fall through to another open document with identical bytes.
  const closed = { ...payloadFor(bActions[0]), uri: "file:///tmp/issue1523/closed.nui" };
  const after = mocks.applyEdit.mock.calls.length;
  await apply(closed);
  expect(mocks.applyEdit.mock.calls.length).toBe(after);
}

async function rejections(c: Case): Promise<void> {
  const doc = documentFor(c.rawSource, c.uri + ".reject.nui");
  const original = payloadFor(actionsFor(doc, fingerprint(c))[0]);
  const patches: Array<(p: Record<string, unknown>) => void> = [
    p => { (p.targetDiagnostic as { source: string }).source = "other"; },
    p => { (p.targetDiagnostic as { code: string }).code = "unknown-type"; },
    p => { (p.targetDiagnostic as NuiQuickFixInput).range.start.character++; },
    p => { p.expectedTypedText = "changed"; },
    p => { (p.candidate as { label: string }).label = "notCanonical"; },
    p => { (p.candidate as { kind: string }).kind = "module"; },
    p => { (p.candidate as { identity: string }).identity = "wrong-owner"; },
    p => { p.replacementRange = { from: -1, to: 2 }; },
    p => { p.sourceRevision = 0; },
    p => { p.rawSource = "different"; }
  ];
  const before = mocks.applyEdit.mock.calls.length;
  for (const patch of patches) {
    const payload = structuredClone(original); patch(payload); await apply(payload);
    expect(doc.getText()).toBe(c.rawSource);
    expect(mocks.applyEdit.mock.calls.length).toBe(before);
  }
  for (const malformed of [null, {}, [], { candidate: null }, { ...original, candidate: null }]) await apply(malformed);
  expect(mocks.applyEdit.mock.calls.length).toBe(before);
  for (const p of patches.slice(0, 3)) {
    const invalid = structuredClone(fingerprint(c));
    p({ targetDiagnostic: invalid });
    expect(actionsFor(doc, invalid)).toEqual([]);
  }
  // Mutation after the handler's initial guard, during its real session lookup.
  const racingApply = createNuiChoiceQuickFixApplyHandler(nativeDoc => {
    const session = sessionFor(nativeDoc);
    doc.setSource(c.rawSource + "// intervening edit\n");
    return session;
  });
  await racingApply(original);
  expect(mocks.applyEdit.mock.calls.length).toBe(before);
}

function rustRoundtrip(c: Case, record: Record<string, unknown>): void {
  const fixed = (record.actualApplies as Array<{ rawAfter: string }>)[0].rawAfter;
  expect(fixed).toBe(applyNormalized(c.rawSource, c.expectedEdits[0]));
  const session = createNuiLanguageSession(fixed);
  const snapshot = session.runtimeEvaluationSnapshot();
  expect(snapshot).toBeTruthy();
  const compiled = snapshot!.compiled;
  const options = buildEvaluationOptions({ compiledDocument: compiled });
  const prepared = prepareRustEvaluation(compiled.document.elements, options);
  expect(prepared.rustEligible).toBe(true);
  execFileSync("cargo", ["build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], { timeout: 120000 });
  const response = execFileSync("rust-evaluator/target/debug/evaluation_stdio", [], {
    timeout: 15000, encoding: "utf8", input: JSON.stringify({ id: 1, input: prepared.input }) + "\n"
  });
  const envelope = JSON.parse(response.trim());
  expect(envelope.error).toBeUndefined();
  const result = evaluationPayloadToResult(envelope.payload as EvaluationPayload);
  record.rust = envelope.payload;
  expect(result.errors).toEqual([]);
  expect(result.computedGeometry.size).toBe(3);
  const geometry = [...result.computedGeometry.values()];
  expect(geometry.find(g => g.name === "A")).toMatchObject({ x: 0, y: 0 });
  expect(geometry.find(g => g.name === "B")).toMatchObject({ x: 3, y: 4 });
  expect(geometry.find(g => g.name === "Hypotenuse")).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 3, y: 4 }, length: 5 });
}

describe("#1523 frozen diagnostic-to-Quick-Fix conformance", () => {
  it.each(oracle.rows)("$id", async row => {
    const failures: string[] = [];
    for (const c of row.cases) {
      const record: Record<string, unknown> = { row: row.id, name: c.name };
      observations.push(record);
      try {
        await ordinaryCase(c, record);
        if (row.id === "R2") { await revisionCycle(c); record.revisions = { sequence: [1, 2, 3], hostVersions: [1, 2, 3], staleFirstARejected: true, sourceRevisionOnlyStalenessRejected: true, freshLastAApplied: true }; }
        if (row.id === "R3") { await recovery(c); record.recovery = { revisions: [1, 2, 3, 4], states: ["valid", "incomplete-no-stale-action", "current-typo", "valid-after-apply"] }; }
        if (row.id === "R4") { await routing(c); record.routing = { sameCodeDistinctRanges: true, wrongDiagnosticRejected: true, otherURIRejected: true, closedURIRejected: true, otherSourceUnchanged: true }; }
        if (row.id === "A4") { await rejections(c); record.rejections = { rejectedTamperedPayloads: 10, malformedPayloads: 5, invalidOfferFingerprints: 3, mutationDuringLookupRejected: true, duplicateAfterActualEditRejected: true }; }
        if (row.id === "A3") rustRoundtrip(c, record);
        if (row.id === "T4" && c.name === "module-callee") await importedModuleControls(record);
        record.status = "PASS";
      } catch (error) {
        record.status = "FAIL"; record.error = String(error);
        failures.push(`${c.name}: ${String(error)}`);
      }
    }
    expect(failures).toEqual([]);
  }, 150000);
});

async function importedModuleControls(record: Record<string, unknown>): Promise<void> {
  const rootId = documentIdFromHost("issue1523-root");
  const libId = documentIdFromHost("issue1523-library");
  const facadeId = documentIdFromHost("issue1523-facade");
  const compileImported = async (source: string) => {
    const graph = await buildMultiDocumentImportGraph({
      root: { kind: "root-current", documentId: rootId, normalizedSource: source, sourceRevision: 1 },
      loader: {
        async loadSavedDependency(_importer, path) {
          const library = path === "./library.nui";
          const normalizedSource = library ? moduleOracle.librarySaved : moduleOracle.facadeSaved;
          return { status: "loaded" as const, snapshot: {
            kind: "dependency-saved" as const, documentId: library ? libId : facadeId,
            savedSourceFingerprint: savedSourceFingerprintFromHost(createHash("sha256").update(normalizedSource).digest("hex")),
            normalizedSource
          } };
        }
      },
      declarationContributors: [moduleDeclarationContributor]
    });
    const analysis = analyzeMultiDocumentModuleSemantics(graph);
    const context = createModuleRuntimeContext(graph, analysis);
    const root = graph.nodes.get(rootId)!;
    const compiled = compileDslDocument(source, {
      preparsed: root.artifact.parsed, sourceRevision: 1,
      assignedStatementIds: root.artifact.statementIdByStatementIndex, moduleRuntimeContext: context
    });
    return { compiled, context, graph };
  };
  const evidence: unknown[] = [];
  record.imported = evidence;
  for (const c of moduleOracle.cases) {
    const { compiled, context } = await compileImported(c.source);
    const diagnostic = compiled.diagnostics.find(d => d.code === c.diagnostic.code)!;
    expect(diagnostic).toBeTruthy();
    expect(toNuiDiagnostic(c.source, diagnostic)).toMatchObject(c.diagnostic);
    expect(context.valid).toBe(false);
    const result = queryDslTypoSuggestions({
      source: { normalizedSource: c.source, sourceRevision: 1 }, diagnostic,
      semantic: { sourceRevision: 1, compiled }
    });
    expect(result?.candidates ?? []).toEqual(c.expectedQuickFixes);
    const positive = await compileImported(c.positiveSource);
    expect(positive.context.valid).toBe(true);
    expect(positive.compiled.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    const at = c.positiveSource.indexOf("Pocket(width:") + "Pocket".length;
    const completion = queryDslCompletion({
      source: { normalizedSource: c.positiveSource, sourceRevision: 1 }, position: at,
      semantic: { sourceRevision: 1, compiled: positive.compiled }
    });
    const definition = positive.context.analysisFor(libId)!.definitions.find(d => d.name === "Pocket")!;
    const modules = completion!.candidates.filter(d => d.kind === "module");
    expect(modules.map(d => d.label)).toEqual(c.expectedPublic);
    expect(modules[0].identity).toBe(moduleSemanticIdentityKey(definition.identity!));
    expect(positive.graph.nodes.get(libId)!.artifact.source.normalizedSource).toBe(moduleOracle.librarySaved);
    expect(positive.graph.nodes.get(libId)!.publicApi.publicEntriesByName.has("Secret")).toBe(false);
    expect(modules.map(d => d.label)).not.toContain("DirtyOnly");
    evidence.push({ name: c.name, disposition: c.disposition, diagnostic: toNuiDiagnostic(c.source, diagnostic), result, positiveCandidates: modules, savedSource: positive.graph.nodes.get(libId)!.artifact.source });
  }
  const shadow = createNuiLanguageSession(moduleOracle.shadowSource);
  const d = shadow.diagnostics().find(d => d.code === moduleOracle.shadowCode)!;
  expect(d).toBeTruthy();
  expect(shadow.quickFixes(d as NuiQuickFixInput)).toEqual([]);
  const unshadowed = createNuiLanguageSession(moduleOracle.shadowPositiveSource);
  const good = unshadowed.diagnostics().find(d => d.code === moduleOracle.shadowCode)!;
  expect(unshadowed.quickFixes(good as NuiQuickFixInput).map(p => p.edit.newText)).toEqual(moduleOracle.shadowPositiveCandidates);
  evidence.push({ shadowing: "PASS", forbidden: moduleOracle.shadowForbiddenCandidates });
}
