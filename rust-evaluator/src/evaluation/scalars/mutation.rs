//! Task 32/33 in-place mutation cursor. Conditional selection is registered
//! by Task 25's Rust runtime; this module never parses or evaluates a branch.
mod for_group_scheduler;
use super::super::scalar_expression_runtime::{
    lookup_for_group_geometry_property, lookup_geometry_collection_length,
    lookup_geometry_collection_presence, lookup_geometry_property,
    lookup_geometry_property_at_stage, lookup_geometry_value_binder_property,
    lookup_geometry_value_property, lookup_optional_geometry_property,
    resolve_for_group_geometry_builtin_target, ForGroupGeometryPropertyRequest,
};
use super::bindings::ScalarDocumentBindingResolver;
use super::bindings::{
    record_field_path_matches, result_for_declared_type, result_for_scalar_type,
    scalar_evaluation_json, select_collection_match_arm, ScalarRecordMapBinderContext,
};
use super::expression_evaluator::{evaluate_typed_expression, ScalarEvaluationEnvironment};
use super::mutation_payload::{
    InitialState, ValidatedBindingCatalogOrder, ValidatedBindingVersion,
    ValidatedBindingVersionKind, ValidatedBindingVersions,
};
use super::program_payload::{
    ValidatedScalarProgramCollectionMember, ValidatedScalarProgramCollectionValue,
    ValidatedScalarProgramRecordFieldIdentity,
};
use super::scalar_payload::scalar_value_matches_type;
use super::types::{
    BindingId, ScalarEvaluation, ScalarExpressionResolvedOptionalMemberTarget, ScalarType,
    ScalarValue,
};
use crate::evaluation::geometry_value_runtime::{
    evaluate_geometry_value_entry, GeometryValueProgramEntry,
};
use crate::evaluation::types::EvaluationState;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

pub(crate) use for_group_scheduler::ForGroupExecutionStatement;

const BINDING_UNAVAILABLE: &str = "evaluation-binding-unavailable";
const RUNTIME_VALUE_TYPE_MISMATCH: &str = "evaluation-runtime-value-type-mismatch";

struct ScopeFrame {
    scope_id: String,
    exit_source_order: usize,
    locals: HashSet<BindingId>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct CollectionCarrySnapshot {
    pub(crate) value_id: String,
    pub(crate) local_bindings: HashMap<BindingId, ScalarEvaluation>,
    pub(crate) collection_carry_snapshots: Option<Arc<HashMap<String, CollectionCarrySnapshot>>>,
    pub(crate) error: Option<ScalarEvaluation>,
}

pub(crate) struct ScalarMutationResolver<'a> {
    program: &'a ValidatedBindingVersions,
    current: HashMap<BindingId, ScalarEvaluation>,
    next_version_index: usize,
    pending_dependency_versions: Vec<usize>,
    history: Vec<Value>,
    conditional_results: HashMap<String, Option<String>>,
    loop_conditional_results: Vec<HashMap<String, Option<String>>>,
    frames: Vec<ScopeFrame>,
    collection_carry_snapshots: HashMap<String, CollectionCarrySnapshot>,
}

pub(crate) struct DependencyBindingSchedule<'a> {
    pub(crate) execution_positions: &'a HashMap<String, f64>,
    pub(crate) prerequisites: &'a HashMap<String, HashSet<String>>,
}

pub(crate) struct GeometryValueReleaseContext<'a> {
    pub(crate) program: &'a [GeometryValueProgramEntry],
    pub(crate) execution_positions: &'a [f64],
    pub(crate) selector_binding_ids_by_index: &'a [HashSet<String>],
    pub(crate) binding_schedule: &'a DependencyBindingSchedule<'a>,
    pub(crate) dependency_ready_binding_ids: &'a HashSet<String>,
    pub(crate) dependency_order_available: bool,
    pub(crate) dependency_execution_position: Option<f64>,
    pub(crate) release_allowed: &'a [bool],
    pub(crate) source_position_fence: bool,
    pub(crate) evaluated: &'a mut [bool],
}

impl<'a> ScalarMutationResolver<'a> {
    pub(crate) fn new(program: &'a ValidatedBindingVersions) -> Self {
        Self {
            program,
            current: HashMap::new(),
            next_version_index: 0,
            pending_dependency_versions: Vec::new(),
            history: Vec::new(),
            conditional_results: HashMap::new(),
            loop_conditional_results: Vec::new(),
            frames: Vec::new(),
            collection_carry_snapshots: HashMap::new(),
        }
    }
    pub(crate) fn advance_before_statement(
        &mut self,
        source_order: usize,
        state: &EvaluationState,
    ) {
        while self.next_version_index < self.program.versions.len() {
            let version_source_order = self.program.versions[self.next_version_index].source_order;
            if version_source_order >= source_order {
                break;
            }
            self.retire_before(version_source_order);
            self.next_version_index += 1;
            let version = &self.program.versions[self.next_version_index - 1];
            self.execute(version, state);
        }
        self.retire_before(source_order);
    }
    pub(crate) fn advance_before_with_execution_position(
        &mut self,
        source_order: usize,
        dependency_execution_position: Option<f64>,
        binding_schedule: &DependencyBindingSchedule<'_>,
        dependency_ready_binding_ids: &HashSet<String>,
        dependency_order_available: bool,
        state: &mut EvaluationState,
    ) {
        let Some(dependency_execution_position) =
            dependency_execution_position.filter(|_| dependency_order_available)
        else {
            self.advance_before_statement(source_order, state);
            return;
        };
        while self.next_version_index < self.program.versions.len() {
            let version = &self.program.versions[self.next_version_index];
            if version.source_order >= source_order {
                break;
            }
            self.retire_before(version.source_order);
            let version_index = self.next_version_index;
            self.next_version_index += 1;
            if Self::is_dependency_scheduled_version(version)
                && binding_schedule
                    .execution_positions
                    .contains_key(&version.binding_id)
            {
                self.pending_dependency_versions.push(version_index);
            } else {
                self.advance_pending_dependency_versions_through(
                    dependency_execution_position,
                    binding_schedule,
                    state,
                    None,
                    dependency_ready_binding_ids,
                    false,
                );
                self.execute(version, state);
            }
        }
        self.retire_before(source_order);
        self.advance_pending_dependency_versions_through(
            dependency_execution_position,
            binding_schedule,
            state,
            None,
            dependency_ready_binding_ids,
            dependency_execution_position.is_infinite(),
        );
    }
    pub(crate) fn advance_before_with_geometry_values(
        &mut self,
        source_order: usize,
        geometry_execution_position: f64,
        state: &mut EvaluationState,
        mut geometry_values: GeometryValueReleaseContext<'_>,
    ) -> bool {
        let next_version_index_before = self.next_version_index;
        let history_len_before = self.history.len();
        let evaluated_count_before = geometry_values
            .evaluated
            .iter()
            .filter(|evaluated| **evaluated)
            .count();
        if geometry_values.dependency_order_available
            && geometry_values.dependency_execution_position.is_some()
        {
            let dependency_execution_position = geometry_values
                .dependency_execution_position
                .expect("checked dependency execution position");
            while self.next_version_index < self.program.versions.len() {
                let version = &self.program.versions[self.next_version_index];
                if version.source_order >= source_order {
                    break;
                }
                self.retire_before(version.source_order);
                let version_index = self.next_version_index;
                self.next_version_index += 1;
                if Self::is_dependency_scheduled_version(version)
                    && geometry_values
                        .binding_schedule
                        .execution_positions
                        .contains_key(&version.binding_id)
                {
                    self.pending_dependency_versions.push(version_index);
                } else {
                    let version_geometry_execution_position = geometry_values
                        .binding_schedule
                        .execution_positions
                        .get(&version.binding_id)
                        .copied()
                        .unwrap_or(geometry_execution_position);
                    self.evaluate_geometry_values_through(
                        version_geometry_execution_position,
                        version.source_order,
                        &mut geometry_values,
                        state,
                        false,
                    );
                    let dependency_ready_binding_ids =
                        geometry_values.dependency_ready_binding_ids.clone();
                    self.advance_pending_dependency_versions_through(
                        dependency_execution_position,
                        geometry_values.binding_schedule,
                        state,
                        Some(&mut geometry_values),
                        &dependency_ready_binding_ids,
                        false,
                    );
                    self.execute(version, state);
                }
            }
            self.retire_before(source_order);
            let dependency_ready_binding_ids = geometry_values.dependency_ready_binding_ids.clone();
            self.advance_pending_dependency_versions_through(
                dependency_execution_position,
                geometry_values.binding_schedule,
                state,
                Some(&mut geometry_values),
                &dependency_ready_binding_ids,
                false,
            );
            self.evaluate_geometry_values_through(
                geometry_execution_position,
                source_order,
                &mut geometry_values,
                state,
                false,
            );
            return self.next_version_index != next_version_index_before
                || self.history.len() != history_len_before
                || geometry_values
                    .evaluated
                    .iter()
                    .filter(|evaluated| **evaluated)
                    .count()
                    > evaluated_count_before;
        }
        while self.next_version_index < self.program.versions.len() {
            let version_source_order = self.program.versions[self.next_version_index].source_order;
            if version_source_order >= source_order {
                break;
            }
            self.retire_before(version_source_order);
            let version = &self.program.versions[self.next_version_index];
            let version_geometry_execution_position = geometry_values
                .binding_schedule
                .execution_positions
                .get(&version.binding_id)
                .copied()
                .unwrap_or(geometry_execution_position);
            self.evaluate_geometry_values_through(
                version_geometry_execution_position,
                version_source_order,
                &mut geometry_values,
                state,
                false,
            );
            self.next_version_index += 1;
            let version = &self.program.versions[self.next_version_index - 1];
            self.execute(version, state);
        }
        self.retire_before(source_order);
        self.evaluate_geometry_values_through(
            geometry_execution_position,
            source_order,
            &mut geometry_values,
            state,
            false,
        );
        self.next_version_index != next_version_index_before
            || self.history.len() != history_len_before
            || geometry_values
                .evaluated
                .iter()
                .filter(|evaluated| **evaluated)
                .count()
                > evaluated_count_before
    }
    pub(crate) fn release_terminal_geometry_values(
        &self,
        geometry_execution_position: f64,
        source_order: usize,
        state: &mut EvaluationState,
        mut geometry_values: GeometryValueReleaseContext<'_>,
    ) {
        self.evaluate_geometry_values_through(
            geometry_execution_position,
            source_order,
            &mut geometry_values,
            state,
            true,
        );
    }
    fn selector_binding_is_pending(
        &self,
        binding_ids: &HashSet<String>,
        state: &EvaluationState,
    ) -> bool {
        binding_ids.iter().any(|binding_id| {
            self.program.binding_ids.contains(binding_id)
                && matches!(
                    self.resolve(binding_id, state),
                    ScalarEvaluation::Error { issue_code, .. }
                        if issue_code == BINDING_UNAVAILABLE
                )
        })
    }
    fn evaluate_geometry_values_through(
        &self,
        geometry_execution_position: f64,
        source_order: usize,
        geometry_values: &mut GeometryValueReleaseContext<'_>,
        state: &mut EvaluationState,
        release_pending_module_selectors: bool,
    ) {
        let resolver: &dyn ScalarDocumentBindingResolver = self;
        let mut entry_indices = (0..geometry_values.program.len()).collect::<Vec<_>>();
        entry_indices.sort_by(|left, right| {
            geometry_values
                .execution_positions
                .get(*left)
                .copied()
                .unwrap_or(geometry_values.program[*left].execution_position)
                .total_cmp(
                    &geometry_values
                        .execution_positions
                        .get(*right)
                        .copied()
                        .unwrap_or(geometry_values.program[*right].execution_position),
                )
                .then_with(|| left.cmp(right))
        });
        for index in entry_indices {
            let entry = &geometry_values.program[index];
            let release_position = geometry_values
                .execution_positions
                .get(index)
                .copied()
                .unwrap_or(entry.execution_position);
            if geometry_values
                .evaluated
                .get(index)
                .copied()
                .unwrap_or(true)
                || !geometry_values
                    .release_allowed
                    .get(index)
                    .copied()
                    .unwrap_or(true)
                || release_position > geometry_execution_position
                || (geometry_values.source_position_fence
                    && entry.source_execution_position > source_order as f64)
            {
                continue;
            }
            // Root selectors retain the established SAY-501 schedule. A
            // Module occurrence can reach this release pass before its local
            // selector binding has become visible, so defer only that
            // instance-owned value until the canonical binding is available.
            if geometry_values
                .selector_binding_ids_by_index
                .get(index)
                .is_some_and(|binding_ids| {
                    !release_pending_module_selectors
                        && !entry.occurrence.instance_path.is_empty()
                        && self.selector_binding_is_pending(binding_ids, state)
                })
            {
                continue;
            }
            if !entry.lazy {
                evaluate_geometry_value_entry(entry, resolver, state);
            }
            if let Some(evaluated) = geometry_values.evaluated.get_mut(index) {
                *evaluated = true;
            }
        }
    }
    pub(crate) fn finalize(
        &mut self,
        state: &mut EvaluationState,
        binding_schedule: &DependencyBindingSchedule<'_>,
        dependency_ready_binding_ids: &HashSet<String>,
        dependency_order_available: bool,
    ) {
        self.advance_before_with_execution_position(
            usize::MAX,
            Some(f64::INFINITY),
            binding_schedule,
            dependency_ready_binding_ids,
            dependency_order_available,
            state,
        );
        self.retire_before(usize::MAX);
    }
    pub(crate) fn is_dependency_scheduled_version(version: &ValidatedBindingVersion) -> bool {
        let is_linear = version.control.get("kind").and_then(Value::as_str) == Some("linear");
        // Catalog order owns materialization; the projected dependency position owns scheduling.
        is_linear
            && match version.catalog_order {
                Some(ValidatedBindingCatalogOrder::Source)
                | Some(ValidatedBindingCatalogOrder::Append)
                | None => true,
            }
    }
    fn advance_pending_dependency_versions_through(
        &mut self,
        dependency_execution_position: f64,
        binding_schedule: &DependencyBindingSchedule<'_>,
        state: &mut EvaluationState,
        mut geometry_values: Option<&mut GeometryValueReleaseContext<'_>>,
        dependency_ready_binding_ids: &HashSet<String>,
        flush_unranked: bool,
    ) {
        let mut ready = self
            .pending_dependency_versions
            .iter()
            .filter_map(|version_index| {
                let version = &self.program.versions[*version_index];
                let rank = binding_schedule
                    .execution_positions
                    .get(&version.binding_id)
                    .copied()?;
                let prerequisites_executed = binding_schedule
                    .prerequisites
                    .get(&version.binding_id)
                    .map_or(true, |prerequisites| {
                        prerequisites
                            .iter()
                            .all(|binding_id| self.current.contains_key(binding_id))
                    });
                (rank <= dependency_execution_position
                    && dependency_ready_binding_ids.contains(&version.binding_id)
                    && prerequisites_executed)
                    .then_some((*version_index, rank))
            })
            .collect::<Vec<_>>();
        while !ready.is_empty() {
            ready.sort_by(|(left_index, left_rank), (right_index, right_rank)| {
                let left = &self.program.versions[*left_index];
                let right = &self.program.versions[*right_index];
                left_rank
                    .total_cmp(right_rank)
                    .then_with(|| left.source_order.cmp(&right.source_order))
                    .then_with(|| left.version_id.cmp(&right.version_id))
            });
            let ready_indices = ready
                .iter()
                .map(|(index, _)| *index)
                .collect::<HashSet<_>>();
            self.pending_dependency_versions
                .retain(|index| !ready_indices.contains(index));
            for (version_index, rank) in ready {
                let version = &self.program.versions[version_index];
                if let Some(geometry_values) = geometry_values.as_deref_mut() {
                    self.evaluate_geometry_values_through(
                        rank,
                        version.source_order,
                        geometry_values,
                        state,
                        false,
                    );
                }
                self.execute(version, state);
            }
            ready = self
                .pending_dependency_versions
                .iter()
                .filter_map(|version_index| {
                    let version = &self.program.versions[*version_index];
                    let rank = binding_schedule
                        .execution_positions
                        .get(&version.binding_id)
                        .copied()?;
                    let prerequisites_executed = binding_schedule
                        .prerequisites
                        .get(&version.binding_id)
                        .map_or(true, |prerequisites| {
                            prerequisites
                                .iter()
                                .all(|binding_id| self.current.contains_key(binding_id))
                        });
                    (rank <= dependency_execution_position
                        && dependency_ready_binding_ids.contains(&version.binding_id)
                        && prerequisites_executed)
                        .then_some((*version_index, rank))
                })
                .collect();
        }
        if flush_unranked {
            self.pending_dependency_versions.sort_by(|left, right| {
                let left = &self.program.versions[*left];
                let right = &self.program.versions[*right];
                binding_schedule
                    .execution_positions
                    .get(&left.binding_id)
                    .copied()
                    .unwrap_or(f64::INFINITY)
                    .total_cmp(
                        &binding_schedule
                            .execution_positions
                            .get(&right.binding_id)
                            .copied()
                            .unwrap_or(f64::INFINITY),
                    )
                    .then_with(|| left.source_order.cmp(&right.source_order))
                    .then_with(|| left.version_id.cmp(&right.version_id))
            });
            let remaining = std::mem::take(&mut self.pending_dependency_versions);
            for version_index in remaining {
                let version = &self.program.versions[version_index];
                if let Some(geometry_values) = geometry_values.as_deref_mut() {
                    self.evaluate_geometry_values_through(
                        dependency_execution_position,
                        version.source_order,
                        geometry_values,
                        state,
                        false,
                    );
                }
                self.execute(version, state);
            }
        }
    }
    pub(crate) fn source_order_for_element(&self, element_id: &str) -> Option<usize> {
        self.program.element_source_orders.get(element_id).copied()
    }
    pub(crate) fn register_conditional_result(&mut self, element_id: &str, branch: Option<&str>) {
        let Some(owner_id) = self
            .program
            .conditional_owners_by_element_id
            .get(element_id)
            .cloned()
        else {
            return;
        };
        let result = branch.map(str::to_owned);
        if let Some(results) = self.loop_conditional_results.last_mut() {
            results.insert(owner_id, result);
            return;
        }
        if self.conditional_results.contains_key(&owner_id) {
            return;
        }
        self.conditional_results
            .insert(owner_id.clone(), result.clone());
        let Some(branch) = result else {
            return;
        };
        for version in &self.program.versions {
            let Some(chain) = version.control.get("ownerChain").and_then(Value::as_array) else {
                continue;
            };
            for owner in chain {
                if owner.get("kind").and_then(Value::as_str) == Some("conditionalBranch")
                    && owner.get("ownerStatementId").and_then(Value::as_str)
                        == Some(owner_id.as_str())
                    && owner.get("branch").and_then(Value::as_str) == Some(branch.as_str())
                {
                    let scope_id = owner
                        .get("scopeId")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned();
                    let exit = owner
                        .get("exitSourceOrder")
                        .and_then(Value::as_u64)
                        .unwrap_or(0) as usize;
                    self.frames.push(ScopeFrame {
                        scope_id,
                        exit_source_order: exit,
                        locals: HashSet::new(),
                    });
                    return;
                }
            }
        }
    }
    pub(crate) fn resolve(&self, binding_id: &str, _state: &EvaluationState) -> ScalarEvaluation {
        if self.program.binding_ids.contains(binding_id) {
            self.lookup_current(binding_id)
        } else {
            ScalarEvaluation::Error {
                r#type: ScalarType::Number,
                issue_code: "evaluation-binding-unavailable".to_owned(),
                binding_id: Some(binding_id.to_owned()),
                context: None,
            }
        }
    }
    pub(crate) fn computed_bindings(&self) -> Vec<Value> {
        let mut computed = self.program.versions.iter().filter(|version| matches!(version.kind, ValidatedBindingVersionKind::Declare { .. }) &&
            version.control.get("ownerChain").and_then(Value::as_array).is_some_and(Vec::is_empty))
            .filter_map(|version| self.current.get(&version.binding_id).map(|evaluation| json!({"bindingId": version.binding_id, "evaluation": scalar_evaluation_json(evaluation)}))).collect::<Vec<_>>();
        for plan in self.program.immutable_for_groups.values() {
            for carry in &plan.carries {
                if let Some(evaluation) = self.current.get(&carry.binding_id) {
                    computed.push(json!({"bindingId": carry.binding_id, "evaluation": scalar_evaluation_json(evaluation)}));
                }
            }
        }
        computed
    }

    pub(crate) fn is_immutable_carry_binding(&self, binding_id: &str) -> bool {
        self.program.immutable_for_groups.values().any(|plan| {
            plan.carries
                .iter()
                .any(|carry| carry.binding_id == binding_id || carry.next_binding_id == binding_id)
                || plan
                    .geometry_carries
                    .iter()
                    .any(|carry| carry.binding_id == binding_id)
                || plan
                    .collection_carries
                    .iter()
                    .any(|carry| carry.binding_id == binding_id)
                || plan
                    .geometry_collection_carries
                    .iter()
                    .any(|carry| carry.binding_id == binding_id)
        })
    }

    pub(crate) fn resolve_collection_carry_snapshot(
        &self,
        value_id: &str,
    ) -> CollectionCarrySnapshot {
        Self::resolve_collection_carry_snapshot_from(value_id, &self.collection_carry_snapshots)
    }

    fn resolve_collection_carry_snapshot_from(
        value_id: &str,
        snapshots: &HashMap<String, CollectionCarrySnapshot>,
    ) -> CollectionCarrySnapshot {
        let mut current = value_id.to_owned();
        let mut local_bindings = HashMap::new();
        let mut collection_carry_snapshots = None;
        let mut error = None;
        let mut seen = HashSet::new();
        while seen.insert(current.clone()) {
            let Some(snapshot) = snapshots.get(&current) else {
                break;
            };
            for (binding_id, value) in &snapshot.local_bindings {
                local_bindings
                    .entry(binding_id.clone())
                    .or_insert_with(|| value.clone());
            }
            if let Some(snapshot_error) = &snapshot.error {
                error = Some(snapshot_error.clone());
                collection_carry_snapshots = snapshot
                    .collection_carry_snapshots
                    .clone()
                    .or(collection_carry_snapshots);
                current = snapshot.value_id.clone();
                break;
            }
            collection_carry_snapshots = snapshot
                .collection_carry_snapshots
                .clone()
                .or(collection_carry_snapshots);
            current = snapshot.value_id.clone();
        }
        CollectionCarrySnapshot {
            value_id: current,
            local_bindings,
            collection_carry_snapshots,
            error,
        }
    }

    fn collection_carry_context(
        &self,
        value_id: &str,
        local_bindings: &HashMap<BindingId, ScalarEvaluation>,
        inherited_snapshots: Option<&Arc<HashMap<String, CollectionCarrySnapshot>>>,
    ) -> CollectionCarrySnapshot {
        let snapshot = match inherited_snapshots {
            Some(redirects) => Self::resolve_collection_carry_snapshot_from(value_id, redirects),
            None => self.resolve_collection_carry_snapshot(value_id),
        };
        let mut merged = local_bindings.clone();
        if inherited_snapshots.is_some() {
            // Entering a captured generation also enters that generation's
            // scalar closure. Its lexical bindings shadow the enclosing
            // generation when the stable binding identity is shared.
            merged.extend(snapshot.local_bindings);
        } else {
            // Preserve the established SAY-481 merge order for the current
            // traversal.
            for (binding_id, value) in snapshot.local_bindings {
                merged.entry(binding_id).or_insert(value);
            }
        }
        CollectionCarrySnapshot {
            value_id: snapshot.value_id,
            local_bindings: merged,
            collection_carry_snapshots: snapshot
                .collection_carry_snapshots
                .or_else(|| inherited_snapshots.cloned()),
            error: snapshot.error,
        }
    }

    fn collection_value_has_carry_snapshot(
        &self,
        value_id: &str,
        inherited_snapshots: Option<&Arc<HashMap<String, CollectionCarrySnapshot>>>,
    ) -> bool {
        // Record-field indexing uses a projected collection identity. Follow
        // its canonical aliases and field projection to the escaped carry.
        let snapshots = inherited_snapshots.map_or(&self.collection_carry_snapshots, Arc::as_ref);
        let mut current = value_id.to_owned();
        let mut seen = HashSet::new();
        while seen.insert(current.clone()) {
            if snapshots.contains_key(&current) {
                return true;
            }
            let Some(value) = self
                .program
                .collection_values
                .iter()
                .find(|value| value.value_id == current)
            else {
                return false;
            };
            match &value.value {
                ValidatedScalarProgramCollectionValue::Alias(target) => current = target.clone(),
                ValidatedScalarProgramCollectionValue::RecordField {
                    source_value_id, ..
                } => current = source_value_id.clone(),
                _ => return false,
            }
        }
        false
    }

    fn collection_traversal_key(
        value_id: &str,
        snapshots: Option<&Arc<HashMap<String, CollectionCarrySnapshot>>>,
    ) -> String {
        let context_id = snapshots.map_or(0, |snapshots| Arc::as_ptr(snapshots) as usize);
        format!("{context_id}:{value_id}")
    }

    pub(crate) fn history(&self) -> Vec<Value> {
        self.history.clone()
    }
    pub(super) fn record_history(&mut self, entry: Value) {
        let Some(version_id) = entry.get("versionId").and_then(Value::as_str) else {
            self.history.push(entry);
            return;
        };
        if let Some(index) = self.history.iter().position(|current| {
            current.get("versionId").and_then(Value::as_str) == Some(version_id)
        }) {
            self.history[index] = entry;
        } else {
            self.history.push(entry);
        }
    }
    fn retire_before(&mut self, source_order: usize) {
        for index in (0..self.frames.len()).rev() {
            if self.frames[index].exit_source_order >= source_order {
                continue;
            }
            for binding_id in self.frames[index].locals.clone() {
                self.current.remove(&binding_id);
            }
            self.frames.remove(index);
        }
    }
    fn inactive_control_status(&self, version: &ValidatedBindingVersion) -> Option<&'static str> {
        let Some(chain) = version.control.get("ownerChain").and_then(Value::as_array) else {
            return Some("inactive-control");
        };
        for owner in chain {
            match owner.get("kind").and_then(Value::as_str) {
                Some("forGroup") => return Some("skipped-control"),
                Some("conditionalBranch")
                    if self
                        .conditional_result(
                            owner
                                .get("ownerStatementId")
                                .and_then(Value::as_str)
                                .unwrap_or_default(),
                        )
                        .is_some_and(|result| {
                            result.as_deref() == owner.get("branch").and_then(Value::as_str)
                        }) => {}
                _ => return Some("inactive-control"),
            }
        }
        None
    }
    pub(super) fn push_loop_conditional_results(&mut self) {
        self.loop_conditional_results.push(HashMap::new());
    }
    pub(super) fn reset_loop_conditional_results(&mut self) {
        if let Some(results) = self.loop_conditional_results.last_mut() {
            results.clear();
        }
    }
    pub(super) fn pop_loop_conditional_results(&mut self) {
        self.loop_conditional_results.pop();
    }
    pub(super) fn conditional_result(&self, owner_id: &str) -> Option<&Option<String>> {
        self.loop_conditional_results
            .iter()
            .rev()
            .find_map(|results| results.get(owner_id))
            .or_else(|| self.conditional_results.get(owner_id))
    }
    fn execute(&mut self, version: &ValidatedBindingVersion, state: &EvaluationState) {
        if let Some(status) = self.inactive_control_status(version) {
            self.history.push(json!({"versionId": version.version_id, "statementId": version.statement_id, "bindingId": version.binding_id, "status": status}));
            return;
        }
        let evaluation = match (&version.initial_state, &version.kind) {
            (InitialState::Poisoned, _)
            | (_, ValidatedBindingVersionKind::Declare { initializer: None }) => {
                ScalarEvaluation::Error {
                    r#type: version.declared_type.clone(),
                    issue_code: "poisoned-binding".to_owned(),
                    binding_id: Some(version.binding_id.clone()),
                    context: None,
                }
            }
            (
                _,
                ValidatedBindingVersionKind::Declare {
                    initializer: Some(expression),
                },
            ) => self.evaluate(expression, version, state),
        };
        self.current
            .insert(version.binding_id.clone(), evaluation.clone());
        if matches!(version.kind, ValidatedBindingVersionKind::Declare { .. })
            && !version
                .control
                .get("ownerChain")
                .and_then(Value::as_array)
                .is_some_and(Vec::is_empty)
        {
            if let Some(scope_id) = version
                .control
                .get("ownerChain")
                .and_then(Value::as_array)
                .and_then(|chain| chain.last())
                .and_then(|owner| owner.get("scopeId"))
                .and_then(Value::as_str)
            {
                if let Some(frame) = self
                    .frames
                    .iter_mut()
                    .rev()
                    .find(|frame| frame.scope_id == scope_id)
                {
                    frame.locals.insert(version.binding_id.clone());
                }
            }
        }
        self.history.push(json!({"versionId": version.version_id, "statementId": version.statement_id, "bindingId": version.binding_id, "status": if matches!(evaluation, ScalarEvaluation::Error { .. }) { "poisoned" } else { "executed" }, "evaluation": scalar_evaluation_json(&evaluation)}));
    }
    pub(super) fn evaluate(
        &self,
        expression: &super::types::TypedScalarExpression,
        version: &ValidatedBindingVersion,
        state: &EvaluationState,
    ) -> ScalarEvaluation {
        let environment = MutationEnvironment {
            resolver: self,
            state,
            source_order: version.source_order as f64,
            local_binding_id: None,
            local_binding: None,
            local_bindings: None,
            record_map_context: None,
            collection_carry_snapshots: None,
            collection_traversal_seen: None,
        };
        result_for_declared_type(
            evaluate_typed_expression(expression, &environment),
            &version.declared_type,
            &version.binding_id,
        )
    }
    pub(super) fn lookup_current(&self, binding_id: &str) -> ScalarEvaluation {
        self.current
            .get(binding_id)
            .cloned()
            .unwrap_or_else(|| ScalarEvaluation::Error {
                r#type: self
                    .program
                    .declared_types
                    .get(binding_id)
                    .cloned()
                    .unwrap_or(ScalarType::Number),
                issue_code: BINDING_UNAVAILABLE.to_owned(),
                binding_id: Some(binding_id.to_owned()),
                context: None,
            })
    }

    // The recursive record projection carries scalar locals, snapshot generation,
    // and the traversal set through the same descriptor walk.
    #[allow(clippy::too_many_arguments)]
    fn resolve_record_field_with_bindings(
        &self,
        collection_value_id: &str,
        index: f64,
        field: &ValidatedScalarProgramRecordFieldIdentity,
        state: &EvaluationState,
        seen: &mut HashSet<String>,
        local_bindings: &HashMap<BindingId, ScalarEvaluation>,
        inherited_snapshots: Option<&Arc<HashMap<String, CollectionCarrySnapshot>>>,
    ) -> ScalarEvaluation {
        let context =
            self.collection_carry_context(collection_value_id, local_bindings, inherited_snapshots);
        if let Some(error) = context.error {
            return result_for_scalar_type(error, &field.r#type);
        }
        let redirected = context.value_id;
        let collection_carry_snapshots = context.collection_carry_snapshots.as_ref();
        let local_bindings = &context.local_bindings;
        if redirected != collection_value_id {
            return self.resolve_record_field_with_bindings(
                &redirected,
                index,
                field,
                state,
                seen,
                local_bindings,
                collection_carry_snapshots,
            );
        }
        let traversal_key =
            Self::collection_traversal_key(collection_value_id, collection_carry_snapshots);
        if !seen.insert(traversal_key) {
            return ScalarEvaluation::Error {
                r#type: field.r#type.clone(),
                issue_code: "evaluation-collection-index-unavailable".to_owned(),
                binding_id: None,
                context: None,
            };
        }
        let Some(value) = self
            .program
            .collection_values
            .iter()
            .find(|candidate| candidate.value_id == collection_value_id)
        else {
            return ScalarEvaluation::Error {
                r#type: field.r#type.clone(),
                issue_code: "evaluation-collection-index-unavailable".to_owned(),
                binding_id: None,
                context: None,
            };
        };
        match &value.value {
            ValidatedScalarProgramCollectionValue::Alias(target) => self
                .resolve_record_field_with_bindings(
                    target,
                    index,
                    field,
                    state,
                    seen,
                    local_bindings,
                    collection_carry_snapshots,
                ),
            ValidatedScalarProgramCollectionValue::RecordField {
                source_value_id,
                field: source_field,
                ..
            } if record_field_path_matches(
                &source_field.record_statement_id,
                source_field.field_index,
                source_field.field_path.as_deref(),
                field,
            ) =>
            {
                self.resolve_record_field_with_bindings(
                    source_value_id,
                    index,
                    field,
                    state,
                    seen,
                    local_bindings,
                    collection_carry_snapshots,
                )
            }
            ValidatedScalarProgramCollectionValue::RecordMap {
                source_value_id,
                binder_fields,
                fields,
                source_order,
                ..
            } => {
                let Some(mapped_field) = fields.iter().find(|candidate| {
                    record_field_path_matches(
                        &candidate.record_statement_id,
                        candidate.field_index,
                        candidate.field_path.as_deref(),
                        field,
                    )
                }) else {
                    return ScalarEvaluation::Error {
                        r#type: field.r#type.clone(),
                        issue_code: RUNTIME_VALUE_TYPE_MISMATCH.to_owned(),
                        binding_id: None,
                        context: None,
                    };
                };
                let record_map_context =
                    ScalarRecordMapBinderContext::new(source_value_id, index, binder_fields, seen);
                let environment = MutationEnvironment {
                    resolver: self,
                    state,
                    source_order: *source_order as f64,
                    local_binding_id: None,
                    local_binding: None,
                    local_bindings: Some(local_bindings),
                    record_map_context: Some(&record_map_context),
                    collection_carry_snapshots,
                    collection_traversal_seen: Some(seen),
                };
                result_for_declared_type(
                    evaluate_typed_expression(&mapped_field.body, &environment),
                    &mapped_field.r#type,
                    collection_value_id,
                )
            }
            ValidatedScalarProgramCollectionValue::If {
                condition,
                then_value_id,
                else_value_id,
                source_order,
            } => {
                let environment = MutationEnvironment {
                    resolver: self,
                    state,
                    source_order: *source_order,
                    local_binding_id: None,
                    local_binding: None,
                    local_bindings: Some(local_bindings),
                    record_map_context: None,
                    collection_carry_snapshots,
                    collection_traversal_seen: Some(seen),
                };
                let selected = match evaluate_typed_expression(condition, &environment) {
                    ScalarEvaluation::Ok {
                        value: ScalarValue::Boolean(true),
                        ..
                    } => then_value_id,
                    ScalarEvaluation::Ok {
                        value: ScalarValue::Boolean(false),
                        ..
                    } => else_value_id,
                    error @ ScalarEvaluation::Error { .. } => {
                        return result_for_scalar_type(error, &field.r#type);
                    }
                    _ => {
                        return ScalarEvaluation::Error {
                            r#type: field.r#type.clone(),
                            issue_code: RUNTIME_VALUE_TYPE_MISMATCH.to_owned(),
                            binding_id: None,
                            context: None,
                        };
                    }
                };
                self.resolve_record_field_with_bindings(
                    selected,
                    index,
                    field,
                    state,
                    seen,
                    local_bindings,
                    collection_carry_snapshots,
                )
            }
            ValidatedScalarProgramCollectionValue::Coalesce {
                left_value_id,
                right_value_id,
                ..
            } => {
                let left_present = match self.resolve_collection_presence_with_bindings(
                    left_value_id,
                    state,
                    &mut seen.clone(),
                    local_bindings,
                    collection_carry_snapshots,
                ) {
                    Ok(present) => present,
                    Err(error) => return result_for_scalar_type(error, &field.r#type),
                };
                let selected = match left_present {
                    Some(true) => left_value_id,
                    Some(false) => right_value_id,
                    None => {
                        return ScalarEvaluation::Error {
                            r#type: field.r#type.clone(),
                            issue_code: "evaluation-collection-index-unavailable".to_owned(),
                            binding_id: None,
                            context: None,
                        }
                    }
                };
                self.resolve_record_field_with_bindings(
                    selected,
                    index,
                    field,
                    state,
                    seen,
                    local_bindings,
                    collection_carry_snapshots,
                )
            }
            ValidatedScalarProgramCollectionValue::Match {
                scrutinee,
                arms,
                source_order,
            } => {
                let environment = MutationEnvironment {
                    resolver: self,
                    state,
                    source_order: *source_order,
                    local_binding_id: None,
                    local_binding: None,
                    local_bindings: Some(local_bindings),
                    record_map_context: None,
                    collection_carry_snapshots,
                    collection_traversal_seen: Some(seen),
                };
                let selected = match select_collection_match_arm(
                    scrutinee,
                    evaluate_typed_expression(scrutinee, &environment),
                    arms,
                ) {
                    Ok(selected) => selected,
                    Err(error) => return result_for_scalar_type(error, &field.r#type),
                };
                let mut branch_bindings = local_bindings.clone();
                if let Some((binding_id, value)) = selected.local_binding {
                    branch_bindings.insert(binding_id, value);
                }
                self.resolve_record_field_with_bindings(
                    &selected.arm.value_id,
                    index,
                    field,
                    state,
                    seen,
                    &branch_bindings,
                    collection_carry_snapshots,
                )
            }
            ValidatedScalarProgramCollectionValue::Literal(members) => {
                let Some(ValidatedScalarProgramCollectionMember::Record { fields, .. }) =
                    members.get(index as usize)
                else {
                    return ScalarEvaluation::Error {
                        r#type: field.r#type.clone(),
                        issue_code: "evaluation-collection-index-invalid".to_owned(),
                        binding_id: None,
                        context: None,
                    };
                };
                let Some(member_field) = fields.iter().find(|candidate| {
                    record_field_path_matches(
                        &candidate.record_statement_id,
                        candidate.field_index,
                        candidate.field_path.as_deref(),
                        field,
                    )
                }) else {
                    return ScalarEvaluation::Error {
                        r#type: field.r#type.clone(),
                        issue_code: RUNTIME_VALUE_TYPE_MISMATCH.to_owned(),
                        binding_id: None,
                        context: None,
                    };
                };
                result_for_declared_type(
                    local_bindings
                        .get(&member_field.binding_id)
                        .cloned()
                        .unwrap_or_else(|| self.resolve(&member_field.binding_id, state)),
                    &field.r#type,
                    &member_field.binding_id,
                )
            }
            _ => ScalarEvaluation::Error {
                r#type: field.r#type.clone(),
                issue_code: "evaluation-collection-index-unavailable".to_owned(),
                binding_id: None,
                context: None,
            },
        }
    }

    fn resolve_collection_presence_with_bindings(
        &self,
        collection_value_id: &str,
        state: &EvaluationState,
        seen: &mut HashSet<String>,
        local_bindings: &HashMap<BindingId, ScalarEvaluation>,
        inherited_snapshots: Option<&Arc<HashMap<String, CollectionCarrySnapshot>>>,
    ) -> Result<Option<bool>, ScalarEvaluation> {
        let context =
            self.collection_carry_context(collection_value_id, local_bindings, inherited_snapshots);
        if let Some(error) = context.error {
            return Err(error);
        }
        let redirected = context.value_id;
        let collection_carry_snapshots = context.collection_carry_snapshots.as_ref();
        let local_bindings = &context.local_bindings;
        if redirected != collection_value_id {
            return self.resolve_collection_presence_with_bindings(
                &redirected,
                state,
                seen,
                local_bindings,
                collection_carry_snapshots,
            );
        }
        let traversal_key =
            Self::collection_traversal_key(collection_value_id, collection_carry_snapshots);
        if !seen.insert(traversal_key) {
            return Ok(None);
        }
        let Some(value) = self
            .program
            .collection_values
            .iter()
            .find(|candidate| candidate.value_id == collection_value_id)
        else {
            return Ok(lookup_geometry_collection_presence(
                state,
                self,
                collection_value_id,
                &mut HashSet::new(),
            ));
        };
        match &value.value {
            ValidatedScalarProgramCollectionValue::None => Ok(Some(false)),
            ValidatedScalarProgramCollectionValue::Literal(_) => Ok(Some(true)),
            ValidatedScalarProgramCollectionValue::Alias(target) => self
                .resolve_collection_presence_with_bindings(
                    target,
                    state,
                    seen,
                    local_bindings,
                    collection_carry_snapshots,
                ),
            ValidatedScalarProgramCollectionValue::Map {
                source_value_id, ..
            }
            | ValidatedScalarProgramCollectionValue::RecordMap {
                source_value_id, ..
            }
            | ValidatedScalarProgramCollectionValue::RecordField {
                source_value_id, ..
            } => self.resolve_collection_presence_with_bindings(
                source_value_id,
                state,
                seen,
                local_bindings,
                collection_carry_snapshots,
            ),
            ValidatedScalarProgramCollectionValue::If {
                condition,
                then_value_id,
                else_value_id,
                source_order,
            } => {
                let environment = MutationEnvironment {
                    resolver: self,
                    state,
                    source_order: *source_order,
                    local_binding_id: None,
                    local_binding: None,
                    local_bindings: Some(local_bindings),
                    record_map_context: None,
                    collection_carry_snapshots,
                    collection_traversal_seen: Some(seen),
                };
                match evaluate_typed_expression(condition, &environment) {
                    ScalarEvaluation::Ok {
                        value: ScalarValue::Boolean(value),
                        ..
                    } => self.resolve_collection_presence_with_bindings(
                        if value { then_value_id } else { else_value_id },
                        state,
                        seen,
                        local_bindings,
                        collection_carry_snapshots,
                    ),
                    error @ ScalarEvaluation::Error { .. } => Err(error),
                    _ => Err(ScalarEvaluation::Error {
                        r#type: ScalarType::Boolean,
                        issue_code: RUNTIME_VALUE_TYPE_MISMATCH.to_owned(),
                        binding_id: None,
                        context: None,
                    }),
                }
            }
            ValidatedScalarProgramCollectionValue::Match {
                scrutinee,
                arms,
                source_order,
            } => {
                let environment = MutationEnvironment {
                    resolver: self,
                    state,
                    source_order: *source_order,
                    local_binding_id: None,
                    local_binding: None,
                    local_bindings: Some(local_bindings),
                    record_map_context: None,
                    collection_carry_snapshots,
                    collection_traversal_seen: Some(seen),
                };
                let selected = select_collection_match_arm(
                    scrutinee,
                    evaluate_typed_expression(scrutinee, &environment),
                    arms,
                )?;
                let mut branch_bindings = local_bindings.clone();
                if let Some((binding_id, value)) = selected.local_binding {
                    branch_bindings.insert(binding_id, value);
                }
                self.resolve_collection_presence_with_bindings(
                    &selected.arm.value_id,
                    state,
                    seen,
                    &branch_bindings,
                    collection_carry_snapshots,
                )
            }
            ValidatedScalarProgramCollectionValue::Coalesce {
                left_value_id,
                right_value_id,
                ..
            } => match self.resolve_collection_presence_with_bindings(
                left_value_id,
                state,
                &mut seen.clone(),
                local_bindings,
                collection_carry_snapshots,
            )? {
                Some(true) => Ok(Some(true)),
                Some(false) => self.resolve_collection_presence_with_bindings(
                    right_value_id,
                    state,
                    seen,
                    local_bindings,
                    collection_carry_snapshots,
                ),
                None => Ok(None),
            },
        }
    }

    fn resolve_collection_index(
        &self,
        collection_value_id: &str,
        index: f64,
        element_type: &ScalarType,
        collection_length: Option<f64>,
        _target_source_order: f64,
        state: &EvaluationState,
    ) -> ScalarEvaluation {
        self.resolve_collection_index_with_bindings(
            collection_value_id,
            index,
            element_type,
            collection_length,
            state,
            &HashMap::new(),
            None,
        )
    }

    // Keep the existing collection-index entry point explicit about its runtime context.
    #[allow(clippy::too_many_arguments)]
    fn resolve_collection_index_with_bindings(
        &self,
        collection_value_id: &str,
        index: f64,
        element_type: &ScalarType,
        collection_length: Option<f64>,
        state: &EvaluationState,
        local_bindings: &HashMap<BindingId, ScalarEvaluation>,
        inherited_snapshots: Option<&Arc<HashMap<String, CollectionCarrySnapshot>>>,
    ) -> ScalarEvaluation {
        let mut seen = HashSet::new();
        self.resolve_collection_index_with_seen(
            collection_value_id,
            index,
            element_type,
            collection_length,
            state,
            local_bindings,
            inherited_snapshots,
            &mut seen,
        )
    }

    // The recursive index walk needs the incoming locals, snapshot generation,
    // and shared cycle set together.
    #[allow(clippy::too_many_arguments)]
    fn resolve_collection_index_with_seen(
        &self,
        collection_value_id: &str,
        index: f64,
        element_type: &ScalarType,
        collection_length: Option<f64>,
        state: &EvaluationState,
        local_bindings: &HashMap<BindingId, ScalarEvaluation>,
        inherited_snapshots: Option<&Arc<HashMap<String, CollectionCarrySnapshot>>>,
        seen: &mut HashSet<String>,
    ) -> ScalarEvaluation {
        if !index.is_finite()
            || index.fract() != 0.0
            || index < 0.0
            || collection_length.is_some_and(|length| index >= length)
        {
            return ScalarEvaluation::Error {
                r#type: element_type.clone(),
                issue_code: "evaluation-collection-index-invalid".to_owned(),
                binding_id: None,
                context: None,
            };
        }
        let mut current = collection_value_id.to_owned();
        let mut carried_local_bindings = local_bindings.clone();
        let mut carried_collection_snapshots = inherited_snapshots.cloned();
        let member = loop {
            let context = self.collection_carry_context(
                &current,
                &carried_local_bindings,
                carried_collection_snapshots.as_ref(),
            );
            if let Some(error) = context.error {
                return result_for_scalar_type(error, element_type);
            }
            let redirected = context.value_id;
            carried_collection_snapshots = context.collection_carry_snapshots;
            if redirected != current {
                current = redirected;
                carried_local_bindings = context.local_bindings;
                continue;
            }
            carried_local_bindings = context.local_bindings;
            let local_bindings = &carried_local_bindings;
            let traversal_key =
                Self::collection_traversal_key(&current, carried_collection_snapshots.as_ref());
            if !seen.insert(traversal_key) {
                return ScalarEvaluation::Error {
                    r#type: element_type.clone(),
                    issue_code: "evaluation-collection-index-unavailable".to_owned(),
                    binding_id: None,
                    context: None,
                };
            }
            let Some(value) = self
                .program
                .collection_values
                .iter()
                .find(|value| value.value_id == current)
            else {
                return ScalarEvaluation::Error {
                    r#type: element_type.clone(),
                    issue_code: "evaluation-collection-index-unavailable".to_owned(),
                    binding_id: None,
                    context: None,
                };
            };
            match &value.value {
                ValidatedScalarProgramCollectionValue::None => {
                    return ScalarEvaluation::Error {
                        r#type: element_type.clone(),
                        issue_code: "evaluation-collection-index-unavailable".to_owned(),
                        binding_id: None,
                        context: None,
                    };
                }
                ValidatedScalarProgramCollectionValue::Alias(target) => current = target.clone(),
                ValidatedScalarProgramCollectionValue::Literal(members) => {
                    break members.get(index as usize)
                }
                ValidatedScalarProgramCollectionValue::Map {
                    source_value_id,
                    source_element_type,
                    result_element_type,
                    binder_id,
                    body,
                    source_order,
                } => {
                    let source = self.resolve_collection_index_with_seen(
                        source_value_id,
                        index,
                        source_element_type,
                        None,
                        state,
                        local_bindings,
                        carried_collection_snapshots.as_ref(),
                        seen,
                    );
                    if matches!(source, ScalarEvaluation::Error { .. }) {
                        return source;
                    }
                    let mut map_bindings = local_bindings.clone();
                    map_bindings.insert(binder_id.clone(), source.clone());
                    let environment = MutationEnvironment {
                        resolver: self,
                        state,
                        source_order: *source_order as f64,
                        local_binding_id: None,
                        local_binding: None,
                        local_bindings: Some(&map_bindings),
                        record_map_context: None,
                        collection_carry_snapshots: carried_collection_snapshots.as_ref(),
                        collection_traversal_seen: Some(seen),
                    };
                    let mapped = evaluate_typed_expression(body, &environment);
                    return match mapped {
                        ScalarEvaluation::Ok { r#type, value }
                            if r#type == *result_element_type
                                && scalar_value_matches_type(&r#type, &value) =>
                        {
                            ScalarEvaluation::Ok { r#type, value }
                        }
                        ScalarEvaluation::Ok { .. } => ScalarEvaluation::Error {
                            r#type: result_element_type.clone(),
                            issue_code: RUNTIME_VALUE_TYPE_MISMATCH.to_owned(),
                            binding_id: None,
                            context: None,
                        },
                        error @ ScalarEvaluation::Error { .. } => error,
                    };
                }
                ValidatedScalarProgramCollectionValue::RecordField {
                    source_value_id,
                    field,
                    ..
                } => {
                    return self.resolve_record_field_with_bindings(
                        source_value_id,
                        index,
                        field,
                        state,
                        &mut HashSet::new(),
                        local_bindings,
                        carried_collection_snapshots.as_ref(),
                    );
                }
                ValidatedScalarProgramCollectionValue::RecordMap { .. } => {
                    return ScalarEvaluation::Error {
                        r#type: element_type.clone(),
                        issue_code: "evaluation-collection-index-unavailable".to_owned(),
                        binding_id: None,
                        context: None,
                    };
                }
                ValidatedScalarProgramCollectionValue::If {
                    condition,
                    then_value_id,
                    else_value_id,
                    source_order,
                } => {
                    let environment = MutationEnvironment {
                        resolver: self,
                        state,
                        source_order: *source_order,
                        local_binding_id: None,
                        local_binding: None,
                        local_bindings: Some(local_bindings),
                        record_map_context: None,
                        collection_carry_snapshots: carried_collection_snapshots.as_ref(),
                        collection_traversal_seen: Some(seen),
                    };
                    let condition = evaluate_typed_expression(condition, &environment);
                    let selected = match condition {
                        ScalarEvaluation::Ok {
                            r#type: ScalarType::Boolean,
                            value: ScalarValue::Boolean(value),
                        } => {
                            if value {
                                then_value_id
                            } else {
                                else_value_id
                            }
                        }
                        error @ ScalarEvaluation::Error { .. } => {
                            return result_for_scalar_type(error, element_type);
                        }
                        _ => {
                            return ScalarEvaluation::Error {
                                r#type: element_type.clone(),
                                issue_code: RUNTIME_VALUE_TYPE_MISMATCH.to_owned(),
                                binding_id: None,
                                context: None,
                            };
                        }
                    };
                    return self.resolve_collection_index_with_seen(
                        selected,
                        index,
                        element_type,
                        None,
                        state,
                        local_bindings,
                        carried_collection_snapshots.as_ref(),
                        seen,
                    );
                }
                ValidatedScalarProgramCollectionValue::Match {
                    scrutinee,
                    arms,
                    source_order,
                } => {
                    let environment = MutationEnvironment {
                        resolver: self,
                        state,
                        source_order: *source_order,
                        local_binding_id: None,
                        local_binding: None,
                        local_bindings: Some(local_bindings),
                        record_map_context: None,
                        collection_carry_snapshots: carried_collection_snapshots.as_ref(),
                        collection_traversal_seen: Some(seen),
                    };
                    let selected = match select_collection_match_arm(
                        scrutinee,
                        evaluate_typed_expression(scrutinee, &environment),
                        arms,
                    ) {
                        Ok(selected) => selected,
                        Err(error) => return result_for_scalar_type(error, element_type),
                    };
                    let mut branch_bindings = local_bindings.clone();
                    if let Some((binding_id, value)) = selected.local_binding {
                        branch_bindings.insert(binding_id, value);
                    }
                    return self.resolve_collection_index_with_seen(
                        &selected.arm.value_id,
                        index,
                        element_type,
                        None,
                        state,
                        &branch_bindings,
                        carried_collection_snapshots.as_ref(),
                        seen,
                    );
                }
                ValidatedScalarProgramCollectionValue::Coalesce {
                    left_value_id,
                    right_value_id,
                    ..
                } => {
                    let left_present = match self.resolve_collection_presence_with_bindings(
                        left_value_id,
                        state,
                        &mut seen.clone(),
                        local_bindings,
                        carried_collection_snapshots.as_ref(),
                    ) {
                        Ok(present) => present,
                        Err(error) => return result_for_scalar_type(error, element_type),
                    };
                    let selected = match left_present {
                        Some(true) => left_value_id,
                        Some(false) => right_value_id,
                        None => {
                            return ScalarEvaluation::Error {
                                r#type: element_type.clone(),
                                issue_code: "evaluation-collection-index-unavailable".to_owned(),
                                binding_id: None,
                                context: None,
                            };
                        }
                    };
                    return self.resolve_collection_index_with_seen(
                        selected,
                        index,
                        element_type,
                        None,
                        state,
                        local_bindings,
                        carried_collection_snapshots.as_ref(),
                        seen,
                    );
                }
            }
        };
        let Some(member) = member else {
            return ScalarEvaluation::Error {
                r#type: element_type.clone(),
                issue_code: "evaluation-collection-index-invalid".to_owned(),
                binding_id: None,
                context: None,
            };
        };
        let result = match member {
            ValidatedScalarProgramCollectionMember::Literal { r#type, value } => {
                ScalarEvaluation::Ok {
                    r#type: r#type.clone(),
                    value: value.clone(),
                }
            }
            ValidatedScalarProgramCollectionMember::Binding { r#type, binding_id } => {
                if r#type != element_type {
                    return ScalarEvaluation::Error {
                        r#type: element_type.clone(),
                        issue_code: RUNTIME_VALUE_TYPE_MISMATCH.to_owned(),
                        binding_id: None,
                        context: None,
                    };
                }
                carried_local_bindings
                    .get(binding_id)
                    .cloned()
                    .unwrap_or_else(|| self.resolve(binding_id, state))
            }
            ValidatedScalarProgramCollectionMember::Record { .. } => {
                return ScalarEvaluation::Error {
                    r#type: element_type.clone(),
                    issue_code: "evaluation-collection-index-unavailable".to_owned(),
                    binding_id: None,
                    context: None,
                };
            }
        };
        match result {
            ScalarEvaluation::Ok {
                r#type: result_type,
                value,
            } if result_type == *element_type
                && scalar_value_matches_type(&result_type, &value) =>
            {
                ScalarEvaluation::Ok {
                    r#type: result_type,
                    value,
                }
            }
            ScalarEvaluation::Ok { .. } => ScalarEvaluation::Error {
                r#type: element_type.clone(),
                issue_code: RUNTIME_VALUE_TYPE_MISMATCH.to_owned(),
                binding_id: None,
                context: None,
            },
            error @ ScalarEvaluation::Error { .. } => error,
        }
    }

    fn resolve_collection_length(
        &self,
        collection_value_id: &str,
        state: &EvaluationState,
        seen: &mut HashSet<String>,
    ) -> Option<f64> {
        self.resolve_collection_length_with_bindings(
            collection_value_id,
            state,
            seen,
            &HashMap::new(),
            None,
        )
        .ok()
        .flatten()
    }

    fn resolve_collection_length_with_bindings(
        &self,
        collection_value_id: &str,
        state: &EvaluationState,
        seen: &mut HashSet<String>,
        local_bindings: &HashMap<BindingId, ScalarEvaluation>,
        inherited_snapshots: Option<&Arc<HashMap<String, CollectionCarrySnapshot>>>,
    ) -> Result<Option<f64>, ScalarEvaluation> {
        let context =
            self.collection_carry_context(collection_value_id, local_bindings, inherited_snapshots);
        if let Some(error) = context.error {
            return Err(error);
        }
        let redirected = context.value_id;
        let collection_carry_snapshots = context.collection_carry_snapshots.as_ref();
        let local_bindings = &context.local_bindings;
        if redirected != collection_value_id {
            return self.resolve_collection_length_with_bindings(
                &redirected,
                state,
                seen,
                local_bindings,
                collection_carry_snapshots,
            );
        }
        let Some(value) = self
            .program
            .collection_values
            .iter()
            .find(|candidate| candidate.value_id == collection_value_id)
        else {
            return Ok(lookup_geometry_collection_length(
                state,
                self,
                collection_value_id,
                seen,
            ));
        };
        let traversal_key =
            Self::collection_traversal_key(collection_value_id, collection_carry_snapshots);
        if !seen.insert(traversal_key.clone()) {
            return Ok(None);
        }
        let result = match &value.value {
            ValidatedScalarProgramCollectionValue::None => Ok(None),
            ValidatedScalarProgramCollectionValue::Alias(target) => self
                .resolve_collection_length_with_bindings(
                    target,
                    state,
                    seen,
                    local_bindings,
                    collection_carry_snapshots,
                ),
            ValidatedScalarProgramCollectionValue::Literal(members) => {
                Ok(Some(members.len() as f64))
            }
            ValidatedScalarProgramCollectionValue::Map {
                source_value_id, ..
            } => self.resolve_collection_length_with_bindings(
                source_value_id,
                state,
                seen,
                local_bindings,
                collection_carry_snapshots,
            ),
            ValidatedScalarProgramCollectionValue::RecordMap {
                source_value_id, ..
            }
            | ValidatedScalarProgramCollectionValue::RecordField {
                source_value_id, ..
            } => self.resolve_collection_length_with_bindings(
                source_value_id,
                state,
                seen,
                local_bindings,
                collection_carry_snapshots,
            ),
            ValidatedScalarProgramCollectionValue::If {
                condition,
                then_value_id,
                else_value_id,
                source_order,
            } => {
                let environment = MutationEnvironment {
                    resolver: self,
                    state,
                    source_order: *source_order,
                    local_binding_id: None,
                    local_binding: None,
                    local_bindings: Some(local_bindings),
                    record_map_context: None,
                    collection_carry_snapshots,
                    collection_traversal_seen: Some(seen),
                };
                match evaluate_typed_expression(condition, &environment) {
                    ScalarEvaluation::Ok {
                        r#type: ScalarType::Boolean,
                        value: ScalarValue::Boolean(selected),
                    } => self.resolve_collection_length_with_bindings(
                        if selected {
                            then_value_id
                        } else {
                            else_value_id
                        },
                        state,
                        seen,
                        local_bindings,
                        collection_carry_snapshots,
                    ),
                    error @ ScalarEvaluation::Error { .. } => Err(error),
                    _ => Err(ScalarEvaluation::Error {
                        r#type: ScalarType::Boolean,
                        issue_code: RUNTIME_VALUE_TYPE_MISMATCH.to_owned(),
                        binding_id: None,
                        context: None,
                    }),
                }
            }
            ValidatedScalarProgramCollectionValue::Match {
                scrutinee,
                arms,
                source_order,
            } => {
                let environment = MutationEnvironment {
                    resolver: self,
                    state,
                    source_order: *source_order,
                    local_binding_id: None,
                    local_binding: None,
                    local_bindings: Some(local_bindings),
                    record_map_context: None,
                    collection_carry_snapshots,
                    collection_traversal_seen: Some(seen),
                };
                let selected = select_collection_match_arm(
                    scrutinee,
                    evaluate_typed_expression(scrutinee, &environment),
                    arms,
                )
                .map_err(|error| result_for_scalar_type(error, &ScalarType::Number))?;
                let mut branch_bindings = local_bindings.clone();
                if let Some((binding_id, value)) = selected.local_binding {
                    branch_bindings.insert(binding_id, value);
                }
                self.resolve_collection_length_with_bindings(
                    &selected.arm.value_id,
                    state,
                    seen,
                    &branch_bindings,
                    collection_carry_snapshots,
                )
            }
            ValidatedScalarProgramCollectionValue::Coalesce {
                left_value_id,
                right_value_id,
                ..
            } => {
                let left_present = self.resolve_collection_presence_with_bindings(
                    left_value_id,
                    state,
                    &mut seen.clone(),
                    local_bindings,
                    collection_carry_snapshots,
                )?;
                match left_present {
                    Some(true) => self.resolve_collection_length_with_bindings(
                        left_value_id,
                        state,
                        seen,
                        local_bindings,
                        collection_carry_snapshots,
                    ),
                    Some(false) => self.resolve_collection_length_with_bindings(
                        right_value_id,
                        state,
                        seen,
                        local_bindings,
                        collection_carry_snapshots,
                    ),
                    None => Ok(None),
                }
            }
        };
        seen.remove(&traversal_key);
        result
    }
}
struct MutationEnvironment<'a, 'b, 'c> {
    resolver: &'a ScalarMutationResolver<'a>,
    state: &'b EvaluationState,
    source_order: f64,
    local_binding_id: Option<&'c str>,
    local_binding: Option<&'c ScalarEvaluation>,
    local_bindings: Option<&'c HashMap<BindingId, ScalarEvaluation>>,
    record_map_context: Option<&'c ScalarRecordMapBinderContext>,
    collection_carry_snapshots: Option<&'c Arc<HashMap<String, CollectionCarrySnapshot>>>,
    collection_traversal_seen: Option<&'c HashSet<String>>,
}
impl ScalarEvaluationEnvironment for MutationEnvironment<'_, '_, '_> {
    fn lookup_binding(&self, binding_id: &str) -> ScalarEvaluation {
        if let Some(context) = self.record_map_context {
            if let Some(binder_field) = context
                .binder_fields
                .iter()
                .find(|field| field.binding_id == binding_id)
            {
                let field = ValidatedScalarProgramRecordFieldIdentity {
                    record_statement_id: binder_field.record_statement_id.clone(),
                    field_index: binder_field.field_index,
                    r#type: binder_field.r#type.clone(),
                    field_path: binder_field.field_path.clone(),
                };
                let mut seen = context.seen.clone();
                let empty_bindings = HashMap::new();
                return self.resolver.resolve_record_field_with_bindings(
                    &context.source_value_id,
                    context.index,
                    &field,
                    self.state,
                    &mut seen,
                    self.local_bindings.unwrap_or(&empty_bindings),
                    self.collection_carry_snapshots,
                );
            }
        }
        if let Some(local_bindings) = self.local_bindings {
            if let Some(value) = local_bindings.get(binding_id) {
                return value.clone();
            }
        }
        if self.local_binding_id == Some(binding_id) {
            if let Some(value) = self.local_binding {
                return value.clone();
            }
        }
        self.resolver.resolve(binding_id, self.state)
    }
    fn lookup_geometry_property(
        &self,
        element_id: &str,
        property: &str,
        target_source_order: f64,
        property_type: &ScalarType,
    ) -> ScalarEvaluation {
        lookup_geometry_property(
            self.state,
            element_id,
            property,
            target_source_order,
            Some(self.source_order),
            property_type,
        )
    }

    fn lookup_geometry_property_at_stage(
        &self,
        element_id: &str,
        stage_path: Option<&[String]>,
        property: &str,
        target_source_order: f64,
        property_type: &ScalarType,
    ) -> ScalarEvaluation {
        lookup_geometry_property_at_stage(
            self.state,
            element_id,
            stage_path,
            property,
            target_source_order,
            Some(self.source_order),
            property_type,
        )
    }

    fn lookup_geometry_value_property(
        &self,
        occurrence: &super::super::types::GeometryValueOccurrence,
        point_key: Option<&str>,
        property: &str,
        target_source_order: f64,
        property_type: &ScalarType,
    ) -> ScalarEvaluation {
        lookup_geometry_value_property(
            self.state,
            occurrence,
            point_key,
            property,
            target_source_order,
            Some(self.source_order),
            property_type,
        )
    }

    fn lookup_geometry_value_binder_property(
        &self,
        binder_id: &str,
        point_key: Option<&str>,
        property: &str,
        target_source_order: f64,
        property_type: &ScalarType,
    ) -> ScalarEvaluation {
        lookup_geometry_value_binder_property(
            self.state,
            binder_id,
            point_key,
            property,
            target_source_order,
            Some(self.source_order),
            property_type,
        )
    }

    fn lookup_for_group_geometry_property(
        &self,
        template_element_id: &str,
        index: Option<&super::types::TypedScalarExpression>,
        point_key: Option<&str>,
        stage_path: Option<&[String]>,
        property: &str,
        target_source_order: f64,
        property_type: &ScalarType,
    ) -> ScalarEvaluation {
        lookup_for_group_geometry_property(
            self.state,
            self.resolver,
            ForGroupGeometryPropertyRequest {
                template_element_id,
                index,
                point_key,
                stage_path,
                property,
                target_source_order,
                current_source_order: Some(self.source_order),
                property_type,
            },
        )
    }

    fn lookup_geometry_builtin_target(
        &self,
        target: &super::types::ScalarExpressionResolvedGeometryTarget,
    ) -> Result<
        super::geometry_builtin_runtime::GeometryBuiltinRuntimeTarget,
        super::geometry_builtin_runtime::GeometryBuiltinRuntimeError,
    > {
        resolve_for_group_geometry_builtin_target(
            self.state,
            self.resolver,
            self.source_order,
            target,
        )
    }

    fn lookup_collection_index(
        &self,
        collection_value_id: &str,
        index: f64,
        element_type: &ScalarType,
        collection_length: Option<f64>,
        target_source_order: f64,
    ) -> ScalarEvaluation {
        let has_carry_snapshot = self.resolver.collection_value_has_carry_snapshot(
            collection_value_id,
            self.collection_carry_snapshots,
        );
        // Keep the source-order fence unless this resolved value has a carry
        // snapshot proving that the statement-for value already escaped.
        if target_source_order >= self.source_order && !has_carry_snapshot {
            return ScalarEvaluation::Error {
                r#type: element_type.clone(),
                issue_code: "evaluation-collection-index-unavailable".to_owned(),
                binding_id: None,
                context: None,
            };
        }
        let empty_bindings = HashMap::new();
        let mut seen = self.collection_traversal_seen.cloned().unwrap_or_default();
        self.resolver.resolve_collection_index_with_seen(
            collection_value_id,
            index,
            element_type,
            collection_length,
            self.state,
            self.local_bindings.unwrap_or(&empty_bindings),
            self.collection_carry_snapshots,
            &mut seen,
        )
    }

    fn lookup_collection_length(&self, collection_value_id: &str) -> Option<f64> {
        let empty_bindings = HashMap::new();
        let mut seen = self.collection_traversal_seen.cloned().unwrap_or_default();
        self.resolver
            .resolve_collection_length_with_bindings(
                collection_value_id,
                self.state,
                &mut seen,
                self.local_bindings.unwrap_or(&empty_bindings),
                self.collection_carry_snapshots,
            )
            .ok()
            .flatten()
    }

    fn lookup_collection_length_evaluation(
        &self,
        collection_value_id: &str,
    ) -> Result<Option<f64>, ScalarEvaluation> {
        let empty_bindings = HashMap::new();
        let mut seen = self.collection_traversal_seen.cloned().unwrap_or_default();
        self.resolver.resolve_collection_length_with_bindings(
            collection_value_id,
            self.state,
            &mut seen,
            self.local_bindings.unwrap_or(&empty_bindings),
            self.collection_carry_snapshots,
        )
    }

    fn lookup_optional_member(
        &self,
        target: &ScalarExpressionResolvedOptionalMemberTarget,
        r#type: &ScalarType,
    ) -> ScalarEvaluation {
        match target {
            ScalarExpressionResolvedOptionalMemberTarget::CollectionLength {
                target_source_order,
                ..
            }
            | ScalarExpressionResolvedOptionalMemberTarget::RecordField {
                target_source_order,
                ..
            } => {
                if *target_source_order > self.source_order {
                    return ScalarEvaluation::Error {
                        r#type: r#type.clone(),
                        issue_code: "evaluation-collection-index-unavailable".to_owned(),
                        binding_id: None,
                        context: None,
                    };
                }
                let empty_bindings = HashMap::new();
                let traversal_seen = self.collection_traversal_seen.cloned().unwrap_or_default();
                self.resolver
                    .resolve_optional_collection_member_with_bindings(
                        target,
                        r#type,
                        self.state,
                        self.local_bindings.unwrap_or(&empty_bindings),
                        self.collection_carry_snapshots,
                        Some(&traversal_seen),
                    )
            }
            ScalarExpressionResolvedOptionalMemberTarget::GeometryProperty { .. } => {
                lookup_optional_geometry_property(
                    self.state,
                    self.resolver,
                    target,
                    r#type,
                    Some(self.source_order),
                )
            }
        }
    }
}

impl ScalarMutationResolver<'_> {
    fn resolve_optional_collection_member_with_bindings(
        &self,
        target: &ScalarExpressionResolvedOptionalMemberTarget,
        r#type: &ScalarType,
        state: &EvaluationState,
        local_bindings: &HashMap<BindingId, ScalarEvaluation>,
        collection_carry_snapshots: Option<&Arc<HashMap<String, CollectionCarrySnapshot>>>,
        traversal_seen: Option<&HashSet<String>>,
    ) -> ScalarEvaluation {
        let none = || ScalarEvaluation::Ok {
            r#type: r#type.clone(),
            value: ScalarValue::None,
        };
        match target {
            ScalarExpressionResolvedOptionalMemberTarget::CollectionLength {
                collection_value_id,
                ..
            } => {
                let mut seen = traversal_seen.cloned().unwrap_or_default();
                match self.resolve_collection_presence_with_bindings(
                    collection_value_id,
                    state,
                    &mut seen,
                    local_bindings,
                    collection_carry_snapshots,
                ) {
                    Ok(Some(false)) => none(),
                    Ok(Some(true)) => {
                        let mut seen = traversal_seen.cloned().unwrap_or_default();
                        match self.resolve_collection_length_with_bindings(
                            collection_value_id,
                            state,
                            &mut seen,
                            local_bindings,
                            collection_carry_snapshots,
                        ) {
                            Ok(Some(length)) => ScalarEvaluation::Ok {
                                r#type: r#type.clone(),
                                value: ScalarValue::Number(length),
                            },
                            Ok(None) => ScalarEvaluation::Error {
                                r#type: r#type.clone(),
                                issue_code: "evaluation-collection-property-unavailable".to_owned(),
                                binding_id: None,
                                context: None,
                            },
                            Err(error) => result_for_scalar_type(error, r#type),
                        }
                    }
                    Ok(None) => ScalarEvaluation::Error {
                        r#type: r#type.clone(),
                        issue_code: "evaluation-collection-property-unavailable".to_owned(),
                        binding_id: None,
                        context: None,
                    },
                    Err(error) => result_for_scalar_type(error, r#type),
                }
            }
            ScalarExpressionResolvedOptionalMemberTarget::RecordField {
                collection_value_id,
                collection_length: _,
                field,
                ..
            } => {
                let mut seen = traversal_seen.cloned().unwrap_or_default();
                match self.resolve_collection_presence_with_bindings(
                    collection_value_id,
                    state,
                    &mut seen,
                    local_bindings,
                    collection_carry_snapshots,
                ) {
                    Ok(Some(false)) => none(),
                    Ok(Some(true)) => {
                        let field = ValidatedScalarProgramRecordFieldIdentity {
                        record_statement_id: field.record_statement_id.clone(),
                        field_index: field.field_index,
                        r#type: field.r#type.clone(),
                        field_path: (!field.field_path.is_empty()).then(|| {
                            field
                                .field_path
                                .iter()
                                .map(|(statement_id, field_index)| {
                                    super::program_payload::ValidatedScalarProgramRecordFieldPathEntry {
                                        record_statement_id: statement_id.clone(),
                                        field_index: *field_index,
                                    }
                                })
                                .collect()
                        }),
                    };
                        let mut seen = traversal_seen.cloned().unwrap_or_default();
                        match self.resolve_record_field_with_bindings(
                            collection_value_id,
                            0.0,
                            &field,
                            state,
                            &mut seen,
                            local_bindings,
                            collection_carry_snapshots,
                        ) {
                            ScalarEvaluation::Ok { value, .. }
                                if scalar_value_matches_type(r#type, &value) =>
                            {
                                ScalarEvaluation::Ok {
                                    r#type: r#type.clone(),
                                    value,
                                }
                            }
                            ScalarEvaluation::Ok { .. } => ScalarEvaluation::Error {
                                r#type: r#type.clone(),
                                issue_code: RUNTIME_VALUE_TYPE_MISMATCH.to_owned(),
                                binding_id: None,
                                context: None,
                            },
                            ScalarEvaluation::Error { issue_code, .. } => ScalarEvaluation::Error {
                                r#type: r#type.clone(),
                                issue_code,
                                binding_id: None,
                                context: None,
                            },
                        }
                    }
                    Ok(None) => ScalarEvaluation::Error {
                        r#type: r#type.clone(),
                        issue_code: "evaluation-collection-index-unavailable".to_owned(),
                        binding_id: None,
                        context: None,
                    },
                    Err(error) => result_for_scalar_type(error, r#type),
                }
            }
            ScalarExpressionResolvedOptionalMemberTarget::GeometryProperty { .. } => {
                ScalarEvaluation::Error {
                    r#type: r#type.clone(),
                    issue_code: "evaluation-optional-member-unavailable".to_owned(),
                    binding_id: None,
                    context: None,
                }
            }
        }
    }
}

#[cfg(test)]
#[path = "mutation_tests.rs"]
mod tests;
impl ScalarDocumentBindingResolver for ScalarMutationResolver<'_> {
    fn resolve_binding(&self, binding_id: &str, state: &EvaluationState) -> ScalarEvaluation {
        self.resolve(binding_id, state)
    }

    fn resolve_collection_index(
        &self,
        collection_value_id: &str,
        index: f64,
        element_type: &ScalarType,
        collection_length: Option<f64>,
        target_source_order: f64,
        state: &EvaluationState,
    ) -> ScalarEvaluation {
        self.resolve_collection_index(
            collection_value_id,
            index,
            element_type,
            collection_length,
            target_source_order,
            state,
        )
    }

    fn resolve_collection_length(
        &self,
        collection_value_id: &str,
        state: &EvaluationState,
        seen: &mut HashSet<String>,
    ) -> Option<f64> {
        self.resolve_collection_length(collection_value_id, state, seen)
    }

    fn resolve_collection_length_evaluation(
        &self,
        collection_value_id: &str,
        state: &EvaluationState,
        seen: &mut HashSet<String>,
    ) -> Result<Option<f64>, ScalarEvaluation> {
        self.resolve_collection_length_with_bindings(
            collection_value_id,
            state,
            seen,
            &HashMap::new(),
            None,
        )
    }

    fn resolve_optional_collection_member(
        &self,
        target: &ScalarExpressionResolvedOptionalMemberTarget,
        r#type: &ScalarType,
        state: &EvaluationState,
    ) -> ScalarEvaluation {
        self.resolve_optional_collection_member_with_bindings(
            target,
            r#type,
            state,
            &HashMap::new(),
            None,
            None,
        )
    }
}
