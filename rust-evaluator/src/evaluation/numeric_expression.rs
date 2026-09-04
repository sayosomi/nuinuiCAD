use serde_json::Value;
use std::collections::HashMap;

use super::errors::numeric_error;
use super::point_anchor::{point_from_geometry, point_from_value, resolve_derived_point};
use super::types::{
    element_id, element_name, find_element_name, EvaluationState, NumericEvalError, Point, Token,
};

pub(crate) fn numeric_value(
    value: &Value,
    state: &EvaluationState,
    element: &Value,
    local_variables: &HashMap<String, f64>,
    local_variable_names: &HashMap<String, String>,
) -> Result<f64, NumericEvalError> {
    if let Some(number) = value.as_f64() {
        return Ok(number);
    }
    let expression = value
        .get("expression")
        .and_then(Value::as_str)
        .ok_or_else(|| NumericEvalError {
            dependency_id: element_id(element).unwrap_or_default(),
            dependency_name: Some(element_name(element)),
            message: "数値が必要です。".to_owned(),
        })?;
    let tokens = tokenize(expression).map_err(|message| NumericEvalError {
        dependency_id: expression.to_owned(),
        dependency_name: None,
        message,
    })?;
    Parser::new(
        expression,
        tokens,
        state,
        element,
        local_variables,
        local_variable_names,
    )
    .parse()
}

pub(crate) fn evaluate_numeric_or_push(
    value: &Value,
    state: &mut EvaluationState,
    element: &Value,
    local_variables: &HashMap<String, f64>,
    local_variable_names: &HashMap<String, String>,
) -> Option<f64> {
    match numeric_value(value, state, element, local_variables, local_variable_names) {
        Ok(value) => Some(value),
        Err(error) => {
            numeric_error(state, element, error);
            None
        }
    }
}

pub(crate) fn tokenize(expression: &str) -> Result<Vec<Token>, String> {
    let chars = expression.chars().collect::<Vec<_>>();
    let mut tokens = Vec::new();
    let mut index = 0;

    while index < chars.len() {
        let ch = chars[index];
        if ch.is_whitespace() {
            index += 1;
            continue;
        }
        match ch {
            '(' => {
                tokens.push(Token::LeftParen);
                index += 1;
                continue;
            }
            ')' => {
                tokens.push(Token::RightParen);
                index += 1;
                continue;
            }
            ',' => {
                tokens.push(Token::Comma);
                index += 1;
                continue;
            }
            '+' | '-' | '*' | '/' => {
                tokens.push(Token::Operator(ch));
                index += 1;
                continue;
            }
            _ => {}
        }
        if matches!(ch, '&' | '|') {
            let next = chars.get(index + 1).copied();
            let operator = match (ch, next) {
                ('&', Some('&')) | ('|', Some('|')) => {
                    index += 2;
                    [ch, ch].iter().collect::<String>()
                }
                _ => return Err(format!("式を解釈できません: {}", &expression[index..])),
            };
            tokens.push(Token::LogicalOperator(operator));
            continue;
        }
        if matches!(ch, '>' | '<' | '=' | '!') {
            let next = chars.get(index + 1).copied();
            let operator = match (ch, next) {
                ('>', Some('=')) | ('<', Some('=')) | ('=', Some('=')) | ('!', Some('=')) => {
                    index += 2;
                    [ch, '='].iter().collect::<String>()
                }
                ('>', _) | ('<', _) => {
                    index += 1;
                    ch.to_string()
                }
                _ => return Err(format!("式を解釈できません: {}", &expression[index..])),
            };
            tokens.push(Token::ComparisonOperator(operator));
            continue;
        }

        if ch.is_ascii_digit() || ch == '.' {
            let start = index;
            let mut saw_dot = ch == '.';
            index += 1;
            while index < chars.len() {
                let next = chars[index];
                if next.is_ascii_digit() {
                    index += 1;
                } else if next == '.' && !saw_dot {
                    saw_dot = true;
                    index += 1;
                } else {
                    break;
                }
            }
            let text = chars[start..index].iter().collect::<String>();
            let value = text
                .parse::<f64>()
                .map_err(|_| format!("数値を解釈できません: {text}"))?;
            tokens.push(Token::Number(value));
            continue;
        }

        if ch == '@' {
            // Task 51: stops at `.` exactly like the TS tokenizer's own
            // localVariable pattern (numericExpressionParser.ts) - under the
            // IR design an `@token` in this normalized, sigil-resolved
            // expression string is never legitimately followed by a dot (an
            // `@Element.property` occurrence has its sigil stripped before
            // reaching either engine). Without this, `@id.length` would
            // silently tokenize as `LocalVariable("id.length")` here while
            // TS stops at the dot, diverging on any malformed input that
            // reaches this far.
            let start = index + 1;
            index = start;
            while index < chars.len()
                && !is_expression_delimiter(chars[index])
                && chars[index] != '.'
            {
                index += 1;
            }
            tokens.push(Token::LocalVariable(chars[start..index].iter().collect()));
            continue;
        }

        let start = index;
        while index < chars.len() && !is_expression_delimiter(chars[index]) && chars[index] != '.' {
            index += 1;
        }
        let first = chars[start..index].iter().collect::<String>();
        if index < chars.len() && chars[index] == '.' {
            index += 1;
            let property_start = index;
            while index < chars.len() && !is_expression_delimiter(chars[index]) {
                index += 1;
            }
            tokens.push(Token::Reference {
                element_id: first,
                property: chars[property_start..index].iter().collect(),
            });
            continue;
        }
        if first == "pi" {
            tokens.push(Token::Number(std::f64::consts::PI));
            continue;
        }
        if index < chars.len()
            && chars[index] == '('
            && matches!(
                first.as_str(),
                "distance" | "距離" | "angle" | "角度" | "lineDistance" | "点線距離" | "sqrt"
            )
        {
            let name = match first.as_str() {
                "距離" => "distance",
                "角度" => "angle",
                "点線距離" => "lineDistance",
                _ => first.as_str(),
            };
            tokens.push(Token::Function(name.to_owned()));
            continue;
        }
        if first.is_empty() {
            return Err(format!("式を解釈できません: {}", &expression[index..]));
        }
        tokens.push(Token::Element(first));
    }

    Ok(tokens)
}

fn normalize_degrees(degrees: f64) -> f64 {
    degrees.rem_euclid(360.0)
}

fn is_expression_delimiter(ch: char) -> bool {
    ch.is_whitespace()
        || matches!(
            ch,
            '(' | ')' | ',' | '+' | '*' | '/' | '>' | '<' | '=' | '!' | '&' | '|'
        )
}

fn point_axis_value(value: Option<&Value>, axis: &str) -> Option<f64> {
    value?.get(axis)?.as_f64()
}

const GEOMETRY_EPSILON: f64 = 1e-9;

fn point_coordinates(value: Option<&Value>) -> Option<(f64, f64)> {
    let value = value?;
    Some((value.get("x")?.as_f64()?, value.get("y")?.as_f64()?))
}

fn direction_angle(from: Option<&Value>, to: Option<&Value>) -> Option<f64> {
    let (from_x, from_y) = point_coordinates(from)?;
    let (to_x, to_y) = point_coordinates(to)?;
    let dx = to_x - from_x;
    let dy = to_y - from_y;
    if dx.hypot(dy) <= GEOMETRY_EPSILON {
        return None;
    }
    Some(normalize_degrees(dy.atan2(dx).to_degrees()))
}

fn finite_direction_angle(from: Option<&Value>, to: Option<&Value>) -> Option<f64> {
    direction_angle(from, to).filter(|angle| angle.is_finite())
}

fn finite_point_distance(from: Option<&Value>, to: Option<&Value>) -> Option<f64> {
    let (from_x, from_y) = point_coordinates(from)?;
    let (to_x, to_y) = point_coordinates(to)?;
    let distance = (to_x - from_x).hypot(to_y - from_y);
    distance.is_finite().then_some(distance)
}

fn reverse_direction(angle: Option<f64>) -> Option<f64> {
    angle.map(|value| normalize_degrees(value + 180.0))
}

fn bezier_start_forward_direction(segment: &Value) -> Option<f64> {
    direction_angle(segment.get("start"), segment.get("control1"))
        .or_else(|| direction_angle(segment.get("start"), segment.get("control2")))
        .or_else(|| direction_angle(segment.get("start"), segment.get("end")))
}

fn bezier_end_forward_direction(segment: &Value) -> Option<f64> {
    direction_angle(segment.get("control2"), segment.get("end"))
        .or_else(|| direction_angle(segment.get("control1"), segment.get("end")))
        .or_else(|| direction_angle(segment.get("start"), segment.get("end")))
}

fn first_segment_direction<F>(segments: &[Value], direction: F) -> Option<f64>
where
    F: Fn(&Value) -> Option<f64>,
{
    segments.iter().find_map(direction)
}

fn last_interior_direction<F>(segments: &[Value], direction: F) -> Option<f64>
where
    F: Fn(&Value) -> Option<f64>,
{
    segments
        .iter()
        .rev()
        .find_map(|segment| reverse_direction(direction(segment)))
}

fn arc_endpoint_directions(geometry: &Value) -> (Option<f64>, Option<f64>) {
    let radius = geometry
        .get("radius")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let sweep = geometry
        .get("sweepAngleDeg")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    if radius.abs() <= GEOMETRY_EPSILON || sweep.abs() <= GEOMETRY_EPSILON {
        return (None, None);
    }
    let offset = if sweep >= 0.0 { 90.0 } else { -90.0 };
    let start = direction_angle(geometry.get("center"), geometry.get("start"))
        .map(|angle| normalize_degrees(angle + offset));
    let end = direction_angle(geometry.get("center"), geometry.get("end"))
        .map(|angle| normalize_degrees(angle + offset + 180.0));
    (start, end)
}

fn offset_segment_start_direction(segment: &Value) -> Option<f64> {
    match segment.get("kind").and_then(Value::as_str) {
        Some("line") => direction_angle(segment.get("start"), segment.get("end")),
        Some("bezier") => bezier_start_forward_direction(segment),
        Some("arc") => {
            let radius = segment.get("radius").and_then(Value::as_f64)?;
            let sweep = segment.get("sweepAngleDeg").and_then(Value::as_f64)?;
            if radius.abs() <= GEOMETRY_EPSILON || sweep.abs() <= GEOMETRY_EPSILON {
                return None;
            }
            let offset = if sweep >= 0.0 { 90.0 } else { -90.0 };
            Some(normalize_degrees(
                direction_angle(segment.get("center"), segment.get("start"))? + offset,
            ))
        }
        _ => None,
    }
}

fn offset_segment_end_forward_direction(segment: &Value) -> Option<f64> {
    match segment.get("kind").and_then(Value::as_str) {
        Some("line") => direction_angle(segment.get("start"), segment.get("end")),
        Some("bezier") => bezier_end_forward_direction(segment),
        Some("arc") => {
            let radius = segment.get("radius").and_then(Value::as_f64)?;
            let sweep = segment.get("sweepAngleDeg").and_then(Value::as_f64)?;
            if radius.abs() <= GEOMETRY_EPSILON || sweep.abs() <= GEOMETRY_EPSILON {
                return None;
            }
            let offset = if sweep >= 0.0 { 90.0 } else { -90.0 };
            Some(normalize_degrees(
                direction_angle(segment.get("center"), segment.get("end"))? + offset,
            ))
        }
        _ => None,
    }
}

/// The sole canonical computed-geometry property accessor. Typed scalar
/// evaluation calls this too; neither evaluator owns a second property map.
pub(crate) fn computed_reference_value(geometry: &Value, property: &str) -> Option<f64> {
    let kind = geometry.get("kind")?.as_str()?;
    if kind == "point" {
        return point_axis_value(Some(geometry), property);
    }
    if kind == "image" {
        return match property {
            "originPoint.x" => point_axis_value(geometry.get("origin"), "x"),
            "originPoint.y" => point_axis_value(geometry.get("origin"), "y"),
            "widthMm" | "heightMm" | "scale" | "angleDeg" | "naturalWidthPx"
            | "naturalHeightPx" | "sourceDpi" | "targetPixelsPerMm" => {
                geometry.get(property)?.as_f64()
            }
            _ => None,
        };
    }
    if kind == "text" {
        return match property {
            "anchorPoint.x" => point_axis_value(geometry.get("anchor"), "x"),
            "anchorPoint.y" => point_axis_value(geometry.get("anchor"), "y"),
            "fontSize" => geometry.get("fontSize")?.as_f64(),
            _ => None,
        };
    }

    let (start, end) = if kind == "bezierCurve" {
        let segments = geometry.get("segments").and_then(Value::as_array);
        (
            segments
                .and_then(|segments| segments.first())
                .and_then(|segment| segment.get("start")),
            segments
                .and_then(|segments| segments.last())
                .and_then(|segment| segment.get("end")),
        )
    } else {
        (geometry.get("start"), geometry.get("end"))
    };
    match property {
        "startPoint.x" => point_axis_value(start, "x"),
        "startPoint.y" => point_axis_value(start, "y"),
        "endPoint.x" => point_axis_value(end, "x"),
        "endPoint.y" => point_axis_value(end, "y"),
        _ => match kind {
            "line" => {
                let direction = direction_angle(start, end);
                match property {
                    "length" => geometry.get("length")?.as_f64(),
                    "startAngleDeg" => direction,
                    "endAngleDeg" => reverse_direction(direction),
                    _ => None,
                }
            }
            "polyline" => {
                let segments = geometry.get("segments")?.as_array()?;
                let start_direction = first_segment_direction(segments, |segment| {
                    direction_angle(segment.get("start"), segment.get("end"))
                });
                let end_direction = last_interior_direction(segments, |segment| {
                    direction_angle(segment.get("start"), segment.get("end"))
                });
                match property {
                    "length" => geometry.get("length")?.as_f64(),
                    "startAngleDeg" => start_direction,
                    "endAngleDeg" => end_direction,
                    _ => None,
                }
            }
            "arcLine" => {
                let (start_direction, end_direction) = arc_endpoint_directions(geometry);
                match property {
                    "length" => geometry.get("length")?.as_f64(),
                    "radius" => geometry.get("radius")?.as_f64(),
                    "sweepAngleDeg" => geometry.get("sweepAngleDeg")?.as_f64(),
                    "startAngleDeg" => start_direction,
                    "endAngleDeg" => end_direction,
                    "startRadiusAngleDeg" => direction_angle(geometry.get("center"), start),
                    "endRadiusAngleDeg" => direction_angle(geometry.get("center"), end),
                    "centerPoint.x" => point_axis_value(geometry.get("center"), "x"),
                    "centerPoint.y" => point_axis_value(geometry.get("center"), "y"),
                    _ => None,
                }
            }
            "bezierCurve" => {
                let segments = geometry.get("segments")?.as_array()?;
                let first = segments.first();
                let last = segments.last();
                let start_direction =
                    first_segment_direction(segments, bezier_start_forward_direction);
                let end_direction = last_interior_direction(segments, bezier_end_forward_direction);
                match property {
                    "length" => geometry.get("length")?.as_f64(),
                    "startAngleDeg" => start_direction,
                    "endAngleDeg" => end_direction,
                    "startHandleAngleDeg" => {
                        direction_angle(first?.get("start"), first?.get("control1"))
                    }
                    "startHandleLength" => {
                        let (start_x, start_y) = point_coordinates(first?.get("start"))?;
                        let (control_x, control_y) = point_coordinates(first?.get("control1"))?;
                        Some((control_x - start_x).hypot(control_y - start_y))
                    }
                    "endHandleAngleDeg" => direction_angle(last?.get("control2"), last?.get("end")),
                    "endHandleLength" => {
                        let (control_x, control_y) = point_coordinates(last?.get("control2"))?;
                        let (end_x, end_y) = point_coordinates(last?.get("end"))?;
                        Some((end_x - control_x).hypot(end_y - control_y))
                    }
                    _ => intermediate_point_value(segments, property),
                }
            }
            "offsetLine" => {
                let segments = geometry.get("segments")?.as_array()?;
                let start_direction =
                    first_segment_direction(segments, offset_segment_start_direction);
                let end_direction =
                    last_interior_direction(segments, offset_segment_end_forward_direction);
                match property {
                    "length" => geometry.get("length")?.as_f64(),
                    "startAngleDeg" => start_direction,
                    "endAngleDeg" => end_direction,
                    _ => None,
                }
            }
            _ => None,
        },
    }
}

fn intermediate_point_value(segments: &[Value], property: &str) -> Option<f64> {
    let rest = property.strip_prefix("intermediatePoints[")?;
    let (index_text, property_name) = rest.split_once("].")?;
    let index = index_text.parse::<usize>().ok()?.checked_sub(1)?;
    let incoming_segment = segments.get(index)?;
    if property_name == "x" || property_name == "y" {
        return point_axis_value(incoming_segment.get("end"), property_name);
    }
    if !matches!(
        property_name,
        "incomingHandleAngleDeg"
            | "incomingHandleLength"
            | "outgoingHandleAngleDeg"
            | "outgoingHandleLength"
    ) {
        return None;
    }
    let outgoing_segment = segments.get(index + 1)?;
    let knot = incoming_segment.get("end");
    let incoming_length = finite_point_distance(knot, incoming_segment.get("control2"))?;
    let outgoing_length = finite_point_distance(knot, outgoing_segment.get("control1"))?;
    let incoming_angle = finite_direction_angle(knot, incoming_segment.get("control2"));
    let outgoing_angle = finite_direction_angle(knot, outgoing_segment.get("control1"));
    let resolved_incoming_angle = incoming_angle.or_else(|| {
        (incoming_length <= GEOMETRY_EPSILON)
            .then(|| reverse_direction(outgoing_angle))
            .flatten()
    });
    let resolved_outgoing_angle = outgoing_angle.or_else(|| {
        (outgoing_length <= GEOMETRY_EPSILON)
            .then(|| reverse_direction(incoming_angle))
            .flatten()
    });
    match property_name {
        "incomingHandleAngleDeg" => resolved_incoming_angle,
        "incomingHandleLength" => Some(incoming_length),
        "outgoingHandleAngleDeg" => resolved_outgoing_angle,
        "outgoingHandleLength" => Some(outgoing_length),
        _ => None,
    }
}

pub(crate) fn parameter_value<'a>(element: &'a Value, key: &str) -> Option<&'a Value> {
    if let Some((prefix, rest)) = key.split_once(':') {
        if prefix == "intermediate" {
            let (point_id, field) = rest.split_once(':')?;
            return element
                .get("intermediatePoints")?
                .as_array()?
                .iter()
                .find(|point| point.get("id").and_then(Value::as_str) == Some(point_id))?
                .get(field);
        }
    }

    if key == "fromPoint" {
        return element
            .get("fromPoint")
            .or_else(|| element.get("fromPointId"));
    }
    if key == "printAnchor" {
        return element.get("printAnchor");
    }
    if key == "placementMode"
        && matches!(
            element.get("type").and_then(Value::as_str),
            Some("divisionPoint" | "lineDivisionPoint")
        )
    {
        return element.get("placement")?.get("kind");
    }
    if (key == "distance" || key == "ratio")
        && matches!(
            element.get("type").and_then(Value::as_str),
            Some("divisionPoint" | "lineDivisionPoint")
        )
    {
        let placement = element.get("placement")?;
        return (placement.get("kind").and_then(Value::as_str) == Some(key))
            .then(|| placement.get("value"))
            .flatten();
    }
    element.get(key)
}

struct Parser<'a> {
    expression: &'a str,
    tokens: Vec<Token>,
    index: usize,
    state: &'a EvaluationState,
    element: &'a Value,
    local_variables: &'a HashMap<String, f64>,
    local_variable_names: &'a HashMap<String, String>,
}

impl<'a> Parser<'a> {
    fn new(
        expression: &'a str,
        tokens: Vec<Token>,
        state: &'a EvaluationState,
        element: &'a Value,
        local_variables: &'a HashMap<String, f64>,
        local_variable_names: &'a HashMap<String, String>,
    ) -> Self {
        Self {
            expression,
            tokens,
            index: 0,
            state,
            element,
            local_variables,
            local_variable_names,
        }
    }

    fn parse(&mut self) -> Result<f64, NumericEvalError> {
        let value = self.parse_logical_or()?;
        if self.index < self.tokens.len() {
            return Err(self.simple_error("式の末尾を解釈できません。"));
        }
        Ok(value)
    }

    fn parse_logical_or(&mut self) -> Result<f64, NumericEvalError> {
        let mut value = self.parse_logical_and()?;
        while self.peek_logical_operator("||") {
            self.consume_logical_operator()?;
            let right = self.parse_logical_and()?;
            value = if value != 0.0 || right != 0.0 {
                1.0
            } else {
                0.0
            };
        }
        Ok(value)
    }

    fn parse_logical_and(&mut self) -> Result<f64, NumericEvalError> {
        let mut value = self.parse_comparison()?;
        while self.peek_logical_operator("&&") {
            self.consume_logical_operator()?;
            let right = self.parse_comparison()?;
            value = if value != 0.0 && right != 0.0 {
                1.0
            } else {
                0.0
            };
        }
        Ok(value)
    }

    fn parse_comparison(&mut self) -> Result<f64, NumericEvalError> {
        let left = self.parse_expression()?;
        let Some(operator) = self.consume_comparison_operator_if_present() else {
            return Ok(left);
        };
        let right = self.parse_expression()?;
        let result = match operator.as_str() {
            ">" => left > right,
            ">=" => left >= right,
            "<" => left < right,
            "<=" => left <= right,
            "!=" => left != right,
            "==" => left == right,
            _ => return Err(self.simple_error("未対応の比較演算子です。")),
        };
        Ok(if result { 1.0 } else { 0.0 })
    }

    fn parse_expression(&mut self) -> Result<f64, NumericEvalError> {
        let mut value = self.parse_term()?;
        while self.peek_operator('+') || self.peek_operator('-') {
            let operator = self.consume_operator()?;
            let right = self.parse_term()?;
            value = if operator == '+' {
                value + right
            } else {
                value - right
            };
        }
        Ok(value)
    }

    fn parse_term(&mut self) -> Result<f64, NumericEvalError> {
        let mut value = self.parse_factor()?;
        while self.peek_operator('*') || self.peek_operator('/') {
            let operator = self.consume_operator()?;
            let right = self.parse_factor()?;
            if operator == '/' && right == 0.0 {
                return Err(self.simple_error("0で割ることはできません。"));
            }
            value = if operator == '*' {
                value * right
            } else {
                value / right
            };
        }
        Ok(value)
    }

    fn parse_factor(&mut self) -> Result<f64, NumericEvalError> {
        let Some(token) = self.consume() else {
            return Err(self.simple_error("式が途中で終わっています。"));
        };
        match token {
            Token::Number(value) => Ok(value),
            Token::Reference {
                element_id,
                property,
            } => self.reference_value(&element_id, &property),
            Token::LocalVariable(variable_id) => self.local_variable_value(&variable_id),
            Token::Function(name) => self.parse_function_call(&name),
            Token::Operator('+') => self.parse_factor(),
            Token::Operator('-') => Ok(-self.parse_factor()?),
            Token::LeftParen => {
                let value = self.parse_logical_or()?;
                if self.consume() != Some(Token::RightParen) {
                    return Err(self.simple_error("閉じ括弧がありません。"));
                }
                Ok(value)
            }
            _ => Err(self.simple_error("数値、参照、または括弧が必要です。")),
        }
    }

    fn reference_value(&self, element_id: &str, property: &str) -> Result<f64, NumericEvalError> {
        if let Some(parameter_path) = property.strip_prefix("params.") {
            return self.parameter_reference_value(element_id, parameter_path);
        }
        let geometry = self
            .state
            .computed_geometry
            .get(element_id)
            .ok_or_else(|| self.dependency_error(element_id))?;
        let measured_value = computed_reference_value(geometry, property);
        measured_value.ok_or_else(|| NumericEvalError {
            dependency_id: element_id.to_owned(),
            dependency_name: find_element_name(self.state, element_id),
            message: format!(
                "{} はこの要素より後にあるか、存在しません。",
                find_element_name(self.state, element_id).unwrap_or_else(|| element_id.to_owned())
            ),
        })
    }

    fn parameter_reference_value(
        &self,
        element_id: &str,
        parameter_path: &str,
    ) -> Result<f64, NumericEvalError> {
        let element = self
            .state
            .elements_by_id
            .get(element_id)
            .and_then(|index| self.state.elements.get(*index))
            .ok_or_else(|| self.dependency_error(element_id))?;
        if let Some((anchor_key, axis)) = parameter_path.rsplit_once('.') {
            if matches!(axis, "x" | "y") {
                if let Some(anchor) = parameter_value(element, anchor_key) {
                    return self.point_anchor_axis_value(anchor, axis);
                }
            }
        }
        let value = parameter_value(element, parameter_path)
            .ok_or_else(|| self.dependency_error(element_id))?;
        numeric_value(
            value,
            self.state,
            self.element,
            self.local_variables,
            self.local_variable_names,
        )
    }

    fn point_anchor_axis_value(&self, anchor: &Value, axis: &str) -> Result<f64, NumericEvalError> {
        match anchor.get("mode").and_then(Value::as_str) {
            Some("coordinate") => {
                let value = anchor
                    .get(axis)
                    .ok_or_else(|| self.simple_error("座標が未定義です。"))?;
                numeric_value(
                    value,
                    self.state,
                    self.element,
                    self.local_variables,
                    self.local_variable_names,
                )
            }
            Some("reference") => {
                let point_id = anchor
                    .get("pointId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| self.simple_error("参照点が未定義です。"))?;
                let point = self.point_value(point_id)?;
                Ok(if axis == "x" { point.x } else { point.y })
            }
            Some("derived") => {
                let element_id = anchor
                    .get("elementId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| self.simple_error("参照要素が未定義です。"))?;
                let point_key = anchor
                    .get("pointKey")
                    .and_then(Value::as_str)
                    .ok_or_else(|| self.simple_error("参照点が未定義です。"))?;
                let point = self.point_value(&format!("{element_id}:{point_key}"))?;
                Ok(if axis == "x" { point.x } else { point.y })
            }
            _ => Err(self.simple_error("点設定ではありません。")),
        }
    }

    fn local_variable_value(&self, variable_id: &str) -> Result<f64, NumericEvalError> {
        self.local_variables
            .get(variable_id)
            .copied()
            .ok_or_else(|| NumericEvalError {
                dependency_id: variable_id.to_owned(),
                dependency_name: self.local_variable_names.get(variable_id).cloned(),
                message: format!(
                    "{} はこの要素内に存在しません。または参照可能な変数に存在しません。",
                    self.local_variable_names
                        .get(variable_id)
                        .cloned()
                        .unwrap_or_else(|| variable_id.to_owned())
                ),
            })
    }

    fn parse_function_call(&mut self, name: &str) -> Result<f64, NumericEvalError> {
        if self.consume() != Some(Token::LeftParen) {
            return Err(self.simple_error("関数の開始括弧がありません。"));
        }

        if name == "sqrt" {
            let value = self.parse_logical_or()?;
            if self.consume() != Some(Token::RightParen) {
                return Err(self.simple_error("閉じ括弧がありません。"));
            }
            if value < 0.0 {
                return Err(self.simple_error("sqrt の引数は0以上である必要があります。"));
            }
            return Ok(value.sqrt());
        }

        let mut args = Vec::new();
        loop {
            match self.consume() {
                Some(Token::Element(id)) => args.push(id),
                _ => return Err(self.simple_error("関数の引数には要素名または要素IDが必要です。")),
            }
            match self.consume() {
                Some(Token::RightParen) => break,
                Some(Token::Comma) => {}
                _ => return Err(self.simple_error("関数の引数はカンマで区切ってください。")),
            }
        }

        let require_count = |expected: usize| {
            if args.len() == expected {
                Ok(())
            } else {
                Err(self.simple_error(&format!("{name} の引数は {expected} 個必要です。")))
            }
        };

        if name == "distance" {
            require_count(2)?;
            let point1 = self.point_value(&args[0])?;
            let point2 = self.point_value(&args[1])?;
            return Ok((point2.x - point1.x).hypot(point2.y - point1.y));
        }
        if name == "angle" {
            require_count(2)?;
            let point1 = self.point_value(&args[0])?;
            let point2 = self.point_value(&args[1])?;
            return Ok(normalize_degrees(
                (point2.y - point1.y)
                    .atan2(point2.x - point1.x)
                    .to_degrees(),
            ));
        }

        require_count(2)?;
        let point = self.point_value(&args[0])?;
        let line = self
            .state
            .computed_geometry
            .get(&args[1])
            .ok_or_else(|| self.dependency_error(&args[1]))?;
        if line.get("kind").and_then(Value::as_str) != Some("line") {
            return Err(self.dependency_error(&args[1]));
        }
        let start = line
            .get("start")
            .and_then(point_from_value)
            .ok_or_else(|| self.dependency_error(&args[1]))?;
        let end = line
            .get("end")
            .and_then(point_from_value)
            .ok_or_else(|| self.dependency_error(&args[1]))?;
        let dx = end.x - start.x;
        let dy = end.y - start.y;
        let length = dx.hypot(dy);
        if length <= 1e-9 {
            return Err(self.simple_error(&format!(
                "{} は長さ0のため点線距離を計算できません。",
                line.get("name").and_then(Value::as_str).unwrap_or(&args[1])
            )));
        }
        Ok((dx * (start.y - point.y) - (start.x - point.x) * dy).abs() / length)
    }

    /// `expression_id` is ambiguous by construction: it may be a plain
    /// (possibly forGroup-generated) element id, or a derived-point
    /// reference `"<elementId>:<pointKey>"` built by `pointAnchorExpression`
    /// (`src/geometry/numericExpressions.ts`) - and a forGroup-generated id
    /// itself contains a colon (`"<templateId>@<forGroupId>:<index>"`), so a
    /// naive first-colon split mistakes the generated id's own colon for the
    /// derived-point-key separator. Resolving this by trying a direct,
    /// whole-string `computed_geometry` lookup first - rather than guessing
    /// from the string shape - sidesteps the ambiguity entirely: a complete
    /// generated id (with no derived-point suffix) is always a hit here,
    /// since forGroup expansion stores geometry under exactly that key. Only
    /// when that direct lookup misses does this fall back to treating the
    /// text after the *last* colon as a derived-point key, which also
    /// correctly separates a derived-point key from a generated id's own
    /// colon(s) when both are present (arbitrarily nested).
    fn point_value(&self, expression_id: &str) -> Result<Point, NumericEvalError> {
        if let Some(geometry) = self.state.computed_geometry.get(expression_id) {
            return point_from_geometry(geometry)
                .ok_or_else(|| self.dependency_error(expression_id));
        }
        let Some((source_id, point_key)) = expression_id.rsplit_once(':') else {
            return Err(self.dependency_error(expression_id));
        };
        let geometry = self
            .state
            .computed_geometry
            .get(source_id)
            .ok_or_else(|| self.dependency_error(source_id))?;
        resolve_derived_point(geometry, point_key, self.state)
            .ok_or_else(|| self.dependency_error(source_id))
    }

    fn dependency_error(&self, element_id: &str) -> NumericEvalError {
        let dependency_name = find_element_name(self.state, element_id);
        NumericEvalError {
            dependency_id: element_id.to_owned(),
            dependency_name: dependency_name.clone(),
            message: format!(
                "{} はこの要素より後にあるか、存在しません。",
                dependency_name.unwrap_or_else(|| element_id.to_owned())
            ),
        }
    }

    fn simple_error(&self, message: &str) -> NumericEvalError {
        NumericEvalError {
            dependency_id: self.expression.to_owned(),
            dependency_name: None,
            message: message.to_owned(),
        }
    }

    fn peek_operator(&self, operator: char) -> bool {
        self.tokens.get(self.index) == Some(&Token::Operator(operator))
    }

    fn consume_operator(&mut self) -> Result<char, NumericEvalError> {
        match self.consume() {
            Some(Token::Operator(operator)) => Ok(operator),
            _ => Err(self.simple_error("演算子が必要です。")),
        }
    }

    fn consume_comparison_operator_if_present(&mut self) -> Option<String> {
        match self.tokens.get(self.index) {
            Some(Token::ComparisonOperator(operator)) => {
                self.index += 1;
                Some(operator.clone())
            }
            _ => None,
        }
    }

    fn peek_logical_operator(&self, operator: &str) -> bool {
        matches!(
            self.tokens.get(self.index),
            Some(Token::LogicalOperator(value)) if value == operator
        )
    }

    fn consume_logical_operator(&mut self) -> Result<String, NumericEvalError> {
        match self.consume() {
            Some(Token::LogicalOperator(operator)) => Ok(operator),
            _ => Err(self.simple_error("論理演算子が必要です。")),
        }
    }

    fn consume(&mut self) -> Option<Token> {
        let token = self.tokens.get(self.index).cloned();
        self.index += 1;
        token
    }
}

#[cfg(test)]
mod tests {
    use super::computed_reference_value;
    use serde_json::json;

    #[test]
    fn exposes_canonical_endpoint_and_radial_angles() {
        let line = json!({
            "kind": "line",
            "start": {"x": 0.0, "y": 0.0},
            "end": {"x": 10.0, "y": 0.0},
            "length": 10.0
        });
        assert_eq!(computed_reference_value(&line, "startAngleDeg"), Some(0.0));
        assert_eq!(computed_reference_value(&line, "endAngleDeg"), Some(180.0));
        assert_eq!(
            computed_reference_value(&line, "startTangentAngleDeg"),
            None
        );

        let arc = json!({
            "kind": "arcLine",
            "center": {"x": 0.0, "y": 0.0},
            "start": {"x": 10.0, "y": 0.0},
            "end": {"x": 0.0, "y": 10.0},
            "radius": 10.0,
            "startAngleDeg": 0.0,
            "endAngleDeg": 90.0,
            "sweepAngleDeg": 90.0,
            "length": 15.0
        });
        assert_eq!(computed_reference_value(&arc, "startAngleDeg"), Some(90.0));
        assert_eq!(computed_reference_value(&arc, "endAngleDeg"), Some(0.0));
        assert_eq!(
            computed_reference_value(&arc, "startRadiusAngleDeg"),
            Some(0.0)
        );
        assert_eq!(
            computed_reference_value(&arc, "endRadiusAngleDeg"),
            Some(90.0)
        );
        assert_eq!(computed_reference_value(&arc, "sweepAngleDeg"), Some(90.0));
    }

    #[test]
    fn skips_degenerate_polyline_and_bezier_material() {
        let polyline = json!({
            "kind": "polyline",
            "segments": [
                {"kind": "line", "start": {"x": 0.0, "y": 0.0}, "end": {"x": 0.0, "y": 0.0}},
                {"kind": "line", "start": {"x": 0.0, "y": 0.0}, "end": {"x": 0.0, "y": 1.0}},
                {"kind": "line", "start": {"x": 0.0, "y": 1.0}, "end": {"x": 0.0, "y": 0.0}}
            ],
            "length": 2.0
        });
        assert_eq!(
            computed_reference_value(&polyline, "startAngleDeg"),
            Some(90.0)
        );
        assert_eq!(
            computed_reference_value(&polyline, "endAngleDeg"),
            Some(90.0)
        );

        let bezier = json!({
            "kind": "bezierCurve",
            "segments": [
                {
                    "start": {"x": 0.0, "y": 0.0},
                    "control1": {"x": 0.0, "y": 0.0},
                    "control2": {"x": 0.0, "y": 0.0},
                    "end": {"x": 0.0, "y": 0.0}
                },
                {
                    "start": {"x": 0.0, "y": 0.0},
                    "control1": {"x": 0.0, "y": 0.0},
                    "control2": {"x": 1.0, "y": 1.0},
                    "end": {"x": 2.0, "y": 2.0}
                },
                {
                    "start": {"x": 2.0, "y": 2.0},
                    "control1": {"x": 2.0, "y": 2.0},
                    "control2": {"x": 2.0, "y": 2.0},
                    "end": {"x": 2.0, "y": 2.0}
                }
            ],
            "length": 2.82842712474619
        });
        assert_eq!(
            computed_reference_value(&bezier, "startAngleDeg"),
            Some(45.0)
        );
        assert_eq!(
            computed_reference_value(&bezier, "endAngleDeg"),
            Some(225.0)
        );
        assert_eq!(
            computed_reference_value(&bezier, "startHandleLength"),
            Some(0.0)
        );
        assert_eq!(
            computed_reference_value(&bezier, "startHandleAngleDeg"),
            None
        );
        assert_eq!(
            computed_reference_value(&bezier, "endHandleLength"),
            Some(0.0)
        );
        assert_eq!(computed_reference_value(&bezier, "endHandleAngleDeg"), None);
    }

    #[test]
    fn exposes_current_bezier_intermediate_handle_geometry_and_degeneracy() {
        let bezier = json!({
            "kind": "bezierCurve",
            "segments": [
                {
                    "start": {"x": 0.0, "y": 0.0},
                    "control1": {"x": 2.0, "y": 0.0},
                    "control2": {"x": 8.0, "y": 0.0},
                    "end": {"x": 10.0, "y": 0.0}
                },
                {
                    "start": {"x": 10.0, "y": 0.0},
                    "control1": {"x": 12.0, "y": 0.0},
                    "control2": {"x": 18.0, "y": 0.0},
                    "end": {"x": 20.0, "y": 0.0}
                }
            ],
            "length": 20.0
        });
        assert_eq!(
            computed_reference_value(&bezier, "intermediatePoints[1].x"),
            Some(10.0)
        );
        assert_eq!(
            computed_reference_value(&bezier, "intermediatePoints[1].y"),
            Some(0.0)
        );
        assert_eq!(
            computed_reference_value(&bezier, "intermediatePoints[1].incomingHandleAngleDeg"),
            Some(180.0)
        );
        assert_eq!(
            computed_reference_value(&bezier, "intermediatePoints[1].incomingHandleLength"),
            Some(2.0)
        );
        assert_eq!(
            computed_reference_value(&bezier, "intermediatePoints[1].outgoingHandleAngleDeg"),
            Some(0.0)
        );
        assert_eq!(
            computed_reference_value(&bezier, "intermediatePoints[1].outgoingHandleLength"),
            Some(2.0)
        );

        let incoming_zero = json!({
            "kind": "bezierCurve",
            "segments": [
                {
                    "start": {"x": 0.0, "y": 0.0},
                    "control1": {"x": 2.0, "y": 0.0},
                    "control2": {"x": 10.0, "y": 0.0},
                    "end": {"x": 10.0, "y": 0.0}
                },
                {
                    "start": {"x": 10.0, "y": 0.0},
                    "control1": {"x": 10.0, "y": 3.0},
                    "control2": {"x": 18.0, "y": 0.0},
                    "end": {"x": 20.0, "y": 0.0}
                }
            ]
        });
        assert_eq!(
            computed_reference_value(
                &incoming_zero,
                "intermediatePoints[1].incomingHandleAngleDeg"
            ),
            Some(270.0)
        );
        assert_eq!(
            computed_reference_value(
                &incoming_zero,
                "intermediatePoints[1].outgoingHandleAngleDeg"
            ),
            Some(90.0)
        );
        assert_eq!(
            computed_reference_value(&incoming_zero, "intermediatePoints[1].incomingHandleLength"),
            Some(0.0)
        );

        let outgoing_zero = json!({
            "kind": "bezierCurve",
            "segments": [
                {
                    "start": {"x": 0.0, "y": 0.0},
                    "control1": {"x": 2.0, "y": 0.0},
                    "control2": {"x": 8.0, "y": 0.0},
                    "end": {"x": 10.0, "y": 0.0}
                },
                {
                    "start": {"x": 10.0, "y": 0.0},
                    "control1": {"x": 10.0, "y": 0.0},
                    "control2": {"x": 18.0, "y": 0.0},
                    "end": {"x": 20.0, "y": 0.0}
                }
            ]
        });
        assert_eq!(
            computed_reference_value(
                &outgoing_zero,
                "intermediatePoints[1].incomingHandleAngleDeg"
            ),
            Some(180.0)
        );
        assert_eq!(
            computed_reference_value(
                &outgoing_zero,
                "intermediatePoints[1].outgoingHandleAngleDeg"
            ),
            Some(0.0)
        );
        assert_eq!(
            computed_reference_value(&outgoing_zero, "intermediatePoints[1].outgoingHandleLength"),
            Some(0.0)
        );

        let both_zero = json!({
            "kind": "bezierCurve",
            "segments": [
                {
                    "start": {"x": 0.0, "y": 0.0},
                    "control1": {"x": 1.0, "y": 0.0},
                    "control2": {"x": 10.0, "y": 0.0},
                    "end": {"x": 10.0, "y": 0.0}
                },
                {
                    "start": {"x": 10.0, "y": 0.0},
                    "control1": {"x": 10.0, "y": 0.0},
                    "control2": {"x": 19.0, "y": 0.0},
                    "end": {"x": 20.0, "y": 0.0}
                }
            ]
        });
        assert_eq!(
            computed_reference_value(&both_zero, "intermediatePoints[1].incomingHandleLength"),
            Some(0.0)
        );
        assert_eq!(
            computed_reference_value(&both_zero, "intermediatePoints[1].outgoingHandleLength"),
            Some(0.0)
        );
        assert_eq!(
            computed_reference_value(&both_zero, "intermediatePoints[1].incomingHandleAngleDeg"),
            None
        );
        assert_eq!(
            computed_reference_value(&both_zero, "intermediatePoints[1].outgoingHandleAngleDeg"),
            None
        );
        assert_eq!(
            computed_reference_value(&bezier, "intermediatePoints[0].x"),
            None
        );
        assert_eq!(
            computed_reference_value(&bezier, "intermediatePoints[1].tangentAngleDeg"),
            None
        );
    }
}
