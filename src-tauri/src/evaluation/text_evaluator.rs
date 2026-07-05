use serde_json::{json, Value};
use std::collections::HashMap;

use super::numeric_expression::evaluate_numeric_or_push;
use super::point_anchor::point_anchor_or_error;
use super::types::{element_id, element_name, insert_geometry, EvaluationState};

fn text_number(value: f64) -> String {
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

fn is_text_delimiter(ch: char) -> bool {
    ch.is_whitespace()
        || matches!(
            ch,
            '(' | ')'
                | ','
                | '+'
                | '*'
                | '/'
                | '>'
                | '<'
                | '='
                | '!'
                | '&'
                | '|'
                | '、'
                | '。'
                | '！'
                | '？'
                | '「'
                | '」'
                | '（'
                | '）'
                | '【'
                | '】'
                | '［'
                | '］'
                | '{'
                | '}'
        )
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
        if ch == '@' {
            let start = index;
            index += 1;
            while index < chars.len() && !is_text_delimiter(chars[index]) && chars[index] != '.' {
                index += 1;
            }
            let expression = chars[start..index].iter().collect::<String>();
            let value = json!({ "kind": "expression", "expression": expression });
            output.push_str(&text_number(evaluate_numeric_or_push(
                &value,
                state,
                element,
                &local_variables.0,
                &local_variables.1,
            )?));
            continue;
        }

        if !is_text_delimiter(ch) {
            let start = index;
            while index < chars.len() && !is_text_delimiter(chars[index]) && chars[index] != '.' {
                index += 1;
            }
            if index < chars.len() && chars[index] == '.' {
                let name = chars[start..index].iter().collect::<String>();
                index += 1;
                let property_start = index;
                while index < chars.len() && !is_text_delimiter(chars[index]) && chars[index] != '.'
                {
                    index += 1;
                }
                let property = chars[property_start..index].iter().collect::<String>();
                let expression = format!(
                    "{}.{}",
                    element_id_or_name(&name, state),
                    property_key(&property)
                );
                let value = json!({ "kind": "expression", "expression": expression });
                output.push_str(&text_number(evaluate_numeric_or_push(
                    &value,
                    state,
                    element,
                    &local_variables.0,
                    &local_variables.1,
                )?));
                continue;
            }
            output.push_str(&chars[start..index].iter().collect::<String>());
            continue;
        }

        output.push(ch);
        index += 1;
    }

    Some(output)
}

pub(crate) fn evaluate_text(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
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
    let Some(text) = resolve_text(
        element
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        element,
        local_variables,
        state,
    ) else {
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
