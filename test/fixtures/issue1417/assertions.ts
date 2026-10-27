import { expect } from "vitest";
import type { TextCompileResult } from "@nuinuicad/nui-language/document";
import type { ScalarProgramCollection, TypedScalarExpression } from "@nuinuicad/nui-language";
import type { EvaluateDocumentInput } from "../../../src/geometry/rustEvaluationInput";
import { evaluationPayloadToResult, type EvaluationPayload } from "../../../src/geometry/evaluationPayload";
import { jsonValue, oracle, type Declaration, type Expr, type Program, type Value } from "./model";

const sorted = (s: Iterable<string>) => [...new Set(s)].sort();
const scalarDeclarations = (p: Program) => [...p.roots, ...p.outputs, ...(p.loop?.body ?? [])].filter(d => !d.type.endsWith("[]"));

export function checkCompiler(p: Program, compiled: TextCompileResult, input: EvaluateDocumentInput) {
  const doc = compiled.doc, analysis = doc.bindingAnalysis!;
  expect(analysis.issues).toEqual([]);
  expect(doc.typedDependencyGraph!.cycles).toEqual([]);
  const identities = new Map<string, string>(), collections = new Map<string, string>(), mapBinders: string[] = [];
  const names = new Map(analysis.catalog.bindings.map(b => [b.id, b.name]));
  for (const name of [...scalarDeclarations(p).map(d => d.name), ...(p.loop?.carries.map(c => c.name) ?? []), ...(p.loop ? [p.loop.binder] : [])]) {
    const matches = analysis.catalog.bindings.filter(b => b.name === name);
    expect(matches, `canonical binding ${name}`).toHaveLength(1);
    identities.set(name, matches[0].id);
  }
  for (const d of p.roots.filter(d => d.type.endsWith("[]"))) {
    const indices = doc.statements.flatMap((s, i) => s.kind === "typedDeclaration" && s.name === d.name ? [i] : []);
    expect(indices, `collection owner ${d.name}`).toHaveLength(1);
    const id = doc.statementMap.statementIdByStatementIndex!.get(indices[0])!;
    expect(id).toBeDefined(); collections.set(d.name, id);
  }
  const collectionNames = new Map([...collections].map(([name, id]) => [id, name]));
  const project = (e: TypedScalarExpression): Expr => {
    switch (e.kind) {
      case "numberLiteral": case "booleanLiteral": return e.value;
      case "choiceLiteral": expect(e.type).toEqual({ kind: "choice", options: ["left", "right"] }); return { choice: e.value };
      case "group": return project(e.expression);
      case "unary": {
        const operand = project(e.operand);
        if (typeof operand !== "number" || !["+", "-"].includes(e.operator)) throw new Error("unexpected generator unary");
        return e.operator === "-" ? -operand : operand;
      }
      case "reference": {
        const name = names.get(e.bindingId!);
        if (!name) throw new Error(`unresolved compiler target ${e.bindingId}`);
        return { ref: name };
      }
      case "binary": return { op: e.operator as Extract<Expr, { op: string }>["op"], left: project(e.left), right: project(e.right) };
      case "valueIf": return { kind: "if", condition: project(e.condition), yes: project(e.thenBranch), no: project(e.elseBranch) };
      case "valueMatch": {
        expect(e.scrutinee.type).toEqual({ kind: "choice", options: ["left", "right"] });
        expect(e.arms.map(a => a.label).sort()).toEqual(["left", "right"]);
        return { kind: "match", selector: project(e.scrutinee), left: project(e.arms.find(a => a.label === "left")!.expression), right: project(e.arms.find(a => a.label === "right")!.expression) };
      }
      case "collectionIndex": {
        const source = collectionNames.get(e.collectionValueId!);
        if (!source) throw new Error(`unknown index owner ${e.collectionValueId}`);
        return { kind: "index", source, index: project(e.index) as number };
      }
      case "geometryProperty": {
        expect(e.property).toBe("length");
        const source = collectionNames.get(e.collectionValueId!);
        if (!source) throw new Error(`unknown length owner ${e.collectionValueId}`);
        return { kind: "length", source };
      }
      default: throw new Error(`unexpected generator AST ${e.kind}`);
    }
  };
  const checkScalar = (d: Declaration) => {
    const id = identities.get(d.name)!;
    const source = doc.scalarProgram!.statements.find(s => s.bindingId === id)!;
    expect(source, `canonical initializer ${d.name}`).toBeDefined();
    expect(project(source.declaration.initializer), d.name).toEqual(d.expression);
    const wire = input.bindingVersions?.versions.find(v => v.bindingId === id)?.initializer
      ?? input.scalarProgram?.statements.find(s => s.bindingId === id)?.declaration.initializer;
    expect(wire, `production initializer ${d.name}`).toBeDefined();
    expect(project(wire as TypedScalarExpression), `production ${d.name}`).toEqual(d.expression);
    const expected = sorted(references(d.expression));
    const resolved = analysis.initializerReferences.filter(r => r.fromBindingId === id).map(r => {
      expect(r.resolution.kind).toBe("resolved");
      return r.resolution.kind === "resolved" ? names.get(r.resolution.binding.id)! : "unresolved";
    });
    expect(sorted(resolved), `lexical references ${d.name}`).toEqual(expected);
    // The ordinary binding graph contains unconditional prerequisites only;
    // lazy branch dependencies belong to the guarded typed graph below.
    expect(sorted((analysis.graph.edgesByFromBindingId.get(id) ?? []).map(e => names.get(e.toBindingId)!)), `binding graph ${d.name}`).toEqual(sorted(requiredReferences(d.expression)));
  };
  for (const d of scalarDeclarations(p)) checkScalar(d);

  const sourceCollections = doc.scalarProgram?.collectionValues ?? [];
  const wireCollections = input.bindingVersions?.collectionValues ?? input.scalarProgram?.collectionValues ?? [];
  const projectCollection = (d: Declaration, all: readonly ScalarProgramCollection[]) => {
    const node = all.find(v => v.valueId === collections.get(d.name));
    expect(node, `collection descriptor ${d.name}`).toBeDefined();
    const e = d.expression;
    if (typeof e !== "object") throw new Error("bad model collection");
    if ("ref" in e) { expect(node).toMatchObject({ kind: "alias", targetValueId: collections.get(e.ref) }); return; }
    if (!("kind" in e)) throw new Error("bad model collection shape");
    if (e.kind === "array") {
      expect(node?.kind).toBe("literal");
      if (node?.kind !== "literal") throw new Error("missing literal");
      expect(node.members.map(m => {
        if (m.kind === "binding") return { ref: names.get(m.bindingId)! };
        if (m.kind !== "literal") throw new Error("unexpected literal member");
        if (m.value.kind === "number") return m.value.value;
        if (m.value.kind === "choice") return { choice: m.value.value };
        throw new Error("unexpected generated member type");
      })).toEqual(e.members);
    } else if (e.kind === "map") {
      expect(node?.kind).toBe("map");
      if (node?.kind !== "map") throw new Error("missing map");
      const binder = analysis.catalog.bindingsById.get(node.binderId)!;
      expect(binder).toMatchObject({ name: e.binder, resolutionMode: "preResolvedOnly", declaredType: { kind: "number" } });
      // Analysis-only map binders share the declaration's catalog scope, but
      // preResolvedOnly excludes them from surrounding source-name lookup.
      expect(doc.statementMap.statementIdByStatementIndex!.get(binder.statementIndex)).toBe(collections.get(d.name));
      expect(node.sourceValueId, `map source ${d.name}`).toBe(collections.get(e.source));
      expect(node.sourceElementType).toEqual({ kind: "number" }); expect(node.resultElementType).toEqual({ kind: "number" });
      expect(project(node.body), `map lexical body ${d.name}`).toEqual(e.body);
      expect(doc.bindingVersions?.versions.some(v => v.bindingId === node.binderId)).toBe(false);
      expect(input.bindingVersions?.versions.some(v => v.bindingId === node.binderId) ?? false).toBe(false);
      mapBinders.push(node.binderId);
    } else throw new Error("unexpected generated collection");
  };
  for (const d of p.roots.filter(d => d.type.endsWith("[]"))) {
    projectCollection(d, sourceCollections); projectCollection(d, wireCollections);
  }
  if (p.loop) {
    const plans = [...doc.bindingVersions!.immutableForGroups!.values()];
    expect(plans).toHaveLength(1);
    const plan = plans[0], wire = input.bindingVersions!.immutableForGroups!;
    expect(wire).toHaveLength(1);
    const owners = input.bindingVersions!.forGroupOwners;
    expect(owners).toHaveLength(1);
    expect(owners[0].ownerStatementId).toBe(plan.ownerStatementId);
    expect(owners[0].iterationBindingId).toBe(identities.get(p.loop.binder));
    expect(plan.executionOwner?.iterationBindingId).toBe(identities.get(p.loop.binder));
    const binder = analysis.catalog.bindingsById.get(identities.get(p.loop.binder)!)!;
    expect(binder.kind).toBe("iteration");
    expect(binder.effectiveScopeId).toBe(owners[0].scopeId);
    expect(binder.declaredType).toEqual(p.roots.find(d => d.type === "choice(left, right)[]") ? { kind: "choice", options: ["left", "right"] } : { kind: "number" });
    const loopElement = doc.document.elements.find(e => e.id === owners[0].elementId)!;
    expect(loopElement.type).toBe("forGroup");
    if (loopElement.type === "forGroup" && "collection" in p.loop.source) expect(loopElement.iterationSourceValueId).toBe(collections.get(p.loop.source.collection));
    for (const model of p.loop.carries) {
      const carry = plan.carries.find(c => c.bindingId === identities.get(model.name))!;
      expect(carry, `carry owner ${model.name}`).toBeDefined();
      expect(project(carry.initializer)).toEqual(model.initial);
      expect(project(carry.nextExpression)).toEqual(model.next);
      expect(carry.declaredType).toEqual({ kind: "number" });
      const next = analysis.catalog.bindingsById.get(carry.nextBindingId!)!;
      expect(next.name).toBe(`${model.name}:next`);
      expect(next.effectiveScopeId).toBe(binder.effectiveScopeId);
      const transmitted = wire[0].carries.find(c => c.bindingId === carry.bindingId)!;
      expect(project(transmitted.initializer as TypedScalarExpression)).toEqual(model.initial);
      expect(project(transmitted.nextExpression as TypedScalarExpression)).toEqual(model.next);
      const expected = sorted(requiredReferences(model.next));
      expect(sorted((analysis.graph.edgesByFromBindingId.get(carry.nextBindingId!) ?? []).map(e => names.get(e.toBindingId)!)), `next dependency ${model.name}`).toEqual(expected);
    }
    for (const d of p.loop.body) {
      const version = doc.bindingVersions!.versions.find(v => v.bindingId === identities.get(d.name))!;
      expect(version.control.ownerChain.at(-1)).toMatchObject({ kind: "forGroup", ownerStatementId: plan.ownerStatementId, scopeId: owners[0].scopeId });
    }
  }
  // Conditional dependencies must retain their guards on the canonical graph
  // AND on the production wire. A shared eager dependency bug cannot be hidden
  // by correct-looking final values alone.
  if (!p.loop) for (const d of p.outputs.filter(d => typeof d.expression === "object" && "kind" in d.expression && ["if", "match"].includes(d.expression.kind))) {
    const expected = sorted(guardedReferences(d.expression));
    for (const edges of [doc.typedDependencyGraph!.edges, input.scalarExpressionPayload!.conditionalDependencyGraph!.edges]) {
      const projected = edges.filter(e => e.kind === "initializer" && e.from.kind === "binding" && e.from.id === identities.get(d.name)).map(e => {
        expect(e.reason).toBeUndefined(); expect(e.to.kind).toBe("binding");
        return `${names.get(e.to.id)}:${e.requiredness}:${e.activation?.guards.map(g => g.branch).join("/") ?? ""}`;
      });
      expect(sorted(projected), `conditional graph ${d.name}`).toEqual(expected);
    }
  }
  return { identities, mapBinders: sorted(mapBinders) };
}

function references(e: Expr): string[] {
  if (typeof e !== "object") return [];
  if ("ref" in e) return [e.ref];
  if ("op" in e) return [...references(e.left), ...references(e.right)];
  if (!("kind" in e)) return [];
  if (e.kind === "if") return [...references(e.condition), ...references(e.yes), ...references(e.no)];
  if (e.kind === "match") return [...references(e.selector), ...references(e.left), ...references(e.right)];
  return [];
}
function guardedReferences(e: Expr): string[] {
  if (typeof e !== "object" || !("kind" in e)) return references(e).map(n => `${n}:required:`);
  if (e.kind === "if") return [...references(e.condition).map(n => `${n}:required:`), ...references(e.yes).map(n => `${n}:conditional:then`), ...references(e.no).map(n => `${n}:conditional:else`)];
  if (e.kind === "match") return [...references(e.selector).map(n => `${n}:required:`), ...references(e.left).map(n => `${n}:conditional:match:left`), ...references(e.right).map(n => `${n}:conditional:match:right`)];
  return [];
}
function requiredReferences(e: Expr): string[] {
  if (typeof e === "object" && "kind" in e) {
    if (e.kind === "if") return references(e.condition);
    if (e.kind === "match") return references(e.selector);
  }
  return references(e);
}

const expectedScalar = (value: Value) => {
  const kind = typeof value === "bigint" ? "number" : typeof value === "boolean" ? "boolean" : "choice";
  const type = kind === "choice" ? { kind, options: ["left", "right"] } : { kind };
  return { status: "ok", type, value: { ...type, value: jsonValue(value) } };
};
export function checkValues(p: Program, compiler: ReturnType<typeof checkCompiler>, payload: EvaluationPayload) {
  const result = evaluationPayloadToResult(payload), model = oracle(p);
  expect(result.errors).toEqual([]); expect(payload.geometryValueErrors ?? []).toEqual([]);
  for (const [name, value] of model.values) {
    // Collections have no public whole-value scalar payload. Their complete
    // lengths/members are materialized by generated scalar output declarations.
    if (!Array.isArray(value)) expect(result.computedScalarBindings?.get(compiler.identities.get(name)!), `full value ${name}`).toEqual(expectedScalar(value));
  }
  for (const binder of compiler.mapBinders) {
    expect(result.computedScalarBindings?.has(binder) ?? false).toBe(false);
    expect([...(result.computedScalarBindingVersions?.values() ?? [])].some(h => h.bindingId === binder)).toBe(false);
  }
  if (p.loop) for (const d of p.loop.body) {
    const history = [...(result.computedScalarBindingVersions?.values() ?? [])].filter(h => h.bindingId === compiler.identities.get(d.name));
    const last = model.trace.at(-1);
    if (!last) expect(history.filter(h => h.status === "executed" || h.status === "poisoned")).toEqual([]);
    else { expect(history).toHaveLength(1); expect(history[0]).toMatchObject({ status: "executed", evaluation: expectedScalar(last.body.get(d.name)!) }); }
  }
  return p.observations.map(n => jsonValue(model.values.get(n)!));
}

export function checkError(p: Program, compiler: ReturnType<typeof checkCompiler>, payload: EvaluationPayload, binding: string) {
  const result = evaluationPayloadToResult(payload);
  expect(result.computedScalarBindings?.get(compiler.identities.get(binding)!)).toMatchObject({ status: "error", issueCode: "evaluation-divide-by-zero" });
  expect(result.computedScalarBindings?.get(compiler.identities.get("result")!)).toMatchObject({ status: "error", issueCode: "evaluation-divide-by-zero" });
  // The runtime error belongs to the selected numeric owner, not a prerequisite
  // or a synthetic value-for binder. Independent good prerequisites still hold.
  for (const d of p.roots.filter(d => d.type === "number")) {
    const expected = oracle({ ...p, loop: undefined, outputs: [] }).values.get(d.name)!;
    expect(result.computedScalarBindings?.get(compiler.identities.get(d.name)!)).toEqual(expectedScalar(expected));
  }
}
