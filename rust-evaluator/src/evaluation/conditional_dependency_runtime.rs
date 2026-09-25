//! Runtime activation of compiler-owned conditional dependency edges.
//!
//! This module does not parse source or resolve names. It validates the graph
//! facts and typed controller expressions emitted by the TypeScript compiler,
//! then projects the single canonical edge set into the selected runtime
//! branch for readiness and cycle diagnostics.

use std::collections::{HashMap, HashSet};

use serde::Deserialize;
use serde_json::Value;

use super::scalars::{
    validate_typed_expression_payload, ScalarDocumentBindingResolver, ScalarValue,
    TypedScalarExpression,
};
use super::types::{DependencyError, ElementId, EvaluationState, GeometryValueOccurrence};

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
    #[serde(default)]
    owner_id: Option<String>,
    #[serde(default)]
    stage_path: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawConditionalDependencyActivation {
    #[serde(default)]
    guards: Vec<RawConditionalDependencyGuard>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawConditionalDependencyGuard {
    controller_id: String,
    branch: String,
    controller_kind: Option<String>,
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
    owner_id: Option<String>,
    stage_path: Vec<String>,
}

#[derive(Debug)]
struct ConditionalDependencyActivation {
    guards: Vec<ConditionalDependencyGuard>,
}

#[derive(Debug)]
struct ConditionalDependencyGuard {
    controller_id: String,
    branch: String,
    controller_kind: Option<String>,
    static_selection: Option<String>,
    controller_expression: Option<TypedScalarExpression>,
}

#[derive(Debug)]
pub(crate) struct ConditionalDependencyGraph {
    edges: Vec<ConditionalDependencyEdge>,
}

pub(crate) struct ActivatedConditionalDependencies {
    pub(crate) evaluation_order: Vec<ElementId>,
    pub(crate) dependency_order: Vec<String>,
    pub(crate) cycles: Vec<DependencyError>,
}

pub(crate) struct ConditionalDependencyControllerCandidate<'a> {
    pub(crate) controller_id: String,
    pub(crate) source_endpoint_id: String,
    pub(crate) controller_kind: Option<String>,
    pub(crate) expression: Option<&'a TypedScalarExpression>,
    pub(crate) branches: Vec<String>,
    pub(crate) prerequisite_endpoint_ids: Vec<String>,
}

struct DependencyReadinessContext<'a> {
    branch_selections: &'a HashMap<String, String>,
    resolver: &'a dyn ScalarDocumentBindingResolver,
    state: &'a EvaluationState,
    evaluated_geometry_values: &'a [bool],
    geometry_value_index_by_endpoint_id: &'a HashMap<String, usize>,
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
                let guards = raw_activation
                    .guards
                    .into_iter()
                    .map(|raw_guard| {
                        let controller_expression = raw_guard
                            .controller_expression
                            .as_ref()
                            .map(validate_typed_expression_payload)
                            .transpose()
                            .map_err(|error| error.message)?;
                        Ok::<_, String>(ConditionalDependencyGuard {
                            controller_id: raw_guard.controller_id,
                            branch: raw_guard.branch,
                            controller_kind: raw_guard.controller_kind,
                            static_selection: raw_guard.static_selection,
                            controller_expression,
                        })
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                Ok::<_, String>(ConditionalDependencyActivation { guards })
            })
            .transpose()?;
        edges.push(ConditionalDependencyEdge {
            from: ConditionalDependencyEndpoint {
                kind: raw_edge.from.kind,
                id: raw_edge.from.id,
                name: raw_edge.from.name,
                owner_id: raw_edge.from.owner_id,
                stage_path: raw_edge.from.stage_path,
            },
            to: ConditionalDependencyEndpoint {
                kind: raw_edge.to.kind,
                id: raw_edge.to.id,
                name: raw_edge.to.name,
                owner_id: raw_edge.to.owner_id,
                stage_path: raw_edge.to.stage_path,
            },
            requiredness: raw_edge.requiredness,
            activation,
        });
    }
    Ok(Some(ConditionalDependencyGraph { edges }))
}

fn encode_identity_tuple(parts: &[String]) -> String {
    let mut encoded = String::new();
    for part in parts {
        encoded.push_str(&part.encode_utf16().count().to_string());
        encoded.push(':');
        encoded.push_str(part);
    }
    encoded
}

pub(crate) fn geometry_value_endpoint_id(occurrence: &GeometryValueOccurrence) -> String {
    let mut parts = vec![
        if occurrence.mapped_member_index.is_some() {
            "geometry-value-map-member".to_owned()
        } else {
            "geometry-value".to_owned()
        },
        occurrence.source_statement_id.clone(),
    ];
    parts.extend(occurrence.instance_path.iter().cloned());
    if let Some(index) = occurrence.mapped_member_index {
        parts.push(index.to_string());
    }
    format!("geometry-value:{}", encode_identity_tuple(&parts))
}

fn endpoint_key(endpoint: &ConditionalDependencyEndpoint) -> String {
    format!("{}:{}", endpoint.kind, endpoint.id)
}

fn diagnostic_endpoint_id(endpoint: &ConditionalDependencyEndpoint) -> String {
    if endpoint.kind == "element" {
        endpoint.id.clone()
    } else {
        endpoint_key(endpoint)
    }
}

pub(crate) fn branch_for_controller_value(
    value: &ScalarValue,
    branches: &HashSet<String>,
) -> Option<String> {
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
    activation
        .guards
        .iter()
        .all(|guard| match guard.static_selection.as_deref() {
            Some("selected") => true,
            Some("unselected") => false,
            _ => branch_selections
                .get(&guard.controller_id)
                .is_some_and(|branch| branch == &guard.branch),
        })
}

fn activation_path_matches(
    guards: &[ConditionalDependencyGuard],
    prefix: &[ConditionalDependencyGuard],
) -> bool {
    guards.len() == prefix.len()
        && guards.iter().zip(prefix).all(|(guard, expected)| {
            guard.controller_id == expected.controller_id
                && guard.branch == expected.branch
                && guard.static_selection == expected.static_selection
        })
}

fn activation_path_is_active(
    guards: &[ConditionalDependencyGuard],
    branch_selections: &HashMap<String, String>,
) -> bool {
    guards
        .iter()
        .all(|guard| match guard.static_selection.as_deref() {
            Some("selected") => true,
            Some("unselected") => false,
            _ => branch_selections
                .get(&guard.controller_id)
                .is_some_and(|branch| branch == &guard.branch),
        })
}

impl ConditionalDependencyGraph {
    pub(crate) fn has_activation(&self) -> bool {
        self.edges.iter().any(|edge| {
            edge.activation
                .as_ref()
                .is_some_and(|activation| !activation.guards.is_empty())
        })
    }

    pub(crate) fn controller_candidates(
        &self,
        branch_selections: &HashMap<String, String>,
    ) -> Vec<ConditionalDependencyControllerCandidate<'_>> {
        let mut candidates = HashMap::<String, ConditionalDependencyControllerCandidate<'_>>::new();
        for edge in &self.edges {
            let Some(activation) = edge.activation.as_ref() else {
                continue;
            };
            for (guard_index, guard) in activation.guards.iter().enumerate() {
                let is_geometry_coalesce =
                    guard.controller_kind.as_deref() == Some("geometry-value-coalesce");
                let expression = guard.controller_expression.as_ref();
                if expression.is_none() && !is_geometry_coalesce {
                    continue;
                }
                let prefix = &activation.guards[..guard_index];
                if !activation_path_is_active(prefix, branch_selections) {
                    continue;
                }
                let source_endpoint_id = endpoint_key(&edge.from);
                let candidate = candidates
                    .entry(guard.controller_id.clone())
                    .or_insert_with(|| ConditionalDependencyControllerCandidate {
                        controller_id: guard.controller_id.clone(),
                        source_endpoint_id: source_endpoint_id.clone(),
                        controller_kind: guard.controller_kind.clone(),
                        expression,
                        branches: Vec::new(),
                        prerequisite_endpoint_ids: Vec::new(),
                    });
                if !candidate.branches.contains(&guard.branch) {
                    candidate.branches.push(guard.branch.clone());
                }
                for prerequisite in &self.edges {
                    if endpoint_key(&prerequisite.from) != source_endpoint_id {
                        continue;
                    }
                    let prerequisite_guards = prerequisite
                        .activation
                        .as_ref()
                        .map(|activation| activation.guards.as_slice())
                        .unwrap_or_default();
                    if !activation_path_matches(prerequisite_guards, prefix)
                        || !edge_is_active(prerequisite, branch_selections)
                    {
                        continue;
                    }
                    let endpoint_id = endpoint_key(&prerequisite.to);
                    if !candidate.prerequisite_endpoint_ids.contains(&endpoint_id) {
                        candidate.prerequisite_endpoint_ids.push(endpoint_id);
                    }
                }
            }
        }
        candidates.into_values().collect()
    }

    pub(crate) fn endpoint_is_ready(
        &self,
        endpoint_id: &str,
        branch_selections: &HashMap<String, String>,
        resolver: &dyn ScalarDocumentBindingResolver,
        state: &EvaluationState,
        evaluated_geometry_values: &[bool],
        geometry_value_index_by_endpoint_id: &HashMap<String, usize>,
    ) -> bool {
        self.endpoint_is_ready_inner(
            endpoint_id,
            &DependencyReadinessContext {
                branch_selections,
                resolver,
                state,
                evaluated_geometry_values,
                geometry_value_index_by_endpoint_id,
            },
            &mut HashSet::new(),
        )
    }

    fn endpoint_is_ready_inner(
        &self,
        endpoint_id: &str,
        context: &DependencyReadinessContext<'_>,
        visiting: &mut HashSet<String>,
    ) -> bool {
        if !visiting.insert(endpoint_id.to_owned()) {
            return false;
        }
        let endpoint = self
            .edges
            .iter()
            .flat_map(|edge| [&edge.from, &edge.to])
            .find(|endpoint| endpoint_key(endpoint) == endpoint_id);
        let Some(endpoint) = endpoint else {
            visiting.remove(endpoint_id);
            return false;
        };
        let ready = match endpoint.kind.as_str() {
            "geometry-value" => context
                .geometry_value_index_by_endpoint_id
                .get(endpoint_id)
                .and_then(|index| context.evaluated_geometry_values.get(*index))
                .copied()
                .unwrap_or(false),
            "geometry-stage" => match endpoint.owner_id.as_ref() {
                Some(owner_id) if endpoint.stage_path == ["base".to_owned()] => context
                    .state
                    .base_transformation_geometry
                    .contains_key(owner_id),
                Some(owner_id) if endpoint.stage_path == ["final".to_owned()] => {
                    context.state.computed_geometry.contains_key(owner_id)
                }
                Some(owner_id) => {
                    context
                        .state
                        .transformation_stage_geometry
                        .contains_key(&format!(
                            "{}\u{0}*\u{0}{}",
                            owner_id,
                            endpoint.stage_path.join(".")
                        ))
                }
                None => false,
            },
            "element" => context.state.computed_geometry.contains_key(&endpoint.id),
            "module-occurrence" => context.state.instance_base_geometry.contains_key(
                endpoint
                    .id
                    .strip_prefix("module-occurrence:")
                    .unwrap_or(&endpoint.id),
            ),
            "binding" => {
                let prerequisites_ready = self
                    .edges
                    .iter()
                    .filter(|edge| {
                        endpoint_key(&edge.from) == endpoint_id
                            && edge_is_active(edge, context.branch_selections)
                    })
                    .all(|edge| {
                        self.endpoint_is_ready_inner(&endpoint_key(&edge.to), context, visiting)
                    });
                prerequisites_ready
                    && matches!(
                        context
                            .resolver
                            .resolve_binding(&endpoint.id, context.state),
                        super::scalars::ScalarEvaluation::Ok { .. }
                    )
            }
            _ => false,
        };
        visiting.remove(endpoint_id);
        ready
    }

    pub(crate) fn project(
        &self,
        element_ids: &[ElementId],
        evaluation_limit_index: usize,
        branch_selections: &HashMap<String, String>,
    ) -> ActivatedConditionalDependencies {
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
            if !edge_is_active(edge, branch_selections) {
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
            dependency_order: traversal.ordered_endpoints,
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
                            element_id: diagnostic_endpoint_id(first),
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
