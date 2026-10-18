import { expect } from "vitest";
import type { TextCompileResult } from "@nuinuicad/nui-language/document";
import { moduleScalarBindingIdFor } from "../../../../packages/nui-language/src/scalars/moduleScalarRuntime";
import type { TypedScalarExpression } from "../../../../packages/nui-language/src/scalars/typedExpressionAst";
import type { EvaluateDocumentInput } from "../../../../src/geometry/rustEvaluationInput";
import { evaluationPayloadToResult, type EvaluationPayload } from "../../../../src/geometry/evaluationPayload";
import { modelNodes, oracle, references, type Expression, type Program } from "./model";

const sorted = (values: Iterable<string>) => [...new Set(values)].sort();

// Compare resolved compiler products to MODEL relationships, never source IDs
// across compilations, or a name lookup reconstructed from generated DSL text.
export function checkCompiler(program: Program, compiled: TextCompileResult, input: EvaluateDocumentInput) {
  const doc = compiled.doc, analysis = doc.bindingAnalysis!;
  expect(analysis.issues).toEqual([]);
  expect(doc.typedDependencyGraph!.cycles).toEqual([]);
  const bindings = analysis.catalog.bindings;
  const identities = new Map<string, string>();
  for (const root of program.roots) {
    const matches = bindings.filter(b => b.kind === "typed" && b.name === root.name && b.resolutionMode === "sourceLookup");
    expect(matches, `root ${root.name}`).toHaveLength(1);
    identities.set(root.name, matches[0].id);
  }
  if (program.module) {
    const module = program.module;
    const semantic = doc.moduleSemanticAnalysis!;
    const definition = semantic.definitions.find(d => d.name === module.name)!;
    expect(definition.parameters.map(p => p.name)).toEqual(["x"]);
    expect(definition.exports.map(e => e.name)).toEqual(["value"]);
    expect(semantic.instances).toHaveLength(module.instances.length);
    const paths: string[] = [];
    for (const instance of module.instances) {
      const call = semantic.instances.find(i => i.name === instance.name)!;
      expect(call.calleeResolution).toBe("resolved");
      expect(call.callee?.definitionStatementId).toBe(definition.statementId);
      const element = doc.document.elements.find(e => e.type === "moduleInstance" && e.name === instance.name)!;
      expect(element).toBeDefined();
      const snapshot = input.moduleMaterialization!.instances.find(i => i.instanceId === element.id)!;
      expect(snapshot.instancePath).toEqual([call.statementId]);
      paths.push(JSON.stringify(snapshot.instancePath));
      for (const local of module.locals) {
        const source = definition.localScalars.find(s => s.name === local.name)!;
        const id = moduleScalarBindingIdFor(snapshot.instancePath!, definition.statementId, source.statementId);
        expect(bindings.some(b => b.id === id)).toBe(true);
        identities.set(`${instance.name}::${local.name}`, id);
        // Source Module resolution is checked independently of runtime lowering.
        expect(source.initializer!.references.map(r => r.name).sort()).toEqual(references(local.expression).sort());
        for (const reference of source.initializer!.references) {
          expect(reference.resolution).toBe("resolved");
          const target = reference.target!;
          if (reference.name === "x") expect(target).toMatchObject({ kind: "parameter", definitionStatementId: definition.statementId, parameterIndex: 0 });
          else expect(target).toMatchObject({ kind: "moduleLocal", statementId: definition.localScalars.find(s => s.name === reference.name)!.statementId });
        }
      }
      const localBinding = analysis.catalog.bindingsById.get(identities.get(`${instance.name}::value`)!)!;
      const parameters = bindings.filter(b => b.name === "x" && b.effectiveScopeId === localBinding.effectiveScopeId);
      expect(parameters).toHaveLength(1);
      identities.set(`${instance.name}::x`, parameters[0].id);
    }
    expect(new Set(paths).size).toBe(module.instances.length);
  }
  expect(new Set(identities.values()).size).toBe(identities.size);
  const names = new Map([...identities].map(([name, id]) => [id, name]));
  const nodes = modelNodes(program);
  const project = (expression: TypedScalarExpression): Expression => {
    switch (expression.kind) {
      case "numberLiteral": return expression.value;
      case "group": return project(expression.expression);
      case "unary": {
        const operand = project(expression.operand);
        if (typeof operand !== "number" || !["+", "-"].includes(expression.operator)) throw new Error("unexpected model unary");
        return expression.operator === "-" ? -operand : operand;
      }
      case "reference": {
        const name = names.get(expression.bindingId!);
        if (!name) throw new Error(`unknown resolved binding ${expression.bindingId}`);
        return name;
      }
      case "binary": {
        if (!["+", "-", "*"].includes(expression.operator)) throw new Error("unexpected model operator");
        return { op: expression.operator as "+" | "-" | "*", left: project(expression.left), right: project(expression.right) };
      }
      default: throw new Error(`unexpected model expression ${expression.kind}`);
    }
  };
  for (const [name, expression] of nodes) {
    const id = identities.get(name)!;
    const compiledExpression = doc.scalarProgram!.statements.find(s => s.bindingId === id)!.declaration.initializer;
    expect(project(compiledExpression), `resolved initializer ${name}`).toEqual(expression);
    const version = input.bindingVersions!.versions.find(v => v.bindingId === id)!;
    expect(project(version.initializer!), `wire initializer ${name}`).toEqual(expression);
    const expected = sorted(references(expression));
    const resolution = analysis.initializerReferences.filter(r => r.fromBindingId === id).map(r => {
      expect(r.resolution.kind).toBe("resolved");
      return r.resolution.kind === "resolved" ? names.get(r.resolution.binding.id)! : "unresolved";
    });
    expect(sorted(resolution), `semantic references ${name}`).toEqual(expected);
    const graph = analysis.graph.edgesByFromBindingId.get(id) ?? [];
    expect(sorted(graph.map(e => names.get(e.toBindingId)!)), `binding graph ${name}`).toEqual(expected);
    for (const edges of [doc.typedDependencyGraph!.edges, input.scalarExpressionPayload!.conditionalDependencyGraph!.edges]) {
      const targets = edges.filter(e => e.kind === "initializer" && e.from.kind === "binding" && e.from.id === id);
      expect(targets.every(e => e.to.kind === "binding" && e.requiredness === "required" && !e.reason)).toBe(true);
      expect(sorted(targets.map(e => names.get(e.to.id)!)), `typed dependency projection ${name}`).toEqual(expected);
    }
  }
  return identities;
}

export function checkValues(program: Program, identities: Map<string, string>, payload: EvaluationPayload) {
  const result = evaluationPayloadToResult(payload);
  expect(result.errors).toEqual([]);
  expect(payload.geometryValueErrors ?? []).toEqual([]);
  const expected = oracle(program);
  // Check every model binding, including BOTH asymmetric instance exports and
  // their parameters, rather than an aggregate that could conceal a swap.
  for (const [name, value] of expected) {
    expect(result.computedScalarBindings?.get(identities.get(name)!), name).toEqual({ status: "ok", value: { kind: "number", value } });
  }
  return program.observations.map(name => expected.get(name)!);
}
