//! Runtime evaluation for an already-resolved nui4 scalar program.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};

use serde_json::{json, Value};

use super::expression_evaluator::{evaluate_typed_expression, ScalarEvaluationEnvironment};
use super::geometry_builtin_runtime::resolve_geometry_builtin_target;
use super::program_payload::{ValidatedScalarProgram, ValidatedScalarProgramStatement};
use super::scalar_payload::scalar_value_matches_type;
use super::types::{
    BindingId, ScalarEvaluation, ScalarEvaluationErrorContext, ScalarType, ScalarValue,
};
use crate::evaluation::numeric_expression::computed_reference_value;
use crate::evaluation::types::EvaluationState;

const BINDING_UNAVAILABLE: &str = "evaluation-binding-unavailable";
const RUNTIME_VALUE_TYPE_MISMATCH: &str = "evaluation-runtime-value-type-mismatch";
const BINDING_CYCLE_GUARD: &str = "evaluation-binding-cycle-guard";

pub(crate) trait ScalarDocumentBindingResolver {
    fn resolve_binding(&self, binding_id: &str, state: &EvaluationState) -> ScalarEvaluation;
}

fn unavailable_binding(binding_id: &str) -> ScalarEvaluation {
    ScalarEvaluation::Error {
        r#type: ScalarType::Number,
        issue_code: BINDING_UNAVAILABLE.to_owned(),
        binding_id: Some(binding_id.to_owned()),
        context: None,
    }
}

pub(crate) fn result_for_declared_type(
    result: ScalarEvaluation,
    declared_type: &ScalarType,
    binding_id: &str,
) -> ScalarEvaluation {
    match &result {
        ScalarEvaluation::Error { .. } => result,
        ScalarEvaluation::Ok { r#type, value }
            if r#type == declared_type && scalar_value_matches_type(r#type, value) =>
        {
            result
        }
        ScalarEvaluation::Ok { .. } => ScalarEvaluation::Error {
            r#type: declared_type.clone(),
            issue_code: RUNTIME_VALUE_TYPE_MISMATCH.to_owned(),
            binding_id: Some(binding_id.to_owned()),
            context: None,
        },
    }
}

fn is_within_evaluation_limit(
    program: &ValidatedScalarProgram,
    statement: &ValidatedScalarProgramStatement,
) -> bool {
    !program.evaluation_limit_source_order.is_some_and(|limit| {
        statement.source_order >= limit
            && !program
                .post_stop_binding_ids
                .contains(&statement.binding_id)
    })
}

/// Resolves one binding's value on demand, memoized for the lifetime of one
/// `evaluate_document` call. `program` is borrowed for this resolver's whole
/// lifetime (it is never mutated during evaluation), but `state` is passed
/// per call rather than stored - `state` is still being mutated by the
/// caller's own per-element loop, so this resolver must never hold a live
/// borrow of it across calls.
pub(crate) struct ScalarBindingResolver<'a> {
    program: &'a ValidatedScalarProgram,
    statement_by_binding_id: HashMap<&'a str, &'a ValidatedScalarProgramStatement>,
    cache: RefCell<HashMap<BindingId, ScalarEvaluation>>,
    in_progress: RefCell<HashSet<BindingId>>,
}

impl<'a> ScalarBindingResolver<'a> {
    pub(crate) fn new(program: &'a ValidatedScalarProgram) -> Self {
        let mut statement_by_binding_id = HashMap::new();
        for statement in &program.statements {
            if is_within_evaluation_limit(program, statement) {
                statement_by_binding_id.insert(statement.binding_id.as_str(), statement);
            }
        }
        Self {
            program,
            statement_by_binding_id,
            cache: RefCell::new(HashMap::new()),
            in_progress: RefCell::new(HashSet::new()),
        }
    }

    /// Resolves `binding_id` against `state`'s current (possibly still
    /// in-progress) contents, caching the result. Safe to call at any point
    /// during the caller's per-element loop, any number of times, for any
    /// binding - each is only ever actually evaluated once.
    pub(crate) fn resolve(&self, binding_id: &str, state: &EvaluationState) -> ScalarEvaluation {
        if let Some(cached) = self.cache.borrow().get(binding_id) {
            return cached.clone();
        }

        let Some(statement) = self.statement_by_binding_id.get(binding_id).copied() else {
            return unavailable_binding(binding_id);
        };

        if !self.in_progress.borrow_mut().insert(binding_id.to_owned()) {
            // Defense-in-depth only - see module comment. Should be
            // unreachable for any program that passed Task 13's compile-time
            // acyclicity checks.
            return ScalarEvaluation::Error {
                r#type: statement.declared_type.clone(),
                issue_code: BINDING_CYCLE_GUARD.to_owned(),
                binding_id: Some(binding_id.to_owned()),
                context: None,
            };
        }

        let environment = ResolvingEnvironment {
            resolver: self,
            state,
            source_order: statement.source_order,
        };
        let evaluation = match &statement.initializer {
            Ok(initializer) => result_for_declared_type(
                evaluate_typed_expression(initializer, &environment),
                &statement.declared_type,
                &statement.binding_id,
            ),
            Err(issue_code) => ScalarEvaluation::Error {
                r#type: statement.declared_type.clone(),
                issue_code: issue_code.clone(),
                binding_id: Some(statement.binding_id.clone()),
                context: None,
            },
        };

        self.in_progress.borrow_mut().remove(binding_id);
        self.cache
            .borrow_mut()
            .insert(binding_id.to_owned(), evaluation.clone());
        evaluation
    }

    /// Walks `program.statements` in array order and pulls each value from
    /// the (memoized, so free after the first ask) resolver, producing the
    /// same `computed_scalar_bindings` shape/order the original one-shot
    /// implementation did - independent of whatever order (if any) the
    /// caller's own per-element loop resolved bindings in beforehand.
    pub(crate) fn finalize(&self, state: &EvaluationState) -> Vec<Value> {
        let mut output = Vec::new();
        for statement in &self.program.statements {
            if !is_within_evaluation_limit(self.program, statement) {
                continue;
            }
            let evaluation = self.resolve(&statement.binding_id, state);
            output.push(json!({
                "bindingId": statement.binding_id,
                "evaluation": scalar_evaluation_json(&evaluation),
            }));
        }
        output
    }
}

impl ScalarDocumentBindingResolver for ScalarBindingResolver<'_> {
    fn resolve_binding(&self, binding_id: &str, state: &EvaluationState) -> ScalarEvaluation {
        self.resolve(binding_id, state)
    }
}

struct ResolvingEnvironment<'a, 'b> {
    resolver: &'a ScalarBindingResolver<'a>,
    state: &'b EvaluationState,
    source_order: usize,
}

impl ScalarEvaluationEnvironment for ResolvingEnvironment<'_, '_> {
    fn lookup_binding(&self, binding_id: &str) -> ScalarEvaluation {
        self.resolver.resolve(binding_id, self.state)
    }
    fn lookup_geometry_property(
        &self,
        element_id: &str,
        property: &str,
        target_source_order: usize,
    ) -> ScalarEvaluation {
        if target_source_order >= self.source_order {
            return ScalarEvaluation::Error {
                r#type: ScalarType::Number,
                issue_code: "evaluation-geometry-property-unavailable".to_owned(),
                binding_id: None,
                context: None,
            };
        }
        match self
            .state
            .computed_geometry
            .get(element_id)
            .and_then(|geometry| computed_reference_value(geometry, property))
        {
            Some(value) => ScalarEvaluation::Ok {
                r#type: ScalarType::Number,
                value: ScalarValue::Number(value),
            },
            None => ScalarEvaluation::Error {
                r#type: ScalarType::Number,
                issue_code: "evaluation-geometry-property-unavailable".to_owned(),
                binding_id: None,
                context: None,
            },
        }
    }

    fn lookup_geometry_builtin_target(
        &self,
        target: &super::types::ScalarExpressionResolvedGeometryTarget,
    ) -> Result<
        super::geometry_builtin_runtime::GeometryBuiltinRuntimeTarget,
        super::geometry_builtin_runtime::GeometryBuiltinRuntimeError,
    > {
        resolve_geometry_builtin_target(self.state, self.source_order, target)
    }
}

fn scalar_type_json(scalar_type: &ScalarType) -> Value {
    match scalar_type {
        ScalarType::Number => json!({ "kind": "number" }),
        ScalarType::String => json!({ "kind": "string" }),
        ScalarType::Boolean => json!({ "kind": "boolean" }),
        ScalarType::Choice { options } => json!({ "kind": "choice", "options": options }),
    }
}

fn scalar_value_json(value: &ScalarValue) -> Value {
    match value {
        ScalarValue::Number(value) => json!({ "kind": "number", "value": value }),
        ScalarValue::String(value) => json!({ "kind": "string", "value": value }),
        ScalarValue::Boolean(value) => json!({ "kind": "boolean", "value": value }),
        ScalarValue::Choice { value, options } => {
            json!({ "kind": "choice", "value": value, "options": options })
        }
    }
}

pub(crate) fn scalar_evaluation_json(evaluation: &ScalarEvaluation) -> Value {
    match evaluation {
        ScalarEvaluation::Ok { r#type, value } => json!({
            "status": "ok",
            "type": scalar_type_json(r#type),
            "value": scalar_value_json(value),
        }),
        ScalarEvaluation::Error {
            r#type,
            issue_code,
            binding_id,
            context,
        } => {
            let mut value = json!({
                "status": "error",
                "type": scalar_type_json(r#type),
                "issueCode": issue_code,
            });
            if let Some(binding_id) = binding_id {
                value["bindingId"] = Value::String(binding_id.clone());
            }
            if let Some(context) = context {
                value["context"] = match context {
                    ScalarEvaluationErrorContext::GeometryBuiltinTarget {
                        target_element_id,
                        point_key,
                    } => {
                        let mut context = json!({
                            "kind": "geometryBuiltinTarget",
                            "targetElementId": target_element_id,
                        });
                        if let Some(point_key) = point_key {
                            context["pointKey"] = Value::String(point_key.clone());
                        }
                        context
                    }
                };
            }
            value
        }
    }
}
