use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

pub type ElementId = String;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationInput {
    pub(crate) elements: Vec<Value>,
    pub(crate) evaluation_limit_index: Option<usize>,
    /// A single typed-scalar-expression payload (Task 17,
    /// docs/typed-variables/tasks/17-rust-expression-payload-validation.md),
    /// deliberately scoped narrower than a full multi-statement "compiled
    /// scalar program" - that's Task 19/21's concern. No caller populates
    /// this yet; when absent, evaluation is byte-for-byte unchanged from
    /// before this field existed. When present, `evaluate_document_input`
    /// only runs it through `scalars::validate_typed_expression_payload` as
    /// an inert shadow check (see mod.rs) - the result never affects
    /// `EvaluationPayload`.
    pub(crate) scalar_expression_payload: Option<Value>,
    /// Task 19's declaration-only IR. Validation is inert until Task 21.
    pub(crate) scalar_program: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyError {
    pub(crate) element_id: ElementId,
    pub(crate) element_name: String,
    pub(crate) missing_dependency_id: ElementId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) missing_dependency_name: Option<String>,
    pub(crate) message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationWarning {
    pub(crate) element_id: ElementId,
    pub(crate) element_name: String,
    pub(crate) message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ForGroupGeneratedRow {
    pub(crate) for_group_id: ElementId,
    pub(crate) template_element_id: ElementId,
    pub(crate) generated_element_id: ElementId,
    pub(crate) iteration_index: usize,
    pub(crate) variable_name: String,
    pub(crate) variable_value: f64,
    pub(crate) element_name: String,
    pub(crate) element_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationPayload {
    pub(crate) computed_geometry: Vec<Value>,
    pub(crate) computed_variables: Vec<Value>,
    pub(crate) errors: Vec<DependencyError>,
    pub(crate) warnings: Vec<EvaluationWarning>,
    pub(crate) evaluated_element_ids: Vec<ElementId>,
    pub(crate) evaluation_limit_index: usize,
    pub(crate) effective_visible_element_ids: Vec<ElementId>,
    pub(crate) effective_enabled_element_ids: Vec<ElementId>,
    pub(crate) condition_inactive_element_ids: Vec<ElementId>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(crate) for_group_generated_rows: Vec<ForGroupGeneratedRow>,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct GroupState {
    pub(crate) disabled_by_group_id: Option<ElementId>,
}

#[derive(Clone, Debug)]
pub(crate) struct Point {
    pub(crate) element_id: ElementId,
    pub(crate) name: String,
    pub(crate) x: f64,
    pub(crate) y: f64,
}

#[derive(Debug)]
pub(crate) struct NumericEvalError {
    pub(crate) dependency_id: ElementId,
    pub(crate) dependency_name: Option<String>,
    pub(crate) message: String,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Token {
    Number(f64),
    Reference {
        element_id: ElementId,
        property: String,
    },
    Element(ElementId),
    LocalVariable(String),
    Function(String),
    Operator(char),
    ComparisonOperator(String),
    LogicalOperator(String),
    Comma,
    LeftParen,
    RightParen,
}

pub(crate) struct EvaluationState {
    pub(crate) elements: Vec<Value>,
    pub(crate) elements_by_id: HashMap<ElementId, usize>,
    pub(crate) group_states: HashMap<ElementId, GroupState>,
    pub(crate) computed_geometry: HashMap<ElementId, Value>,
    pub(crate) computed_geometry_order: Vec<ElementId>,
    pub(crate) computed_variables: HashMap<ElementId, Value>,
    pub(crate) computed_variable_order: Vec<ElementId>,
    pub(crate) errors: Vec<DependencyError>,
    pub(crate) warnings: Vec<EvaluationWarning>,
}

pub fn element_id(element: &Value) -> Option<ElementId> {
    element.get("id")?.as_str().map(ToOwned::to_owned)
}

pub fn element_name(element: &Value) -> String {
    element
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

pub fn element_type(element: &Value) -> Option<&str> {
    element.get("type")?.as_str()
}

pub fn bool_field(element: &Value, key: &str, default: bool) -> bool {
    element.get(key).and_then(Value::as_bool).unwrap_or(default)
}

pub fn parent_group_id(element: &Value) -> Option<ElementId> {
    element
        .get("parentGroupId")?
        .as_str()
        .map(ToOwned::to_owned)
}

pub fn find_element_name(state: &EvaluationState, id: &str) -> Option<String> {
    state
        .elements_by_id
        .get(id)
        .and_then(|index| state.elements.get(*index))
        .map(element_name)
}

pub fn insert_geometry(state: &mut EvaluationState, id: ElementId, geometry: Value) {
    if !state.computed_geometry.contains_key(&id) {
        state.computed_geometry_order.push(id.clone());
    }
    state.computed_geometry.insert(id, geometry);
}

pub fn insert_variable(state: &mut EvaluationState, id: ElementId, variable: Value) {
    if !state.computed_variables.contains_key(&id) {
        state.computed_variable_order.push(id.clone());
    }
    state.computed_variables.insert(id, variable);
}
