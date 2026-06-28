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
    Parser::new(tokens, state, local_variables, local_variable_names).parse()
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

fn tokenize(expression: &str) -> Result<Vec<Token>, String> {
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
            while index < chars.len()
                && !is_expression_delimiter(chars[index])
                && chars[index] != '.'
            {
                index += 1;
            }
            tokens.push(Token::Reference {
                element_id: first,
                property: chars[property_start..index].iter().collect(),
            });
            continue;
        }
        if index < chars.len()
            && chars[index] == '('
            && matches!(
                first.as_str(),
                "distance" | "距離" | "angle" | "角度" | "lineDistance" | "点線距離"
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
    ch.is_whitespace() || matches!(ch, '(' | ')' | ',' | '+' | '-' | '*' | '/')
}

struct Parser<'a> {
    tokens: Vec<Token>,
    index: usize,
    state: &'a EvaluationState,
    local_variables: &'a HashMap<String, f64>,
    local_variable_names: &'a HashMap<String, String>,
}

impl<'a> Parser<'a> {
    fn new(
        tokens: Vec<Token>,
        state: &'a EvaluationState,
        local_variables: &'a HashMap<String, f64>,
        local_variable_names: &'a HashMap<String, String>,
    ) -> Self {
        Self {
            tokens,
            index: 0,
            state,
            local_variables,
            local_variable_names,
        }
    }

    fn parse(&mut self) -> Result<f64, NumericEvalError> {
        let value = self.parse_expression()?;
        if self.index < self.tokens.len() {
            return Err(self.simple_error("式の末尾を解釈できません。"));
        }
        Ok(value)
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
                let value = self.parse_expression()?;
                if self.consume() != Some(Token::RightParen) {
                    return Err(self.simple_error("閉じ括弧がありません。"));
                }
                Ok(value)
            }
            _ => Err(self.simple_error("数値、参照、または括弧が必要です。")),
        }
    }

    fn reference_value(&self, element_id: &str, property: &str) -> Result<f64, NumericEvalError> {
        let geometry = self
            .state
            .computed_geometry
            .get(element_id)
            .ok_or_else(|| self.dependency_error(element_id))?;
        let measured_value = geometry.get(property).and_then(Value::as_f64);
        measured_value.ok_or_else(|| NumericEvalError {
            dependency_id: element_id.to_owned(),
            dependency_name: find_element_name(self.state, element_id),
            message: format!(
                "{} はこの要素より後にあるか、存在しません。",
                find_element_name(self.state, element_id).unwrap_or_else(|| element_id.to_owned())
            ),
        })
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
                (point1.y - point2.y)
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

    fn point_value(&self, expression_id: &str) -> Result<Point, NumericEvalError> {
        let (source_id, point_key) = expression_id
            .split_once(':')
            .map_or((expression_id, None), |(source, key)| (source, Some(key)));
        let geometry = self
            .state
            .computed_geometry
            .get(source_id)
            .ok_or_else(|| self.dependency_error(source_id))?;
        if let Some(key) = point_key {
            return resolve_derived_point(geometry, key, self.state)
                .ok_or_else(|| self.dependency_error(source_id));
        }
        point_from_geometry(geometry).ok_or_else(|| self.dependency_error(source_id))
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
            dependency_id: message.to_owned(),
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

    fn consume(&mut self) -> Option<Token> {
        let token = self.tokens.get(self.index).cloned();
        self.index += 1;
        token
    }
}
