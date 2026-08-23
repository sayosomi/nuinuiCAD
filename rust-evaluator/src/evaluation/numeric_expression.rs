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

/// The sole canonical computed-geometry property accessor. Typed scalar
/// evaluation calls this too; neither evaluator owns a second property map.
pub(crate) fn computed_reference_value(geometry: &Value, property: &str) -> Option<f64> {
    match geometry.get("kind")?.as_str()? {
        "point" => point_axis_value(Some(geometry), property),
        "line" => match property {
            "length"
            | "startAngleDeg"
            | "endAngleDeg"
            | "startTangentAngleDeg"
            | "endTangentAngleDeg" => geometry.get(property)?.as_f64(),
            "startPoint.x" => point_axis_value(geometry.get("start"), "x"),
            "startPoint.y" => point_axis_value(geometry.get("start"), "y"),
            "endPoint.x" => point_axis_value(geometry.get("end"), "x"),
            "endPoint.y" => point_axis_value(geometry.get("end"), "y"),
            _ => None,
        },
        "arcLine" => match property {
            "length"
            | "radius"
            | "startAngleDeg"
            | "endAngleDeg"
            | "sweepAngleDeg"
            | "startTangentAngleDeg"
            | "endTangentAngleDeg" => geometry.get(property)?.as_f64(),
            "centerPoint.x" => point_axis_value(geometry.get("center"), "x"),
            "centerPoint.y" => point_axis_value(geometry.get("center"), "y"),
            "startPoint.x" => point_axis_value(geometry.get("start"), "x"),
            "startPoint.y" => point_axis_value(geometry.get("start"), "y"),
            "endPoint.x" => point_axis_value(geometry.get("end"), "x"),
            "endPoint.y" => point_axis_value(geometry.get("end"), "y"),
            _ => None,
        },
        "bezierCurve" => {
            let segments = geometry.get("segments")?.as_array()?;
            let first = segments.first();
            let last = segments.last();
            match property {
                "length"
                | "startTangentAngleDeg"
                | "endTangentAngleDeg"
                | "startHandleAngleDeg"
                | "startHandleLength"
                | "endHandleAngleDeg"
                | "endHandleLength" => geometry.get(property)?.as_f64(),
                "startPoint.x" => point_axis_value(first?.get("start"), "x"),
                "startPoint.y" => point_axis_value(first?.get("start"), "y"),
                "endPoint.x" => point_axis_value(last?.get("end"), "x"),
                "endPoint.y" => point_axis_value(last?.get("end"), "y"),
                _ => intermediate_point_value(segments, property),
            }
        }
        "offsetLine" | "joinedPath" => match property {
            "length" | "startTangentAngleDeg" | "endTangentAngleDeg" => {
                geometry.get(property)?.as_f64()
            }
            "startPoint.x" => point_axis_value(geometry.get("start"), "x"),
            "startPoint.y" => point_axis_value(geometry.get("start"), "y"),
            "endPoint.x" => point_axis_value(geometry.get("end"), "x"),
            "endPoint.y" => point_axis_value(geometry.get("end"), "y"),
            _ => None,
        },
        "image" => match property {
            "originPoint.x" => point_axis_value(geometry.get("origin"), "x"),
            "originPoint.y" => point_axis_value(geometry.get("origin"), "y"),
            "widthMm" | "heightMm" | "scale" | "angleDeg" | "naturalWidthPx"
            | "naturalHeightPx" | "sourceDpi" | "targetPixelsPerMm" => {
                geometry.get(property)?.as_f64()
            }
            _ => None,
        },
        "text" => match property {
            "anchorPoint.x" => point_axis_value(geometry.get("anchor"), "x"),
            "anchorPoint.y" => point_axis_value(geometry.get("anchor"), "y"),
            "fontSize" => geometry.get("fontSize")?.as_f64(),
            _ => None,
        },
        _ => None,
    }
}

fn intermediate_point_value(segments: &[Value], property: &str) -> Option<f64> {
    let rest = property.strip_prefix("intermediatePoints[")?;
    let (index_text, axis_text) = rest.split_once("].")?;
    let index = index_text.parse::<usize>().ok()?.checked_sub(1)?;
    if axis_text != "x" && axis_text != "y" {
        return None;
    }
    point_axis_value(segments.get(index)?.get("end"), axis_text)
}

fn parameter_value<'a>(element: &'a Value, key: &str) -> Option<&'a Value> {
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
