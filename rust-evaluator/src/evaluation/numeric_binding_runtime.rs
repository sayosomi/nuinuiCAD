//! Validates and materializes general numeric-expression BindingId slots.
//! Numeric expression tokens remain owned by the existing
//! numeric-expression runtime after this pass.
use std::collections::{HashMap, HashSet};

use serde_json::{Map, Value};

use super::errors::geometry_error;
use super::scalar_expression_runtime::evaluate_document_typed_expression;
use super::scalars::{
    declared_scalar_expression_type, validate_typed_expression_payload,
    ScalarDocumentBindingResolver, ScalarEvaluation, ScalarEvaluationErrorContext, ScalarType,
    ScalarValue, TypedBuiltinArgument, TypedScalarExpression,
};
use super::types::{
    element_display_name, element_id, element_name, DependencyError, EvaluationState,
};

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
    let mut pending = vec![(expression, Vec::<&str>::new())];
    let mut declared_local_binding_ids = HashSet::new();
    while let Some((node, local_binding_ids)) = pending.pop() {
        match node {
            TypedScalarExpression::Reference { binding_id, .. } => {
                if let Some(binding_id) = binding_id {
                    if !valid_binding_ids.contains(binding_id.as_str())
                        && !local_binding_ids.contains(&binding_id.as_str())
                    {
                        return Err(payload_error(
                            "numeric binding typedExpression reference bindingId does not exist in the scalar program",
                        ));
                    }
                }
            }
            TypedScalarExpression::GeometryProperty {
                element_id,
                geometry_value_occurrence,
                for_group_template_element_id,
                for_group_index,
                ..
            } => {
                let target_element_id = for_group_template_element_id
                    .as_deref()
                    .unwrap_or(element_id.as_str());
                if geometry_value_occurrence.is_none()
                    && !elements_by_id.contains_key(target_element_id)
                {
                    return Err(payload_error(
                        "numeric binding typedExpression geometry target does not match an element",
                    ));
                }
                if let Some(index) = for_group_index {
                    pending.push((index, local_binding_ids));
                }
            }
            TypedScalarExpression::CollectionIndex { index, .. } => {
                pending.push((index, local_binding_ids));
            }
            TypedScalarExpression::Unary { operand, .. }
            | TypedScalarExpression::Group {
                expression: operand,
                ..
            } => pending.push((operand, local_binding_ids)),
            TypedScalarExpression::Binary { left, right, .. } => {
                pending.push((left, local_binding_ids.clone()));
                pending.push((right, local_binding_ids));
            }
            TypedScalarExpression::ValueIf {
                condition,
                then_branch,
                else_branch,
                ..
            } => {
                pending.push((condition, local_binding_ids.clone()));
                pending.push((then_branch, local_binding_ids.clone()));
                pending.push((else_branch, local_binding_ids));
            }
            TypedScalarExpression::ValueMatch {
                scrutinee, arms, ..
            } => {
                let scrutinee_type = declared_scalar_expression_type(scrutinee);
                pending.push((scrutinee, local_binding_ids.clone()));
                for arm in arms {
                    let has_binder_metadata = arm.binder_id.is_some() && arm.binder_type.is_some();
                    if arm.binder_id.is_some() != arm.binder_type.is_some()
                        || arm.binder.is_some() != has_binder_metadata
                    {
                        return Err(payload_error(
                            "numeric binding typedExpression value-match binder metadata is incomplete",
                        ));
                    }

                    let mut arm_binding_ids = local_binding_ids.clone();
                    if let (Some(binder_id), Some(binder_type)) =
                        (arm.binder_id.as_deref(), arm.binder_type.as_ref())
                    {
                        if binder_id.is_empty()
                            || arm.label != "some"
                            || matches!(arm.binder.as_deref(), None | Some(""))
                            || !matches!(
                                scrutinee_type.as_ref(),
                                Some(ScalarType::Optional { value_type }) if value_type.as_ref() == binder_type
                            )
                        {
                            return Err(payload_error(
                                "numeric binding typedExpression value-match binder metadata does not match its optional some arm",
                            ));
                        }
                        if valid_binding_ids.contains(binder_id)
                            || !declared_local_binding_ids.insert(binder_id)
                        {
                            return Err(payload_error(
                                "numeric binding typedExpression value-match binderId must be unique and local",
                            ));
                        }
                        arm_binding_ids.push(binder_id);
                    }
                    pending.push((&arm.expression, arm_binding_ids));
                }
            }
            TypedScalarExpression::Call { args, .. } => {
                for argument in args {
                    if let TypedBuiltinArgument::Scalar { expression } = argument {
                        pending.push((expression, local_binding_ids.clone()));
                    } else if let TypedBuiltinArgument::GeometryReference {
                        target: Some(target),
                        ..
                    } = argument
                    {
                        let target_element_id = target
                            .for_group_template_element_id
                            .as_deref()
                            .unwrap_or(target.statement_id.as_str());
                        if !elements_by_id.contains_key(target_element_id) {
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
            | TypedScalarExpression::NoneLiteral { .. }
            | TypedScalarExpression::ChoiceLiteral { .. }
            | TypedScalarExpression::OptionalMember { .. } => {}
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

fn mapping_error(element: &Value, parameter_key: &str) -> DependencyError {
    let name = element_name(element);
    geometry_error(
        element,
        format!(
            "\"{name}\" の \"{parameter_key}\" の数値式を正準の型付き参照へ対応付けられません。"
        ),
    )
}

fn scalar_issue_message(
    issue_code: &str,
    context: Option<&ScalarEvaluationErrorContext>,
    state: &EvaluationState,
) -> String {
    if issue_code == "evaluation-geometry-builtin-disabled" {
        if let Some(ScalarEvaluationErrorContext::GeometryBuiltinTarget {
            target_element_id,
            point_key,
        }) = context
        {
            let target = state
                .elements_by_id
                .get(target_element_id)
                .and_then(|index| state.elements.get(*index));
            let base = target
                .map(element_display_name)
                .filter(|name| !name.trim().is_empty())
                .unwrap_or_else(|| target_element_id.clone());
            let display_target = point_key
                .as_deref()
                .map_or_else(|| base.clone(), |key| format!("{base}.{key}"));
            let repair_action = if point_key.is_some() {
                format!("「{base}」を評価ONに")
            } else {
                "評価ONに".to_owned()
            };
            return format!(
                "「{display_target}」は評価OFFのためgeometry引数として利用できません。{repair_action}するか、参照先を変更してください。"
            );
        }
    }
    match issue_code {
        "poisoned-binding" => "評価に失敗し無効化されています。",
        "evaluation-binding-unavailable" => "参照先のbindingを解決できません。",
        "evaluation-runtime-value-type-mismatch" => "値の型が宣言と一致しません。",
        "evaluation-binding-cycle-guard" => "循環参照が検出されました。",
        "evaluation-divide-by-zero" => "0での除算が発生しました。",
        "evaluation-remainder-by-zero" => "0での剰余が発生しました。",
        "evaluation-invalid-builtin-argument" => "組み込み関数の引数が不正です。",
        "evaluation-geometry-builtin-unavailable" => "組み込み関数のgeometry引数を評価できません。参照先のgeometryが有効で、正常に評価済みか確認してください。",
        "evaluation-geometry-builtin-disabled" => "組み込み関数のgeometry引数がdisabledのため利用できません。",
        "evaluation-zero-length-line" => "lineDistance/lineAngleでは長さ0のlineを利用できません。",
        "evaluation-sqrt-negative-input" => "sqrtの引数は0以上である必要があります。",
        "evaluation-round-to-non-positive-step" => "roundToのstepは0より大きい必要があります。",
        "evaluation-is-close-negative-tolerance" => "isCloseのtoleranceは0以上である必要があります。",
        "evaluation-tan-odd-multiple-of-90" => "tanは90°+180°×nでは定義できません。別の角度を指定してください。",
        "evaluation-asin-out-of-range" => "asinの引数は-1以上1以下である必要があります。",
        "evaluation-acos-out-of-range" => "acosの引数は-1以上1以下である必要があります。",
        "evaluation-non-finite-result" => "計算結果が数値として不正です。",
        "evaluation-static-type-null" => "型を確定できませんでした。",
        "evaluation-numeric-adapter-failure" => "数値の評価に失敗しました。",
        "evaluation-geometry-property-unavailable" => "要素プロパティはこの位置では評価できません。参照先が前方にあり、有効で、正常に評価済みか確認してください。",
        _ => "実行時エラーが発生しました。",
    }
    .to_owned()
}

fn evaluation_error(
    element: &Value,
    entry: &ValidatedNumericBinding,
    evaluation: ScalarEvaluation,
    state: &EvaluationState,
) -> DependencyError {
    let (issue_code, binding_id, context) = match evaluation {
        ScalarEvaluation::Error {
            issue_code,
            binding_id,
            context,
            ..
        } => (issue_code, binding_id, context),
        ScalarEvaluation::Ok {
            value: ScalarValue::Number(value),
            ..
        } if !value.is_finite() => ("evaluation-non-finite-result".to_owned(), None, None),
        ScalarEvaluation::Ok { .. } => (
            "evaluation-runtime-value-type-mismatch".to_owned(),
            None,
            None,
        ),
    };
    let context_target = match (binding_id.is_none(), context.as_ref()) {
        (
            true,
            Some(ScalarEvaluationErrorContext::GeometryBuiltinTarget {
                target_element_id, ..
            }),
        ) => Some(target_element_id.as_str()),
        _ => None,
    };
    let missing_dependency_id = binding_id
        .as_deref()
        .or(context_target)
        .unwrap_or(&entry.expression)
        .to_owned();
    let missing_dependency_name = context_target.and_then(|target_id| {
        state
            .elements_by_id
            .get(target_id)
            .and_then(|index| state.elements.get(*index))
            .map(element_display_name)
            .map(Into::into)
    });
    let name = element_display_name(element);
    DependencyError {
        code: None,
        element_id: element_id(element).unwrap_or_default(),
        element_name: name.clone(),
        missing_dependency_id,
        missing_dependency_name,
        message: format!(
            "{name} の数値式を評価できません。{}",
            scalar_issue_message(&issue_code, context.as_ref(), state)
        ),
    }
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

#[allow(clippy::result_large_err)]
pub(crate) fn apply_numeric_bindings(
    element: &Value,
    entries: Option<&Vec<ValidatedNumericBinding>>,
    resolver: &dyn ScalarDocumentBindingResolver,
    current_source_order: Option<usize>,
    state: &EvaluationState,
) -> Result<Value, Vec<DependencyError>> {
    let Some(entries) = entries else {
        return Ok(element.clone());
    };
    let mut materialized = element.clone();
    let mut errors = Vec::new();
    for entry in entries {
        let Some(current) = numeric_expression(&materialized, &entry.parameter_key) else {
            errors.push(mapping_error(&materialized, &entry.parameter_key));
            return Err(errors);
        };
        if current != entry.expression {
            errors.push(mapping_error(&materialized, &entry.parameter_key));
            return Err(errors);
        }
        if let Some(expression) = entry.typed_expression.as_ref() {
            let evaluation = evaluate_document_typed_expression(
                expression,
                resolver,
                state,
                current_source_order.map(|order| order as f64),
            );
            let value = match evaluation {
                ScalarEvaluation::Ok {
                    r#type: ScalarType::Number,
                    value: ScalarValue::Number(value),
                } if value.is_finite() => Some(value),
                evaluation => {
                    errors.push(evaluation_error(&materialized, entry, evaluation, state));
                    None
                }
            };
            let Some(value) = value else { continue };
            let Some(target) = numeric_expression_mut(&mut materialized, &entry.parameter_key)
            else {
                errors.push(mapping_error(&materialized, &entry.parameter_key));
                return Err(errors);
            };
            *target = Value::from(value);
            continue;
        }
        let mut expression = current.to_owned();
        let mut entry_failed = false;
        for reference in entry.references.iter().rev() {
            let evaluation = resolver.resolve_binding(&reference.binding_id, state);
            let value = match evaluation {
                ScalarEvaluation::Ok {
                    r#type: ScalarType::Number,
                    value: ScalarValue::Number(value),
                } if value.is_finite() => Some(value),
                evaluation => {
                    errors.push(evaluation_error(&materialized, entry, evaluation, state));
                    entry_failed = true;
                    None
                }
            };
            let Some(value) = value else { break };
            let Some(start) = utf16_byte_offset(&expression, reference.expression_start) else {
                errors.push(mapping_error(&materialized, &entry.parameter_key));
                return Err(errors);
            };
            let Some(end) = utf16_byte_offset(&expression, reference.expression_end) else {
                errors.push(mapping_error(&materialized, &entry.parameter_key));
                return Err(errors);
            };
            if expression.get(start..end) != Some(&format!("@{}", reference.name)) {
                errors.push(mapping_error(&materialized, &entry.parameter_key));
                return Err(errors);
            }
            let Some(literal) = numeric_literal_for_expression(value) else {
                errors.push(evaluation_error(
                    &materialized,
                    entry,
                    ScalarEvaluation::Error {
                        r#type: ScalarType::Number,
                        issue_code: "evaluation-non-finite-result".to_owned(),
                        binding_id: None,
                        context: None,
                    },
                    state,
                ));
                entry_failed = true;
                break;
            };
            expression.replace_range(start..end, &literal);
        }
        if entry_failed {
            continue;
        }
        let Some(target) = numeric_expression_mut(&mut materialized, &entry.parameter_key) else {
            errors.push(mapping_error(&materialized, &entry.parameter_key));
            return Err(errors);
        };
        *target = Value::Object(Map::from_iter([
            ("kind".to_owned(), Value::String("expression".to_owned())),
            ("expression".to_owned(), Value::String(expression)),
        ]));
    }
    if errors.is_empty() {
        Ok(materialized)
    } else {
        Err(errors)
    }
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

    fn typed_reference(name: &str, binding_id: &str, scalar_type: Value) -> Value {
        json!({
            "kind": "reference",
            "span": {"start": 0, "end": 10},
            "nameSpan": {"start": 1, "end": 6},
            "name": name,
            "bindingId": binding_id,
            "type": scalar_type
        })
    }

    fn number_type() -> Value {
        json!({"kind": "number"})
    }

    fn optional_number_type() -> Value {
        json!({"kind": "optional", "valueType": number_type()})
    }

    fn typed_value_match(binder_id: &str, binder_name: &str, some_expression: Value) -> Value {
        json!({
            "kind": "valueMatch",
            "span": {"start": 0, "end": 60},
            "scrutinee": typed_reference("maybe", "binding:maybe", optional_number_type()),
            "arms": [
                {
                    "label": "none",
                    "labelSpan": {"start": 20, "end": 24},
                    "expression": number_literal(0.0)
                },
                {
                    "label": "some",
                    "labelSpan": {"start": 30, "end": 34},
                    "binder": binder_name,
                    "binderSpan": {"start": 35, "end": 35 + binder_name.len()},
                    "binderId": binder_id,
                    "binderType": number_type(),
                    "expression": some_expression
                }
            ],
            "type": number_type()
        })
    }

    fn numeric_match_entry(typed_expression: Value) -> Value {
        numeric_entry(
            "match @maybe { none => 0 some value => @value }",
            Some(typed_expression),
            json!([{
                "bindingId": "binding:maybe",
                "name": "maybe",
                "expressionStart": 6,
                "expressionEnd": 12
            }]),
        )
    }

    fn iteration_reference_expression() -> Value {
        json!({
            "kind": "reference",
            "span": {"start": 0, "end": 2},
            "nameSpan": {"start": 1, "end": 2},
            "name": "x",
            "bindingId": "binding:iteration:loop",
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
            completed_transformation_recipe_indices: std::collections::HashSet::new(),
            transformation_dependency_plans: None,
            geometry_input_targets: HashMap::new(),
            geometry_collection_nodes: HashMap::new(),
            geometry_value_binders: HashMap::new(),
            for_group_generated_rows: Vec::new(),
            for_group_expected_occurrence_count_by_template_id: HashMap::new(),
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
            selected_drawing_profile_id: None,
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
            base_transformation_geometry: HashMap::new(),
            transformation_stage_geometry: HashMap::new(),
            computed_geometry_values: HashMap::new(),
            computed_geometry_order: vec![String::from("baseline"), String::from("p")],
            pre_mutation_geometry: HashMap::new(),
            geometry_mutation_executions: Vec::new(),
            condition_evaluation_traces: Vec::new(),
            instance_base_geometry: HashMap::new(),
            errors: Vec::new(),
            geometry_value_errors: Vec::new(),
            warnings: Vec::new(),
        }
    }

    fn state(element: Value) -> EvaluationState {
        EvaluationState {
            completed_transformation_recipe_indices: std::collections::HashSet::new(),
            transformation_dependency_plans: None,
            geometry_input_targets: HashMap::new(),
            geometry_collection_nodes: HashMap::new(),
            geometry_value_binders: HashMap::new(),
            for_group_generated_rows: Vec::new(),
            for_group_expected_occurrence_count_by_template_id: HashMap::new(),
            elements: vec![element],
            elements_by_id: HashMap::from([(String::from("p"), 0)]),
            drawing_modifiers: serde_json::json!([]),
            selected_drawing_profile_id: None,
            group_states: HashMap::new(),
            computed_geometry: HashMap::new(),
            base_transformation_geometry: HashMap::new(),
            transformation_stage_geometry: HashMap::new(),
            computed_geometry_values: HashMap::new(),
            computed_geometry_order: Vec::new(),
            pre_mutation_geometry: HashMap::new(),
            geometry_mutation_executions: Vec::new(),
            condition_evaluation_traces: Vec::new(),
            instance_base_geometry: HashMap::new(),
            errors: Vec::new(),
            geometry_value_errors: Vec::new(),
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
    fn accepts_numeric_geometry_properties_resolved_to_geometry_value_occurrences() {
        let element = point_with_expression("@P.x");
        let elements_by_id = HashMap::from([("p", &element)]);
        let geometry_value_property = json!({
            "kind": "geometryProperty",
            "span": {"start": 0, "end": 4},
            "elementNameSpan": {"start": 1, "end": 2},
            "propertySpan": {"start": 3, "end": 4},
            "elementName": "P",
            "elementId": null,
            "geometryValueOccurrence": {
                "sourceStatementId": "statement:immutable-point",
                "instancePath": []
            },
            "property": "x",
            "targetSourceOrder": 0,
            "type": {"kind": "number"}
        });

        let decoded = validate_numeric_bindings_payload(
            &json!([numeric_entry(
                "@P.x",
                Some(geometry_value_property),
                json!([])
            )]),
            &elements_by_id,
            &HashSet::new(),
        );

        assert!(decoded.is_ok());
    }

    #[test]
    fn accepts_typed_expression_references_to_their_value_match_arm_binder() {
        let element = point_with_expression("match @maybe { none => 0 some value => @value }");
        let elements_by_id = HashMap::from([("p", &element)]);
        let expression = typed_value_match(
            "optional-match-binder:local",
            "value",
            typed_reference("value", "optional-match-binder:local", number_type()),
        );

        let decoded = validate_numeric_bindings_payload(
            &json!([numeric_match_entry(expression)]),
            &elements_by_id,
            &HashSet::from(["binding:maybe"]),
        );

        assert!(decoded.is_ok());
    }

    #[test]
    fn rejects_typed_expression_references_to_a_value_match_binder_outside_its_arm() {
        let element = point_with_expression("match @maybe { none => 0 some value => @value }");
        let elements_by_id = HashMap::from([("p", &element)]);
        let local_match =
            typed_value_match("optional-match-binder:local", "value", number_literal(1.0));
        let expression = json!({
            "kind": "binary",
            "span": {"start": 0, "end": 80},
            "operator": "+",
            "left": local_match,
            "right": typed_reference(
                "value",
                "optional-match-binder:local",
                number_type()
            ),
            "type": number_type()
        });

        let result = validate_numeric_bindings_payload(
            &json!([numeric_match_entry(expression)]),
            &elements_by_id,
            &HashSet::from(["binding:maybe"]),
        );

        assert!(
            matches!(result, Err(error) if error.contains("does not exist in the scalar program"))
        );
    }

    #[test]
    fn rejects_typed_expression_references_to_undeclared_value_match_binder_ids() {
        let element = point_with_expression("match @maybe { none => 0 some value => @value }");
        let elements_by_id = HashMap::from([("p", &element)]);
        let expression = typed_value_match(
            "optional-match-binder:local",
            "value",
            typed_reference("value", "optional-match-binder:forged", number_type()),
        );

        let result = validate_numeric_bindings_payload(
            &json!([numeric_match_entry(expression)]),
            &elements_by_id,
            &HashSet::from(["binding:maybe"]),
        );

        assert!(
            matches!(result, Err(error) if error.contains("does not exist in the scalar program"))
        );
    }

    #[test]
    fn rejects_value_match_binder_ids_that_collide_with_scalar_program_ids() {
        let element = point_with_expression("match @maybe { none => 0 some value => @value }");
        let elements_by_id = HashMap::from([("p", &element)]);
        let expression = typed_value_match(
            "binding:maybe",
            "value",
            typed_reference("value", "binding:maybe", number_type()),
        );

        let result = validate_numeric_bindings_payload(
            &json!([numeric_match_entry(expression)]),
            &elements_by_id,
            &HashSet::from(["binding:maybe"]),
        );

        assert!(
            matches!(result, Err(error) if error.contains("binderId must be unique and local"))
        );
    }

    #[test]
    fn accepts_nested_value_match_binders_in_their_lexical_scopes() {
        let element = point_with_expression("match @maybe { none => 0 some value => @value }");
        let elements_by_id = HashMap::from([("p", &element)]);
        let inner_expression = typed_value_match(
            "optional-match-binder:inner",
            "inner",
            json!({
                "kind": "binary",
                "span": {"start": 0, "end": 20},
                "operator": "+",
                "left": typed_reference(
                    "outer",
                    "optional-match-binder:outer",
                    number_type()
                ),
                "right": typed_reference(
                    "inner",
                    "optional-match-binder:inner",
                    number_type()
                ),
                "type": number_type()
            }),
        );
        let expression =
            typed_value_match("optional-match-binder:outer", "outer", inner_expression);

        let decoded = validate_numeric_bindings_payload(
            &json!([numeric_match_entry(expression)]),
            &elements_by_id,
            &HashSet::from(["binding:maybe"]),
        );

        assert!(decoded.is_ok());
    }

    #[test]
    fn rejects_nested_value_match_binder_after_leaving_its_arm() {
        let element = point_with_expression("match @maybe { none => 0 some value => @value }");
        let elements_by_id = HashMap::from([("p", &element)]);
        let inner_expression = typed_value_match(
            "optional-match-binder:inner",
            "inner",
            json!({
                "kind": "binary",
                "span": {"start": 0, "end": 20},
                "operator": "+",
                "left": typed_reference(
                    "outer",
                    "optional-match-binder:outer",
                    number_type()
                ),
                "right": typed_reference(
                    "inner",
                    "optional-match-binder:inner",
                    number_type()
                ),
                "type": number_type()
            }),
        );
        let outer_arm_expression = json!({
            "kind": "binary",
            "span": {"start": 0, "end": 80},
            "operator": "+",
            "left": inner_expression,
            "right": typed_reference(
                "inner",
                "optional-match-binder:inner",
                number_type()
            ),
            "type": number_type()
        });
        let expression =
            typed_value_match("optional-match-binder:outer", "outer", outer_arm_expression);

        let result = validate_numeric_bindings_payload(
            &json!([numeric_match_entry(expression)]),
            &elements_by_id,
            &HashSet::from(["binding:maybe"]),
        );

        assert!(
            matches!(result, Err(error) if error.contains("does not exist in the scalar program"))
        );
    }

    #[test]
    fn resolves_typed_numeric_iteration_binding_ids_from_iteration_overrides() {
        let element = point_with_expression("@x");
        let elements_by_id = HashMap::from([("p", &element)]);
        let valid_ids = HashSet::from(["binding:iteration:loop"]);
        let decoded = validate_numeric_bindings_payload(
            &json!([numeric_entry(
                "@x",
                Some(iteration_reference_expression()),
                json!([{
                    "bindingId": "binding:iteration:loop",
                    "name": "x",
                    "expressionStart": 0,
                    "expressionEnd": 2
                }])
            )]),
            &elements_by_id,
            &valid_ids,
        )
        .unwrap();
        let result = apply_numeric_bindings(
            &element,
            Some(&decoded),
            &StubResolver(ScalarEvaluation::Ok {
                r#type: ScalarType::Number,
                value: ScalarValue::Number(2.0),
            }),
            None,
            &state(element.clone()),
        )
        .unwrap();
        assert_eq!(result["x"], json!(2.0));
    }

    #[test]
    fn resolves_typed_numeric_iteration_binding_ids_to_range_values() {
        use super::super::for_group::IterationScalarBindingResolver;

        let element = point_with_expression("@x");
        let elements_by_id = HashMap::from([("p", &element)]);
        let valid_ids = HashSet::from(["binding:iteration:loop"]);
        let decoded = validate_numeric_bindings_payload(
            &json!([numeric_entry(
                "@x",
                Some(iteration_reference_expression()),
                json!([{
                    "bindingId": "binding:iteration:loop",
                    "name": "x",
                    "expressionStart": 0,
                    "expressionEnd": 2
                }])
            )]),
            &elements_by_id,
            &valid_ids,
        )
        .unwrap();
        let fallback = ScalarEvaluation::Ok {
            r#type: ScalarType::Number,
            value: ScalarValue::Number(-1.0),
        };
        let iteration = vec![json!({
            "id": "loop:iteration",
            "name": "x",
            "value": 2.0
        })];
        let iteration_binding_ids = vec!["binding:iteration:loop".to_owned()];
        let iteration_value_overrides = vec![None];
        let base_resolver = StubResolver(fallback);
        let resolver = IterationScalarBindingResolver::new(
            &base_resolver,
            &iteration,
            &iteration_binding_ids,
            &iteration_value_overrides,
        );
        let result = apply_numeric_bindings(
            &element,
            Some(&decoded),
            &resolver,
            None,
            &state(element.clone()),
        )
        .unwrap();
        assert_eq!(result["x"], json!(2.0));
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
