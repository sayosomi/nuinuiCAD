use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fmt;

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
    /// Task 19's validated declaration-only IR. Task 21 evaluates this after
    /// the production geometry pass, preserving the existing geometry result.
    pub(crate) scalar_program: Option<Value>,
    /// Task 32's fully compiled binding-version IR for a document containing
    /// linear `set` statements. This is deliberately separate from
    /// `scalar_program`: Rust receives stable IDs, resolved references and
    /// source positions, never source text or names to resolve.
    pub(crate) binding_versions: Option<Value>,
    /// Schema-driven elementId-keyed property sources (re-keyed from
    /// `CompiledDslDocument.propertyBindings` by TS's
    /// `propertyBindingRuntime.ts`). Requires `scalar_program` to also be
    /// present - see `property_binding_payload.rs`'s validation, which
    /// rejects every direct binding entry when there is no scalar program to
    /// resolve binding ids against, rather than silently falling back to
    /// literal values.
    pub(crate) property_bindings: Option<Value>,
    /// Task 25's elementId-keyed `forGroup.showGenerated` bindings. Same
    /// fail-closed-without-a-scalar-program contract as `property_bindings`.
    pub(crate) control_boolean_bindings: Option<Value>,
    /// Task 25's `conditionalGroup.condition` typed boolean expressions, one
    /// entry per bound `conditionalGroup` (`{elementId, expression}`). A
    /// distinct shape from `control_boolean_bindings`/`property_bindings`
    /// (a full AST, not a bindingId) since `condition` accepts an arbitrary
    /// boolean expression, not just a bare `@name` reference.
    pub(crate) condition_expressions: Option<Value>,
    /// Compiled Task 26/27 text-template segments. This carries no source
    /// text or names for Rust to parse: typed holes already contain resolved
    /// expression ASTs, while numeric holes retain their local numeric
    /// runtime path.
    pub(crate) text_templates: Option<Value>,
    /// Validated text-property sources. Kept separate from common property
    /// bindings only while the text runtime physical route remains in place.
    pub(crate) text_property_bindings: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationCommandError {
    pub(crate) code: String,
    pub(crate) message: String,
}

impl fmt::Display for EvaluationCommandError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for EvaluationCommandError {}

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

#[derive(Debug, Clone, Serialize)]
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
    pub(crate) errors: Vec<DependencyError>,
    pub(crate) warnings: Vec<EvaluationWarning>,
    pub(crate) evaluated_element_ids: Vec<ElementId>,
    pub(crate) evaluation_limit_index: usize,
    pub(crate) effective_visible_element_ids: Vec<ElementId>,
    pub(crate) effective_enabled_element_ids: Vec<ElementId>,
    pub(crate) condition_inactive_element_ids: Vec<ElementId>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(crate) for_group_generated_rows: Vec<ForGroupGeneratedRow>,
    /// Task 25: `forGroup` ids whose generated-result presentation is
    /// enabled. Never affects iteration count/rows - `for_group_generated_rows`
    /// above is always fully populated regardless of membership here.
    pub(crate) for_group_effective_show_generated_ids: Vec<ElementId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) computed_scalar_bindings: Option<Vec<Value>>,
    /// Task 32's source-ordered runtime history for every executed/poisoned
    /// binding version. Absent on Task 21's declaration-only path.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) computed_scalar_binding_versions: Option<Vec<Value>>,
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

/// A label safe to interpolate into a diagnostic message, even for a bare
/// mutation-statement element (edge/extendTrim/move/symmetricMove/
/// pathReverse) whose `name` is always "" - these have no DSL name slot to
/// write into. Every other element type always has a real non-empty name,
/// so this fallback is unreachable for them.
pub fn element_display_name(element: &Value) -> String {
    let name = element_name(element);
    if !name.is_empty() {
        return name;
    }
    match element_type(element) {
        Some("edge") => "エッジ",
        Some("extendTrim") => "延長短縮",
        Some("move") => "移動",
        Some("symmetricMove") => "対称移動",
        Some("pathReverse") => "反転",
        Some(other) => other,
        None => "要素",
    }
    .to_owned()
}

/// Mirrors the TypeScript `elementTypesWithoutOwnDrawableGeometry` set (see
/// src/model/elementActivity.ts): these five bare mutation-statement types
/// always have `name === ""` in the model, since the DSL "mutation" category
/// has no name slot to write into.
pub fn element_type_without_own_drawable_geometry(element_type: Option<&str>) -> bool {
    matches!(
        element_type,
        Some("edge" | "extendTrim" | "move" | "symmetricMove" | "pathReverse")
    )
}

pub fn element_type(element: &Value) -> Option<&str> {
    element.get("type")?.as_str()
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
        .map(element_display_name)
}

pub fn insert_geometry(state: &mut EvaluationState, id: ElementId, geometry: Value) {
    if !state.computed_geometry.contains_key(&id) {
        state.computed_geometry_order.push(id.clone());
    }
    state.computed_geometry.insert(id, geometry);
}
