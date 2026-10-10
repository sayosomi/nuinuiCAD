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

struct GeometryDependencyReadinessContext<'a> {
    branch_selections: &'a HashMap<String, String>,
    state: &'a EvaluationState,
}

struct GeometryPropertyReadinessContext<'a> {
    outgoing_edges: HashMap<String, Vec<&'a ConditionalDependencyEdge>>,
    endpoints: HashMap<String, &'a ConditionalDependencyEndpoint>,
    resolver: &'a dyn ScalarDocumentBindingResolver,
    state: &'a EvaluationState,
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
                "element" => context.state.computed_geometry.contains_key(&endpoint.id),
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
                "geometry-value" | "geometry-stage" | "module-occurrence" => {
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
        let mut outgoing_edges = HashMap::<String, Vec<&ConditionalDependencyEdge>>::new();
        let mut endpoints = HashMap::<String, &ConditionalDependencyEndpoint>::new();
        for edge in &self.edges {
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

    pub(crate) fn geometry_prerequisites_are_ready(
        &self,
        endpoint_id: &str,
        branch_selections: &HashMap<String, String>,
        state: &EvaluationState,
    ) -> bool {
        let context = GeometryDependencyReadinessContext {
            branch_selections,
            state,
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
        let mut outgoing_edges = HashMap::<String, Vec<&ConditionalDependencyEdge>>::new();
        let mut endpoints = HashMap::<String, &ConditionalDependencyEndpoint>::new();
        for edge in &self.edges {
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
        let current_element_id = endpoint_id.strip_prefix("element:").unwrap_or(endpoint_id);
        self.edges
            .iter()
            .filter(|edge| {
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
            "element" => context.state.computed_geometry.contains_key(&endpoint.id),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::evaluation::scalars::{ScalarEvaluation, ScalarType};

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
            transformation_dependency_plans: None,
            computed_geometry_order: Vec::new(),
            computed_geometry_values: HashMap::new(),
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
    fn geometry_value_selector_bindings_use_canonical_selector_spans() {
        let graph = ConditionalDependencyGraph {
            edges: vec![
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
            ],
        };

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
        let graph = ConditionalDependencyGraph {
            edges: vec![
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
            ],
        };
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
        let graph = ConditionalDependencyGraph { edges: vec![edge] };
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
                evaluated_geometry_values: &[],
                geometry_value_index_by_endpoint_id: &geometry_value_index_by_endpoint_id,
            });
        assert_eq!(ready, HashSet::from([outer.to_owned(), child.to_owned()]));

        let conditional_graph = ConditionalDependencyGraph {
            edges: vec![ConditionalDependencyEdge {
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
            }],
        };
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
