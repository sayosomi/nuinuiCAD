//! Document-context evaluation for Task 19's already-resolved scalar program.
//! This module never parses source or resolves a binding name.
//!
//! Task 23 changed this from a one-shot `evaluate_scalar_program(program,
//! state)` function (which built a full snapshot of legacy `var` values from
//! `state` up front, then walked every statement once) into
//! `ScalarBindingResolver`, an on-demand, memoized resolver: `resolve` only
//! evaluates a binding's initializer the first time something asks for it,
//! reading `state.computed_variables` *live* rather than from a snapshot.
//! This lets a caller (the per-element evaluation loop in `mod.rs`) resolve
//! a specific binding mid-loop - e.g. to materialize a bound element
//! property - without re-evaluating the whole program and without ever
//! evaluating any single binding more than once. `finalize` still produces
//! the exact same `computed_scalar_bindings` shape/order as the original
//! one-shot function, by walking `program.statements` in order and pulling
//! each value from the (memoized) resolver.
//!
//! A compiled ScalarProgram is already guaranteed acyclic and forward-
//! reference free (Task 13's diagnostics reject any document containing a
//! cycle/forward reference at compile time), so on-demand recursion always
//! strictly resolves "earlier" statements first and terminates; the
//! `in_progress` guard below is defense-in-depth only, for this new
//! recursive control flow, not a correctness requirement.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};

use serde_json::{json, Value};

use super::expression_evaluator::{evaluate_typed_expression, ScalarEvaluationEnvironment};
use super::program_payload::{ValidatedScalarProgram, ValidatedScalarProgramStatement};
use super::scalar_payload::scalar_value_matches_type;
use super::types::{BindingId, ScalarEvaluation, ScalarType, ScalarValue};
use crate::evaluation::types::EvaluationState;

const LEGACY_BINDING_PREFIX: &str = "binding:";
const EXTERNAL_BINDING_UNAVAILABLE: &str = "evaluation-external-binding-unavailable";
const RUNTIME_VALUE_TYPE_MISMATCH: &str = "evaluation-runtime-value-type-mismatch";
const BINDING_CYCLE_GUARD: &str = "evaluation-binding-cycle-guard";

fn unavailable_binding(binding_id: &str) -> ScalarEvaluation {
    ScalarEvaluation::Error {
        r#type: ScalarType::Number,
        issue_code: EXTERNAL_BINDING_UNAVAILABLE.to_owned(),
        binding_id: Some(binding_id.to_owned()),
    }
}

fn resolve_external_binding(binding_id: &str, state: &EvaluationState) -> ScalarEvaluation {
    let Some(element_id) = binding_id.strip_prefix(LEGACY_BINDING_PREFIX) else {
        return unavailable_binding(binding_id);
    };
    let value = state
        .computed_variables
        .get(element_id)
        .and_then(|variable| variable.get("value"))
        .and_then(Value::as_f64);
    match value {
        Some(value) => ScalarEvaluation::Ok {
            r#type: ScalarType::Number,
            value: ScalarValue::Number(value),
        },
        None => unavailable_binding(binding_id),
    }
}

fn result_for_declared_type(
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
        },
    }
}

fn is_within_evaluation_limit(
    program: &ValidatedScalarProgram,
    statement: &ValidatedScalarProgramStatement,
) -> bool {
    !program
        .evaluation_limit_source_order
        .is_some_and(|limit| statement.source_order >= limit)
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
            return resolve_external_binding(binding_id, state);
        };

        if !self.in_progress.borrow_mut().insert(binding_id.to_owned()) {
            // Defense-in-depth only - see module comment. Should be
            // unreachable for any program that passed Task 13's compile-time
            // acyclicity checks.
            return ScalarEvaluation::Error {
                r#type: statement.declared_type.clone(),
                issue_code: BINDING_CYCLE_GUARD.to_owned(),
                binding_id: Some(binding_id.to_owned()),
            };
        }

        let environment = ResolvingEnvironment {
            resolver: self,
            state,
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

struct ResolvingEnvironment<'a, 'b> {
    resolver: &'a ScalarBindingResolver<'a>,
    state: &'b EvaluationState,
}

impl ScalarEvaluationEnvironment for ResolvingEnvironment<'_, '_> {
    fn lookup_binding(&self, binding_id: &str) -> ScalarEvaluation {
        self.resolver.resolve(binding_id, self.state)
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
        } => {
            let mut value = json!({
                "status": "error",
                "type": scalar_type_json(r#type),
                "issueCode": issue_code,
            });
            if let Some(binding_id) = binding_id {
                value["bindingId"] = Value::String(binding_id.clone());
            }
            value
        }
    }
}
