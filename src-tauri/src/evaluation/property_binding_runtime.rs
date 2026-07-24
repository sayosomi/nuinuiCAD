//! Task 23: materializes Task 22's compiled property-binding sources into
//! resolved literal values on an element clone, immediately before that
//! element is dispatched to its per-type evaluator. Mirrors
//! `src/geometry/propertyBindingRuntime.ts` - see that file's module
//! comment for the full design rationale.
//!
//! This module never re-parses source and never re-resolves a binding name:
//! `ValidatedPropertyBinding` entries arrive already elementId-keyed and
//! already validated (`property_binding_payload.rs`); this module only ever
//! does one binding-resolver lookup per bound property per element, via a
//! caller-supplied `ScalarBindingResolver` - it never evaluates a scalar
//! program itself.

use serde_json::Value;

use super::errors::geometry_error;
use super::scalars::{
    ScalarDocumentBindingResolver, ScalarEvaluation, ScalarType, ScalarValue,
    ValidatedPropertyBinding,
};
use super::types::{element_name, DependencyError, EvaluationState};

/// Whether a resolved runtime `ScalarValue` is actually usable for a
/// property's own canonical `expected_type` - not
/// `scalar_value_matches_type` (scalar_payload.rs), which requires the
/// value's own option list to be structurally identical to the type being
/// checked against and would incorrectly reject the legitimate D07 case: a
/// binding declared with a narrower choice type than the property it is
/// assigned to. A kind mismatch (including a poisoned/Error evaluation,
/// handled by the caller before this is reached) already falls through to
/// `false` here.
fn scalar_value_satisfies_expected_type(value: &ScalarValue, expected_type: &ScalarType) -> bool {
    match (value, expected_type) {
        (ScalarValue::Number(_), ScalarType::Number) => true,
        (ScalarValue::String(_), ScalarType::String) => true,
        (ScalarValue::Boolean(_), ScalarType::Boolean) => true,
        (ScalarValue::Choice { value, .. }, ScalarType::Choice { options }) => {
            options.contains(value)
        }
        _ => false,
    }
}

fn scalar_value_to_json(value: &ScalarValue) -> Value {
    match value {
        ScalarValue::Number(value) => Value::from(*value),
        ScalarValue::String(value) => Value::String(value.clone()),
        ScalarValue::Boolean(value) => Value::Bool(*value),
        ScalarValue::Choice { value, .. } => Value::String(value.clone()),
    }
}

fn property_binding_failure_message(element: &Value, parameter_key: &str) -> String {
    let name = element_name(element);
    format!(
        "\"{name}\" の \"{parameter_key}\" に紐づく変数の評価に失敗したか、値が許可された型・選択肢と一致しません。"
    )
}

/// Resolves and applies every bound property for `element` (looked up by
/// the caller under the appropriate id - the element's own id, or its
/// forGroup *template* id for a generated clone - before calling this),
/// via `resolver` (never re-evaluating a scalar program). Fails closed - per
/// docs/typed-variables/tasks/23-standard-property-runtime.md - on eval
/// failure/poison, runtime type mismatch, or choice-option mismatch: the
/// caller must not evaluate or draw the element in that case. Returns a
/// clone of `element` unchanged when `entries` is `None`/empty.
pub(crate) fn apply_property_bindings(
    element: &Value,
    entries: Option<&Vec<ValidatedPropertyBinding>>,
    resolver: &dyn ScalarDocumentBindingResolver,
    state: &EvaluationState,
) -> Result<Value, DependencyError> {
    let Some(entries) = entries else {
        return Ok(element.clone());
    };
    if entries.is_empty() {
        return Ok(element.clone());
    }

    let mut materialized = element.clone();
    let Some(object) = materialized.as_object_mut() else {
        return Ok(materialized);
    };

    for entry in entries {
        let evaluation = resolver.resolve_binding(&entry.binding_id, state);
        match evaluation {
            ScalarEvaluation::Ok { value, .. }
                if scalar_value_satisfies_expected_type(&value, &entry.expected_type) =>
            {
                object.insert(entry.parameter_key.clone(), scalar_value_to_json(&value));
            }
            _ => {
                return Err(geometry_error(
                    element,
                    property_binding_failure_message(element, &entry.parameter_key),
                ));
            }
        }
    }

    Ok(materialized)
}
