use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

type ElementId = String;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationInput {
    elements: Vec<Value>,
    evaluation_limit_index: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyError {
    element_id: ElementId,
    element_name: String,
    missing_dependency_id: ElementId,
    #[serde(skip_serializing_if = "Option::is_none")]
    missing_dependency_name: Option<String>,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationWarning {
    element_id: ElementId,
    element_name: String,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationPayload {
    computed_geometry: Vec<Value>,
    computed_variables: Vec<Value>,
    errors: Vec<DependencyError>,
    warnings: Vec<EvaluationWarning>,
    evaluated_element_ids: Vec<ElementId>,
    evaluation_limit_index: usize,
    effective_visible_element_ids: Vec<ElementId>,
    effective_enabled_element_ids: Vec<ElementId>,
}

#[derive(Clone, Debug, Default)]
struct GroupState {
    hidden_by_group_id: Option<ElementId>,
    disabled_by_group_id: Option<ElementId>,
}

#[derive(Clone, Debug)]
struct Point {
    element_id: ElementId,
    name: String,
    x: f64,
    y: f64,
}

#[derive(Debug)]
struct NumericEvalError {
    dependency_id: ElementId,
    dependency_name: Option<String>,
    message: String,
}

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Number(f64),
    Reference { element_id: ElementId, property: String },
    Element(ElementId),
    LocalVariable(String),
    Function(String),
    Operator(char),
    Comma,
    LeftParen,
    RightParen,
}

struct EvaluationState {
    elements: Vec<Value>,
    elements_by_id: HashMap<ElementId, usize>,
    group_states: HashMap<ElementId, GroupState>,
    computed_geometry: HashMap<ElementId, Value>,
    computed_geometry_order: Vec<ElementId>,
    computed_variables: HashMap<ElementId, Value>,
    computed_variable_order: Vec<ElementId>,
    errors: Vec<DependencyError>,
    warnings: Vec<EvaluationWarning>,
}

#[tauri::command]
pub fn evaluate_document(input: EvaluationInput) -> EvaluationPayload {
    evaluate_document_input(input)
}

fn evaluate_document_input(input: EvaluationInput) -> EvaluationPayload {
    let evaluation_limit_index = input
        .evaluation_limit_index
        .unwrap_or(input.elements.len())
        .min(input.elements.len());
    let evaluated_elements = input.elements[..evaluation_limit_index].to_vec();
    let evaluated_ids: HashSet<ElementId> = evaluated_elements.iter().filter_map(element_id).collect();
    let group_states = group_state_by_element_id(&input.elements);
    let effective_visible_element_ids = effective_element_ids(&input.elements, &group_states, true)
        .into_iter()
        .filter(|id| evaluated_ids.contains(id))
        .collect::<Vec<_>>();
    let effective_enabled_ids = effective_element_ids(&input.elements, &group_states, false)
        .into_iter()
        .filter(|id| evaluated_ids.contains(id))
        .collect::<HashSet<_>>();
    let effective_enabled_element_ids = input
        .elements
        .iter()
        .filter_map(element_id)
        .filter(|id| effective_enabled_ids.contains(id) && evaluated_ids.contains(id))
        .collect::<Vec<_>>();

    let mut state = EvaluationState {
        elements_by_id: input
            .elements
            .iter()
            .enumerate()
            .filter_map(|(index, element)| element_id(element).map(|id| (id, index)))
            .collect(),
        elements: input.elements,
        group_states,
        computed_geometry: HashMap::new(),
        computed_geometry_order: Vec::new(),
        computed_variables: HashMap::new(),
        computed_variable_order: Vec::new(),
        errors: Vec::new(),
        warnings: Vec::new(),
    };

    for index in 0..evaluation_limit_index {
        let element = state.elements[index].clone();
        let id = match element_id(&element) {
            Some(id) => id,
            None => continue,
        };
        if element_type(&element) == Some("group") || !effective_enabled_ids.contains(&id) {
            continue;
        }

        let Some(local_variables) = evaluate_local_variables(index, &mut state) else {
            continue;
        };

        match element_type(&element) {
            Some("variable") => evaluate_variable_element(&element, &local_variables, &mut state),
            Some("freePoint") => evaluate_free_point(&element, &local_variables, &mut state),
            Some("offsetPoint") => evaluate_offset_point(&element, &local_variables, &mut state),
            Some("polarOffsetPoint") => evaluate_polar_offset_point(&element, &local_variables, &mut state),
            Some("line") => evaluate_line(&element, &local_variables, &mut state),
            Some("arcLine") => evaluate_arc_line(&element, &local_variables, &mut state),
            _ => {}
        }
    }

    EvaluationPayload {
        computed_geometry: state
            .computed_geometry_order
            .iter()
            .filter_map(|id| state.computed_geometry.get(id).cloned())
            .collect(),
        computed_variables: state
            .computed_variable_order
            .iter()
            .filter_map(|id| state.computed_variables.get(id).cloned())
            .collect(),
        errors: state.errors,
        warnings: state.warnings,
        evaluated_element_ids: evaluated_elements.iter().filter_map(element_id).collect(),
        evaluation_limit_index,
        effective_visible_element_ids,
        effective_enabled_element_ids,
    }
}

fn element_id(element: &Value) -> Option<ElementId> {
    element.get("id")?.as_str().map(ToOwned::to_owned)
}

fn element_name(element: &Value) -> String {
    element
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

fn element_type(element: &Value) -> Option<&str> {
    element.get("type")?.as_str()
}

fn bool_field(element: &Value, key: &str, default: bool) -> bool {
    element.get(key).and_then(Value::as_bool).unwrap_or(default)
}

fn parent_group_id(element: &Value) -> Option<ElementId> {
    element.get("parentGroupId")?.as_str().map(ToOwned::to_owned)
}

fn group_state_by_element_id(elements: &[Value]) -> HashMap<ElementId, GroupState> {
    let by_id = elements
        .iter()
        .enumerate()
        .filter_map(|(index, element)| element_id(element).map(|id| (id, index)))
        .collect::<HashMap<_, _>>();
    let mut cache = HashMap::new();

    for index in 0..elements.len() {
        state_for_group(index, elements, &by_id, &mut cache, &mut HashSet::new());
    }

    cache
}

fn state_for_group(
    index: usize,
    elements: &[Value],
    by_id: &HashMap<ElementId, usize>,
    cache: &mut HashMap<ElementId, GroupState>,
    visiting: &mut HashSet<ElementId>,
) -> GroupState {
    let element = &elements[index];
    let Some(id) = element_id(element) else {
        return GroupState::default();
    };
    if let Some(cached) = cache.get(&id) {
        return cached.clone();
    }
    if !visiting.insert(id.clone()) {
        return GroupState::default();
    }

    let state = parent_group_id(element)
        .and_then(|parent_id| {
            let parent_index = by_id.get(&parent_id).copied()?;
            Some((parent_id, parent_index))
        })
        .and_then(|(parent_id, parent_index)| {
            let parent = &elements[parent_index];
            (element_type(parent) == Some("group")).then_some((parent_id, parent_index))
        })
        .map(|(parent_id, parent_index)| {
            let parent = &elements[parent_index];
            let parent_state = state_for_group(parent_index, elements, by_id, cache, visiting);
            GroupState {
                hidden_by_group_id: parent_state
                    .hidden_by_group_id
                    .or_else(|| (!bool_field(parent, "visible", true)).then_some(parent_id.clone())),
                disabled_by_group_id: parent_state
                    .disabled_by_group_id
                    .or_else(|| (!bool_field(parent, "enabled", true)).then_some(parent_id)),
            }
        })
        .unwrap_or_default();

    visiting.remove(&id);
    cache.insert(id, state.clone());
    state
}

fn effective_element_ids(
    elements: &[Value],
    group_states: &HashMap<ElementId, GroupState>,
    visible: bool,
) -> Vec<ElementId> {
    elements
        .iter()
        .filter_map(|element| {
            let id = element_id(element)?;
            let own_flag = bool_field(element, if visible { "visible" } else { "enabled" }, true);
            let blocked_by_group = group_states
                .get(&id)
                .and_then(|state| {
                    if visible {
                        state.hidden_by_group_id.as_ref()
                    } else {
                        state.disabled_by_group_id.as_ref()
                    }
                })
                .is_some();
            (own_flag && !blocked_by_group).then_some(id)
        })
        .collect()
}

fn find_element_name(state: &EvaluationState, id: &str) -> Option<String> {
    state
        .elements_by_id
        .get(id)
        .and_then(|index| state.elements.get(*index))
        .map(element_name)
}

fn dependency_error(state: &EvaluationState, element: &Value, missing_dependency_id: &str) -> DependencyError {
    let missing_dependency_name = find_element_name(state, missing_dependency_id);
    let dependency_label = missing_dependency_name
        .clone()
        .unwrap_or_else(|| missing_dependency_id.to_owned());
    let disabled_group_id = state
        .group_states
        .get(missing_dependency_id)
        .and_then(|state| state.disabled_by_group_id.clone());
    let disabled_group_name = disabled_group_id
        .as_deref()
        .and_then(|id| find_element_name(state, id));
    let element_name = element_name(element);

    DependencyError {
        element_id: element_id(element).unwrap_or_default(),
        element_name: element_name.clone(),
        missing_dependency_id: missing_dependency_id.to_owned(),
        missing_dependency_name,
        message: disabled_group_name.map_or_else(
            || {
                format!(
                    "{element_name} は {dependency_label} を参照していますが、{dependency_label} はこの要素より後にあるか、存在しません。{dependency_label} を {element_name} より前に移動してください。"
                )
            },
            |group_name| {
                format!(
                    "{element_name} は {dependency_label} を参照していますが、{dependency_label} はグループ {group_name} により評価OFFです。{group_name} を評価ONにするか、参照先を変更してください。"
                )
            },
        ),
    }
}

fn numeric_error(state: &mut EvaluationState, element: &Value, error: NumericEvalError) {
    let disabled_group_id = state
        .group_states
        .get(&error.dependency_id)
        .and_then(|state| state.disabled_by_group_id.clone());
    let disabled_group_name = disabled_group_id
        .as_deref()
        .and_then(|id| find_element_name(state, id));
    let element_name = element_name(element);

    state.errors.push(DependencyError {
        element_id: element_id(element).unwrap_or_default(),
        element_name: element_name.clone(),
        missing_dependency_id: error.dependency_id,
        missing_dependency_name: error.dependency_name,
        message: disabled_group_name.map_or_else(
            || format!("{element_name} の数値式を評価できません。{}", error.message),
            |group_name| {
                format!(
                    "{element_name} の数値式を評価できません。参照先はグループ {group_name} により評価OFFです。{group_name} を評価ONにするか、数値式を変更してください。"
                )
            },
        ),
    });
}

fn insert_geometry(state: &mut EvaluationState, id: ElementId, geometry: Value) {
    if !state.computed_geometry.contains_key(&id) {
        state.computed_geometry_order.push(id.clone());
    }
    state.computed_geometry.insert(id, geometry);
}

fn insert_variable(state: &mut EvaluationState, id: ElementId, variable: Value) {
    if !state.computed_variables.contains_key(&id) {
        state.computed_variable_order.push(id.clone());
    }
    state.computed_variables.insert(id, variable);
}

fn computed_point(id: impl Into<String>, name: impl Into<String>, x: f64, y: f64) -> Value {
    json!({
        "kind": "point",
        "elementId": id.into(),
        "name": name.into(),
        "x": x,
        "y": y
    })
}

fn point_from_geometry(value: &Value) -> Option<Point> {
    if value.get("kind")?.as_str()? != "point" {
        return None;
    }
    Some(Point {
        element_id: value.get("elementId")?.as_str()?.to_owned(),
        name: value.get("name")?.as_str()?.to_owned(),
        x: value.get("x")?.as_f64()?,
        y: value.get("y")?.as_f64()?,
    })
}

fn point_from_value(value: &Value) -> Option<Point> {
    Some(Point {
        element_id: value.get("elementId")?.as_str()?.to_owned(),
        name: value.get("name")?.as_str()?.to_owned(),
        x: value.get("x")?.as_f64()?,
        y: value.get("y")?.as_f64()?,
    })
}

fn numeric_value(
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

fn evaluate_numeric_or_push(
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

fn evaluate_local_variables(
    element_index: usize,
    state: &mut EvaluationState,
) -> Option<(HashMap<String, f64>, HashMap<String, String>)> {
    let element = state.elements[element_index].clone();
    let mut local_variable_values = HashMap::new();
    let mut local_variable_names = HashMap::new();

    for index in (0..element_index).rev() {
        let candidate = &state.elements[index];
        if element_type(candidate) != Some("variable") || !variable_is_in_scope(candidate, &element, state) {
            continue;
        }
        let Some(candidate_id) = element_id(candidate) else {
            continue;
        };
        let Some(computed) = state.computed_variables.get(&candidate_id) else {
            continue;
        };
        let Some(value) = computed.get("value").and_then(Value::as_f64) else {
            continue;
        };
        let candidate_name = element_name(candidate);
        local_variable_values.entry(candidate_id.clone()).or_insert(value);
        local_variable_values.entry(candidate_name.clone()).or_insert(value);
        local_variable_names.entry(candidate_id).or_insert(candidate_name.clone());
        local_variable_names.entry(candidate_name.clone()).or_insert(candidate_name);
    }

    if let Some(variables) = element.get("numericVariables").and_then(Value::as_array) {
        for variable in variables {
            let Some(variable_id) = variable.get("id").and_then(Value::as_str) else {
                continue;
            };
            let variable_name = variable
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or(variable_id)
                .to_owned();
            local_variable_names.insert(variable_id.to_owned(), variable_name.clone());
            local_variable_names.insert(variable_name.clone(), variable_name.clone());
            let value = evaluate_numeric_or_push(
                variable.get("value").unwrap_or(&Value::Null),
                state,
                &element,
                &local_variable_values,
                &local_variable_names,
            )?;
            local_variable_values.insert(variable_id.to_owned(), value);
            local_variable_values.insert(variable_name, value);
        }
    }

    Some((local_variable_values, local_variable_names))
}

fn ancestor_group_ids(element: &Value, state: &EvaluationState) -> Vec<ElementId> {
    let mut ids = Vec::new();
    let mut visited = HashSet::new();
    let mut parent_id = parent_group_id(element);

    while let Some(id) = parent_id {
        if !visited.insert(id.clone()) {
            break;
        }
        ids.push(id.clone());
        parent_id = state
            .elements_by_id
            .get(&id)
            .and_then(|index| state.elements.get(*index))
            .and_then(parent_group_id);
    }

    ids
}

fn variable_is_in_scope(variable: &Value, consumer: &Value, state: &EvaluationState) -> bool {
    if variable.get("scope").and_then(Value::as_str) == Some("global") {
        return true;
    }
    match parent_group_id(variable) {
        None => parent_group_id(consumer).is_none(),
        Some(parent_id) => {
            parent_group_id(consumer).as_deref() == Some(parent_id.as_str())
                || ancestor_group_ids(consumer, state).contains(&parent_id)
        }
    }
}

fn point_anchor_for_element(element: &Value) -> Option<Value> {
    if element_type(element) != Some("offsetPoint") && element_type(element) != Some("polarOffsetPoint") {
        return None;
    }
    element.get("fromPoint").cloned().or_else(|| {
        element.get("fromPointId").and_then(Value::as_str).map(|point_id| {
            json!({
                "mode": "reference",
                "pointId": point_id
            })
        })
    })
}

fn anchor_reference_element_id(anchor: &Value) -> Option<ElementId> {
    match anchor.get("mode")?.as_str()? {
        "reference" => anchor.get("pointId")?.as_str().map(ToOwned::to_owned),
        "derived" => anchor.get("elementId")?.as_str().map(ToOwned::to_owned),
        _ => None,
    }
}

fn resolve_derived_point(source: &Value, point_key: &str) -> Option<Point> {
    match source.get("kind")?.as_str()? {
        "line" => {
            if point_key == "start" {
                source.get("start").and_then(point_from_value)
            } else if point_key == "end" {
                source.get("end").and_then(point_from_value)
            } else {
                None
            }
        }
        "arcLine" => {
            if point_key == "center" {
                source.get("center").and_then(point_from_value)
            } else if point_key == "start" {
                source.get("start").and_then(point_from_value)
            } else if point_key == "end" {
                source.get("end").and_then(point_from_value)
            } else {
                None
            }
        }
        _ => None,
    }
}

fn point_anchor_or_error(
    element: &Value,
    anchor: &Value,
    anchor_key: &str,
    state: &mut EvaluationState,
    local_variables: &HashMap<String, f64>,
    local_variable_names: &HashMap<String, String>,
) -> Option<Point> {
    match anchor.get("mode").and_then(Value::as_str) {
        Some("reference") => {
            let point_id = anchor.get("pointId")?.as_str()?;
            let point = state.computed_geometry.get(point_id).and_then(point_from_geometry);
            if point.is_none() {
                state.errors.push(dependency_error(state, element, point_id));
            }
            point
        }
        Some("derived") => {
            let source_id = anchor.get("elementId")?.as_str()?;
            let point_key = anchor.get("pointKey")?.as_str()?;
            let point = state
                .computed_geometry
                .get(source_id)
                .and_then(|source| resolve_derived_point(source, point_key));
            if point.is_none() {
                state.errors.push(dependency_error(state, element, source_id));
            }
            point.map(|point| Point {
                element_id: format!("{source_id}:{point_key}"),
                name: format!("{}.{}", find_element_name(state, source_id).unwrap_or_else(|| source_id.to_owned()), point_key),
                ..point
            })
        }
        Some("coordinate") => {
            let x = evaluate_numeric_or_push(
                anchor.get("x").unwrap_or(&Value::Null),
                state,
                element,
                local_variables,
                local_variable_names,
            )?;
            let y = evaluate_numeric_or_push(
                anchor.get("y").unwrap_or(&Value::Null),
                state,
                element,
                local_variables,
                local_variable_names,
            )?;
            Some(Point {
                element_id: format!("{}:{anchor_key}", element_id(element).unwrap_or_default()),
                name: format!("{}.{anchor_key}", element_name(element)),
                x,
                y,
            })
        }
        _ => None,
    }
}

fn get_computed_point_or_error(
    element: &Value,
    point_id: &str,
    state: &mut EvaluationState,
) -> Option<Point> {
    let point = state.computed_geometry.get(point_id).and_then(point_from_geometry);
    if point.is_none() {
        state.errors.push(dependency_error(state, element, point_id));
    }
    point
}

fn evaluate_variable_element(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let value_mode = element.get("valueMode").and_then(Value::as_str).unwrap_or("expression");
    let value = match value_mode {
        "expression" => evaluate_numeric_or_push(
            element.get("expression").unwrap_or(&Value::Null),
            state,
            element,
            &local_variables.0,
            &local_variables.1,
        ),
        "pointDistance" => {
            let Some(point1) = point_anchor_or_error(
                element,
                element.get("point1").unwrap_or(&Value::Null),
                "point1",
                state,
                &local_variables.0,
                &local_variables.1,
            ) else {
                return;
            };
            let Some(point2) = point_anchor_or_error(
                element,
                element.get("point2").unwrap_or(&Value::Null),
                "point2",
                state,
                &local_variables.0,
                &local_variables.1,
            ) else {
                return;
            };
            Some((point2.x - point1.x).hypot(point2.y - point1.y))
        }
        "pointAngle" => {
            let Some(point1) = point_anchor_or_error(
                element,
                element.get("point1").unwrap_or(&Value::Null),
                "point1",
                state,
                &local_variables.0,
                &local_variables.1,
            ) else {
                return;
            };
            let Some(point2) = point_anchor_or_error(
                element,
                element.get("point2").unwrap_or(&Value::Null),
                "point2",
                state,
                &local_variables.0,
                &local_variables.1,
            ) else {
                return;
            };
            Some(normalize_degrees((point1.y - point2.y).atan2(point2.x - point1.x).to_degrees()))
        }
        "pointLineDistance" => {
            let Some(point) = point_anchor_or_error(
                element,
                element.get("point").unwrap_or(&Value::Null),
                "point",
                state,
                &local_variables.0,
                &local_variables.1,
            ) else {
                return;
            };
            let line_id = element.get("lineId").and_then(Value::as_str).unwrap_or_default();
            let Some(line) = state.computed_geometry.get(line_id).cloned() else {
                state.errors.push(dependency_error(state, element, line_id));
                return;
            };
            let Some(start) = line.get("start").and_then(point_from_value) else {
                state.errors.push(dependency_error(state, element, line_id));
                return;
            };
            let Some(end) = line.get("end").and_then(point_from_value) else {
                state.errors.push(dependency_error(state, element, line_id));
                return;
            };
            let dx = end.x - start.x;
            let dy = end.y - start.y;
            let length = dx.hypot(dy);
            if length <= 1e-9 {
                state.errors.push(DependencyError {
                    element_id: element_id(element).unwrap_or_default(),
                    element_name: element_name(element),
                    missing_dependency_id: element_id(element).unwrap_or_default(),
                    missing_dependency_name: Some(element_name(element)),
                    message: format!("{} は長さ0のため点線距離を計算できません。", element_name(element)),
                });
                return;
            }
            Some((dx * (start.y - point.y) - (start.x - point.x) * dy).abs() / length)
        }
        _ => None,
    };

    let Some(value) = value else {
        return;
    };
    let id = element_id(element).unwrap_or_default();
    insert_variable(
        state,
        id.clone(),
        json!({
            "kind": "variable",
            "elementId": id,
            "name": element_name(element),
            "value": value
        }),
    );
}

fn evaluate_free_point(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(x) = evaluate_numeric_or_push(
        element.get("x").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(y) = evaluate_numeric_or_push(
        element.get("y").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let id = element_id(element).unwrap_or_default();
    insert_geometry(state, id.clone(), computed_point(id, element_name(element), x, y));
}

fn evaluate_offset_point(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(anchor) = point_anchor_for_element(element) else {
        return;
    };
    let from_point = if anchor.get("mode").and_then(Value::as_str) == Some("reference") {
        get_computed_point_or_error(element, anchor.get("pointId").and_then(Value::as_str).unwrap_or_default(), state)
    } else {
        point_anchor_or_error(element, &anchor, "from", state, &local_variables.0, &local_variables.1)
    };
    let Some(from_point) = from_point else {
        return;
    };
    let Some(dx) = evaluate_numeric_or_push(
        element.get("dx").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(dy) = evaluate_numeric_or_push(
        element.get("dy").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let id = element_id(element).unwrap_or_default();
    insert_geometry(
        state,
        id.clone(),
        computed_point(id, element_name(element), from_point.x + dx, from_point.y + dy),
    );
}

fn evaluate_polar_offset_point(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(anchor) = point_anchor_for_element(element) else {
        return;
    };
    let from_point = if anchor.get("mode").and_then(Value::as_str) == Some("reference") {
        get_computed_point_or_error(element, anchor.get("pointId").and_then(Value::as_str).unwrap_or_default(), state)
    } else {
        point_anchor_or_error(element, &anchor, "from", state, &local_variables.0, &local_variables.1)
    };
    let Some(from_point) = from_point else {
        return;
    };
    let Some(angle_deg) = evaluate_numeric_or_push(
        element.get("angleDeg").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(distance) = evaluate_numeric_or_push(
        element.get("distance").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let angle_rad = angle_deg.to_radians();
    let id = element_id(element).unwrap_or_default();
    insert_geometry(
        state,
        id.clone(),
        computed_point(
            id,
            element_name(element),
            from_point.x + angle_rad.cos() * distance,
            from_point.y - angle_rad.sin() * distance,
        ),
    );
}

fn evaluate_line(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(start_anchor) = element.get("startPoint") else {
        return;
    };
    let Some(end_anchor) = element.get("endPoint") else {
        return;
    };
    let Some(start) = point_anchor_or_error(element, start_anchor, "start", state, &local_variables.0, &local_variables.1) else {
        return;
    };
    let Some(end) = point_anchor_or_error(element, end_anchor, "end", state, &local_variables.0, &local_variables.1) else {
        return;
    };
    let dx = end.x - start.x;
    let dy = start.y - end.y;
    let length = dx.hypot(dy);
    let start_angle = angle_from_to(&start, &end);
    let end_angle = angle_from_to(&end, &start);
    let id = element_id(element).unwrap_or_default();
    insert_geometry(
        state,
        id.clone(),
        json!({
            "kind": "line",
            "elementId": id,
            "name": element_name(element),
            "startPointId": anchor_reference_element_id(start_anchor),
            "endPointId": anchor_reference_element_id(end_anchor),
            "start": computed_point(start.element_id, start.name, start.x, start.y),
            "end": computed_point(end.element_id, end.name, end.x, end.y),
            "length": length,
            "startAngleDeg": start_angle,
            "endAngleDeg": end_angle,
            "startTangentAngleDeg": start_angle,
            "endTangentAngleDeg": end_angle
        }),
    );
}

fn evaluate_arc_line(
    element: &Value,
    local_variables: &(HashMap<String, f64>, HashMap<String, String>),
    state: &mut EvaluationState,
) {
    let Some(center_anchor) = element.get("centerPoint") else {
        return;
    };
    let Some(center) = point_anchor_or_error(element, center_anchor, "center", state, &local_variables.0, &local_variables.1) else {
        return;
    };
    let Some(radius) = evaluate_numeric_or_push(
        element.get("radius").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(start_angle_deg) = evaluate_numeric_or_push(
        element.get("startAngleDeg").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let Some(end_angle_deg) = evaluate_numeric_or_push(
        element.get("endAngleDeg").unwrap_or(&Value::Null),
        state,
        element,
        &local_variables.0,
        &local_variables.1,
    ) else {
        return;
    };
    let safe_radius = if radius > 0.0 { radius } else { 0.0 };
    let sweep_angle_deg = normalize_degrees(end_angle_deg - start_angle_deg);
    let start_angle_rad = start_angle_deg.to_radians();
    let end_angle_rad = end_angle_deg.to_radians();
    let tangent_offset = if sweep_angle_deg >= 0.0 { 90.0 } else { -90.0 };
    let id = element_id(element).unwrap_or_default();
    insert_geometry(
        state,
        id.clone(),
        json!({
            "kind": "arcLine",
            "elementId": id,
            "name": element_name(element),
            "centerPointId": anchor_reference_element_id(center_anchor),
            "center": computed_point(center.element_id, center.name, center.x, center.y),
            "start": computed_point(format!("{}:start", element_id(element).unwrap_or_default()), format!("{}.始点", element_name(element)), center.x + start_angle_rad.cos() * safe_radius, center.y - start_angle_rad.sin() * safe_radius),
            "end": computed_point(format!("{}:end", element_id(element).unwrap_or_default()), format!("{}.終点", element_name(element)), center.x + end_angle_rad.cos() * safe_radius, center.y - end_angle_rad.sin() * safe_radius),
            "radius": radius,
            "startAngleDeg": start_angle_deg,
            "endAngleDeg": end_angle_deg,
            "startTangentAngleDeg": normalize_degrees(start_angle_deg + tangent_offset),
            "endTangentAngleDeg": normalize_degrees(end_angle_deg + tangent_offset + 180.0),
            "sweepAngleDeg": sweep_angle_deg,
            "length": safe_radius * sweep_angle_deg.to_radians()
        }),
    );
}

fn angle_from_to(start: &Point, end: &Point) -> Option<f64> {
    let dx = end.x - start.x;
    let dy = start.y - end.y;
    let length = dx.hypot(dy);
    (length > 1e-9).then(|| normalize_degrees(dy.atan2(dx).to_degrees()))
}

fn normalize_degrees(degrees: f64) -> f64 {
    degrees.rem_euclid(360.0)
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
            let value = text.parse::<f64>().map_err(|_| format!("数値を解釈できません: {text}"))?;
            tokens.push(Token::Number(value));
            continue;
        }

        if ch == '@' {
            let start = index + 1;
            index = start;
            while index < chars.len() && !is_expression_delimiter(chars[index]) && chars[index] != '.' {
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
            while index < chars.len() && !is_expression_delimiter(chars[index]) && chars[index] != '.' {
                index += 1;
            }
            tokens.push(Token::Reference {
                element_id: first,
                property: chars[property_start..index].iter().collect(),
            });
            continue;
        }
        if index < chars.len() && chars[index] == '(' {
            if matches!(first.as_str(), "distance" | "距離" | "angle" | "角度" | "lineDistance" | "点線距離") {
                let name = match first.as_str() {
                    "距離" => "distance",
                    "角度" => "angle",
                    "点線距離" => "lineDistance",
                    _ => first.as_str(),
                };
                tokens.push(Token::Function(name.to_owned()));
                continue;
            }
        }
        if first.is_empty() {
            return Err(format!("式を解釈できません: {}", &expression[index..]));
        }
        tokens.push(Token::Element(first));
    }

    Ok(tokens)
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
            value = if operator == '+' { value + right } else { value - right };
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
            value = if operator == '*' { value * right } else { value / right };
        }
        Ok(value)
    }

    fn parse_factor(&mut self) -> Result<f64, NumericEvalError> {
        let Some(token) = self.consume() else {
            return Err(self.simple_error("式が途中で終わっています。"));
        };
        match token {
            Token::Number(value) => Ok(value),
            Token::Reference { element_id, property } => self.reference_value(&element_id, &property),
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
        self.local_variables.get(variable_id).copied().ok_or_else(|| NumericEvalError {
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
            return Ok(normalize_degrees((point1.y - point2.y).atan2(point2.x - point1.x).to_degrees()));
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
        let start = line.get("start").and_then(point_from_value).ok_or_else(|| self.dependency_error(&args[1]))?;
        let end = line.get("end").and_then(point_from_value).ok_or_else(|| self.dependency_error(&args[1]))?;
        let dx = end.x - start.x;
        let dy = end.y - start.y;
        let length = dx.hypot(dy);
        if length <= 1e-9 {
            return Err(self.simple_error(&format!("{} は長さ0のため点線距離を計算できません。", line.get("name").and_then(Value::as_str).unwrap_or(&args[1]))));
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
            return resolve_derived_point(geometry, key).ok_or_else(|| self.dependency_error(source_id));
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

#[cfg(test)]
mod tests {
    use super::*;

    fn element(value: Value) -> Value {
        value
    }

    #[test]
    fn evaluates_points_lines_variables_and_arcs() {
        let result = evaluate_document_input(EvaluationInput {
            elements: vec![
                element(json!({
                    "id": "ease",
                    "name": "ゆとり",
                    "type": "variable",
                    "visible": true,
                    "enabled": true,
                    "scope": "global",
                    "valueMode": "expression",
                    "expression": 12,
                    "point1": { "mode": "reference", "pointId": "a" },
                    "point2": { "mode": "reference", "pointId": "a" },
                    "point": { "mode": "reference", "pointId": "a" },
                    "lineId": ""
                })),
                element(json!({
                    "id": "a",
                    "name": "点A",
                    "type": "freePoint",
                    "visible": true,
                    "enabled": true,
                    "x": { "kind": "expression", "expression": "@ゆとり + 8" },
                    "y": 20
                })),
                element(json!({
                    "id": "b",
                    "name": "点B",
                    "type": "polarOffsetPoint",
                    "visible": true,
                    "enabled": true,
                    "fromPointId": "a",
                    "angleDeg": 0,
                    "distance": 10
                })),
                element(json!({
                    "id": "ab",
                    "name": "直線AB",
                    "type": "line",
                    "visible": true,
                    "enabled": true,
                    "startPoint": { "mode": "reference", "pointId": "a" },
                    "endPoint": { "mode": "reference", "pointId": "b" }
                })),
                element(json!({
                    "id": "arc",
                    "name": "円弧",
                    "type": "arcLine",
                    "visible": true,
                    "enabled": true,
                    "centerPoint": { "mode": "reference", "pointId": "a" },
                    "radius": 20,
                    "startAngleDeg": 0,
                    "endAngleDeg": 90
                }))
            ],
            evaluation_limit_index: None,
        });

        assert!(result.errors.is_empty());
        assert_eq!(result.computed_variables[0]["value"], json!(12.0));
        assert_eq!(result.computed_geometry[0]["x"], json!(20.0));
        assert_eq!(result.computed_geometry[1]["x"], json!(30.0));
        assert_eq!(result.computed_geometry[2]["kind"], json!("line"));
        assert_eq!(result.computed_geometry[3]["kind"], json!("arcLine"));
    }

    #[test]
    fn reports_too_late_dependency() {
        let result = evaluate_document_input(EvaluationInput {
            elements: vec![
                element(json!({
                    "id": "line",
                    "name": "参照線",
                    "type": "line",
                    "visible": true,
                    "enabled": true,
                    "startPoint": { "mode": "reference", "pointId": "a" },
                    "endPoint": { "mode": "coordinate", "x": 10, "y": 10 }
                })),
                element(json!({
                    "id": "a",
                    "name": "点A",
                    "type": "freePoint",
                    "visible": true,
                    "enabled": true,
                    "x": 0,
                    "y": 0
                }))
            ],
            evaluation_limit_index: Some(1),
        });

        assert_eq!(result.computed_geometry.len(), 0);
        assert_eq!(result.errors[0].element_id, "line");
        assert_eq!(result.errors[0].missing_dependency_id, "a");
        assert_eq!(result.errors[0].missing_dependency_name.as_deref(), Some("点A"));
    }

    #[test]
    fn applies_group_visibility_and_enabled_masks() {
        let result = evaluate_document_input(EvaluationInput {
            elements: vec![
                element(json!({
                    "id": "group",
                    "name": "前身頃",
                    "type": "group",
                    "visible": false,
                    "enabled": false,
                    "expanded": true
                })),
                element(json!({
                    "id": "a",
                    "name": "点A",
                    "type": "freePoint",
                    "parentGroupId": "group",
                    "visible": true,
                    "enabled": true,
                    "x": 0,
                    "y": 0
                }))
            ],
            evaluation_limit_index: None,
        });

        assert!(result.computed_geometry.is_empty());
        assert!(!result.effective_visible_element_ids.contains(&"a".to_owned()));
        assert!(!result.effective_enabled_element_ids.contains(&"a".to_owned()));
    }
}
