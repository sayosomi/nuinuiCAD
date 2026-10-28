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

#[cfg(test)]
thread_local! {
    static READINESS_EDGE_VISITS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    static MODULE_PREREQUISITE_EDGE_VISITS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    static CONTROLLER_CANDIDATE_EDGE_VISITS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

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
    #[serde(default)]
    span: Option<RawConditionalDependencySpan>,
    requiredness: Option<String>,
    activation: Option<RawConditionalDependencyActivation>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawConditionalDependencySpan {
    start: usize,
    end: usize,
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
    span: Option<(usize, usize)>,
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
    guarded_edge_indices: Vec<usize>,
    module_occurrence_edge_indices_by_from: HashMap<String, Vec<usize>>,
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
    completed_element_ids: Option<&'a HashSet<ElementId>>,
    evaluated_geometry_values: &'a [bool],
    geometry_value_index_by_endpoint_id: &'a HashMap<String, usize>,
}

struct GeometryDependencyReadinessContext<'a> {
    branch_selections: &'a HashMap<String, String>,
    state: &'a EvaluationState,
    completed_element_ids: Option<&'a HashSet<ElementId>>,
}

struct GeometryPropertyReadinessContext<'a> {
    outgoing_edges: HashMap<String, Vec<&'a ConditionalDependencyEdge>>,
    endpoints: HashMap<String, &'a ConditionalDependencyEndpoint>,
    resolver: &'a dyn ScalarDocumentBindingResolver,
    state: &'a EvaluationState,
    completed_element_ids: Option<&'a HashSet<ElementId>>,
    evaluated_geometry_values: &'a [bool],
    geometry_value_index_by_endpoint_id: &'a HashMap<String, usize>,
    source_order_by_binding_id: Option<&'a HashMap<String, usize>>,
}

pub(crate) struct DependencyScheduledBindingReadiness<'a> {
    pub(crate) candidate_binding_ids: &'a [String],
    pub(crate) source_order_by_binding_id: &'a HashMap<String, usize>,
    pub(crate) branch_selections: &'a HashMap<String, String>,
    pub(crate) resolver: &'a dyn ScalarDocumentBindingResolver,
    pub(crate) state: &'a EvaluationState,
    pub(crate) completed_element_ids: Option<&'a HashSet<ElementId>>,
    pub(crate) evaluated_geometry_values: &'a [bool],
    pub(crate) geometry_value_index_by_endpoint_id: &'a HashMap<String, usize>,
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
            span: raw_edge.span.map(|span| (span.start, span.end)),
            activation,
        });
    }
    Ok(Some(ConditionalDependencyGraph::from_edges(edges)))
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

pub(crate) fn local_module_binding_prefix(instance_path: &[String]) -> String {
    let mut parts = vec!["local".to_owned()];
    parts.extend(instance_path.iter().cloned());
    format!("module-binding:{}", encode_identity_tuple(&parts))
}

pub(crate) fn geometry_value_endpoint_id(occurrence: &GeometryValueOccurrence) -> String {
    let mut parts = vec![
        if occurrence.runtime_generation.is_some() {
            "geometry-value-map-generation".to_owned()
        } else if occurrence.mapped_member_index.is_some() {
            "geometry-value-map-member".to_owned()
        } else {
            "geometry-value".to_owned()
        },
        occurrence.source_statement_id.clone(),
    ];
    parts.extend(occurrence.instance_path.iter().cloned());
    if let Some(generation) = occurrence.runtime_generation {
        parts.push(generation.to_string());
    }
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

fn element_geometry_prerequisite_ready(
    state: &EvaluationState,
    element_id: &str,
    completed: Option<&HashSet<ElementId>>,
) -> bool {
    state.computed_geometry.contains_key(element_id)
        || (completed.is_some_and(|ids| ids.contains(element_id))
            && state
                .elements_by_id
                .get(element_id)
                .and_then(|index| state.elements.get(*index))
                .and_then(|element| element.get("type"))
                .and_then(Value::as_str)
                == Some("forGroup"))
}

fn geometry_property_prerequisites_are_ready(
    endpoint_id: &str,
    context: &GeometryPropertyReadinessContext<'_>,
    readiness_by_endpoint: &mut HashMap<String, bool>,
    visiting: &mut HashSet<String>,
) -> bool {
    if let Some(ready) = readiness_by_endpoint.get(endpoint_id) {
        return *ready;
    }
    if !visiting.insert(endpoint_id.to_owned()) {
        return false;
    }
    let ready =
        context
            .endpoints
            .get(endpoint_id)
            .is_some_and(|endpoint| match endpoint.kind.as_str() {
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
                "element" => element_geometry_prerequisite_ready(
                    context.state,
                    &endpoint.id,
                    context.completed_element_ids,
                ),
                "module-occurrence" => context.state.instance_base_geometry.contains_key(
                    endpoint
                        .id
                        .strip_prefix("module-occurrence:")
                        .unwrap_or(&endpoint.id),
                ),
                "binding" => {
                    let prerequisites_ready = context
                        .outgoing_edges
                        .get(endpoint_id)
                        .into_iter()
                        .flatten()
                        .all(|edge| {
                            geometry_property_prerequisites_are_ready(
                                &endpoint_key(&edge.to),
                                context,
                                readiness_by_endpoint,
                                visiting,
                            )
                        });
                    prerequisites_ready
                        && matches!(
                            context
                                .resolver
                                .resolve_binding(&endpoint.id, context.state),
                            super::scalars::ScalarEvaluation::Ok { .. }
                        )
                }
                _ => true,
            });
    visiting.remove(endpoint_id);
    readiness_by_endpoint.insert(endpoint_id.to_owned(), ready);
    ready
}

impl ConditionalDependencyGraph {
    fn from_edges(edges: Vec<ConditionalDependencyEdge>) -> Self {
        let mut guarded_edge_indices = Vec::new();
        let mut module_occurrence_edge_indices_by_from = HashMap::<String, Vec<usize>>::new();
        for (edge_index, edge) in edges.iter().enumerate() {
            if edge
                .activation
                .as_ref()
                .is_some_and(|activation| !activation.guards.is_empty())
            {
                guarded_edge_indices.push(edge_index);
            }
            if edge.to.kind == "module-occurrence" {
                module_occurrence_edge_indices_by_from
                    .entry(endpoint_key(&edge.from))
                    .or_default()
                    .push(edge_index);
            }
        }
        Self {
            edges,
            guarded_edge_indices,
            module_occurrence_edge_indices_by_from,
        }
    }

    /// Binding IDs that directly or transitively depend on a geometry
    /// property. Scalar forwarding declarations participate in the same
    /// dependency ordering as the geometry-derived binding they expose.
    pub(crate) fn bindings_with_active_geometry_property_dependency(
        &self,
        branch_selections: &HashMap<String, String>,
    ) -> HashSet<String> {
        let mut binding_dependents = HashMap::<String, Vec<String>>::new();
        let mut geometry_dependent_bindings = HashSet::new();
        for edge in &self.edges {
            if !edge_is_active(edge, branch_selections) || edge.from.kind != "binding" {
                continue;
            }
            match edge.to.kind.as_str() {
                "element" | "geometry-value" | "geometry-stage" | "module-occurrence" => {
                    geometry_dependent_bindings.insert(edge.from.id.clone());
                }
                "binding" => binding_dependents
                    .entry(edge.to.id.clone())
                    .or_default()
                    .push(edge.from.id.clone()),
                _ => {}
            }
        }
        let mut pending = geometry_dependent_bindings
            .iter()
            .cloned()
            .collect::<Vec<_>>();
        while let Some(dependency_id) = pending.pop() {
            for dependent_id in binding_dependents.get(&dependency_id).into_iter().flatten() {
                if geometry_dependent_bindings.insert(dependent_id.clone()) {
                    pending.push(dependent_id.clone());
                }
            }
        }
        geometry_dependent_bindings
    }

    /// Binding endpoints on an active forward scalar dependency edge. Both
    /// sides must enter the existing dependency schedule so the prerequisite
    /// can execute before its dependent even when ordinary source progression
    /// has not reached it yet.
    pub(crate) fn bindings_with_active_forward_binding_dependency(
        &self,
        branch_selections: &HashMap<String, String>,
        source_order_by_binding_id: &HashMap<String, usize>,
    ) -> HashSet<String> {
        let mut scheduled_binding_ids = HashSet::new();
        for edge in &self.edges {
            if !edge_is_active(edge, branch_selections)
                || edge.from.kind != "binding"
                || edge.to.kind != "binding"
            {
                continue;
            }
            let Some(dependent_source_order) = source_order_by_binding_id.get(&edge.from.id) else {
                continue;
            };
            let Some(prerequisite_source_order) = source_order_by_binding_id.get(&edge.to.id)
            else {
                continue;
            };
            if prerequisite_source_order > dependent_source_order {
                scheduled_binding_ids.insert(edge.from.id.clone());
                scheduled_binding_ids.insert(edge.to.id.clone());
            }
        }
        scheduled_binding_ids
    }

    /// Immutable binding prerequisites of forward geometry inputs. Follow only
    /// canonical active edges; control-owned declarations keep their event fence.
    pub(crate) fn early_geometry_input_bindings(
        &self,
        branch_selections: &HashMap<String, String>,
        binding_orders: &HashMap<String, usize>,
        element_orders: &HashMap<String, usize>,
        linear_bindings: &HashSet<String>,
    ) -> HashSet<String> {
        let mut prerequisites = HashMap::<&str, Vec<&str>>::new();
        for edge in &self.edges {
            if edge.from.kind == "binding"
                && edge.to.kind == "binding"
                && edge_is_active(edge, branch_selections)
            {
                prerequisites
                    .entry(&edge.from.id)
                    .or_default()
                    .push(&edge.to.id);
            }
        }
        let mut early = HashSet::new();
        for edge in &self.edges {
            if edge.from.kind != "element"
                || edge.to.kind != "binding"
                || !edge_is_active(edge, branch_selections)
            {
                continue;
            }
            let Some(consumer_order) = element_orders.get(&edge.from.id) else {
                continue;
            };
            let mut pending = vec![edge.to.id.as_str()];
            let mut closure = HashSet::new();
            let mut has_forward = false;
            while let Some(binding_id) = pending.pop() {
                if !linear_bindings.contains(binding_id) || !closure.insert(binding_id) {
                    continue;
                }
                has_forward |= binding_orders
                    .get(binding_id)
                    .is_some_and(|order| order > consumer_order);
                pending.extend(prerequisites.get(binding_id).into_iter().flatten().copied());
            }
            if has_forward {
                early.extend(closure.into_iter().map(str::to_owned));
            }
        }
        early
    }

    /// Scalar bindings referenced by if/match selectors in immutable geometry
    /// values. Source ranges associate the selector expressions with existing
    /// canonical graph edges; binding identities are never resolved here.
    pub(crate) fn bindings_with_active_geometry_value_selector_dependency(
        &self,
        branch_selections: &HashMap<String, String>,
        selector_spans_by_endpoint_id: &HashMap<String, Vec<(usize, usize)>>,
    ) -> HashSet<String> {
        self.geometry_value_selector_binding_ids_by_endpoint_id(
            branch_selections,
            selector_spans_by_endpoint_id,
        )
        .into_values()
        .flatten()
        .collect()
    }

    /// Direct canonical binding dependencies for each geometry-value selector.
    /// The source spans distinguish if/match selector edges from other scalar
    /// inputs to the same geometry value; binding IDs remain graph-owned.
    pub(crate) fn geometry_value_selector_binding_ids_by_endpoint_id(
        &self,
        branch_selections: &HashMap<String, String>,
        selector_spans_by_endpoint_id: &HashMap<String, Vec<(usize, usize)>>,
    ) -> HashMap<String, HashSet<String>> {
        let mut bindings_by_endpoint_id = HashMap::<String, HashSet<String>>::new();
        for edge in &self.edges {
            if edge.from.kind != "geometry-value"
                || edge.to.kind != "binding"
                || !edge_is_active(edge, branch_selections)
            {
                continue;
            }
            let Some((edge_start, edge_end)) = edge.span else {
                continue;
            };
            let endpoint_id = endpoint_key(&edge.from);
            if selector_spans_by_endpoint_id
                .get(&endpoint_id)
                .is_some_and(|selector_spans| {
                    selector_spans
                        .iter()
                        .any(|(start, end)| edge_start >= *start && edge_end <= *end)
                })
            {
                bindings_by_endpoint_id
                    .entry(endpoint_id)
                    .or_default()
                    .insert(edge.to.id.clone());
            }
        }
        bindings_by_endpoint_id
    }

    pub(crate) fn active_scheduled_binding_prerequisites(
        &self,
        branch_selections: &HashMap<String, String>,
        scheduled_binding_ids: &HashSet<String>,
    ) -> HashMap<String, HashSet<String>> {
        let mut prerequisites_by_binding_id = HashMap::<String, HashSet<String>>::new();
        for edge in &self.edges {
            if edge.from.kind != "binding"
                || edge.to.kind != "binding"
                || !edge_is_active(edge, branch_selections)
                || !scheduled_binding_ids.contains(&edge.from.id)
                || !scheduled_binding_ids.contains(&edge.to.id)
            {
                continue;
            }
            prerequisites_by_binding_id
                .entry(edge.from.id.clone())
                .or_default()
                .insert(edge.to.id.clone());
        }
        prerequisites_by_binding_id
    }

    pub(crate) fn ready_dependency_scheduled_binding_ids(
        &self,
        readiness: DependencyScheduledBindingReadiness<'_>,
    ) -> HashSet<String> {
        if readiness.candidate_binding_ids.is_empty() {
            return HashSet::new();
        }
        let mut outgoing_edges = HashMap::<String, Vec<&ConditionalDependencyEdge>>::new();
        let mut endpoints = HashMap::<String, &ConditionalDependencyEndpoint>::new();
        for edge in &self.edges {
            #[cfg(test)]
            READINESS_EDGE_VISITS.with(|count| count.set(count.get() + 1));
            let from_id = endpoint_key(&edge.from);
            let to_id = endpoint_key(&edge.to);
            endpoints.entry(from_id.clone()).or_insert(&edge.from);
            endpoints.entry(to_id.clone()).or_insert(&edge.to);
            if edge_is_active(edge, readiness.branch_selections) {
                outgoing_edges.entry(from_id).or_default().push(edge);
            }
        }

        let context = GeometryPropertyReadinessContext {
            outgoing_edges,
            endpoints,
            resolver: readiness.resolver,
            state: readiness.state,
            completed_element_ids: readiness.completed_element_ids,
            evaluated_geometry_values: readiness.evaluated_geometry_values,
            geometry_value_index_by_endpoint_id: readiness.geometry_value_index_by_endpoint_id,
            source_order_by_binding_id: Some(readiness.source_order_by_binding_id),
        };
        let mut ready = Self::ready_geometry_dependent_binding_ids_from_context(
            readiness.candidate_binding_ids,
            &context,
        );
        let candidate_ids = readiness
            .candidate_binding_ids
            .iter()
            .cloned()
            .collect::<HashSet<_>>();
        let mut readiness_by_endpoint = HashMap::new();
        let mut visiting = HashSet::new();
        let mut progressed = true;
        while progressed {
            progressed = false;
            for binding_id in readiness.candidate_binding_ids {
                if ready.contains(binding_id) {
                    continue;
                }
                let endpoint_id = format!("binding:{binding_id}");
                let prerequisites = context.outgoing_edges.get(&endpoint_id);
                let prerequisites_ready = prerequisites.map_or(true, |edges| {
                    edges.iter().all(|edge| {
                        if edge.to.kind == "binding"
                            && candidate_ids.contains(&edge.to.id)
                            && ready.contains(&edge.to.id)
                        {
                            return true;
                        }
                        if edge.to.kind == "binding"
                            && !candidate_ids.contains(&edge.to.id)
                            && context.source_order_by_binding_id.is_some_and(
                                |source_order_by_binding_id| {
                                    source_order_by_binding_id
                                        .get(&edge.to.id)
                                        .zip(source_order_by_binding_id.get(binding_id))
                                        .is_some_and(|(prerequisite, dependent)| {
                                            prerequisite < dependent
                                        })
                                },
                            )
                        {
                            return true;
                        }
                        geometry_property_prerequisites_are_ready(
                            &endpoint_key(&edge.to),
                            &context,
                            &mut readiness_by_endpoint,
                            &mut visiting,
                        )
                    })
                });
                if !prerequisites_ready {
                    continue;
                }
                ready.insert(binding_id.clone());
                progressed = true;
            }
        }
        ready
    }

    pub(crate) fn has_activation(&self) -> bool {
        !self.guarded_edge_indices.is_empty()
    }

    pub(crate) fn controller_candidates(
        &self,
        branch_selections: &HashMap<String, String>,
    ) -> Vec<ConditionalDependencyControllerCandidate<'_>> {
        let mut candidates = HashMap::<String, ConditionalDependencyControllerCandidate<'_>>::new();
        for edge_index in &self.guarded_edge_indices {
            #[cfg(test)]
            CONTROLLER_CANDIDATE_EDGE_VISITS.with(|count| count.set(count.get() + 1));
            let edge = &self.edges[*edge_index];
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
                // Module atomicity forwards this activation to consumers.
                // Their prerequisites must not become the producer's own
                // controller prerequisites (which would wait for its output).
                if candidate.source_endpoint_id != source_endpoint_id {
                    continue;
                }
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

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn endpoint_is_ready(
        &self,
        endpoint_id: &str,
        branch_selections: &HashMap<String, String>,
        resolver: &dyn ScalarDocumentBindingResolver,
        state: &EvaluationState,
        evaluated_geometry_values: &[bool],
        geometry_value_index_by_endpoint_id: &HashMap<String, usize>,
        completed_element_ids: Option<&HashSet<ElementId>>,
    ) -> bool {
        self.endpoint_is_ready_inner(
            endpoint_id,
            &DependencyReadinessContext {
                branch_selections,
                resolver,
                state,
                completed_element_ids,
                evaluated_geometry_values,
                geometry_value_index_by_endpoint_id,
            },
            &mut HashSet::new(),
        )
    }

    pub(crate) fn geometry_prerequisites_are_ready(
        &self,
        endpoint_id: &str,
        branch_selections: &HashMap<String, String>,
        state: &EvaluationState,
        completed_element_ids: Option<&HashSet<ElementId>>,
    ) -> bool {
        let context = GeometryDependencyReadinessContext {
            branch_selections,
            state,
            completed_element_ids,
        };
        self.edges
            .iter()
            .filter(|edge| {
                endpoint_key(&edge.from) == endpoint_id && edge_is_active(edge, branch_selections)
            })
            .all(|edge| {
                self.geometry_prerequisite_is_ready_inner(
                    &endpoint_key(&edge.to),
                    &context,
                    &mut HashSet::new(),
                )
            })
    }

    /// A rank-sorted release pass can still skip a predecessor at its source
    /// fence. Read the current pass's completion state before releasing aliases.
    pub(crate) fn geometry_value_prerequisites_are_ready(
        &self,
        endpoint_id: &str,
        branch_selections: &HashMap<String, String>,
        evaluated: &[bool],
        index_by_endpoint_id: &HashMap<String, usize>,
    ) -> bool {
        self.edges
            .iter()
            .filter(|edge| {
                endpoint_key(&edge.from) == endpoint_id
                    && edge.to.kind == "geometry-value"
                    && edge_is_active(edge, branch_selections)
            })
            .all(|edge| {
                index_by_endpoint_id
                    .get(&endpoint_key(&edge.to))
                    .and_then(|index| evaluated.get(*index))
                    .copied()
                    .unwrap_or(false)
            })
    }

    /// Whether an active, evaluated drawable depends on this geometry value.
    /// Terminal release uses this to distinguish unavailable values that can
    /// still produce user-facing diagnostics from Module occurrences excluded
    /// by the current evaluation limit.
    pub(crate) fn geometry_value_has_evaluated_element_consumer(
        &self,
        endpoint_id: &str,
        branch_selections: &HashMap<String, String>,
        evaluated_element_ids: &HashSet<ElementId>,
    ) -> bool {
        let mut dependents_by_prerequisite =
            HashMap::<String, Vec<&ConditionalDependencyEndpoint>>::new();
        for edge in &self.edges {
            if edge_is_active(edge, branch_selections) {
                dependents_by_prerequisite
                    .entry(endpoint_key(&edge.to))
                    .or_default()
                    .push(&edge.from);
            }
        }

        let mut pending = vec![endpoint_id.to_owned()];
        let mut visited = HashSet::new();
        while let Some(prerequisite_id) = pending.pop() {
            if !visited.insert(prerequisite_id.clone()) {
                continue;
            }
            for dependent in dependents_by_prerequisite
                .get(&prerequisite_id)
                .into_iter()
                .flatten()
            {
                if dependent.kind == "element" && evaluated_element_ids.contains(&dependent.id) {
                    return true;
                }
                pending.push(endpoint_key(dependent));
            }
        }
        false
    }

    #[cfg(test)]
    pub(crate) fn ready_geometry_dependent_binding_ids(
        &self,
        candidate_binding_ids: &[String],
        branch_selections: &HashMap<String, String>,
        resolver: &dyn ScalarDocumentBindingResolver,
        state: &EvaluationState,
        evaluated_geometry_values: &[bool],
        geometry_value_index_by_endpoint_id: &HashMap<String, usize>,
    ) -> HashSet<String> {
        if candidate_binding_ids.is_empty() {
            return HashSet::new();
        }
        let mut outgoing_edges = HashMap::<String, Vec<&ConditionalDependencyEdge>>::new();
        let mut endpoints = HashMap::<String, &ConditionalDependencyEndpoint>::new();
        for edge in &self.edges {
            #[cfg(test)]
            READINESS_EDGE_VISITS.with(|count| count.set(count.get() + 1));
            let from_id = endpoint_key(&edge.from);
            let to_id = endpoint_key(&edge.to);
            endpoints.entry(from_id.clone()).or_insert(&edge.from);
            endpoints.entry(to_id.clone()).or_insert(&edge.to);
            if edge_is_active(edge, branch_selections) {
                outgoing_edges.entry(from_id).or_default().push(edge);
            }
        }

        let context = GeometryPropertyReadinessContext {
            outgoing_edges,
            endpoints,
            resolver,
            state,
            evaluated_geometry_values,
            geometry_value_index_by_endpoint_id,
            source_order_by_binding_id: None,
            completed_element_ids: None,
        };
        Self::ready_geometry_dependent_binding_ids_from_context(candidate_binding_ids, &context)
    }

    fn ready_geometry_dependent_binding_ids_from_context(
        candidate_binding_ids: &[String],
        context: &GeometryPropertyReadinessContext<'_>,
    ) -> HashSet<String> {
        let mut ready = HashSet::new();
        let mut readiness_by_endpoint = HashMap::new();
        let mut visiting = HashSet::new();
        for binding_id in candidate_binding_ids {
            let endpoint_id = format!("binding:{binding_id}");
            let Some(prerequisites) = context.outgoing_edges.get(&endpoint_id) else {
                continue;
            };
            if !prerequisites.is_empty()
                && prerequisites.iter().all(|edge| {
                    geometry_property_prerequisites_are_ready(
                        &endpoint_key(&edge.to),
                        context,
                        &mut readiness_by_endpoint,
                        &mut visiting,
                    )
                })
            {
                ready.insert(binding_id.clone());
            }
        }
        ready
    }

    pub(crate) fn geometry_prerequisites_have_failed(
        &self,
        endpoint_id: &str,
        branch_selections: &HashMap<String, String>,
        state: &EvaluationState,
    ) -> bool {
        if state.errors.is_empty() {
            return false;
        }
        let current_element_id = endpoint_id.strip_prefix("element:").unwrap_or(endpoint_id);
        self.edges
            .iter()
            .filter(|edge| {
                #[cfg(test)]
                READINESS_EDGE_VISITS.with(|count| count.set(count.get() + 1));
                endpoint_key(&edge.from) == endpoint_id && edge_is_active(edge, branch_selections)
            })
            .any(|edge| {
                if !matches!(edge.to.kind.as_str(), "element" | "geometry-stage") {
                    return false;
                }
                let dependency_id = edge.to.owner_id.as_deref().unwrap_or(&edge.to.id);
                dependency_id != current_element_id
                    && state
                        .errors
                        .iter()
                        .any(|error| error.element_id == dependency_id)
            })
    }

    pub(crate) fn unavailable_module_instance_prerequisite(
        &self,
        endpoint_id: &str,
        branch_selections: &HashMap<String, String>,
        failed_instance_ids: &HashSet<ElementId>,
        included_instance_ids: &HashSet<ElementId>,
    ) -> Option<(ElementId, bool)> {
        let mut excluded_instance_id = None;
        for edge_index in self
            .module_occurrence_edge_indices_by_from
            .get(endpoint_id)
            .into_iter()
            .flatten()
        {
            let edge = &self.edges[*edge_index];
            #[cfg(test)]
            MODULE_PREREQUISITE_EDGE_VISITS.with(|count| count.set(count.get() + 1));
            if !edge_is_active(edge, branch_selections) {
                continue;
            }
            let instance_id = edge
                .to
                .id
                .strip_prefix("module-occurrence:")
                .unwrap_or(&edge.to.id);
            if failed_instance_ids.contains(instance_id) {
                return Some((instance_id.to_owned(), true));
            }
            if !included_instance_ids.contains(instance_id) {
                excluded_instance_id = Some(instance_id.to_owned());
            }
        }
        excluded_instance_id.map(|instance_id| (instance_id, false))
    }

    pub(crate) fn binding_ids_depending_on_module_bindings(
        &self,
        local_binding_prefixes: &[String],
        branch_selections: &HashMap<String, String>,
    ) -> HashSet<String> {
        let mut unavailable_bindings = HashSet::new();
        let mut pending = self
            .edges
            .iter()
            .flat_map(|edge| [&edge.from, &edge.to])
            .filter(|endpoint| {
                endpoint.kind == "binding"
                    && local_binding_prefixes
                        .iter()
                        .any(|prefix| endpoint.id.starts_with(prefix))
            })
            .map(endpoint_key)
            .collect::<Vec<_>>();
        let mut visited = HashSet::new();
        while let Some(endpoint_id) = pending.pop() {
            if !visited.insert(endpoint_id.clone()) {
                continue;
            }
            for edge in self.edges.iter().filter(|edge| {
                endpoint_key(&edge.to) == endpoint_id && edge_is_active(edge, branch_selections)
            }) {
                if edge.from.kind != "binding" {
                    continue;
                }
                unavailable_bindings.insert(edge.from.id.clone());
                pending.push(endpoint_key(&edge.from));
            }
        }
        unavailable_bindings
    }

    fn geometry_prerequisite_is_ready_inner(
        &self,
        endpoint_id: &str,
        context: &GeometryDependencyReadinessContext<'_>,
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
            // Geometry-value prerequisites are released in the same canonical
            // rank-sorted pass; only drawable prerequisites can be pending on
            // the element loop when this readiness snapshot is taken.
            "geometry-value" => true,
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
            "element" => element_geometry_prerequisite_ready(
                context.state,
                &endpoint.id,
                context.completed_element_ids,
            ),
            "module-occurrence" => context.state.instance_base_geometry.contains_key(
                endpoint
                    .id
                    .strip_prefix("module-occurrence:")
                    .unwrap_or(&endpoint.id),
            ),
            "binding" => self
                .edges
                .iter()
                .filter(|edge| {
                    endpoint_key(&edge.from) == endpoint_id
                        && edge_is_active(edge, context.branch_selections)
                })
                .all(|edge| {
                    self.geometry_prerequisite_is_ready_inner(
                        &endpoint_key(&edge.to),
                        context,
                        visiting,
                    )
                }),
            _ => true,
        };
        visiting.remove(endpoint_id);
        ready
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
            "element" => element_geometry_prerequisite_ready(
                context.state,
                &endpoint.id,
                context.completed_element_ids,
            ),
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
        // Enter/exit frames preserve the recursive edge encounter order and
        // active cycle path without consuming one native stack frame per node.
        let mut pending = vec![(node_id.to_owned(), false)];
        while let Some((node_id, exiting)) = pending.pop() {
            if exiting {
                self.stack.pop();
                self.visit_state.insert(node_id.clone(), 2);
                self.ordered_endpoints.push(node_id);
                continue;
            }
            match self.visit_state.get(&node_id).copied() {
                Some(2) => continue,
                Some(1) => {
                    let start = self.stack.iter().position(|id| id == &node_id).unwrap_or(0);
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
                    continue;
                }
                _ => {}
            }
            self.visit_state.insert(node_id.clone(), 1);
            self.stack.push(node_id.clone());
            let dependencies = self
                .dependencies_by_node
                .get(&node_id)
                .cloned()
                .unwrap_or_default();
            pending.push((node_id, true));
            for dependency_id in dependencies.into_iter().rev() {
                pending.push((dependency_id, false));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::evaluation::scalars::{ScalarEvaluation, ScalarType};

    fn no_module_occurrence_graph_payload(edge_count: usize, query_count: usize) -> Value {
        assert!(query_count > 0);
        let edges = (0..edge_count)
            .map(|index| {
                let element_index = index % query_count;
                serde_json::json!({
                    "from": {
                        "kind": "element",
                        "id": format!("element-{element_index}"),
                        "name": format!("Element{element_index}")
                    },
                    "to": {
                        "kind": "binding",
                        "id": format!("binding-{index}"),
                        "name": format!("Binding{index}")
                    },
                    "requiredness": "required"
                })
            })
            .collect::<Vec<_>>();
        serde_json::json!({ "edges": edges })
    }

    #[test]
    fn module_prerequisite_lookup_skips_unrelated_edges_without_module_occurrences() {
        let edge_count = 64;
        let query_count = 8;
        let payload = no_module_occurrence_graph_payload(edge_count, query_count);
        let payload_edges = payload["edges"].as_array().unwrap();
        assert!(!payload_edges
            .iter()
            .any(|edge| { edge["to"]["kind"].as_str() == Some("module-occurrence") }));
        // Independent graph oracle: no compiler-supplied module-occurrence
        // prerequisite means every endpoint query has the semantic answer None.
        let expected = None;
        let graph = decode_conditional_dependency_graph(Some(&payload))
            .unwrap()
            .unwrap();
        let selections = HashMap::new();
        let failed = HashSet::new();
        let included = HashSet::new();
        MODULE_PREREQUISITE_EDGE_VISITS.with(|count| count.set(0));
        for index in 0..query_count {
            assert_eq!(
                graph.unavailable_module_instance_prerequisite(
                    &format!("element:element-{index}"),
                    &selections,
                    &failed,
                    &included,
                ),
                expected,
            );
        }
        let edge_visits = MODULE_PREREQUISITE_EDGE_VISITS.with(|count| count.get());
        let independently_expected_full_scan_visits = query_count * edge_count;
        assert_eq!(
            edge_visits,
            0,
            "module-free lookup must avoid unrelated edge visits and endpoint-key work; base full-scan discriminator expects {independently_expected_full_scan_visits} visits, observed {edge_visits}",
        );
    }

    #[test]
    fn module_prerequisite_lookup_empty_graph_control() {
        let graph = decode_conditional_dependency_graph(Some(&serde_json::json!({
            "edges": []
        })))
        .unwrap()
        .unwrap();
        let selections = HashMap::new();
        let failed = HashSet::new();
        let included = HashSet::new();
        MODULE_PREREQUISITE_EDGE_VISITS.with(|count| count.set(0));
        for endpoint_id in ["element:first", "element:second", "element:third"] {
            assert_eq!(
                graph.unavailable_module_instance_prerequisite(
                    endpoint_id,
                    &selections,
                    &failed,
                    &included,
                ),
                None,
            );
        }
        assert_eq!(MODULE_PREREQUISITE_EDGE_VISITS.with(|count| count.get()), 0,);
    }

    fn module_prerequisite_semantics_payload() -> Value {
        serde_json::json!({
            "edges": [
                {
                    "from": { "kind": "element", "id": "target", "name": "Target" },
                    "to": { "kind": "module-occurrence", "id": "module-occurrence:excluded-first", "name": "ExcludedFirst" },
                    "requiredness": "required"
                },
                {
                    "from": { "kind": "element", "id": "other", "name": "Other" },
                    "to": { "kind": "module-occurrence", "id": "module-occurrence:unrelated", "name": "Unrelated" },
                    "requiredness": "required"
                },
                {
                    "from": { "kind": "element", "id": "target", "name": "Target" },
                    "to": { "kind": "binding", "id": "ordinary-binding", "name": "OrdinaryBinding" },
                    "requiredness": "required"
                },
                {
                    "from": { "kind": "element", "id": "target", "name": "Target" },
                    "to": { "kind": "module-occurrence", "id": "module-occurrence:candidate-first", "name": "CandidateFirst" },
                    "requiredness": "required"
                },
                {
                    "from": { "kind": "element", "id": "target", "name": "Target" },
                    "to": { "kind": "module-occurrence", "id": "module-occurrence:excluded-last", "name": "ExcludedLast" },
                    "requiredness": "required"
                },
                {
                    "from": { "kind": "element", "id": "target", "name": "Target" },
                    "to": { "kind": "module-occurrence", "id": "module-occurrence:candidate-last", "name": "CandidateLast" },
                    "requiredness": "required"
                },
                {
                    "from": { "kind": "element", "id": "target", "name": "Target" },
                    "to": { "kind": "module-occurrence", "id": "module-occurrence:then-only", "name": "ThenOnly" },
                    "requiredness": "conditional",
                    "activation": { "guards": [{ "controllerId": "controller", "branch": "then" }] }
                },
                {
                    "from": { "kind": "element", "id": "target", "name": "Target" },
                    "to": { "kind": "module-occurrence", "id": "module-occurrence:else-only", "name": "ElseOnly" },
                    "requiredness": "conditional",
                    "activation": { "guards": [{ "controllerId": "controller", "branch": "else" }] }
                },
                {
                    "from": { "kind": "element", "id": "target", "name": "Target" },
                    "to": { "kind": "module-occurrence", "id": "module-occurrence:static-selected", "name": "StaticSelected" },
                    "requiredness": "conditional",
                    "activation": { "guards": [{ "controllerId": "static", "branch": "then", "staticSelection": "selected" }] }
                },
                {
                    "from": { "kind": "element", "id": "target", "name": "Target" },
                    "to": { "kind": "module-occurrence", "id": "module-occurrence:static-unselected", "name": "StaticUnselected" },
                    "requiredness": "conditional",
                    "activation": { "guards": [{ "controllerId": "static", "branch": "else", "staticSelection": "unselected" }] }
                }
            ]
        })
    }

    #[test]
    fn module_prerequisite_resolution_preserves_activation_and_priority() {
        let payload = module_prerequisite_semantics_payload();
        let graph = decode_conditional_dependency_graph(Some(&payload))
            .unwrap()
            .unwrap();
        let then = HashMap::from([("controller".to_owned(), "then".to_owned())]);
        let else_branch = HashMap::from([("controller".to_owned(), "else".to_owned())]);
        let all_active_then = HashSet::from([
            "excluded-first".to_owned(),
            "candidate-first".to_owned(),
            "excluded-last".to_owned(),
            "candidate-last".to_owned(),
            "then-only".to_owned(),
            "static-selected".to_owned(),
        ]);
        let failed = HashSet::new();

        // Reuse one decoded graph with changing branch and instance state.
        assert_eq!(
            graph.unavailable_module_instance_prerequisite(
                "element:target",
                &then,
                &failed,
                &all_active_then,
            ),
            None,
            "included and available active prerequisites are ready; inactive guards are ignored",
        );

        let excluding_two = HashSet::from([
            "candidate-first".to_owned(),
            "candidate-last".to_owned(),
            "then-only".to_owned(),
            "static-selected".to_owned(),
        ]);
        assert_eq!(
            graph.unavailable_module_instance_prerequisite(
                "element:target",
                &then,
                &failed,
                &excluding_two,
            ),
            Some(("excluded-last".to_owned(), false)),
            "when none failed, preserve the last active excluded prerequisite in graph order",
        );

        let two_failures =
            HashSet::from(["candidate-first".to_owned(), "candidate-last".to_owned()]);
        assert_eq!(
            graph.unavailable_module_instance_prerequisite(
                "element:target",
                &then,
                &two_failures,
                &all_active_then,
            ),
            Some(("candidate-first".to_owned(), true)),
            "return the first active failed prerequisite, even when a later one also failed",
        );

        let late_failure = HashSet::from(["candidate-last".to_owned()]);
        assert_eq!(
            graph.unavailable_module_instance_prerequisite(
                "element:target",
                &then,
                &late_failure,
                &excluding_two,
            ),
            Some(("candidate-last".to_owned(), true)),
            "a failed prerequisite takes priority over earlier excluded prerequisites",
        );

        let all_active_else = HashSet::from([
            "excluded-first".to_owned(),
            "candidate-first".to_owned(),
            "excluded-last".to_owned(),
            "candidate-last".to_owned(),
            "else-only".to_owned(),
            "static-selected".to_owned(),
        ]);
        assert_eq!(
            graph.unavailable_module_instance_prerequisite(
                "element:target",
                &else_branch,
                &failed,
                &all_active_else,
            ),
            None,
            "the else selection activates else-only and deactivates then-only",
        );

        assert_eq!(
            graph.unavailable_module_instance_prerequisite(
                "element:target",
                &then,
                &HashSet::from(["unrelated".to_owned()]),
                &all_active_then,
            ),
            None,
            "other source endpoints and non-module target kinds do not affect this query",
        );
    }

    #[test]
    fn module_prerequisite_graph_decode_rejects_invalid_payloads() {
        assert!(
            decode_conditional_dependency_graph(Some(&serde_json::json!({
                "edges": [{ "from": {}, "to": {} }]
            })))
            .is_err()
        );
        assert!(decode_conditional_dependency_graph(Some(&serde_json::json!({
            "edges": [{
                "from": { "kind": "element", "id": "target", "name": "Target" },
                "to": { "kind": "module-occurrence", "id": "module-occurrence:one", "name": "One" },
                "requiredness": "conditional",
                "activation": { "guards": [{
                    "controllerId": "controller", "branch": "then",
                    "controllerExpression": { "kind": "invalid" }
                }] }
            }]
        })))
        .is_err());
    }

    #[test]
    fn empty_error_readiness_does_not_scan_unrelated_edges() {
        let payload: Value = serde_json::from_str(include_str!(
            "../../../test/fixtures/issue-1474/continuation-2/R2-graph.json"
        ))
        .unwrap();
        let graph = decode_conditional_dependency_graph(Some(&payload))
            .unwrap()
            .unwrap();
        let mut state = empty_evaluation_state();
        let selections = HashMap::new();
        READINESS_EDGE_VISITS.with(|count| count.set(0));
        for edge in graph
            .edges
            .iter()
            .filter(|edge| edge.from.kind == "element" && edge.from.name.starts_with("Fan"))
        {
            assert!(!graph.geometry_prerequisites_have_failed(
                &endpoint_key(&edge.from),
                &selections,
                &state
            ));
        }
        let visits = READINESS_EDGE_VISITS.with(|count| count.get());
        eprintln!("#1474 empty-error readiness edge visits={visits}");
        assert_eq!(
            visits, 0,
            "no prerequisite can have failed when the error set is empty"
        );
        let edge = graph
            .edges
            .iter()
            .find(|edge| edge.from.kind == "element" && edge.from.name == "Fan0")
            .unwrap();
        let dependency_id = edge.to.owner_id.as_deref().unwrap_or(&edge.to.id);
        state.errors.push(DependencyError {
            code: None,
            element_id: "unrelated".to_owned(),
            element_name: "unrelated".to_owned(),
            missing_dependency_id: "missing".to_owned(),
            missing_dependency_name: None,
            message: "control".to_owned(),
        });
        assert!(!graph.geometry_prerequisites_have_failed(
            &endpoint_key(&edge.from),
            &selections,
            &state
        ));
        state.errors[0].element_id = dependency_id.to_owned();
        assert!(graph.geometry_prerequisites_have_failed(
            &endpoint_key(&edge.from),
            &selections,
            &state
        ));
    }

    #[test]
    fn issue_1476_diamond_projection_preserves_order_on_default_stack() {
        for (name, fixture) in [
            (
                "D1",
                include_str!("../../../test/fixtures/issue-1476/stage6/D1-r1-projection.json"),
            ),
            (
                "D3",
                include_str!("../../../test/fixtures/issue-1476/stage6/D3-r1-projection.json"),
            ),
        ] {
            let payload: Value = serde_json::from_str(fixture).unwrap();
            let graph = decode_conditional_dependency_graph(Some(&payload["graph"]))
                .unwrap()
                .unwrap();
            let element_ids: Vec<String> =
                serde_json::from_value(payload["elementIds"].clone()).unwrap();
            let expected: Vec<String> =
                serde_json::from_value(payload["expectedDependencyOrder"].clone()).unwrap();
            eprintln!("#1476 projecting {name} with {} edges", graph.edges.len());
            let projected = graph.project(&element_ids, element_ids.len(), &HashMap::new());
            assert!(projected.cycles.is_empty());
            assert_eq!(
                projected.dependency_order, expected,
                "frozen edge encounter order"
            );
            let ranks = projected
                .dependency_order
                .iter()
                .enumerate()
                .map(|(rank, id)| (id.as_str(), rank))
                .collect::<HashMap<_, _>>();
            for edge in &graph.edges {
                assert!(
                    ranks[endpoint_key(&edge.to).as_str()]
                        < ranks[endpoint_key(&edge.from).as_str()],
                    "every prerequisite precedes its dependent"
                );
            }
            assert_eq!(projected.evaluation_order.len(), element_ids.len());
            assert_eq!(
                projected.evaluation_order.iter().collect::<HashSet<_>>(),
                element_ids.iter().collect::<HashSet<_>>()
            );
            eprintln!("#1476 {name} projection order and dependency controls PASS");
        }
    }

    #[test]
    fn issue_1476_projection_preserves_conditional_cycle_diagnostics() {
        let graph = ConditionalDependencyGraph::from_edges(vec![
            required_edge(endpoint("element", "a", "A"), endpoint("element", "b", "B")),
            ConditionalDependencyEdge {
                from: endpoint("element", "b", "B"),
                to: endpoint("element", "a", "A"),
                span: None,
                requiredness: Some("conditional".to_owned()),
                activation: Some(ConditionalDependencyActivation {
                    guards: vec![ConditionalDependencyGuard {
                        controller_id: "controller".to_owned(),
                        branch: "then".to_owned(),
                        controller_kind: None,
                        static_selection: None,
                        controller_expression: None,
                    }],
                }),
            },
        ]);
        let ids = vec!["a".to_owned(), "b".to_owned(), "unconnected".to_owned()];
        let inactive = graph.project(&ids, ids.len(), &HashMap::new());
        assert!(inactive.cycles.is_empty());
        assert_eq!(inactive.evaluation_order, ["b", "a", "unconnected"]);
        let active = graph.project(
            &ids,
            ids.len(),
            &HashMap::from([("controller".to_owned(), "then".to_owned())]),
        );
        assert_eq!(active.evaluation_order, inactive.evaluation_order);
        assert_eq!(active.cycles.len(), 1);
        let cycle = &active.cycles[0];
        assert_eq!(cycle.code.as_deref(), Some("dependency-cycle"));
        assert_eq!(cycle.element_id, "a");
        assert_eq!(cycle.missing_dependency_id, "element:b");
        assert_eq!(cycle.message, "依存関係 cycle: A -> B -> A");
    }

    #[test]
    fn empty_candidate_readiness_does_not_rebuild_unrelated_topology() {
        let payload: Value = serde_json::from_str(include_str!(
            "../../../test/fixtures/issue-1474/continuation-2/R2-graph.json"
        ))
        .unwrap();
        let graph = decode_conditional_dependency_graph(Some(&payload))
            .unwrap()
            .unwrap();
        let state = empty_evaluation_state();
        let resolver = AvailabilityResolver {
            available_binding_ids: HashSet::new(),
        };
        let source_orders = HashMap::new();
        let selections = HashMap::new();
        let geometry_indices = HashMap::new();
        READINESS_EDGE_VISITS.with(|count| count.set(0));
        let empty = decode_conditional_dependency_graph(Some(&serde_json::json!({"edges":[]})))
            .unwrap()
            .unwrap();
        assert!(empty
            .ready_dependency_scheduled_binding_ids(DependencyScheduledBindingReadiness {
                candidate_binding_ids: &[],
                source_order_by_binding_id: &source_orders,
                branch_selections: &selections,
                resolver: &resolver,
                state: &state,
                completed_element_ids: None,
                evaluated_geometry_values: &[],
                geometry_value_index_by_endpoint_id: &geometry_indices,
            })
            .is_empty());
        assert_eq!(
            READINESS_EDGE_VISITS.with(|count| count.get()),
            0,
            "adjacent empty graph control"
        );
        for _ in 0..8 {
            assert!(graph
                .ready_dependency_scheduled_binding_ids(DependencyScheduledBindingReadiness {
                    candidate_binding_ids: &[],
                    source_order_by_binding_id: &source_orders,
                    branch_selections: &selections,
                    resolver: &resolver,
                    state: &state,
                    completed_element_ids: None,
                    evaluated_geometry_values: &[],
                    geometry_value_index_by_endpoint_id: &geometry_indices,
                })
                .is_empty());
            assert!(graph
                .ready_geometry_dependent_binding_ids(
                    &[],
                    &selections,
                    &resolver,
                    &state,
                    &[],
                    &geometry_indices
                )
                .is_empty());
        }
        let visits = READINESS_EDGE_VISITS.with(|count| count.get());
        eprintln!("#1474 empty-candidate readiness edge visits={visits} for 16 queries / 29 edges");
        assert_eq!(
            visits, 0,
            "an empty query must not scan or allocate a copy of the topology"
        );
    }

    struct AvailabilityResolver {
        available_binding_ids: HashSet<String>,
    }

    impl ScalarDocumentBindingResolver for AvailabilityResolver {
        fn resolve_binding(&self, binding_id: &str, _state: &EvaluationState) -> ScalarEvaluation {
            if self.available_binding_ids.contains(binding_id) {
                ScalarEvaluation::Ok {
                    r#type: ScalarType::Number,
                    value: ScalarValue::Number(1.0),
                }
            } else {
                ScalarEvaluation::Error {
                    r#type: ScalarType::Number,
                    issue_code: "evaluation-binding-unavailable".to_owned(),
                    binding_id: Some(binding_id.to_owned()),
                    context: None,
                }
            }
        }
    }

    fn endpoint(kind: &str, id: &str, name: &str) -> ConditionalDependencyEndpoint {
        ConditionalDependencyEndpoint {
            kind: kind.to_owned(),
            id: id.to_owned(),
            name: name.to_owned(),
            owner_id: None,
            stage_path: Vec::new(),
        }
    }

    fn required_edge(
        from: ConditionalDependencyEndpoint,
        to: ConditionalDependencyEndpoint,
    ) -> ConditionalDependencyEdge {
        ConditionalDependencyEdge {
            from,
            to,
            span: None,
            requiredness: Some("required".to_owned()),
            activation: None,
        }
    }

    fn required_edge_with_span(
        from: ConditionalDependencyEndpoint,
        to: ConditionalDependencyEndpoint,
        span: (usize, usize),
    ) -> ConditionalDependencyEdge {
        ConditionalDependencyEdge {
            from,
            to,
            span: Some(span),
            requiredness: Some("required".to_owned()),
            activation: None,
        }
    }

    fn empty_evaluation_state() -> EvaluationState {
        EvaluationState {
            elements: Vec::new(),
            elements_by_id: HashMap::new(),
            drawing_modifiers: Value::Null,
            selected_drawing_profile_id: None,
            group_states: HashMap::new(),
            computed_geometry: HashMap::new(),
            base_transformation_geometry: HashMap::new(),
            transformation_stage_geometry: HashMap::new(),
            completed_transformation_recipe_indices: HashSet::new(),
            completed_transformation_targets: HashMap::new(),
            transformation_dependency_plans: None,
            computed_geometry_order: Vec::new(),
            computed_geometry_values: HashMap::new(),
            lazy_geometry_value_programs: HashMap::new(),
            geometry_input_targets: HashMap::new(),
            geometry_collection_nodes: HashMap::new(),
            geometry_value_binders: HashMap::new(),
            for_group_generated_rows: Vec::new(),
            for_group_expected_occurrence_count_by_template_id: HashMap::new(),
            pre_mutation_geometry: HashMap::new(),
            geometry_mutation_executions: Vec::new(),
            condition_evaluation_traces: Vec::new(),
            instance_base_geometry: HashMap::new(),
            errors: Vec::new(),
            geometry_value_errors: Vec::new(),
            warnings: Vec::new(),
        }
    }

    #[test]
    fn issue_1476_controller_guardless_scan_avoids_full_edge_walk() {
        let edge_state = |graph: &ConditionalDependencyGraph| {
            graph
                .edges
                .iter()
                .map(|edge| {
                    (
                        edge.from.kind.clone(),
                        edge.from.id.clone(),
                        edge.to.kind.clone(),
                        edge.to.id.clone(),
                        edge.span,
                        edge.requiredness.clone(),
                        edge.activation.as_ref().map(|activation| {
                            activation
                                .guards
                                .iter()
                                .map(|guard| {
                                    (
                                        guard.controller_id.clone(),
                                        guard.branch.clone(),
                                        guard.controller_kind.clone(),
                                        guard.static_selection.clone(),
                                    )
                                })
                                .collect::<Vec<_>>()
                        }),
                    )
                })
                .collect::<Vec<_>>()
        };

        let mut guardless_candidate_visits = Vec::new();
        for edge_count in [64, 256] {
            let graph = ConditionalDependencyGraph::from_edges(
                (0..edge_count)
                    .map(|index| {
                        required_edge(
                            endpoint(
                                "element",
                                &format!("unrelated-source-{index}"),
                                &format!("UnrelatedSource{index}"),
                            ),
                            endpoint(
                                "binding",
                                &format!("unrelated-target-{index}"),
                                &format!("UnrelatedTarget{index}"),
                            ),
                        )
                    })
                    .collect(),
            );
            let before = edge_state(&graph);

            CONTROLLER_CANDIDATE_EDGE_VISITS.with(|count| count.set(0));
            for _ in 0..8 {
                assert!(graph.controller_candidates(&HashMap::new()).is_empty());
            }
            let candidate_visits = CONTROLLER_CANDIDATE_EDGE_VISITS.with(std::cell::Cell::get);

            for _ in 0..8 {
                assert!(!graph.has_activation());
            }

            eprintln!(
                "#1476 guardless edges={edge_count} queries=8 controller_candidate_visits={candidate_visits}; Base full-scan visits expect {}",
                edge_count * 8,
            );
            guardless_candidate_visits.push(candidate_visits);
            assert_eq!(
                edge_state(&graph),
                before,
                "queries must not mutate the graph"
            );
        }

        let empty = ConditionalDependencyGraph::from_edges(Vec::new());
        assert!(!empty.has_activation());
        assert!(empty.controller_candidates(&HashMap::new()).is_empty());

        let mut empty_guards_edge = required_edge(
            endpoint("element", "empty-guards-source", "EmptyGuardsSource"),
            endpoint("binding", "empty-guards-target", "EmptyGuardsTarget"),
        );
        empty_guards_edge.activation = Some(ConditionalDependencyActivation { guards: vec![] });
        let empty_guards = ConditionalDependencyGraph::from_edges(vec![empty_guards_edge]);
        assert!(!empty_guards.has_activation());
        assert!(empty_guards
            .controller_candidates(&HashMap::new())
            .is_empty());

        let boolean_expression = || {
            validate_typed_expression_payload(&serde_json::json!({
                "kind": "booleanLiteral",
                "span": { "start": 0, "end": 1 },
                "value": true,
                "type": { "kind": "boolean" }
            }))
            .expect("valid boolean controller expression")
        };
        let make_guard =
            |controller_id: &str,
             branch: &str,
             controller_kind: Option<&str>,
             static_selection: Option<&str>,
             controller_expression: Option<TypedScalarExpression>| {
                ConditionalDependencyGuard {
                    controller_id: controller_id.to_owned(),
                    branch: branch.to_owned(),
                    controller_kind: controller_kind.map(str::to_owned),
                    static_selection: static_selection.map(str::to_owned),
                    controller_expression,
                }
            };
        let make_conditional_edge =
            |from_id: &str, to_id: &str, guards: Vec<ConditionalDependencyGuard>| {
                ConditionalDependencyEdge {
                    from: endpoint("geometry-value", from_id, from_id),
                    to: endpoint("binding", to_id, to_id),
                    span: None,
                    requiredness: Some("conditional".to_owned()),
                    activation: Some(ConditionalDependencyActivation { guards }),
                }
            };
        let unrelated_edge = |index: usize| {
            required_edge(
                endpoint(
                    "element",
                    &format!("mixed-unrelated-source-{index}"),
                    &format!("MixedUnrelatedSource{index}"),
                ),
                endpoint(
                    "binding",
                    &format!("mixed-unrelated-target-{index}"),
                    &format!("MixedUnrelatedTarget{index}"),
                ),
            )
        };
        let outer_guard = |branch: &str| {
            make_guard(
                "outer-controller",
                branch,
                None,
                None,
                Some(boolean_expression()),
            )
        };
        let coalesce_guard = |branch: &str| {
            make_guard(
                "coalesce-controller",
                branch,
                Some("geometry-value-coalesce"),
                None,
                None,
            )
        };

        let guarded_positive_control = ConditionalDependencyGraph::from_edges(vec![
            make_conditional_edge(
                "positive-source",
                "positive-left",
                vec![make_guard(
                    "positive-controller",
                    "left",
                    Some("geometry-value-coalesce"),
                    None,
                    None,
                )],
            ),
            make_conditional_edge(
                "positive-source",
                "positive-right",
                vec![make_guard(
                    "positive-controller",
                    "right",
                    Some("geometry-value-coalesce"),
                    None,
                    None,
                )],
            ),
        ]);
        assert!(guarded_positive_control.has_activation());
        CONTROLLER_CANDIDATE_EDGE_VISITS.with(|count| count.set(0));
        let positive_candidates = guarded_positive_control.controller_candidates(&HashMap::new());
        let positive_guarded_visits = CONTROLLER_CANDIDATE_EDGE_VISITS.with(std::cell::Cell::get);
        assert_eq!(positive_candidates.len(), 1);
        assert_eq!(positive_candidates[0].branches, vec!["left", "right"]);
        assert_eq!(
            positive_guarded_visits, 2,
            "a graph containing only two guarded edges must increment the candidate visit counter twice"
        );
        for _ in 0..8 {
            assert!(guarded_positive_control.has_activation());
        }

        let mut semantic_edges = (0..16).map(unrelated_edge).collect::<Vec<_>>();
        semantic_edges.push(required_edge(
            endpoint("geometry-value", "coalesce-source", "CoalesceSource"),
            endpoint("binding", "coalesce-pre-a", "CoalescePrerequisiteA"),
        ));
        semantic_edges.push(required_edge(
            endpoint("geometry-value", "coalesce-source", "CoalesceSource"),
            endpoint("binding", "coalesce-pre-b", "CoalescePrerequisiteB"),
        ));
        semantic_edges.push(make_conditional_edge(
            "coalesce-source",
            "coalesce-left",
            vec![coalesce_guard("left")],
        ));
        semantic_edges.push(make_conditional_edge(
            "coalesce-source",
            "coalesce-right",
            vec![coalesce_guard("right")],
        ));
        semantic_edges.extend((16..32).map(unrelated_edge));
        semantic_edges.push(required_edge(
            endpoint("geometry-value", "nested-source", "NestedSource"),
            endpoint("binding", "nested-pre", "NestedPrerequisite"),
        ));
        semantic_edges.push(make_conditional_edge(
            "nested-source",
            "outer-then-branch",
            vec![outer_guard("then")],
        ));
        semantic_edges.push(make_conditional_edge(
            "nested-source",
            "outer-else-branch",
            vec![outer_guard("else")],
        ));
        semantic_edges.push(make_conditional_edge(
            "nested-source",
            "then-pre",
            vec![make_guard("outer-controller", "then", None, None, None)],
        ));
        semantic_edges.push(make_conditional_edge(
            "nested-source",
            "else-pre",
            vec![make_guard("outer-controller", "else", None, None, None)],
        ));
        semantic_edges.push(make_conditional_edge(
            "nested-source",
            "inner-left",
            vec![
                outer_guard("then"),
                make_guard(
                    "inner-controller",
                    "left",
                    Some("geometry-value-coalesce"),
                    None,
                    None,
                ),
            ],
        ));
        semantic_edges.push(make_conditional_edge(
            "nested-source",
            "inner-right",
            vec![
                outer_guard("then"),
                make_guard(
                    "inner-controller",
                    "right",
                    Some("geometry-value-coalesce"),
                    None,
                    None,
                ),
            ],
        ));

        let static_selected = make_guard("static-selector", "then", None, Some("selected"), None);
        let static_unselected =
            make_guard("static-selector", "else", None, Some("unselected"), None);
        semantic_edges.push(make_conditional_edge(
            "nested-source",
            "static-selected-pre",
            vec![outer_guard("then"), static_selected],
        ));
        semantic_edges.push(make_conditional_edge(
            "nested-source",
            "static-unselected-pre",
            vec![outer_guard("then"), static_unselected],
        ));
        semantic_edges.push(make_conditional_edge(
            "nested-source",
            "static-coalesce-left",
            vec![
                outer_guard("then"),
                make_guard("static-selector", "then", None, Some("selected"), None),
                make_guard(
                    "static-coalesce",
                    "left",
                    Some("geometry-value-coalesce"),
                    None,
                    None,
                ),
            ],
        ));
        semantic_edges.push(make_conditional_edge(
            "nested-source",
            "static-coalesce-right",
            vec![
                outer_guard("then"),
                make_guard("static-selector", "then", None, Some("selected"), None),
                make_guard(
                    "static-coalesce",
                    "right",
                    Some("geometry-value-coalesce"),
                    None,
                    None,
                ),
            ],
        ));
        semantic_edges.push(make_conditional_edge(
            "nested-source",
            "inactive-static-coalesce",
            vec![
                outer_guard("then"),
                make_guard("static-selector", "else", None, Some("unselected"), None),
                make_guard(
                    "inactive-static-coalesce",
                    "left",
                    Some("geometry-value-coalesce"),
                    None,
                    None,
                ),
            ],
        ));
        semantic_edges.extend((32..64).map(unrelated_edge));
        let semantic_graph = ConditionalDependencyGraph::from_edges(semantic_edges);
        assert!(semantic_graph.has_activation());
        let semantic_state = edge_state(&semantic_graph);

        let initially_selected = semantic_graph.controller_candidates(&HashMap::new());
        let coalesce = initially_selected
            .iter()
            .find(|candidate| candidate.controller_id == "coalesce-controller")
            .expect("geometry coalesce remains a controller candidate");
        assert_eq!(
            coalesce.source_endpoint_id,
            "geometry-value:coalesce-source"
        );
        assert_eq!(
            coalesce.controller_kind.as_deref(),
            Some("geometry-value-coalesce")
        );
        assert!(coalesce.expression.is_none());
        assert_eq!(coalesce.branches, vec!["left", "right"]);
        assert_eq!(
            coalesce.prerequisite_endpoint_ids,
            vec!["binding:coalesce-pre-a", "binding:coalesce-pre-b"]
        );
        let outer = initially_selected
            .iter()
            .find(|candidate| candidate.controller_id == "outer-controller")
            .expect("typed controller expression remains eligible");
        assert_eq!(outer.source_endpoint_id, "geometry-value:nested-source");
        assert!(matches!(
            outer.expression,
            Some(TypedScalarExpression::BooleanLiteral { value: true, .. })
        ));
        assert_eq!(outer.branches, vec!["then", "else"]);
        assert_eq!(outer.prerequisite_endpoint_ids, vec!["binding:nested-pre"]);
        assert!(!initially_selected
            .iter()
            .any(|candidate| candidate.controller_id == "inner-controller"));
        let outer_branches = outer.branches.iter().cloned().collect::<HashSet<_>>();
        assert_eq!(
            branch_for_controller_value(&ScalarValue::Boolean(true), &outer_branches),
            Some("then".to_owned())
        );
        assert_eq!(
            branch_for_controller_value(&ScalarValue::Boolean(false), &outer_branches),
            Some("else".to_owned())
        );

        let then_selection = HashMap::from([
            ("outer-controller".to_owned(), "then".to_owned()),
            ("static-selector".to_owned(), "unselected".to_owned()),
        ]);
        let active_candidates = semantic_graph.controller_candidates(&then_selection);
        let inner = active_candidates
            .iter()
            .find(|candidate| candidate.controller_id == "inner-controller")
            .expect("inner candidate is enabled by the active outer branch");
        assert_eq!(inner.branches, vec!["left", "right"]);
        assert_eq!(
            inner.prerequisite_endpoint_ids,
            vec!["binding:outer-then-branch", "binding:then-pre"]
        );
        let static_coalesce = active_candidates
            .iter()
            .find(|candidate| candidate.controller_id == "static-coalesce")
            .expect("static selected prefix ignores a conflicting dynamic selection");
        assert_eq!(static_coalesce.branches, vec!["left", "right"]);
        assert_eq!(
            static_coalesce.prerequisite_endpoint_ids,
            vec!["binding:static-selected-pre"]
        );
        assert!(!active_candidates
            .iter()
            .any(|candidate| candidate.controller_id == "inactive-static-coalesce"));
        let selected_static_edge = semantic_graph
            .edges
            .iter()
            .find(|edge| edge.to.id == "static-selected-pre")
            .unwrap();
        let unselected_static_edge = semantic_graph
            .edges
            .iter()
            .find(|edge| edge.to.id == "static-unselected-pre")
            .unwrap();
        assert!(edge_is_active(selected_static_edge, &then_selection));
        assert!(!edge_is_active(unselected_static_edge, &then_selection));

        let else_selection = HashMap::from([
            ("outer-controller".to_owned(), "else".to_owned()),
            ("static-selector".to_owned(), "selected".to_owned()),
        ]);
        let inactive_candidates = semantic_graph.controller_candidates(&else_selection);
        assert!(!inactive_candidates
            .iter()
            .any(|candidate| candidate.controller_id == "inner-controller"));
        assert!(!inactive_candidates
            .iter()
            .any(|candidate| candidate.controller_id == "static-coalesce"));
        let active_again = semantic_graph.controller_candidates(&then_selection);
        assert!(active_again
            .iter()
            .any(|candidate| candidate.controller_id == "inner-controller"));
        assert_eq!(edge_state(&semantic_graph), semantic_state);

        let module_graph = ConditionalDependencyGraph::from_edges(
            decode_conditional_dependency_graph(Some(&module_prerequisite_semantics_payload()))
                .unwrap()
                .unwrap()
                .edges,
        );
        let module_then = HashMap::from([("controller".to_owned(), "then".to_owned())]);
        let all_active_then = HashSet::from([
            "excluded-first".to_owned(),
            "candidate-first".to_owned(),
            "excluded-last".to_owned(),
            "candidate-last".to_owned(),
            "then-only".to_owned(),
            "static-selected".to_owned(),
        ]);
        let excluding_two = HashSet::from([
            "candidate-first".to_owned(),
            "candidate-last".to_owned(),
            "then-only".to_owned(),
            "static-selected".to_owned(),
        ]);
        assert_eq!(
            module_graph.unavailable_module_instance_prerequisite(
                "element:target",
                &module_then,
                &HashSet::new(),
                &all_active_then,
            ),
            None
        );
        assert_eq!(
            module_graph.unavailable_module_instance_prerequisite(
                "element:target",
                &module_then,
                &HashSet::new(),
                &excluding_two,
            ),
            Some(("excluded-last".to_owned(), false))
        );
        assert_eq!(
            module_graph.unavailable_module_instance_prerequisite(
                "element:target",
                &module_then,
                &HashSet::from(["candidate-first".to_owned()]),
                &excluding_two,
            ),
            Some(("candidate-first".to_owned(), true))
        );
        eprintln!("#1476 semantic controls=PASS");

        assert_eq!(
            guardless_candidate_visits,
            vec![0, 0],
            "guardless controller scans must do zero repeated unrelated work; Base full-scan visits are 512 and 2048",
        );
    }

    #[test]
    fn forwarded_activation_keeps_controller_prerequisites_at_its_producer() {
        let conditional = |from| ConditionalDependencyEdge {
            from,
            to: endpoint("binding", "selected", "selected"),
            span: None,
            requiredness: Some("conditional".to_owned()),
            activation: Some(ConditionalDependencyActivation {
                guards: vec![ConditionalDependencyGuard {
                    controller_id: "geometry-value:chosen\0choice".to_owned(),
                    branch: "then".to_owned(),
                    controller_kind: None,
                    static_selection: None,
                    controller_expression: Some(
                        validate_typed_expression_payload(&serde_json::json!({
                            "kind": "booleanLiteral", "span": { "start": 0, "end": 1 },
                            "value": true, "type": { "kind": "boolean" }
                        }))
                        .expect("valid typed controller"),
                    ),
                }],
            }),
        };
        let graph = ConditionalDependencyGraph::from_edges(vec![
            required_edge(
                endpoint("geometry-value", "chosen", "chosen"),
                endpoint("binding", "flag", "flag"),
            ),
            conditional(endpoint("geometry-value", "chosen", "chosen")),
            required_edge(
                endpoint("element", "outside", "outside"),
                endpoint("geometry-value", "chosen", "chosen"),
            ),
            conditional(endpoint("element", "outside", "outside")),
        ]);
        let candidates = graph.controller_candidates(&HashMap::new());
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].source_endpoint_id, "geometry-value:chosen");
        assert_eq!(
            candidates[0].prerequisite_endpoint_ids,
            vec!["binding:flag"]
        );
    }

    #[test]
    fn geometry_value_selector_bindings_use_canonical_selector_spans() {
        let graph = ConditionalDependencyGraph::from_edges(vec![
            required_edge_with_span(
                endpoint("geometry-value", "chosen", "chosen"),
                endpoint("binding", "flag", "flag"),
                (12, 17),
            ),
            required_edge_with_span(
                endpoint("geometry-value", "chosen", "chosen"),
                endpoint("binding", "leafValue", "leaf value"),
                (30, 37),
            ),
            ConditionalDependencyEdge {
                from: endpoint("geometry-value", "chosen", "chosen"),
                to: endpoint("binding", "nestedFlag", "nested flag"),
                span: Some((15, 19)),
                requiredness: Some("conditional".to_owned()),
                activation: Some(ConditionalDependencyActivation {
                    guards: vec![ConditionalDependencyGuard {
                        controller_id: "outer-controller".to_owned(),
                        branch: "then".to_owned(),
                        controller_kind: None,
                        static_selection: None,
                        controller_expression: None,
                    }],
                }),
            },
            required_edge_with_span(
                endpoint("element", "other", "other"),
                endpoint("binding", "otherFlag", "other flag"),
                (15, 19),
            ),
        ]);

        let selector_spans = HashMap::from([("geometry-value:chosen".to_owned(), vec![(10, 20)])]);
        assert_eq!(
            graph.geometry_value_selector_binding_ids_by_endpoint_id(
                &HashMap::new(),
                &selector_spans,
            ),
            HashMap::from([(
                "geometry-value:chosen".to_owned(),
                HashSet::from(["flag".to_owned()]),
            )]),
            "selector readiness should use canonical binding IDs per geometry-value occurrence"
        );
        assert_eq!(
            graph.bindings_with_active_geometry_value_selector_dependency(
                &HashMap::new(),
                &selector_spans,
            ),
            HashSet::from(["flag".to_owned()]),
            "only unconditional canonical binding edges inside selector spans should be scheduled"
        );
        assert_eq!(
            graph.bindings_with_active_geometry_value_selector_dependency(
                &HashMap::from([("outer-controller".to_owned(), "then".to_owned())]),
                &selector_spans,
            ),
            HashSet::from(["flag".to_owned(), "nestedFlag".to_owned()]),
            "active nested selectors should use their canonical conditional prerequisite edge"
        );
    }

    #[test]
    fn geometry_dependency_classification_and_readiness_follow_exact_forwarding_bindings() {
        let inner_20 = "module-binding:inner-20";
        let outer_20 = "module-binding:outer-20";
        let root_20 = "binding:root-20";
        let inner_40 = "module-binding:inner-40";
        let outer_40 = "module-binding:outer-40";
        let root_40 = "binding:root-40";
        let graph = ConditionalDependencyGraph::from_edges(vec![
            required_edge(
                endpoint("binding", inner_20, "Inner20.value"),
                endpoint("geometry-value", "shape-20", "Shape20.length"),
            ),
            required_edge(
                endpoint("binding", outer_20, "Outer20.value"),
                endpoint("binding", inner_20, "Inner20.value"),
            ),
            required_edge(
                endpoint("binding", root_20, "Root20.value"),
                endpoint("binding", outer_20, "Outer20.value"),
            ),
            required_edge(
                endpoint("binding", inner_40, "Inner40.value"),
                endpoint("geometry-value", "shape-40", "Shape40.length"),
            ),
            required_edge(
                endpoint("binding", outer_40, "Outer40.value"),
                endpoint("binding", inner_40, "Inner40.value"),
            ),
            required_edge(
                endpoint("binding", root_40, "Root40.value"),
                endpoint("binding", outer_40, "Outer40.value"),
            ),
        ]);
        let branch_selections = HashMap::new();
        let geometry_dependent_binding_ids =
            graph.bindings_with_active_geometry_property_dependency(&branch_selections);
        assert_eq!(
            geometry_dependent_binding_ids,
            HashSet::from([
                inner_20.to_owned(),
                outer_20.to_owned(),
                root_20.to_owned(),
                inner_40.to_owned(),
                outer_40.to_owned(),
                root_40.to_owned(),
            ]),
            "required binding-to-binding edges must carry geometry dependency through the full per-instance forwarding chain"
        );

        let candidates =
            [inner_20, outer_20, root_20, inner_40, outer_40, root_40].map(str::to_owned);
        let geometry_value_index_by_endpoint_id = HashMap::from([
            ("geometry-value:shape-20".to_owned(), 0),
            ("geometry-value:shape-40".to_owned(), 1),
        ]);
        let evaluated_geometry_values = [true, true];
        let state = empty_evaluation_state();

        let unavailable_children = AvailabilityResolver {
            available_binding_ids: HashSet::new(),
        };
        let ready = graph.ready_geometry_dependent_binding_ids(
            &candidates,
            &branch_selections,
            &unavailable_children,
            &state,
            &evaluated_geometry_values,
            &geometry_value_index_by_endpoint_id,
        );
        assert!(ready.contains(inner_20));
        assert!(ready.contains(inner_40));
        assert!(
            !ready.contains(outer_20) && !ready.contains(root_20),
            "ready geometry alone must not release forwarding bindings while their exact child binding is unavailable"
        );

        let only_inner_20_available = AvailabilityResolver {
            available_binding_ids: HashSet::from([inner_20.to_owned()]),
        };
        let ready = graph.ready_geometry_dependent_binding_ids(
            &candidates,
            &branch_selections,
            &only_inner_20_available,
            &state,
            &evaluated_geometry_values,
            &geometry_value_index_by_endpoint_id,
        );
        assert!(ready.contains(outer_20));
        assert!(!ready.contains(root_20));
        assert!(!ready.contains(outer_40) && !ready.contains(root_40));

        let exact_20_chain_available = AvailabilityResolver {
            available_binding_ids: HashSet::from([inner_20.to_owned(), outer_20.to_owned()]),
        };
        let ready = graph.ready_geometry_dependent_binding_ids(
            &candidates,
            &branch_selections,
            &exact_20_chain_available,
            &state,
            &evaluated_geometry_values,
            &geometry_value_index_by_endpoint_id,
        );
        assert!(ready.contains(outer_20) && ready.contains(root_20));
        assert!(!ready.contains(outer_40) && !ready.contains(root_40));
    }

    #[test]
    fn say_465_schedules_active_forward_scalar_prerequisites_by_binding_identity() {
        let outer = "module-binding:outer";
        let child = "module-binding:child";
        let edge = required_edge(
            endpoint("binding", outer, "Outer.Forwarded"),
            endpoint("binding", child, "Nested.Value"),
        );
        let graph = ConditionalDependencyGraph::from_edges(vec![edge]);
        let branch_selections = HashMap::new();
        let source_order_by_binding_id =
            HashMap::from([(outer.to_owned(), 1), (child.to_owned(), 3)]);
        assert_eq!(
            graph.bindings_with_active_forward_binding_dependency(
                &branch_selections,
                &source_order_by_binding_id,
            ),
            HashSet::from([outer.to_owned(), child.to_owned()]),
        );
        assert!(graph
            .bindings_with_active_forward_binding_dependency(
                &branch_selections,
                &HashMap::from([(outer.to_owned(), 3), (child.to_owned(), 1)]),
            )
            .is_empty());

        let unavailable = AvailabilityResolver {
            available_binding_ids: HashSet::new(),
        };
        let candidate_binding_ids = [outer.to_owned(), child.to_owned()];
        let state = empty_evaluation_state();
        let geometry_value_index_by_endpoint_id = HashMap::new();
        let ready =
            graph.ready_dependency_scheduled_binding_ids(DependencyScheduledBindingReadiness {
                candidate_binding_ids: &candidate_binding_ids,
                source_order_by_binding_id: &source_order_by_binding_id,
                branch_selections: &branch_selections,
                resolver: &unavailable,
                state: &state,
                completed_element_ids: None,
                evaluated_geometry_values: &[],
                geometry_value_index_by_endpoint_id: &geometry_value_index_by_endpoint_id,
            });
        assert_eq!(ready, HashSet::from([outer.to_owned(), child.to_owned()]));

        let conditional_graph =
            ConditionalDependencyGraph::from_edges(vec![ConditionalDependencyEdge {
                from: endpoint("binding", outer, "Outer.Forwarded"),
                to: endpoint("binding", child, "Nested.Value"),
                span: None,
                requiredness: Some("conditional".to_owned()),
                activation: Some(ConditionalDependencyActivation {
                    guards: vec![ConditionalDependencyGuard {
                        controller_id: "controller".to_owned(),
                        branch: "then".to_owned(),
                        controller_kind: None,
                        static_selection: None,
                        controller_expression: None,
                    }],
                }),
            }]);
        assert!(conditional_graph
            .bindings_with_active_forward_binding_dependency(
                &branch_selections,
                &source_order_by_binding_id,
            )
            .is_empty());
        assert_eq!(
            conditional_graph.bindings_with_active_forward_binding_dependency(
                &HashMap::from([("controller".to_owned(), "then".to_owned())]),
                &source_order_by_binding_id,
            ),
            HashSet::from([outer.to_owned(), child.to_owned()]),
        );
    }
}
