from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, text: str) -> None:
    Path(path).write_text(text)


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one occurrence, found {count}: {old[:80]!r}")
    write(path, text.replace(old, new, 1))


# TypeScript expression evaluator: observe only nodes the existing evaluator reaches.
replace_once(
    "src/scalars/expressionEvaluator.ts",
    "  lookupGeometryTarget?: (target: ScalarExpressionResolvedGeometryTarget) => GeometryBuiltinTargetLookupResult | undefined;\n\n}",
    "  lookupGeometryTarget?: (target: ScalarExpressionResolvedGeometryTarget) => GeometryBuiltinTargetLookupResult | undefined;\n\n"
    "  /** Optional inspection hook. Called once after each expression node actually reached by production evaluation. */\n"
    "  onExpressionEvaluated?: (node: TypedScalarExpression, evaluation: ScalarEvaluation) => void;\n\n}"
)
replace_once(
    "src/scalars/expressionEvaluator.ts",
    "export const evaluateTypedExpression = (\n  node: TypedScalarExpression,\n  environment: ScalarEvaluationEnvironment\n): ScalarEvaluation => {",
    "const evaluateTypedExpressionNode = (\n  node: TypedScalarExpression,\n  environment: ScalarEvaluationEnvironment\n): ScalarEvaluation => {"
)
text = read("src/scalars/expressionEvaluator.ts")
if "const evaluateTypedExpressionNode" not in text or "onExpressionEvaluated?.(node" in text:
    raise SystemExit("expression evaluator wrapper precondition failed")
text += "\n\nexport const evaluateTypedExpression = (\n  node: TypedScalarExpression,\n  environment: ScalarEvaluationEnvironment\n): ScalarEvaluation => {\n  const evaluation = evaluateTypedExpressionNode(node, environment);\n  environment.onExpressionEvaluated?.(node, evaluation);\n  return evaluation;\n};\n"
write("src/scalars/expressionEvaluator.ts", text)

# TypeScript control runtime: add a trace-producing condition resolver while preserving legacy branch-only API.
replace_once(
    "src/geometry/controlBooleanRuntime.ts",
    "import { evaluateTypedExpression } from \"../scalars/expressionEvaluator\";",
    "import { evaluateTypedExpression } from \"../scalars/expressionEvaluator\";\n"
    "import { evaluateConditionExpressionWithTrace, type ConditionEvaluationTrace } from \"../scalars/conditionEvaluationTrace\";"
)
insert = '''\nexport type ResolvedConditionalGroupCondition = {\n  activeBranch: "then" | "else" | null;\n  trace: ConditionEvaluationTrace;\n};\n\nconst activeBranchForConditionEvaluation = (evaluation: ScalarEvaluation): "then" | "else" | null => {\n  if (evaluation.status !== "ok" || evaluation.type.kind !== "boolean" || evaluation.value.kind !== "boolean") return null;\n  return evaluation.value.value ? "then" : "else";\n};\n\n/** Evaluates a typed condition exactly once and returns both branch state and exact reached-node trace. */\nexport const resolveConditionalGroupCondition = (\n  expression: TypedScalarExpression,\n  resolveBinding: ControlBooleanResolveFn,\n  resolveGeometryProperty?: ControlBooleanGeometryResolveFn\n): ResolvedConditionalGroupCondition => {\n  const { evaluation, trace } = evaluateConditionExpressionWithTrace(expression, {\n    lookupBinding: resolveBinding,\n    ...(resolveGeometryProperty ? { lookupGeometryProperty: resolveGeometryProperty } : {})\n  });\n  return { activeBranch: activeBranchForConditionEvaluation(evaluation), trace };\n};\n'''
replace_once(
    "src/geometry/controlBooleanRuntime.ts",
    "/**\n * A `conditionalGroup`'s active branch from its typed boolean condition:",
    insert + "\n/**\n * A `conditionalGroup`'s active branch from its typed boolean condition:"
)
replace_once(
    "src/geometry/controlBooleanRuntime.ts",
    "  if (evaluation.status !== \"ok\" || evaluation.type.kind !== \"boolean\") return null;\n  return evaluation.value.value ? \"then\" : \"else\";",
    "  return activeBranchForConditionEvaluation(evaluation);"
)

# Shared EvaluationResult exposes exact-current traces keyed by runtime conditionalGroup id.
replace_once(
    "src/types/geometry.ts",
    "import type { ScalarEvaluation } from \"../scalars/types\";",
    "import type { ScalarEvaluation } from \"../scalars/types\";\n"
    "import type { ConditionEvaluationTrace } from \"../scalars/conditionEvaluationTrace\";"
)
replace_once(
    "src/types/geometry.ts",
    "  conditionInactiveElementIds?: Set<ElementId>;",
    "  conditionInactiveElementIds?: Set<ElementId>;\n"
    "  /** Exact reached-node trace for each typed conditionalGroup evaluated in this runtime revision. */\n"
    "  conditionEvaluationTraces?: ReadonlyMap<ElementId, ConditionEvaluationTrace>;"
)

# TypeScript document evaluator records the trace at the same point it decides the active branch.
replace_once(
    "src/geometry/evaluate.ts",
    "  resolveConditionalGroupBranch,\n  resolveForGroupEffectiveShowGenerated",
    "  resolveConditionalGroupBranch,\n  resolveConditionalGroupCondition,\n  resolveForGroupEffectiveShowGenerated"
)
replace_once(
    "src/geometry/evaluate.ts",
    "import type { TypedScalarExpression } from \"../scalars/typedExpressionAst\";",
    "import type { TypedScalarExpression } from \"../scalars/typedExpressionAst\";\n"
    "import type { ConditionEvaluationTrace } from \"../scalars/conditionEvaluationTrace\";"
)
replace_once(
    "src/geometry/evaluate.ts",
    "  const conditionInactiveElementIds = new Set<ElementId>();",
    "  const conditionInactiveElementIds = new Set<ElementId>();\n"
    "  const conditionEvaluationTraces = new Map<ElementId, ConditionEvaluationTrace>();"
)
old_condition = '''      const typedCondition = conditionalGroupConditionsByElementId?.get((sourceElement ?? element).id);\n      const activeBranch = typedCondition\n        ? resolveConditionalGroupBranch(\n            typedCondition,\n            scalarBindingResolver!.resolveBinding,\n            resolveScalarGeometryProperty\n          )\n        : (() => {\n            const conditionValue = numericError(\n              element,\n              element.condition,\n              computedGeometry,\n              runtimeElementsById,\n              errors,\n              localVariables.localVariableValues,\n              localVariables.localVariableNames,\n              disabledByGroupId,\n              runtimeElements\n            );\n            return conditionValue === undefined ? null : conditionValue === 0 ? "else" : "then";\n          })();'''
new_condition = '''      const typedCondition = conditionalGroupConditionsByElementId?.get((sourceElement ?? element).id);\n      const resolvedTypedCondition = typedCondition\n        ? resolveConditionalGroupCondition(\n            typedCondition,\n            scalarBindingResolver!.resolveBinding,\n            resolveScalarGeometryProperty\n          )\n        : undefined;\n      if (resolvedTypedCondition) conditionEvaluationTraces.set(element.id, resolvedTypedCondition.trace);\n      const activeBranch = resolvedTypedCondition\n        ? resolvedTypedCondition.activeBranch\n        : (() => {\n            const conditionValue = numericError(\n              element,\n              element.condition,\n              computedGeometry,\n              runtimeElementsById,\n              errors,\n              localVariables.localVariableValues,\n              localVariables.localVariableNames,\n              disabledByGroupId,\n              runtimeElements\n            );\n            return conditionValue === undefined ? null : conditionValue === 0 ? "else" : "then";\n          })();'''
replace_once("src/geometry/evaluate.ts", old_condition, new_condition)
replace_once(
    "src/geometry/evaluate.ts",
    "    conditionInactiveElementIds,\n    forGroupGeneratedRows,",
    "    conditionInactiveElementIds,\n    conditionEvaluationTraces,\n    forGroupGeneratedRows,"
)
# Remove now-unused branch-only import from evaluate.ts.
replace_once(
    "src/geometry/evaluate.ts",
    "  resolveConditionalGroupBranch,\n  resolveConditionalGroupCondition,",
    "  resolveConditionalGroupCondition,"
)

# TS payload conversion/validation.
replace_once(
    "src/geometry/evaluationPayload.ts",
    "import { parseScalarEvaluationJson } from \"../scalars/scalarJson\";",
    "import { parseScalarEvaluationJson } from \"../scalars/scalarJson\";\n"
    "import { parseConditionEvaluationTraceJson, type ConditionEvaluationTrace } from \"../scalars/conditionEvaluationTrace\";"
)
helper = '''\nconst parseConditionEvaluationTraces = (value: unknown): Map<ElementId, ConditionEvaluationTrace> => {\n  if (!Array.isArray(value)) return failScalarOutput("conditionEvaluationTraces must be an array");\n  const traces = new Map<ElementId, ConditionEvaluationTrace>();\n  for (const [index, entry] of value.entries()) {\n    if (!isPlainObject(entry) || Object.keys(entry).length !== 2 || !("elementId" in entry) || !("trace" in entry)) {\n      return failScalarOutput(`conditionEvaluationTraces entry at index ${index} must contain only elementId && trace`);\n    }\n    if (typeof entry.elementId !== "string" || entry.elementId.length === 0) {\n      return failScalarOutput(`conditionEvaluationTraces entry at index ${index} has an invalid elementId`);\n    }\n    if (traces.has(entry.elementId)) {\n      return failScalarOutput(`conditionEvaluationTraces duplicates elementId ${entry.elementId}`);\n    }\n    try {\n      traces.set(entry.elementId, parseConditionEvaluationTraceJson(entry.trace));\n    } catch (error) {\n      return failScalarOutput(`conditionEvaluationTraces entry at index ${index} has an invalid trace: ${error instanceof Error ? error.message : String(error)}`);\n    }\n  }\n  return traces;\n};\n'''
replace_once(
    "src/geometry/evaluationPayload.ts",
    "export type EvaluationPayload = {",
    helper + "\nexport type EvaluationPayload = {"
)
replace_once(
    "src/geometry/evaluationPayload.ts",
    "  conditionInactiveElementIds?: ElementId[];",
    "  conditionInactiveElementIds?: ElementId[];\n"
    "  conditionEvaluationTraces?: Array<{ elementId: ElementId; trace: ConditionEvaluationTrace }>;"
)
replace_once(
    "src/geometry/evaluationPayload.ts",
    "  conditionInactiveElementIds: Array.from(result.conditionInactiveElementIds ?? []),",
    "  conditionInactiveElementIds: Array.from(result.conditionInactiveElementIds ?? []),\n"
    "  conditionEvaluationTraces: result.conditionEvaluationTraces?.size\n"
    "    ? Array.from(result.conditionEvaluationTraces, ([elementId, trace]) => ({ elementId, trace }))\n"
    "    : undefined,"
)
replace_once(
    "src/geometry/evaluationPayload.ts",
    "  conditionInactiveElementIds: new Set(payload.conditionInactiveElementIds ?? []),",
    "  conditionInactiveElementIds: new Set(payload.conditionInactiveElementIds ?? []),\n"
    "  conditionEvaluationTraces: payload.conditionEvaluationTraces !== undefined\n"
    "    ? parseConditionEvaluationTraces(payload.conditionEvaluationTraces)\n"
    "    : new Map(),"
)

# Rust iterative evaluator: optional observer gets a post-order callback without changing the normal path's work count.
replace_once(
    "src-tauri/src/evaluation/scalars/expression_evaluator.rs",
    "pub(super) enum EvalWork<'a> {\n    Eval(&'a TypedScalarExpression),",
    "pub(super) enum EvalWork<'a> {\n    Eval(&'a TypedScalarExpression),\n    Record(&'a TypedScalarExpression),"
)
replace_once(
    "src-tauri/src/evaluation/scalars/expression_evaluator.rs",
    '''pub(crate) fn evaluate_typed_expression(\n    node: &TypedScalarExpression,\n    environment: &impl ScalarEvaluationEnvironment,\n) -> ScalarEvaluation {\n    let mut work: Vec<EvalWork> = vec![EvalWork::Eval(node)];''',
    '''pub(crate) fn evaluate_typed_expression(\n    node: &TypedScalarExpression,\n    environment: &impl ScalarEvaluationEnvironment,\n) -> ScalarEvaluation {\n    evaluate_typed_expression_internal::<fn(&TypedScalarExpression, &ScalarEvaluation)>(node, environment, None)\n}\n\npub(crate) fn evaluate_typed_expression_with_observer<F>(\n    node: &TypedScalarExpression,\n    environment: &impl ScalarEvaluationEnvironment,\n    observer: &mut F,\n) -> ScalarEvaluation\nwhere\n    F: FnMut(&TypedScalarExpression, &ScalarEvaluation),\n{\n    evaluate_typed_expression_internal(node, environment, Some(observer))\n}\n\nfn evaluate_typed_expression_internal<F>(\n    node: &TypedScalarExpression,\n    environment: &impl ScalarEvaluationEnvironment,\n    mut observer: Option<&mut F>,\n) -> ScalarEvaluation\nwhere\n    F: FnMut(&TypedScalarExpression, &ScalarEvaluation),\n{\n    let mut work: Vec<EvalWork> = vec![EvalWork::Eval(node)];'''
)
replace_once(
    "src-tauri/src/evaluation/scalars/expression_evaluator.rs",
    "            EvalWork::Eval(node) => eval_node(node, environment, &mut work, &mut output),\n            EvalWork::FinishUnary",
    '''            EvalWork::Eval(node) => {\n                if observer.is_some() {\n                    work.push(EvalWork::Record(node));\n                }\n                eval_node(node, environment, &mut work, &mut output);\n            }\n            EvalWork::Record(node) => {\n                if let Some(observer) = observer.as_deref_mut() {\n                    observer(node, output.last().expect("recorded node result must be present"));\n                }\n            }\n            EvalWork::FinishUnary'''
)

# Rust scalar module registers trace module/tests and exposes trace evaluator to runtime owner.
replace_once(
    "src-tauri/src/evaluation/scalars/mod.rs",
    "mod condition_expression_payload;",
    "mod condition_evaluation_trace;\nmod condition_expression_payload;"
)
replace_once(
    "src-tauri/src/evaluation/scalars/mod.rs",
    "#[cfg(test)]\nmod condition_expression_payload_tests;",
    "#[cfg(test)]\nmod condition_evaluation_trace_tests;\n#[cfg(test)]\nmod condition_expression_payload_tests;"
)
replace_once(
    "src-tauri/src/evaluation/scalars/mod.rs",
    "pub(crate) use condition_expression_payload::{",
    "pub(crate) use condition_evaluation_trace::evaluate_condition_expression_with_trace;\n"
    "pub(crate) use condition_expression_payload::{"
)

# Rust control runtime exposes trace-producing condition resolution beside the existing API.
replace_once(
    "src-tauri/src/evaluation/control_boolean_runtime.rs",
    "use super::numeric_expression::computed_reference_value;",
    "use serde_json::Value;\n\nuse super::numeric_expression::computed_reference_value;"
)
replace_once(
    "src-tauri/src/evaluation/control_boolean_runtime.rs",
    "    evaluate_typed_expression, ScalarDocumentBindingResolver, ScalarEvaluation,",
    "    evaluate_condition_expression_with_trace, evaluate_typed_expression, ScalarDocumentBindingResolver, ScalarEvaluation,"
)
insert_rust_control = '''\nfn active_branch_for_condition_evaluation(evaluation: &ScalarEvaluation) -> Option<&'static str> {\n    match evaluation {\n        ScalarEvaluation::Ok {\n            r#type: ScalarType::Boolean,\n            value: super::scalars::ScalarValue::Boolean(true),\n        } => Some("then"),\n        ScalarEvaluation::Ok {\n            r#type: ScalarType::Boolean,\n            value: super::scalars::ScalarValue::Boolean(false),\n        } => Some("else"),\n        _ => None,\n    }\n}\n\npub(crate) fn resolve_conditional_group_condition(\n    expression: &TypedScalarExpression,\n    resolver: &dyn ScalarDocumentBindingResolver,\n    state: &EvaluationState,\n) -> (Option<&'static str>, Value) {\n    let environment = ResolverEnvironment { resolver, state };\n    let (evaluation, trace) = evaluate_condition_expression_with_trace(expression, &environment);\n    (active_branch_for_condition_evaluation(&evaluation), trace)\n}\n'''
replace_once(
    "src-tauri/src/evaluation/control_boolean_runtime.rs",
    "/// A `conditionalGroup`'s active branch from its typed boolean condition:",
    insert_rust_control + "\n/// A `conditionalGroup`'s active branch from its typed boolean condition:"
)
old_match = '''    match evaluate_typed_expression(expression, &environment) {\n        ScalarEvaluation::Ok {\n            r#type: ScalarType::Boolean,\n            value,\n        } => match value {\n            super::scalars::ScalarValue::Boolean(true) => Some("then"),\n            super::scalars::ScalarValue::Boolean(false) => Some("else"),\n            _ => None,\n        },\n        _ => None,\n    }'''
replace_once(
    "src-tauri/src/evaluation/control_boolean_runtime.rs",
    old_match,
    "    let evaluation = evaluate_typed_expression(expression, &environment);\n    active_branch_for_condition_evaluation(&evaluation)"
)

# Rust EvaluationState/Payload carry JSON-friendly trace entries.
replace_once(
    "src-tauri/src/evaluation/types.rs",
    "    pub(crate) condition_inactive_element_ids: Vec<ElementId>,",
    "    pub(crate) condition_inactive_element_ids: Vec<ElementId>,\n"
    "    #[serde(skip_serializing_if = \"Vec::is_empty\")]\n"
    "    pub(crate) condition_evaluation_traces: Vec<Value>,"
)
replace_once(
    "src-tauri/src/evaluation/types.rs",
    "    pub(crate) geometry_mutation_executions: Vec<GeometryMutationExecution>,",
    "    pub(crate) geometry_mutation_executions: Vec<GeometryMutationExecution>,\n"
    "    pub(crate) condition_evaluation_traces: Vec<Value>,"
)

# Add the new state field to every Rust EvaluationState literal that follows the established mutation field.
for path in Path("src-tauri/src").rglob("*.rs"):
    text = path.read_text()
    updated = re.sub(
        r'(?m)^(\s*)geometry_mutation_executions: Vec::new\(\),\n(?!\1condition_evaluation_traces:)',
        r'\1geometry_mutation_executions: Vec::new(),\n\1condition_evaluation_traces: Vec::new(),\n',
        text,
    )
    if updated != text:
        path.write_text(updated)

# Rust evaluation owner records runtime-id-keyed traces and emits them through IPC.
replace_once(
    "src-tauri/src/evaluation/mod.rs",
    "use control_boolean_runtime::{\n    resolve_conditional_group_branch, resolve_for_group_effective_show_generated,\n};",
    "use control_boolean_runtime::{\n    resolve_conditional_group_branch, resolve_conditional_group_condition,\n    resolve_for_group_effective_show_generated,\n};"
)
old_rust_condition = '''                Some(expression) => {\n                    let resolver = condition_context.scalar_binding_resolver.expect(\n                        "scalar_binding_resolver must exist when condition_expressions exist",\n                    );\n                    resolve_conditional_group_branch(expression, resolver, state)\n                }'''
new_rust_condition = '''                Some(expression) => {\n                    let resolver = condition_context.scalar_binding_resolver.expect(\n                        "scalar_binding_resolver must exist when condition_expressions exist",\n                    );\n                    let (active_branch, trace) =\n                        resolve_conditional_group_condition(expression, resolver, state);\n                    state.condition_evaluation_traces.push(serde_json::json!({\n                        "elementId": id.clone(),\n                        "trace": trace,\n                    }));\n                    active_branch\n                }'''
replace_once("src-tauri/src/evaluation/mod.rs", old_rust_condition, new_rust_condition)
replace_once(
    "src-tauri/src/evaluation/mod.rs",
    "        condition_inactive_element_ids: state\n            .elements",
    "        condition_inactive_element_ids: state\n            .elements"
)
replace_once(
    "src-tauri/src/evaluation/mod.rs",
    "            .filter(|id| condition_inactive_ids.contains(id))\n            .collect(),\n        for_group_generated_rows,",
    "            .filter(|id| condition_inactive_ids.contains(id))\n            .collect(),\n"
    "        condition_evaluation_traces: state.condition_evaluation_traces,\n"
    "        for_group_generated_rows,"
)
# Remove branch-only Rust import now unused by production mod.rs.
replace_once(
    "src-tauri/src/evaluation/mod.rs",
    "    resolve_conditional_group_branch, resolve_conditional_group_condition,\n",
    "    resolve_conditional_group_condition,\n"
)

print("SAY-127 wiring applied")
