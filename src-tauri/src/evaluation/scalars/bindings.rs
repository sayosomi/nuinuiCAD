//! Document-context evaluation for Task 19's already-resolved scalar program.
//! This module never parses source or resolves a binding name.

use std::collections::HashMap;

use serde_json::{json, Value};

use super::expression_evaluator::{evaluate_typed_expression, ScalarEvaluationEnvironment};
use super::program_payload::ValidatedScalarProgram;
use super::scalar_payload::scalar_value_matches_type;
use super::types::{BindingId, ScalarEvaluation, ScalarType, ScalarValue};
use crate::evaluation::types::EvaluationState;

const LEGACY_BINDING_PREFIX: &str = "binding:";
const EXTERNAL_BINDING_UNAVAILABLE: &str = "evaluation-external-binding-unavailable";
const RUNTIME_VALUE_TYPE_MISMATCH: &str = "evaluation-runtime-value-type-mismatch";

struct BindingEnvironment<'a> {
    computed: HashMap<BindingId, ScalarEvaluation>,
    external: &'a HashMap<BindingId, ScalarEvaluation>,
}

impl ScalarEvaluationEnvironment for BindingEnvironment<'_> {
    fn lookup_binding(&self, binding_id: &str) -> ScalarEvaluation {
        self.computed
            .get(binding_id)
            .cloned()
            .or_else(|| self.external.get(binding_id).cloned())
            .unwrap_or_else(|| unavailable_binding(binding_id))
    }
}

fn unavailable_binding(binding_id: &str) -> ScalarEvaluation {
    ScalarEvaluation::Error {
        r#type: ScalarType::Number,
        issue_code: EXTERNAL_BINDING_UNAVAILABLE.to_owned(),
        binding_id: Some(binding_id.to_owned()),
    }
}

fn external_bindings(state: &EvaluationState) -> HashMap<BindingId, ScalarEvaluation> {
    state
        .computed_variable_order
        .iter()
        .filter_map(|element_id| {
            let value = state
                .computed_variables
                .get(element_id)?
                .get("value")?
                .as_f64()?;
            Some((
                format!("{LEGACY_BINDING_PREFIX}{element_id}"),
                ScalarEvaluation::Ok {
                    r#type: ScalarType::Number,
                    value: ScalarValue::Number(value),
                },
            ))
        })
        .collect()
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

pub(crate) fn evaluate_scalar_program(
    program: &ValidatedScalarProgram,
    state: &EvaluationState,
) -> Vec<Value> {
    let external = external_bindings(state);
    let mut environment = BindingEnvironment {
        computed: HashMap::new(),
        external: &external,
    };
    let mut output = Vec::new();

    for statement in &program.statements {
        if program
            .evaluation_limit_source_order
            .is_some_and(|limit| statement.source_order >= limit)
        {
            continue;
        }
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
        environment
            .computed
            .insert(statement.binding_id.clone(), evaluation.clone());
        output.push(json!({
            "bindingId": statement.binding_id,
            "evaluation": scalar_evaluation_json(&evaluation),
        }));
    }
    output
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

fn scalar_evaluation_json(evaluation: &ScalarEvaluation) -> Value {
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
