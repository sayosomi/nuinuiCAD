//! Runtime activation of compiler-owned conditional dependency edges.
//!
//! This module does not parse source or resolve names. It validates the graph
//! facts and typed controller expressions emitted by the TypeScript compiler,
//! then projects the single canonical edge set into the selected runtime
//! branch for readiness and cycle diagnostics.

use std::collections::{HashMap, HashSet};

use serde::Deserialize;
use serde_json::Value;

use super::control_boolean_runtime::evaluate_scalar_expression_with_document_resolver;
use super::scalars::{
    validate_typed_expression_payload, ScalarDocumentBindingResolver, ScalarValue,
    TypedScalarExpression,
};
use super::types::{DependencyError, ElementId, EvaluationState};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawConditionalDependencyGraph {
    edges: Vec<RawConditionalDependencyEdge>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawConditionalDependencyEdge {
    from: RawConditionalDependencyEndpoint,
    to: RawConditionalDependencyEndpoint,
    requiredness: Option<String>,
    activation: Option<RawConditionalDependencyActivation>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawConditionalDependencyEndpoint {
    kind: String,
    id: String,
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawConditionalDependencyActivation {
    controller_id: String,
    branch: String,
    static_selection: Option<String>,
    controller_expression: Option<Value>,
}

#[derive(Debug)]
struct ConditionalDependencyEdge {
    from: ConditionalDependencyEndpoint,
    to: ConditionalDependencyEndpoint,
    requiredness: Option<String>,
    activation: Option<ConditionalDependencyActivation>,
}

#[derive(Debug)]
struct ConditionalDependencyEndpoint {
    kind: String,
    id: String,
    name: String,
}

#[derive(Debug)]
struct ConditionalDependencyActivation {
    controller_id: String,
    branch: String,
    static_selection: Option<String>,
    controller_expression: Option<TypedScalarExpression>,
}

#[derive(Debug)]
pub(crate) struct ConditionalDependencyGraph {
    edges: Vec<ConditionalDependencyEdge>,
}

pub(crate) struct ActivatedConditionalDependencies {
    pub(crate) evaluation_order: Vec<ElementId>,
    pub(crate) cycles: Vec<DependencyError>,
}

pub(crate) fn decode_conditional_dependency_graph(
    payload: Option<&Value>,
) -> Result<Option<ConditionalDependencyGraph>, String> {
    let Some(payload) = payload else {
        return Ok(None);
    };
    let raw: RawConditionalDependencyGraph = serde_json::from_value(payload.clone())
        .map_err(|error| format!("conditional dependency graph payload is invalid: {error}"))?;
    let mut edges = Vec::with_capacity(raw.edges.len());
    for raw_edge in raw.edges {
        let activation = raw_edge
            .activation
            .map(|raw_activation| {
                let controller_expression = raw_activation
                    .controller_expression
                    .as_ref()
                    .map(validate_typed_expression_payload)
                    .transpose()
                    .map_err(|error| error.message)?;
                Ok::<_, String>(ConditionalDependencyActivation {
                    controller_id: raw_activation.controller_id,
                    branch: raw_activation.branch,
                    static_selection: raw_activation.static_selection,
                    controller_expression,
                })
            })
            .transpose()?;
        edges.push(ConditionalDependencyEdge {
            from: ConditionalDependencyEndpoint {
                kind: raw_edge.from.kind,
                id: raw_edge.from.id,
                name: raw_edge.from.name,
            },
            to: ConditionalDependencyEndpoint {
                kind: raw_edge.to.kind,
                id: raw_edge.to.id,
                name: raw_edge.to.name,
            },
            requiredness: raw_edge.requiredness,
            activation,
        });
    }
    Ok(Some(ConditionalDependencyGraph { edges }))
}

fn endpoint_key(endpoint: &ConditionalDependencyEndpoint) -> String {
    format!("{}:{}", endpoint.kind, endpoint.id)
}

fn branch_for_controller_value(value: &ScalarValue, branches: &HashSet<String>) -> Option<String> {
    match value {
        ScalarValue::Boolean(value) => Some(if *value { "then" } else { "else" }.to_owned()),
        ScalarValue::Choice { value, .. } => Some(format!("match:{value}")),
        ScalarValue::None => Some(
            if branches.contains("match:none") {
                "match:none"
            } else {
                "right"
            }
            .to_owned(),
        ),
        ScalarValue::Number(_) | ScalarValue::String(_) => branches
            .contains("match:some")
            .then(|| "match:some".to_owned()),
    }
}

fn edge_is_active(
    edge: &ConditionalDependencyEdge,
    branch_selections: &HashMap<String, String>,
) -> bool {
    if edge.requiredness.as_deref() != Some("conditional") {
        return true;
    }
    let Some(activation) = edge.activation.as_ref() else {
        // Preserve established readiness for structured geometry products that
        // are conditional but do not expose a controller AST at this owner
        // boundary. Compiler-resolved activation facts are filtered below.
        return true;
    };
    match activation.static_selection.as_deref() {
        Some("selected") => true,
        Some("unselected") => false,
        _ => branch_selections
            .get(&activation.controller_id)
            .is_some_and(|branch| branch == &activation.branch),
    }
}

impl ConditionalDependencyGraph {
    pub(crate) fn has_activation(&self) -> bool {
        self.edges.iter().any(|edge| edge.activation.is_some())
    }

    pub(crate) fn activate(
        &self,
        element_ids: &[ElementId],
        evaluation_limit_index: usize,
        resolver: Option<&dyn ScalarDocumentBindingResolver>,
        state: &EvaluationState,
    ) -> ActivatedConditionalDependencies {
        let mut branch_selections = HashMap::<String, String>::new();
        if let Some(resolver) = resolver {
            let mut controllers = HashMap::<String, &TypedScalarExpression>::new();
            for edge in &self.edges {
                if let Some(activation) = edge.activation.as_ref() {
                    if let Some(expression) = activation.controller_expression.as_ref() {
                        controllers
                            .entry(activation.controller_id.clone())
                            .or_insert(expression);
                    }
                }
            }
            for (controller_id, expression) in controllers {
                let evaluation =
                    evaluate_scalar_expression_with_document_resolver(expression, resolver, state);
                if let super::scalars::ScalarEvaluation::Ok { value, .. } = evaluation {
                    let branches = self
                        .edges
                        .iter()
                        .filter_map(|edge| edge.activation.as_ref())
                        .filter(|activation| activation.controller_id == controller_id)
                        .map(|activation| activation.branch.clone())
                        .collect::<HashSet<_>>();
                    if let Some(branch) = branch_for_controller_value(&value, &branches) {
                        branch_selections.insert(controller_id, branch);
                    }
                }
            }
        }

        let mut endpoint_by_id = HashMap::<String, &ConditionalDependencyEndpoint>::new();
        let mut dependencies_by_node = HashMap::<String, Vec<String>>::new();
        let mut endpoint_order = Vec::<String>::new();
        for edge in &self.edges {
            let from = endpoint_key(&edge.from);
            let to = endpoint_key(&edge.to);
            if !endpoint_by_id.contains_key(&from) {
                endpoint_order.push(from.clone());
                endpoint_by_id.insert(from.clone(), &edge.from);
            }
            if !endpoint_by_id.contains_key(&to) {
                endpoint_order.push(to.clone());
                endpoint_by_id.insert(to.clone(), &edge.to);
            }
            if !edge_is_active(edge, &branch_selections) {
                continue;
            }
            let dependencies = dependencies_by_node.entry(from).or_default();
            if !dependencies.contains(&to) {
                dependencies.push(to);
            }
        }
        let mut traversal = DependencyTraversal {
            dependencies_by_node: &dependencies_by_node,
            endpoint_by_id: &endpoint_by_id,
            visit_state: HashMap::new(),
            stack: Vec::new(),
            ordered_endpoints: Vec::new(),
            cycles: Vec::new(),
            cycle_keys: HashSet::new(),
        };
        for node_id in endpoint_order {
            traversal.visit(&node_id);
        }
        let mut evaluation_order = traversal
            .ordered_endpoints
            .iter()
            .filter_map(|id| endpoint_by_id.get(id))
            .filter(|endpoint| endpoint.kind == "element")
            .map(|endpoint| endpoint.id.clone())
            .collect::<Vec<_>>();
        for element_id in element_ids.iter().take(evaluation_limit_index) {
            if !evaluation_order.contains(element_id) {
                evaluation_order.push(element_id.clone());
            }
        }
        ActivatedConditionalDependencies {
            evaluation_order,
            cycles: traversal.cycles,
        }
    }
}

struct DependencyTraversal<'a> {
    dependencies_by_node: &'a HashMap<String, Vec<String>>,
    endpoint_by_id: &'a HashMap<String, &'a ConditionalDependencyEndpoint>,
    visit_state: HashMap<String, u8>,
    stack: Vec<String>,
    ordered_endpoints: Vec<String>,
    cycles: Vec<DependencyError>,
    cycle_keys: HashSet<String>,
}

impl<'a> DependencyTraversal<'a> {
    fn visit(&mut self, node_id: &str) {
        match self.visit_state.get(node_id).copied() {
            Some(2) => return,
            Some(1) => {
                let start = self.stack.iter().position(|id| id == node_id).unwrap_or(0);
                let cycle_ids = self.stack[start..]
                    .iter()
                    .cloned()
                    .chain(std::iter::once(node_id.to_owned()))
                    .collect::<Vec<_>>();
                let key = cycle_ids.join("|");
                if self.cycle_keys.insert(key) {
                    let cycle_endpoints = cycle_ids
                        .iter()
                        .filter_map(|id| self.endpoint_by_id.get(id))
                        .collect::<Vec<_>>();
                    let first = cycle_endpoints.first();
                    let second = cycle_endpoints.get(1).or(first);
                    if let Some(first) = first {
                        self.cycles.push(DependencyError {
                            code: Some("dependency-cycle".into()),
                            element_id: endpoint_key(first),
                            element_name: first.name.clone(),
                            missing_dependency_id: second
                                .map(|endpoint| endpoint_key(endpoint))
                                .unwrap_or_default(),
                            missing_dependency_name: second
                                .map(|endpoint| endpoint.name.clone().into()),
                            message: format!(
                                "依存関係 cycle: {}",
                                cycle_endpoints
                                    .iter()
                                    .map(|endpoint| endpoint.name.as_str())
                                    .collect::<Vec<_>>()
                                    .join(" -> ")
                            ),
                        });
                    }
                }
                return;
            }
            _ => {}
        }
        self.visit_state.insert(node_id.to_owned(), 1);
        self.stack.push(node_id.to_owned());
        let dependencies = self
            .dependencies_by_node
            .get(node_id)
            .cloned()
            .unwrap_or_default();
        for dependency_id in dependencies {
            self.visit(&dependency_id);
        }
        self.stack.pop();
        self.visit_state.insert(node_id.to_owned(), 2);
        self.ordered_endpoints.push(node_id.to_owned());
    }
}
