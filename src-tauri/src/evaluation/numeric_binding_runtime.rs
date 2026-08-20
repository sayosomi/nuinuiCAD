//! Validates and materializes general numeric-expression BindingId slots.
//! Numeric expression tokens remain owned by the existing
//! numeric-expression runtime after this pass.
use std::collections::{HashMap, HashSet};

use serde_json::{Map, Value};

use super::errors::geometry_error;
use super::scalar_expression_runtime::evaluate_document_typed_expression;
use super::scalars::{
    declared_scalar_expression_type, validate_typed_expression_payload,
    ScalarDocumentBindingResolver, ScalarEvaluation, ScalarType, ScalarValue, TypedBuiltinArgument,
    TypedScalarExpression,
};
use super::types::{element_name, DependencyError, EvaluationState};

#[derive(Debug)]
pub(crate) struct ValidatedNumericBindingReference {
    binding_id: String,
    name: String,
    expression_start: usize,
    expression_end: usize,
}

#[derive(Debug)]
pub(crate) struct ValidatedNumericBinding {
    pub(crate) element_id: String,
    parameter_key: String,
    expression: String,
    references: Vec<ValidatedNumericBindingReference>,
    typed_expression: Option<TypedScalarExpression>,
}

fn payload_error(message: impl Into<String>) -> String {
    message.into()
}

fn utf16_byte_offset(value: &str, offset: usize) -> Option<usize> {
    let mut units = 0usize;
    for (byte, ch) in value.char_indices() {
        if units == offset {
            return Some(byte);
        }
        units += ch.len_utf16();
        if units > offset {
            return None;
        }
    }
    (units == offset).then_some(value.len())
}

fn numeric_expression<'a>(element: &'a Value, parameter_key: &str) -> Option<&'a str> {
    let object = element.as_object()?;
    let value = if let Some(rest) = parameter_key.strip_prefix("intermediate:") {
        let (id, field) = rest.split_once(':')?;
        object
            .get("intermediatePoints")?
            .as_array()?
            .iter()
            .find(|item| item.get("id").and_then(Value::as_str) == Some(id))?
            .get(field)?
    } else if matches!(parameter_key, "distance" | "ratio") && object.get("placement").is_some() {
        object.get("placement")?.get("value")?
    } else if let Some((anchor, axis)) = parameter_key.rsplit_once(':') {
        if matches!(axis, "x" | "y") {
            object.get(anchor)?.get(axis)?
        } else {
            object.get(parameter_key)?
        }
    } else {
        object.get(parameter_key)?
    };
    value
        .get("kind")
        .and_then(Value::as_str)
        .filter(|kind| *kind == "expression")?;
    value.get("expression")?.as_str()
}

fn numeric_expression_mut<'a>(
    element: &'a mut Value,
    parameter_key: &str,
) -> Option<&'a mut Value> {
    let object = element.as_object_mut()?;
    if let Some(rest) = parameter_key.strip_prefix("intermediate:") {
        let (id, field) = rest.split_once(':')?;
        return object
            .get_mut("intermediatePoints")?
            .as_array_mut()?
            .iter_mut()
            .find(|item| item.get("id").and_then(Value::as_str) == Some(id))?
            .get_mut(field);
    }
    if matches!(parameter_key, "distance" | "ratio") && object.get("placement").is_some() {
        return object.get_mut("placement")?.get_mut("value");
    }
    if let Some((anchor, axis)) = parameter_key.rsplit_once(':') {
        if matches!(axis, "x" | "y") {
            return object.get_mut(anchor)?.get_mut(axis);
        }
    }
    object.get_mut(parameter_key)
}

fn validate_typed_expression_runtime_targets(
    expression: &TypedScalarExpression,
    elements_by_id: &HashMap<&str, &Value>,
    valid_binding_ids: &HashSet<&str>,
) -> Result<(), String> {
    let mut pending = vec![expression];
    while let Some(node) = pending.pop() {
        match node {
            TypedScalarExpression::Reference { binding_id, .. } => {
                if let Some(binding_id) = binding_id {
                    if !valid_binding_ids.contains(binding_id.as_str()) {
                        return Err(payload_error(
                            "numeric binding typedExpression reference bindingId does not exist in the scalar program",
                        ));
                    }
                }
            }
            TypedScalarExpression::GeometryProperty { element_id, .. } => {
                if !elements_by_id.contains_key(element_id.as_str()) {
                    return Err(payload_error(
                        "numeric binding typedExpression geometry target does not match an element",
                    ));
                }
            }
            TypedScalarExpression::Unary { operand, .. }
            | TypedScalarExpression::Group {
                expression: operand,
                ..
            } => pending.push(operand),
            TypedScalarExpression::Binary { left, right, .. } => {
                pending.push(left);
                pending.push(right);
            }
            TypedScalarExpression::Call { args, .. } => {
                for argument in args {
                    if let TypedBuiltinArgument::Scalar { expression } = argument {
                        pending.push(expression);
                    } else if let TypedBuiltinArgument::GeometryReference {
                        target: Some(target),
                        ..
                    } = argument
                    {
                        if !elements_by_id.contains_key(target.statement_id.as_str()) {
                            return Err(payload_error(
                                "numeric binding typedExpression geometry target does not match an element",
                            ));
                        }
                    }
                }
            }
            TypedScalarExpression::NumberLiteral { .. }
            | TypedScalarExpression::StringLiteral { .. }
            | TypedScalarExpression::BooleanLiteral { .. }
            | TypedScalarExpression::ChoiceLiteral { .. } => {}
        }
    }
    Ok(())
}

pub(crate) fn validate_numeric_bindings_payload(
    payload: &Value,
    elements_by_id: &HashMap<&str, &Value>,
    valid_binding_ids: &HashSet<&str>,
) -> Result<Vec<ValidatedNumericBinding>, String> {
    let array = payload
        .as_array()
        .ok_or_else(|| payload_error("numericBindings must be an array"))?;
    let mut seen = HashSet::new();
    let mut result = Vec::with_capacity(array.len());
    for item in array {
        let object = item
            .as_object()
            .ok_or_else(|| payload_error("numeric binding must be an object"))?;
        if object.keys().any(|key| {
            !matches!(
                key.as_str(),
                "elementId" | "parameterKey" | "expression" | "references" | "typedExpression"
            )
        }) {
            return Err(payload_error("numeric binding has an unexpected field"));
        }
        let element_id = object
            .get("elementId")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| payload_error("numeric binding elementId must be a non-empty string"))?
            .to_owned();
        let parameter_key = object
            .get("parameterKey")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                payload_error("numeric binding parameterKey must be a non-empty string")
            })?
            .to_owned();
        let expression = object
            .get("expression")
            .and_then(Value::as_str)
            .ok_or_else(|| payload_error("numeric binding expression must be a string"))?
            .to_owned();
        if !seen.insert((element_id.clone(), parameter_key.clone())) {
            return Err(payload_error("duplicate numeric binding entry"));
        }
        let typed_expression = object
            .get("typedExpression")
            .map(validate_typed_expression_payload)
            .transpose()
            .map_err(|error| {
                payload_error(format!(
                    "numeric binding typedExpression is invalid: {}: {}",
                    error.code.as_str(),
                    error.message
                ))
            })?;
        if let Some(typed_expression) = typed_expression.as_ref() {
            if declared_scalar_expression_type(typed_expression) != Some(ScalarType::Number) {
                return Err(payload_error(
                    "numeric binding typedExpression must have number type",
                ));
            }
            validate_typed_expression_runtime_targets(
                typed_expression,
                elements_by_id,
                valid_binding_ids,
            )?;
        }
        let element = elements_by_id
            .get(element_id.as_str())
            .ok_or_else(|| payload_error("numeric binding elementId does not match an element"))?;
        if numeric_expression(element, &parameter_key) != Some(expression.as_str()) {
            return Err(payload_error(
                "numeric binding canonical parameter path does not match expression",
            ));
        }
        let refs = object
            .get("references")
            .and_then(Value::as_array)
            .ok_or_else(|| payload_error("numeric binding references must be an array"))?;
        if typed_expression.is_none() && refs.is_empty() {
            return Err(payload_error(
                "numeric binding references must be a non-empty array",
            ));
        }
        let mut references = Vec::with_capacity(refs.len());
        let mut last_end = 0usize;
        for reference in refs {
            let reference = reference
                .as_object()
                .ok_or_else(|| payload_error("numeric binding reference must be an object"))?;
            if reference.keys().any(|key| {
                !matches!(
                    key.as_str(),
                    "bindingId" | "name" | "expressionStart" | "expressionEnd"
                )
            }) {
                return Err(payload_error(
                    "numeric binding reference has an unexpected field",
                ));
            }
            let binding_id = reference
                .get("bindingId")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    payload_error("numeric binding reference bindingId must be a non-empty string")
                })?
                .to_owned();
            let name = reference
                .get("name")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    payload_error("numeric binding reference name must be a non-empty string")
                })?
                .to_owned();
            let start = reference
                .get("expressionStart")
                .and_then(Value::as_u64)
                .map(|value| value as usize)
                .ok_or_else(|| {
                    payload_error("numeric binding reference expressionStart must be an integer")
                })?;
            let end = reference
                .get("expressionEnd")
                .and_then(Value::as_u64)
                .map(|value| value as usize)
                .ok_or_else(|| {
                    payload_error("numeric binding reference expressionEnd must be an integer")
                })?;
            let start_byte = utf16_byte_offset(&expression, start).ok_or_else(|| {
                payload_error("numeric binding reference start is not a UTF-16 boundary")
            })?;
            let end_byte = utf16_byte_offset(&expression, end).ok_or_else(|| {
                payload_error("numeric binding reference end is not a UTF-16 boundary")
            })?;
            if start >= end
                || start < last_end
                || expression.get(start_byte..end_byte) != Some(&format!("@{name}"))
            {
                return Err(payload_error(
                    "numeric binding reference does not match its canonical occurrence",
                ));
            }
            if !valid_binding_ids.contains(binding_id.as_str()) {
                return Err(payload_error(
                    "numeric binding reference bindingId does not exist in the scalar program",
                ));
            }
            last_end = end;
            references.push(ValidatedNumericBindingReference {
                binding_id,
                name,
                expression_start: start,
                expression_end: end,
            });
        }
        result.push(ValidatedNumericBinding {
            element_id,
            parameter_key,
            expression,
            references,
            typed_expression,
        });
    }
    Ok(result)
}

fn runtime_error(element: &Value, parameter_key: &str, mapping: bool) -> DependencyError {
    let name = element_name(element);
    geometry_error(
        element,
        if mapping {
            format!("\"{name}\" の \"{parameter_key}\" の数値式を正準の型付き参照へ対応付けられません。")
        } else {
            format!("\"{name}\" の \"{parameter_key}\" に紐づく数値変数の評価に失敗しました。")
        },
    )
}

fn numeric_literal_for_expression(value: f64) -> Option<String> {
    if !value.is_finite() {
        return None;
    }
    if value == 0.0 && value.is_sign_negative() {
        return Some("-0".to_owned());
    }
    let source = value.to_string();
    let Some(exponent_at) = source.find(['e', 'E']) else {
        return Some(source);
    };
    let (mantissa, exponent) = source.split_at(exponent_at);
    let exponent = exponent[1..].parse::<isize>().ok()?;
    let (sign, mantissa) = mantissa
        .strip_prefix('-')
        .map_or(("", mantissa), |rest| ("-", rest));
    let (whole, fraction) = mantissa.split_once('.').unwrap_or((mantissa, ""));
    let digits = format!("{whole}{fraction}");
    let decimal = whole.len() as isize + exponent;
    if decimal <= 0 {
        return Some(format!(
            "{sign}0.{}{}",
            "0".repeat((-decimal) as usize),
            digits
        ));
    }
    if decimal as usize >= digits.len() {
        return Some(format!(
            "{sign}{digits}{}",
            "0".repeat(decimal as usize - digits.len())
        ));
    }
    let decimal = decimal as usize;
    Some(format!(
        "{sign}{}.{}",
        &digits[..decimal],
        &digits[decimal..]
    ))
}

pub(crate) fn apply_numeric_bindings(
    element: &Value,
    entries: Option<&Vec<ValidatedNumericBinding>>,
    resolver: &dyn ScalarDocumentBindingResolver,
    current_source_order: Option<usize>,
    state: &EvaluationState,
) -> Result<Value, DependencyError> {
    let Some(entries) = entries else {
        return Ok(element.clone());
    };
    let mut materialized = element.clone();
    for entry in entries {
        let Some(current) = numeric_expression(&materialized, &entry.parameter_key) else {
            return Err(runtime_error(&materialized, &entry.parameter_key, true));
        };
        if current != entry.expression {
            return Err(runtime_error(&materialized, &entry.parameter_key, true));
        }
        if let Some(expression) = entry.typed_expression.as_ref() {
            let evaluation = evaluate_document_typed_expression(
                expression,
                resolver,
                state,
                current_source_order,
            );
            let ScalarEvaluation::Ok {
                r#type: ScalarType::Number,
                value: ScalarValue::Number(value),
            } = evaluation
            else {
                return Err(runtime_error(&materialized, &entry.parameter_key, false));
            };
            if !value.is_finite() {
                return Err(runtime_error(&materialized, &entry.parameter_key, false));
            }
            let Some(target) = numeric_expression_mut(&mut materialized, &entry.parameter_key)
            else {
                return Err(runtime_error(&materialized, &entry.parameter_key, true));
            };
            *target = Value::from(value);
            continue;
        }
        let mut expression = current.to_owned();
        for reference in entry.references.iter().rev() {
            let evaluation = resolver.resolve_binding(&reference.binding_id, state);
            let ScalarEvaluation::Ok {
                value: ScalarValue::Number(value),
                ..
            } = evaluation
            else {
                return Err(runtime_error(&materialized, &entry.parameter_key, false));
            };
            if !value.is_finite() {
                return Err(runtime_error(&materialized, &entry.parameter_key, false));
            }
            let Some(start) = utf16_byte_offset(&expression, reference.expression_start) else {
                return Err(runtime_error(&materialized, &entry.parameter_key, true));
            };
            let Some(end) = utf16_byte_offset(&expression, reference.expression_end) else {
                return Err(runtime_error(&materialized, &entry.parameter_key, true));
            };
            if expression.get(start..end) != Some(&format!("@{}", reference.name)) {
                return Err(runtime_error(&materialized, &entry.parameter_key, true));
            }
            let Some(literal) = numeric_literal_for_expression(value) else {
                return Err(runtime_error(&materialized, &entry.parameter_key, false));
            };
            expression.replace_range(start..end, &literal);
        }
        let Some(target) = numeric_expression_mut(&mut materialized, &entry.parameter_key) else {
            return Err(runtime_error(&materialized, &entry.parameter_key, true));
        };
        *target = Value::Object(Map::from_iter([
            ("kind".to_owned(), Value::String("expression".to_owned())),
            ("expression".to_owned(), Value::String(expression)),
        ]));
    }
    Ok(materialized)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn point_with_expression(expression: &str) -> Value {
        json!({
            "id": "p",
            "name": "P",
            "type": "freePoint",
            "activity": "visible",
            "x": {"kind": "expression", "expression": expression},
            "y": 0
        })
    }

    fn number_literal(value: f64) -> Value {
        json!({
            "kind": "numberLiteral",
            "span": {"start": 0, "end": 1},
            "value": value,
            "type": {"kind": "number"}
        })
    }

    fn reference_expression() -> Value {
        json!({
            "kind": "reference",
            "span": {"start": 0, "end": 6},
            "nameSpan": {"start": 1, "end": 6},
            "name": "value",
            "bindingId": "binding:value",
            "type": {"kind": "number"}
        })
    }

    fn numeric_entry(
        expression: &str,
        typed_expression: Option<Value>,
        references: Value,
    ) -> Value {
        let mut entry = json!({
            "elementId": "p",
            "parameterKey": "x",
            "expression": expression,
            "references": references
        });
        if let Some(typed_expression) = typed_expression {
            entry["typedExpression"] = typed_expression;
        }
        entry
    }

    fn line_distance_expression() -> Value {
        json!({
            "kind": "call",
            "span": {"start": 0, "end": 29},
            "nameSpan": {"start": 0, "end": 12},
            "name": "lineDistance",
            "target": {"kind": "builtin", "name": "lineDistance"},
            "args": [
                {
                    "kind": "geometryReference",
                    "expectedGeometryType": "point",
                    "target": {
                        "statementId": "p",
                        "statementIndex": 1,
                        "geometryType": "point"
                    }
                },
                {
                    "kind": "geometryReference",
                    "expectedGeometryType": "line",
                    "target": {
                        "statementId": "baseline",
                        "statementIndex": 0,
                        "geometryType": "line"
                    }
                }
            ],
            "type": {"kind": "number"}
        })
    }

    fn geometry_state(element: Value) -> EvaluationState {
        EvaluationState {
            elements: vec![
                json!({
                    "id": "baseline",
                    "name": "Baseline",
                    "type": "line",
                    "activity": "visible"
                }),
                element,
            ],
            elements_by_id: HashMap::from([(String::from("baseline"), 0), (String::from("p"), 1)]),
            drawing_modifiers: serde_json::json!([]),
            group_states: HashMap::new(),
            computed_geometry: HashMap::from([
                (
                    String::from("baseline"),
                    json!({
                        "kind": "line",
                        "start": {"kind": "point", "elementId": "baseline", "name": "Baseline", "x": 0, "y": 0},
                        "end": {"kind": "point", "elementId": "baseline", "name": "Baseline", "x": 1, "y": 0}
                    }),
                ),
                (
                    String::from("p"),
                    json!({
                        "kind": "point",
                        "elementId": "p",
                        "name": "P",
                        "x": 3,
                        "y": 4
                    }),
                ),
            ]),
            computed_geometry_order: vec![String::from("baseline"), String::from("p")],
            pre_mutation_bezier_geometry: HashMap::new(),
            errors: Vec::new(),
            warnings: Vec::new(),
        }
    }

    fn state(element: Value) -> EvaluationState {
        EvaluationState {
            elements: vec![element],
            elements_by_id: HashMap::from([(String::from("p"), 0)]),
            drawing_modifiers: serde_json::json!([]),
            group_states: HashMap::new(),
            computed_geometry: HashMap::new(),
            computed_geometry_order: Vec::new(),
            pre_mutation_bezier_geometry: HashMap::new(),
            errors: Vec::new(),
            warnings: Vec::new(),
        }
    }

    struct StubResolver(ScalarEvaluation);

    impl ScalarDocumentBindingResolver for StubResolver {
        fn resolve_binding(&self, _binding_id: &str, _state: &EvaluationState) -> ScalarEvaluation {
            self.0.clone()
        }
    }

    #[test]
    fn accepts_typed_numeric_entries_with_empty_references() {
        let element = point_with_expression("7");
        let elements_by_id = HashMap::from([("p", &element)]);
        let decoded = validate_numeric_bindings_payload(
            &json!([numeric_entry("7", Some(number_literal(7.0)), json!([]))]),
            &elements_by_id,
            &HashSet::new(),
        );
        assert!(decoded.is_ok());
    }

    #[test]
    fn rejects_legacy_numeric_entries_with_empty_references() {
        let element = point_with_expression("7");
        let elements_by_id = HashMap::from([("p", &element)]);
        assert!(validate_numeric_bindings_payload(
            &json!([numeric_entry("7", None, json!([]))]),
            &elements_by_id,
            &HashSet::new(),
        )
        .is_err());
    }

    #[test]
    fn rejects_malformed_typed_numeric_expression() {
        let element = point_with_expression("7");
        let elements_by_id = HashMap::from([("p", &element)]);
        let malformed = json!({
            "kind": "numberLiteral",
            "span": {"start": 0, "end": 1},
            "value": 7,
            "type": {"kind": "number"},
            "unexpected": true
        });
        assert!(validate_numeric_bindings_payload(
            &json!([numeric_entry("7", Some(malformed), json!([]))]),
            &elements_by_id,
            &HashSet::new(),
        )
        .is_err());
    }

    #[test]
    fn materializes_typed_numeric_result_as_a_literal_number() {
        let element = point_with_expression("7");
        let elements_by_id = HashMap::from([("p", &element)]);
        let decoded = validate_numeric_bindings_payload(
            &json!([numeric_entry("7", Some(number_literal(7.0)), json!([]))]),
            &elements_by_id,
            &HashSet::new(),
        )
        .unwrap();
        let result = apply_numeric_bindings(
            &element,
            Some(&decoded),
            &StubResolver(ScalarEvaluation::Error {
                r#type: ScalarType::Number,
                issue_code: "unused".to_owned(),
                binding_id: None,
                context: None,
            }),
            None,
            &state(element.clone()),
        )
        .unwrap();
        assert_eq!(result["x"], json!(7.0));
    }

    #[test]
    fn materializes_typed_numeric_geometry_builtin_with_current_source_order() {
        let element = point_with_expression("lineDistance(@p, @baseline)");
        let baseline = json!({
            "id": "baseline",
            "name": "Baseline",
            "type": "line",
            "activity": "visible"
        });
        let elements_by_id = HashMap::from([("p", &element), ("baseline", &baseline)]);
        let decoded = validate_numeric_bindings_payload(
            &json!([numeric_entry(
                "lineDistance(@p, @baseline)",
                Some(line_distance_expression()),
                json!([])
            )]),
            &elements_by_id,
            &HashSet::new(),
        )
        .unwrap();
        let result = apply_numeric_bindings(
            &element,
            Some(&decoded),
            &StubResolver(ScalarEvaluation::Error {
                r#type: ScalarType::Number,
                issue_code: "unused".to_owned(),
                binding_id: None,
                context: None,
            }),
            Some(2),
            &geometry_state(element.clone()),
        )
        .unwrap();
        assert_eq!(result["x"], json!(4.0));
    }

    #[test]
    fn typed_numeric_evaluation_errors_fail_closed_for_wrong_type_error_and_non_finite() {
        let cases = [
            ScalarEvaluation::Ok {
                r#type: ScalarType::Boolean,
                value: ScalarValue::Boolean(true),
            },
            ScalarEvaluation::Error {
                r#type: ScalarType::Number,
                issue_code: "evaluation-error".to_owned(),
                binding_id: None,
                context: None,
            },
            ScalarEvaluation::Ok {
                r#type: ScalarType::Number,
                value: ScalarValue::Number(f64::NAN),
            },
        ];
        for evaluation in cases {
            let element = point_with_expression("@value");
            let elements_by_id = HashMap::from([("p", &element)]);
            let valid_ids = HashSet::from(["binding:value"]);
            let decoded = validate_numeric_bindings_payload(
                &json!([numeric_entry(
                    "@value",
                    Some(reference_expression()),
                    json!([])
                )]),
                &elements_by_id,
                &valid_ids,
            )
            .unwrap();
            assert!(apply_numeric_bindings(
                &element,
                Some(&decoded),
                &StubResolver(evaluation),
                None,
                &state(element.clone()),
            )
            .is_err());
        }
    }

    #[test]
    fn expands_finite_exponents_without_losing_the_ieee_value() {
        for value in [
            0.0,
            -0.0,
            f64::from_bits(1),
            f64::MAX,
            1e-7,
            -1e-7,
            1e20,
            -42.0,
            12.3456,
        ] {
            let literal = numeric_literal_for_expression(value).expect("finite");
            assert!(!literal.contains(['e', 'E']));
            assert_eq!(literal.parse::<f64>().unwrap().to_bits(), value.to_bits());
        }
        assert_eq!(numeric_literal_for_expression(-0.0).as_deref(), Some("-0"));
        assert_eq!(numeric_literal_for_expression(f64::NAN), None);
    }
}
