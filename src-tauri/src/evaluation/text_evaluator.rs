use serde_json::{json, Value};
use std::collections::HashMap;

use super::numeric_expression::evaluate_numeric_or_push;
use super::point_anchor::point_anchor_or_error;
use super::scalars::{ScalarDocumentBindingResolver, ValidatedTextTemplate};
use super::text_template_runtime::resolve_text_template;
use super::types::{element_id, element_name, insert_geometry, ElementId, EvaluationState};

pub(crate) fn text_number(value: f64) -> String {
    if (value - value.round()).abs() < 0.000_000_001 {
        format!("{value:.0}")
    } else {
        format!("{value:.3}")
            .trim_end_matches('0')
            .trim_end_matches('.')
            .to_owned()
    }
}

fn property_key(value: &str) -> &str {
    match value {
        "長さ" => "length",
        "始角度" => "startAngleDeg",
        "終角度" => "endAngleDeg",
        "始点接線角度" => "startTangentAngleDeg",
        "終点接線角度" => "endTangentAngleDeg",
        "始点ハンドル角度" => "startHandleAngleDeg",
        "始点ハンドル長" => "startHandleLength",
        "終点ハンドル角度" => "endHandleAngleDeg",
        "終点ハンドル長" => "endHandleLength",
        _ => value,
    }
}

/// Maps each `.`-separated segment of a property path through `property_key`
/// individually (Task 51: the `@` branch's delimiter scan does not stop at
/// `.`, so an `@AB.startPoint.x` occurrence carries its full path here,
/// unlike the bare-form scanner below which only ever sees one segment at a
/// time).
fn property_path_key(path: &str) -> String {
    path.split('.')
        .map(property_key)
        .collect::<Vec<_>>()
        .join(".")
}

fn element_id_or_name(value: &str, state: &EvaluationState) -> String {
    if state.computed_geometry.contains_key(value) || state.elements_by_id.contains_key(value) {
        return value.to_owned();
    }
    state
        .elements
        .iter()
        .find(|element| element_name(element) == value)
        .and_then(element_id)
        .unwrap_or_else(|| value.to_owned())
}

fn is_expression_delimiter(ch: char) -> bool {
    ch.is_whitespace()
        || matches!(
            ch,
            '(' | ')' | ',' | '+' | '*' | '/' | '>' | '<' | '=' | '!' | '&' | '|'
        )
}

/// Task 51 Rule R(1): `@Self.localVarName` resolves to the current element's
/// own numeric variable only when exactly one variable shares that name -
/// mirrors the TS side's `localVariableNameCounts > 1` skip
/// (numericExpressions.ts). An ambiguous or absent match falls through to
/// Rule R(2) (element-property resolution) rather than guessing.
fn local_variable_id_for_display_name(display_name: &str, element: &Value) -> Option<String> {
    let (element_name_part, variable_name) = display_name.split_once('.')?;
    if element_name_part != element_name(element) {
        return None;
    }
    let mut matches = element
        .get("numericVariables")
        .and_then(Value::as_array)?
        .iter()
        .filter(|variable| variable.get("name").and_then(Value::as_str) == Some(variable_name));
    let only = matches.next()?;
    if matches.next().is_some() {
        return None;
    }
    only.get("id").and_then(Value::as_str).map(str::to_owned)
}

pub(crate) fn normalize_text_expression(
    expression: &str,
    element: &Value,
    state: &EvaluationState,
) -> String {
    let chars = expression.chars().collect::<Vec<_>>();
    let mut index = 0;
    let mut output = String::new();

    while index < chars.len() {
        let ch = chars[index];
        if ch == '@' {
            index += 1;
            let start = index;
            while index < chars.len() && !is_expression_delimiter(chars[index]) {
                index += 1;
            }
            let name = chars[start..index].iter().collect::<String>();
            // Task 51 Rule R: R(1) (the current element's own unique local
            // variable) wins first; otherwise, if the name contains a `.`,
            // it is an `@Element.property` reference (Rule R(2)) and the
            // sigil is dropped, lowering to the exact same sigil-free IR the
            // bare form below produces. A plain `@variable` with no dot
            // keeps its sigil unchanged.
            if let Some(variable_id) = local_variable_id_for_display_name(&name, element) {
                output.push('@');
                output.push_str(&variable_id);
            } else if let Some((head, tail)) = name.split_once('.') {
                output.push_str(&element_id_or_name(head, state));
                output.push('.');
                output.push_str(&property_path_key(tail));
            } else {
                output.push('@');
                output.push_str(&name);
            }
            continue;
        }

        if !is_expression_delimiter(ch) {
            let start = index;
            while index < chars.len()
                && !is_expression_delimiter(chars[index])
                && chars[index] != '.'
            {
                index += 1;
            }
            if index < chars.len() && chars[index] == '.' {
                let name = chars[start..index].iter().collect::<String>();
                index += 1;
                let property_start = index;
                while index < chars.len()
                    && !is_expression_delimiter(chars[index])
                    && chars[index] != '.'
                {
                    index += 1;
                }
                let property = chars[property_start..index].iter().collect::<String>();
                output.push_str(&format!(
                    "{}.{}",
                    element_id_or_name(&name, state),
                    property_key(&property)
                ));
                continue;
            }
            output.push_str(&chars[start..index].iter().collect::<String>());
            continue;
        }

        output.push(ch);
        index += 1;
    }

    output
}

fn resolve_text(
    text: &str,
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) -> Option<String> {
    let chars = text.chars().collect::<Vec<_>>();
    let mut index = 0;
    let mut output = String::new();

    while index < chars.len() {
        let ch = chars[index];
        if ch == '{' {
            index += 1;
            let expression_start = index;
            while index < chars.len() && chars[index] != '}' {
                index += 1;
            }
            if index >= chars.len() {
                output.push('{');
                output.push_str(&chars[expression_start..index].iter().collect::<String>());
                continue;
            }
            let expression = chars[expression_start..index]
                .iter()
                .collect::<String>()
                .trim()
                .to_owned();
            let expression = normalize_text_expression(&expression, element, state);
            let value = json!({ "kind": "expression", "expression": expression });
            output.push_str(&text_number(evaluate_numeric_or_push(
                &value,
                state,
                element,
                &local_variables.0,
                &local_variables.1,
            )?));
            index += 1;
            continue;
        }

        output.push(ch);
        index += 1;
    }

    Some(output)
}

pub(crate) struct TextTemplateContext<'a> {
    pub(crate) lookup_id: &'a ElementId,
    pub(crate) by_element_id: &'a HashMap<ElementId, ValidatedTextTemplate>,
    pub(crate) scalar_binding_resolver: Option<&'a dyn ScalarDocumentBindingResolver>,
}

pub(crate) fn evaluate_text(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    template_context: TextTemplateContext,
    state: &mut EvaluationState,
) {
    let Some(font_size) = evaluate_numeric_or_push(
        element.get("fontSize").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(text) = (match template_context
        .by_element_id
        .get(template_context.lookup_id)
    {
        Some(template) => resolve_text_template(
            template,
            element,
            local_variables,
            template_context.scalar_binding_resolver,
            state,
        ),
        None => resolve_text(
            element
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            element,
            local_variables,
            state,
        ),
    }) else {
        return;
    };
    let anchor = match element.get("anchor") {
        Some(Value::Null) | None => Value::Null,
        Some(anchor_value) => {
            let Some(point) = point_anchor_or_error(
                element,
                anchor_value,
                "anchor",
                state,
                &local_variables.0,
                &local_variables.1,
            ) else {
                return;
            };
            json!({
                "kind": "point",
                "elementId": point.element_id,
                "name": point.name,
                "x": point.x,
                "y": point.y
            })
        }
    };
    let id = element_id(element).unwrap_or_default();
    insert_geometry(
        state,
        id.clone(),
        json!({
            "kind": "text",
            "elementId": id,
            "name": element_name(element),
            "text": text,
            "anchor": anchor,
            "fontSize": font_size
        }),
    );
}
