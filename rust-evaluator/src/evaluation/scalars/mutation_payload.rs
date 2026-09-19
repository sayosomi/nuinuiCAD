//! Fail-closed Task 32 decoder for Task 30's already-resolved binding-version
//! graph. This boundary never parses source, resolves names, or creates IDs.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use super::expression_payload::validate_typed_expression_payload;
use super::expression_shape_payload::decode_geometry_target_payload;
use super::issue::{ScalarPayloadIssue, ScalarPayloadIssueCode as Code};
use super::json_helpers::{as_object, issue, reject_unexpected_fields, require_field};
use super::program_payload::{
    decode_collection_values, ValidatedScalarProgramCollection,
    ValidatedScalarProgramCollectionMember,
};
use super::scalar_payload::{decode_scalar_type, scalar_type_assignable};
use super::types::{BindingId, ScalarType, TypedBuiltinArgument, TypedScalarExpression};
use crate::evaluation::line_geometry_input::decode_collection_node;
use crate::evaluation::types::{GeometryInputCollectionNode, GeometryInputTarget};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum InitialState {
    Uncomputed,
    Poisoned,
}

#[derive(Debug)]
pub(crate) enum ValidatedBindingVersionKind {
    Declare {
        initializer: Option<TypedScalarExpression>,
    },
}

#[derive(Debug)]
pub(crate) struct ValidatedBindingVersion {
    pub(crate) version_id: String,
    pub(crate) statement_id: String,
    pub(crate) binding_id: BindingId,
    pub(crate) declared_type: ScalarType,
    pub(crate) source_order: usize,
    pub(crate) control: Value,
    pub(crate) initial_state: InitialState,
    pub(crate) kind: ValidatedBindingVersionKind,
}

#[derive(Debug)]
pub(crate) struct ValidatedBindingVersions {
    pub(crate) versions: Vec<ValidatedBindingVersion>,
    pub(crate) binding_ids: HashSet<BindingId>,
    pub(crate) declared_types: HashMap<BindingId, ScalarType>,
    pub(crate) element_source_orders: HashMap<String, usize>,
    pub(crate) conditional_owners_by_element_id: HashMap<String, String>,
    pub(crate) for_group_owners_by_element_id: HashMap<String, ValidatedForGroupOwner>,
    pub(crate) collection_values: Vec<ValidatedScalarProgramCollection>,
    pub(crate) immutable_for_groups: HashMap<String, ValidatedImmutableForGroupPlan>,
}

#[derive(Debug)]
pub(crate) struct ValidatedImmutableForGroupPlan {
    pub(crate) owner_statement_id: String,
    pub(crate) carries: Vec<ValidatedImmutableForGroupCarry>,
    pub(crate) geometry_carries: Vec<ValidatedImmutableGeometryCarry>,
    pub(crate) collection_carries: Vec<ValidatedImmutableCollectionCarry>,
    pub(crate) geometry_collection_carries: Vec<ValidatedImmutableGeometryCollectionCarry>,
}

#[derive(Debug)]
pub(crate) struct ValidatedImmutableForGroupCarry {
    pub(crate) binding_id: BindingId,
    pub(crate) next_binding_id: BindingId,
    pub(crate) initializer: TypedScalarExpression,
    pub(crate) declared_type: ScalarType,
    pub(crate) next_expression: TypedScalarExpression,
    pub(crate) next_source_order: usize,
}

#[derive(Debug)]
pub(crate) struct ValidatedImmutableGeometryCarry {
    pub(crate) binding_id: BindingId,
    pub(crate) initializer: super::types::ScalarExpressionResolvedGeometryTarget,
    pub(crate) next: super::types::ScalarExpressionResolvedGeometryTarget,
}

#[derive(Debug)]
pub(crate) struct ValidatedImmutableCollectionCarry {
    pub(crate) binding_id: BindingId,
    pub(crate) collection_value_id: String,
    pub(crate) initializer_value_id: String,
    pub(crate) next_value_id: String,
}

#[derive(Debug)]
pub(crate) enum ValidatedImmutableGeometryCollectionSource {
    Value(String),
    Node(Box<GeometryInputCollectionNode>),
}

#[derive(Debug)]
pub(crate) struct ValidatedImmutableGeometryCollectionCarry {
    pub(crate) binding_id: BindingId,
    pub(crate) collection_value_id: String,
    pub(crate) initializer: ValidatedImmutableGeometryCollectionSource,
    pub(crate) next: ValidatedImmutableGeometryCollectionSource,
}

fn geometry_input_target_type(
    target: &GeometryInputTarget,
) -> Option<super::types::GeometryInterfaceType> {
    let (geometry_type, point_key) = match target {
        GeometryInputTarget::Drawable {
            geometry_type,
            point_key,
            ..
        }
        | GeometryInputTarget::ForGroupOccurrence {
            geometry_type,
            point_key,
            ..
        }
        | GeometryInputTarget::GeometryValue {
            geometry_type,
            point_key,
            ..
        }
        | GeometryInputTarget::GeometryValueMap {
            geometry_type,
            point_key,
            ..
        } => (geometry_type.as_str(), point_key.as_ref()),
        GeometryInputTarget::Coordinate { .. } => {
            return Some(super::types::GeometryInterfaceType::Point)
        }
        GeometryInputTarget::CollectionValue { .. }
        | GeometryInputTarget::CollectionIndex { .. } => return None,
    };
    if point_key.is_some() {
        Some(super::types::GeometryInterfaceType::Point)
    } else {
        super::types::GeometryInterfaceType::from_wire_name(geometry_type)
    }
}

fn resolved_geometry_target_type(
    target: &super::types::ScalarExpressionResolvedGeometryTarget,
) -> super::types::GeometryInterfaceType {
    if target.point_key.is_some() {
        super::types::GeometryInterfaceType::Point
    } else {
        target.geometry_type
    }
}

fn geometry_type_assignable(
    actual: super::types::GeometryInterfaceType,
    expected: super::types::GeometryInterfaceType,
) -> bool {
    actual == expected
        || matches!(
            (actual, expected),
            (
                super::types::GeometryInterfaceType::Line,
                super::types::GeometryInterfaceType::Path
            )
        )
}

fn geometry_collection_node_assignable(
    node: &GeometryInputCollectionNode,
    expected: super::types::GeometryInterfaceType,
) -> bool {
    match node {
        GeometryInputCollectionNode::None => true,
        GeometryInputCollectionNode::Leaf { targets } => targets.iter().all(|target| {
            geometry_input_target_type(target)
                .is_some_and(|actual| geometry_type_assignable(actual, expected))
        }),
        GeometryInputCollectionNode::If {
            then_branch,
            else_branch,
            ..
        } => {
            geometry_collection_node_assignable(then_branch, expected)
                && geometry_collection_node_assignable(else_branch, expected)
        }
        GeometryInputCollectionNode::Match { arms, .. } => arms
            .iter()
            .all(|(_, arm)| geometry_collection_node_assignable(arm, expected)),
        GeometryInputCollectionNode::Coalesce {
            left_branch,
            right_branch,
        } => {
            geometry_collection_node_assignable(left_branch, expected)
                && geometry_collection_node_assignable(right_branch, expected)
        }
    }
}

fn geometry_collection_source_assignable(
    source: &ValidatedImmutableGeometryCollectionSource,
    expected: super::types::GeometryInterfaceType,
) -> bool {
    match source {
        // A value source is already compiler-resolved to a declaration-backed
        // collection identity. Its element type is not duplicated in this
        // payload, so the Rust boundary can only validate node sources here.
        ValidatedImmutableGeometryCollectionSource::Value(_) => true,
        ValidatedImmutableGeometryCollectionSource::Node(node) => {
            geometry_collection_node_assignable(node, expected)
        }
    }
}

fn decode_geometry_collection_declared_type(
    value: &Value,
    context: &str,
) -> Result<super::types::GeometryInterfaceType, ScalarPayloadIssue> {
    let object = as_object(value, context)?;
    reject_unexpected_fields(object, &["kind", "elementType"], context)?;
    if string(
        require_field(object, "kind", context)?,
        &format!("{context} kind"),
    )? != "array"
    {
        return Err(issue(
            Code::InvalidFieldType,
            format!("{context} kind must be array"),
        ));
    }
    let element = as_object(
        require_field(object, "elementType", context)?,
        &format!("{context} elementType"),
    )?;
    reject_unexpected_fields(element, &["kind"], &format!("{context} elementType"))?;
    let element_name = string(
        require_field(element, "kind", &format!("{context} elementType"))?,
        &format!("{context} elementType kind"),
    )?;
    super::types::GeometryInterfaceType::from_wire_name(element_name).ok_or_else(|| {
        issue(
            Code::InvalidFieldType,
            format!("{context} elementType kind must be point, line, or path"),
        )
    })
}

fn decode_geometry_carry_declared_type(
    value: &Value,
    context: &str,
) -> Result<super::types::GeometryInterfaceType, ScalarPayloadIssue> {
    let object = as_object(value, context)?;
    reject_unexpected_fields(object, &["kind"], context)?;
    let kind = string(
        require_field(object, "kind", context)?,
        &format!("{context} kind"),
    )?;
    super::types::GeometryInterfaceType::from_wire_name(kind).ok_or_else(|| {
        issue(
            Code::InvalidFieldType,
            format!("{context} kind must be point, line, or path"),
        )
    })
}

#[derive(Debug, Clone)]
pub(crate) struct ValidatedForGroupOwner {
    pub(crate) owner_statement_id: String,
    pub(crate) scope_id: String,
    pub(crate) exit_source_order: usize,
    pub(crate) iteration_binding_id: String,
}

fn string<'a>(json: &'a Value, context: &str) -> Result<&'a str, ScalarPayloadIssue> {
    json.as_str()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            issue(
                Code::InvalidFieldType,
                format!("{context} must be a non-empty string"),
            )
        })
}

fn integer(json: &Value, context: &str) -> Result<usize, ScalarPayloadIssue> {
    json.as_u64().map(|value| value as usize).ok_or_else(|| {
        issue(
            Code::InvalidSourceOrder,
            format!("{context} must be a non-negative integer"),
        )
    })
}

fn decode_geometry_target(
    value: &Value,
    context: &str,
) -> Result<super::types::ScalarExpressionResolvedGeometryTarget, ScalarPayloadIssue> {
    decode_geometry_target_payload(value)
        .map_err(|error| {
            issue(
                Code::InvalidFieldType,
                format!("{context} is invalid: {error:?}"),
            )
        })?
        .ok_or_else(|| {
            issue(
                Code::InvalidFieldType,
                format!("{context} must not be null"),
            )
        })
}

fn decode_geometry_collection_source(
    value: &Value,
    context: &str,
) -> Result<ValidatedImmutableGeometryCollectionSource, ScalarPayloadIssue> {
    let object = as_object(value, context)?;
    reject_unexpected_fields(object, &["kind", "valueId", "node"], context)?;
    match string(
        require_field(object, "kind", context)?,
        &format!("{context} kind"),
    )? {
        "value" => Ok(ValidatedImmutableGeometryCollectionSource::Value(
            string(
                require_field(object, "valueId", context)?,
                &format!("{context} valueId"),
            )?
            .to_owned(),
        )),
        "node" => {
            let node = decode_collection_node(
                require_field(object, "node", context)?,
                &format!("{context} node"),
            )
            .map_err(|error| {
                issue(
                    Code::InvalidFieldType,
                    format!("{context} is invalid: {error:?}"),
                )
            })?;
            Ok(ValidatedImmutableGeometryCollectionSource::Node(Box::new(
                node,
            )))
        }
        _ => Err(issue(
            Code::UnknownKind,
            format!("{context} kind must be value or node"),
        )),
    }
}

fn expression_type(expression: &TypedScalarExpression) -> Option<&ScalarType> {
    match expression {
        TypedScalarExpression::NumberLiteral { r#type, .. }
        | TypedScalarExpression::StringLiteral { r#type, .. }
        | TypedScalarExpression::BooleanLiteral { r#type, .. }
        | TypedScalarExpression::NoneLiteral { r#type, .. }
        | TypedScalarExpression::GeometryProperty { r#type, .. } => Some(r#type),
        TypedScalarExpression::OptionalMember { r#type, .. } => r#type.as_ref(),
        TypedScalarExpression::ChoiceLiteral { r#type, .. }
        | TypedScalarExpression::Reference { r#type, .. }
        | TypedScalarExpression::CollectionIndex { r#type, .. }
        | TypedScalarExpression::Unary { r#type, .. }
        | TypedScalarExpression::Binary { r#type, .. }
        | TypedScalarExpression::Group { r#type, .. }
        | TypedScalarExpression::ValueIf { r#type, .. }
        | TypedScalarExpression::ValueMatch { r#type, .. }
        | TypedScalarExpression::Call { r#type, .. } => r#type.as_ref(),
    }
}

fn validate_control(json: &Value, scope_id: &str) -> Result<(), ScalarPayloadIssue> {
    let object = as_object(json, "binding version control")?;
    reject_unexpected_fields(
        object,
        &["scopeId", "scopeExitSourceOrder", "ownerChain", "kind"],
        "binding version control",
    )?;
    if string(
        require_field(object, "scopeId", "binding version control")?,
        "binding version control scopeId",
    )? != scope_id
    {
        return Err(issue(
            Code::InvalidControlOwner,
            "binding version control scopeId must match version scopeId",
        ));
    }
    if let Some(exit) = object.get("scopeExitSourceOrder") {
        integer(exit, "binding version control scopeExitSourceOrder")?;
    }
    let owner_chain = require_field(object, "ownerChain", "binding version control")?
        .as_array()
        .ok_or_else(|| {
            issue(
                Code::InvalidControlOwner,
                "binding version control ownerChain must be an array",
            )
        })?;
    for owner in owner_chain {
        let owner = as_object(owner, "binding version control owner")?;
        let kind = string(
            require_field(owner, "kind", "binding version control owner")?,
            "binding version control owner kind",
        )?;
        match kind {
            "conditionalBranch" => {
                reject_unexpected_fields(
                    owner,
                    &[
                        "kind",
                        "ownerStatementId",
                        "branch",
                        "scopeId",
                        "exitSourceOrder",
                    ],
                    "conditional control owner",
                )?;
                string(
                    require_field(owner, "ownerStatementId", "conditional control owner")?,
                    "conditional control ownerStatementId",
                )?;
                integer(
                    require_field(owner, "exitSourceOrder", "conditional control owner")?,
                    "conditional control exitSourceOrder",
                )?;
                match string(
                    require_field(owner, "branch", "conditional control owner")?,
                    "conditional control branch",
                )? {
                    "then" | "else" => {}
                    _ => {
                        return Err(issue(
                            Code::InvalidControlOwner,
                            "conditional control branch must be then or else",
                        ))
                    }
                }
                string(
                    require_field(owner, "scopeId", "conditional control owner")?,
                    "conditional control scopeId",
                )?;
            }
            "forGroup" => {
                reject_unexpected_fields(
                    owner,
                    &[
                        "kind",
                        "ownerStatementId",
                        "scopeId",
                        "exitSourceOrder",
                        "iterationBindingId",
                    ],
                    "forGroup control owner",
                )?;
                string(
                    require_field(owner, "ownerStatementId", "forGroup control owner")?,
                    "forGroup control ownerStatementId",
                )?;
                integer(
                    require_field(owner, "exitSourceOrder", "forGroup control owner")?,
                    "forGroup control exitSourceOrder",
                )?;
                string(
                    require_field(owner, "scopeId", "forGroup control owner")?,
                    "forGroup control scopeId",
                )?;
                if let Some(iteration_binding_id) = owner.get("iterationBindingId") {
                    string(
                        iteration_binding_id,
                        "forGroup control owner iterationBindingId",
                    )?;
                }
            }
            _ => {
                return Err(issue(
                    Code::InvalidControlOwner,
                    "unknown binding version control owner",
                ))
            }
        }
    }
    let kind = string(
        require_field(object, "kind", "binding version control")?,
        "binding version control kind",
    )?;
    let expected = owner_chain
        .last()
        .and_then(Value::as_object)
        .and_then(|owner| owner.get("kind"))
        .and_then(Value::as_str)
        .unwrap_or("linear");
    if kind != expected {
        return Err(issue(
            Code::InvalidControlOwner,
            "binding version control kind disagrees with ownerChain",
        ));
    }
    Ok(())
}

fn decode_initial_state(json: &Value) -> Result<InitialState, ScalarPayloadIssue> {
    let object = as_object(json, "binding version initialState")?;
    let kind = string(
        require_field(object, "kind", "binding version initialState")?,
        "binding version initialState kind",
    )?;
    match kind {
        "uncomputed" => {
            reject_unexpected_fields(object, &["kind"], "uncomputed initialState")?;
            Ok(InitialState::Uncomputed)
        }
        "poisoned" => {
            reject_unexpected_fields(object, &["kind", "reason"], "poisoned initialState")?;
            match string(
                require_field(object, "reason", "poisoned initialState")?,
                "poisoned initialState reason",
            )? {
                "invalid-declaration" | "invalid-dependency" => Ok(InitialState::Poisoned),
                _ => Err(issue(
                    Code::InvalidFieldType,
                    "invalid poisoned initialState reason",
                )),
            }
        }
        _ => Err(issue(
            Code::UnknownKind,
            "unknown binding version initialState kind",
        )),
    }
}

fn decode_version(
    json: &Value,
) -> Result<(ValidatedBindingVersion, Option<String>), ScalarPayloadIssue> {
    let object = as_object(json, "binding version")?;
    let kind = string(
        require_field(object, "kind", "binding version")?,
        "binding version kind",
    )?;
    let allowed = match kind {
        "declare" => &[
            "versionId",
            "statementId",
            "kind",
            "bindingId",
            "bindingKind",
            "declaredType",
            "sourceOrder",
            "scopeId",
            "scopeExitSourceOrder",
            "control",
            "predecessorId",
            "initialState",
            "initializer",
        ][..],
        _ => return Err(issue(Code::UnknownKind, "unknown binding version kind")),
    };
    reject_unexpected_fields(object, allowed, "binding version")?;
    let version_id = string(
        require_field(object, "versionId", "binding version")?,
        "binding version versionId",
    )?
    .to_owned();
    let statement_id = string(
        require_field(object, "statementId", "binding version")?,
        "binding version statementId",
    )?
    .to_owned();
    let binding_id = string(
        require_field(object, "bindingId", "binding version")?,
        "binding version bindingId",
    )?
    .to_owned();
    let binding_kind = string(
        require_field(object, "bindingKind", "binding version")?,
        "binding version bindingKind",
    )?;
    let scope_id = string(
        require_field(object, "scopeId", "binding version")?,
        "binding version scopeId",
    )?;
    let control = require_field(object, "control", "binding version")?;
    validate_control(control, scope_id)?;
    if let Some(exit) = object.get("scopeExitSourceOrder") {
        integer(exit, "binding version scopeExitSourceOrder")?;
    }
    let source_order = integer(
        require_field(object, "sourceOrder", "binding version")?,
        "binding version sourceOrder",
    )?;
    let declared_type =
        decode_scalar_type(require_field(object, "declaredType", "binding version")?)?;
    let predecessor = object
        .get("predecessorId")
        .map(|value| string(value, "binding version predecessorId").map(str::to_owned))
        .transpose()?;
    let initial_state =
        decode_initial_state(require_field(object, "initialState", "binding version")?)?;
    let kind = match kind {
        "declare" => {
            if version_id != statement_id || binding_kind != "const" {
                return Err(issue(
                    Code::InvalidVersionId,
                    "declaration version identity or bindingKind is inconsistent",
                ));
            }
            let initializer = object
                .get("initializer")
                .map(validate_typed_expression_payload)
                .transpose()?;
            if initial_state == InitialState::Uncomputed && initializer.is_none() {
                return Err(issue(
                    Code::MissingField,
                    "uncomputed declaration version requires initializer",
                ));
            }
            if let Some(expression) = initializer.as_ref() {
                if expression_type(expression).map_or(true, |actual| {
                    !scalar_type_assignable(actual, &declared_type)
                }) {
                    return Err(issue(
                        Code::LiteralTypeMismatch,
                        "declaration initializer type must match declaredType",
                    ));
                }
            }
            ValidatedBindingVersionKind::Declare { initializer }
        }
        _ => unreachable!(),
    };
    Ok((
        ValidatedBindingVersion {
            version_id,
            statement_id,
            binding_id,
            declared_type,
            source_order,
            control: control.clone(),
            initial_state,
            kind,
        },
        predecessor,
    ))
}

fn collect_references<'a>(expression: &'a TypedScalarExpression, output: &mut Vec<&'a str>) {
    let mut work = vec![expression];
    while let Some(node) = work.pop() {
        match node {
            TypedScalarExpression::Reference {
                binding_id: Some(id),
                ..
            } => output.push(id),
            TypedScalarExpression::CollectionIndex { index, .. } => work.push(index),
            TypedScalarExpression::Unary { operand, .. }
            | TypedScalarExpression::Group {
                expression: operand,
                ..
            } => work.push(operand),
            TypedScalarExpression::Binary { left, right, .. } => {
                work.push(left);
                work.push(right);
            }
            TypedScalarExpression::ValueIf {
                condition,
                then_branch,
                else_branch,
                ..
            } => {
                work.push(condition);
                work.push(then_branch);
                work.push(else_branch);
            }
            TypedScalarExpression::ValueMatch {
                scrutinee, arms, ..
            } => {
                work.push(scrutinee);
                for arm in arms {
                    work.push(&arm.expression);
                }
            }
            TypedScalarExpression::Call { args, .. } => {
                for argument in args {
                    if let TypedBuiltinArgument::Scalar { expression } = argument {
                        work.push(expression);
                    }
                }
            }
            _ => {}
        }
    }
}

pub(crate) fn validate_binding_versions_payload(
    json: &Value,
    elements: &[Value],
) -> Result<ValidatedBindingVersions, ScalarPayloadIssue> {
    let object = as_object(json, "binding versions payload")?;
    reject_unexpected_fields(
        object,
        &[
            "versions",
            "elementSourceOrders",
            "elementSourceExecutionUnits",
            "conditionalOwners",
            "forGroupOwners",
            "collectionValues",
            "immutableForGroups",
        ],
        "binding versions payload",
    )?;
    let version_json = require_field(object, "versions", "binding versions payload")?
        .as_array()
        .ok_or_else(|| issue(Code::InvalidFieldType, "binding versions must be an array"))?;
    let mut versions = Vec::with_capacity(version_json.len());
    let mut version_ids = HashSet::new();
    let mut current_by_binding = HashMap::<String, String>::new();
    let mut declared_types = HashMap::<BindingId, ScalarType>::new();
    let mut previous_order = None;
    for item in version_json {
        let (version, predecessor) = decode_version(item)?;
        if !version_ids.insert(version.version_id.clone()) {
            return Err(issue(
                Code::InvalidVersionId,
                "binding versionId must be unique",
            ));
        }
        if previous_order.is_some_and(|order| order >= version.source_order) {
            return Err(issue(
                Code::InvalidSourceOrder,
                "binding versions must be in strict source order",
            ));
        }
        previous_order = Some(version.source_order);
        let expected_predecessor = current_by_binding.get(&version.binding_id).cloned();
        if predecessor != expected_predecessor {
            return Err(issue(
                Code::InconsistentVersionPredecessor,
                "binding version predecessor is missing or inconsistent",
            ));
        }
        match (&version.kind, declared_types.get(&version.binding_id)) {
            (ValidatedBindingVersionKind::Declare { .. }, None) => {
                declared_types.insert(version.binding_id.clone(), version.declared_type.clone());
            }
            _ => {
                return Err(issue(
                    Code::InvalidBindingId,
                    "binding version target/declaration chain is inconsistent",
                ))
            }
        }
        current_by_binding.insert(version.binding_id.clone(), version.version_id.clone());
        versions.push(version);
    }
    let collection_values = object
        .get("collectionValues")
        .map(decode_collection_values)
        .transpose()?
        .unwrap_or_default();
    let mut immutable_for_groups = HashMap::new();
    if let Some(plans) = object.get("immutableForGroups") {
        let plans = plans.as_array().ok_or_else(|| {
            issue(
                Code::InvalidFieldType,
                "immutableForGroups must be an array",
            )
        })?;
        for plan in plans {
            let plan = as_object(plan, "immutable forGroup plan")?;
            reject_unexpected_fields(
                plan,
                &[
                    "ownerStatementId",
                    "carries",
                    "geometryCarries",
                    "collectionCarries",
                    "geometryCollectionCarries",
                ],
                "immutable forGroup plan",
            )?;
            let owner_statement_id = string(
                require_field(plan, "ownerStatementId", "immutable forGroup plan")?,
                "immutable forGroup ownerStatementId",
            )?
            .to_owned();
            if immutable_for_groups.contains_key(&owner_statement_id) {
                return Err(issue(
                    Code::InvalidBindingId,
                    "immutable forGroup ownerStatementId must be unique",
                ));
            }
            let carry_json = require_field(plan, "carries", "immutable forGroup plan")?
                .as_array()
                .ok_or_else(|| {
                    issue(
                        Code::InvalidFieldType,
                        "immutable forGroup carries must be an array",
                    )
                })?;
            let mut carries = Vec::with_capacity(carry_json.len());
            for carry in carry_json {
                let carry = as_object(carry, "immutable forGroup carry")?;
                reject_unexpected_fields(
                    carry,
                    &[
                        "bindingId",
                        "nextBindingId",
                        "initializer",
                        "declaredType",
                        "nextExpression",
                        "nextSourceOrder",
                    ],
                    "immutable forGroup carry",
                )?;
                let binding_id = string(
                    require_field(carry, "bindingId", "immutable carry")?,
                    "immutable carry bindingId",
                )?
                .to_owned();
                let next_binding_id = string(
                    require_field(carry, "nextBindingId", "immutable carry")?,
                    "immutable carry nextBindingId",
                )?
                .to_owned();
                let declared_type =
                    decode_scalar_type(require_field(carry, "declaredType", "immutable carry")?)?;
                let initializer = validate_typed_expression_payload(require_field(
                    carry,
                    "initializer",
                    "immutable carry",
                )?)?;
                let next_expression = validate_typed_expression_payload(require_field(
                    carry,
                    "nextExpression",
                    "immutable carry",
                )?)?;
                for expression in [&initializer, &next_expression] {
                    if expression_type(expression).map_or(true, |actual| {
                        !scalar_type_assignable(actual, &declared_type)
                    }) {
                        return Err(issue(
                            Code::LiteralTypeMismatch,
                            "immutable carry expression type must match declaredType",
                        ));
                    }
                }
                let next_source_order = integer(
                    require_field(carry, "nextSourceOrder", "immutable carry")?,
                    "immutable carry nextSourceOrder",
                )?;
                carries.push(ValidatedImmutableForGroupCarry {
                    binding_id,
                    next_binding_id,
                    initializer,
                    declared_type,
                    next_expression,
                    next_source_order,
                });
            }
            let mut geometry_carries = Vec::new();
            if let Some(entries) = plan.get("geometryCarries") {
                let entries = entries.as_array().ok_or_else(|| {
                    issue(
                        Code::InvalidFieldType,
                        "immutable forGroup geometryCarries must be an array",
                    )
                })?;
                for carry in entries {
                    let carry = as_object(carry, "immutable geometry carry")?;
                    reject_unexpected_fields(
                        carry,
                        &[
                            "bindingId",
                            "declaredType",
                            "initializerTarget",
                            "nextTarget",
                            "nextSourceOrder",
                        ],
                        "immutable geometry carry",
                    )?;
                    let binding_id = string(
                        require_field(carry, "bindingId", "immutable geometry carry")?,
                        "immutable geometry carry bindingId",
                    )?
                    .to_owned();
                    let declared_type = decode_geometry_carry_declared_type(
                        require_field(carry, "declaredType", "immutable geometry carry")?,
                        "immutable geometry carry declaredType",
                    )?;
                    let initializer = decode_geometry_target(
                        require_field(carry, "initializerTarget", "immutable geometry carry")?,
                        "immutable geometry carry initializerTarget",
                    )?;
                    let next = decode_geometry_target(
                        require_field(carry, "nextTarget", "immutable geometry carry")?,
                        "immutable geometry carry nextTarget",
                    )?;
                    integer(
                        require_field(carry, "nextSourceOrder", "immutable geometry carry")?,
                        "immutable geometry carry nextSourceOrder",
                    )?;
                    if !geometry_type_assignable(
                        resolved_geometry_target_type(&initializer),
                        declared_type,
                    ) || !geometry_type_assignable(
                        resolved_geometry_target_type(&next),
                        declared_type,
                    ) {
                        return Err(issue(
                            Code::LiteralTypeMismatch,
                            "immutable geometry carry target type must be assignable to declaredType",
                        ));
                    }
                    geometry_carries.push(ValidatedImmutableGeometryCarry {
                        binding_id,
                        initializer,
                        next,
                    });
                }
            }
            let mut collection_carries = Vec::new();
            if let Some(entries) = plan.get("collectionCarries") {
                let entries = entries.as_array().ok_or_else(|| {
                    issue(
                        Code::InvalidFieldType,
                        "immutable forGroup collectionCarries must be an array",
                    )
                })?;
                for carry in entries {
                    let carry = as_object(carry, "immutable collection carry")?;
                    reject_unexpected_fields(
                        carry,
                        &[
                            "bindingId",
                            "collectionValueId",
                            "initializerValueId",
                            "nextValueId",
                            "declaredType",
                            "nextSourceOrder",
                        ],
                        "immutable collection carry",
                    )?;
                    integer(
                        require_field(carry, "nextSourceOrder", "immutable collection carry")?,
                        "immutable collection carry nextSourceOrder",
                    )?;
                    collection_carries.push(ValidatedImmutableCollectionCarry {
                        binding_id: string(
                            require_field(carry, "bindingId", "immutable collection carry")?,
                            "immutable collection carry bindingId",
                        )?
                        .to_owned(),
                        collection_value_id: string(
                            require_field(
                                carry,
                                "collectionValueId",
                                "immutable collection carry",
                            )?,
                            "immutable collection carry collectionValueId",
                        )?
                        .to_owned(),
                        initializer_value_id: string(
                            require_field(
                                carry,
                                "initializerValueId",
                                "immutable collection carry",
                            )?,
                            "immutable collection carry initializerValueId",
                        )?
                        .to_owned(),
                        next_value_id: string(
                            require_field(carry, "nextValueId", "immutable collection carry")?,
                            "immutable collection carry nextValueId",
                        )?
                        .to_owned(),
                    });
                }
            }
            let mut geometry_collection_carries = Vec::new();
            if let Some(entries) = plan.get("geometryCollectionCarries") {
                let entries = entries.as_array().ok_or_else(|| {
                    issue(
                        Code::InvalidFieldType,
                        "immutable forGroup geometryCollectionCarries must be an array",
                    )
                })?;
                for carry in entries {
                    let carry = as_object(carry, "immutable geometry collection carry")?;
                    reject_unexpected_fields(
                        carry,
                        &[
                            "bindingId",
                            "collectionValueId",
                            "initializer",
                            "next",
                            "declaredType",
                            "nextSourceOrder",
                        ],
                        "immutable geometry collection carry",
                    )?;
                    integer(
                        require_field(
                            carry,
                            "nextSourceOrder",
                            "immutable geometry collection carry",
                        )?,
                        "immutable geometry collection carry nextSourceOrder",
                    )?;
                    let declared_type = decode_geometry_collection_declared_type(
                        require_field(
                            carry,
                            "declaredType",
                            "immutable geometry collection carry",
                        )?,
                        "immutable geometry collection carry declaredType",
                    )?;
                    let initializer = decode_geometry_collection_source(
                        require_field(carry, "initializer", "immutable geometry collection carry")?,
                        "immutable geometry collection carry initializer",
                    )?;
                    let next = decode_geometry_collection_source(
                        require_field(carry, "next", "immutable geometry collection carry")?,
                        "immutable geometry collection carry next",
                    )?;
                    if !geometry_collection_source_assignable(&initializer, declared_type)
                        || !geometry_collection_source_assignable(&next, declared_type)
                    {
                        return Err(issue(
                            Code::LiteralTypeMismatch,
                            "immutable geometry collection carry source type must be assignable to declaredType",
                        ));
                    }
                    geometry_collection_carries.push(ValidatedImmutableGeometryCollectionCarry {
                        binding_id: string(
                            require_field(
                                carry,
                                "bindingId",
                                "immutable geometry collection carry",
                            )?,
                            "immutable geometry collection carry bindingId",
                        )?
                        .to_owned(),
                        collection_value_id: string(
                            require_field(
                                carry,
                                "collectionValueId",
                                "immutable geometry collection carry",
                            )?,
                            "immutable geometry collection carry collectionValueId",
                        )?
                        .to_owned(),
                        initializer,
                        next,
                    });
                }
            }
            immutable_for_groups.insert(
                owner_statement_id.clone(),
                ValidatedImmutableForGroupPlan {
                    owner_statement_id,
                    carries,
                    geometry_carries,
                    collection_carries,
                    geometry_collection_carries,
                },
            );
        }
    }
    // Carry declarations and their `next` expressions are immutable loop
    // state, not temporal versions. They still belong to the resolved binding
    // namespace so expressions can reference them at the Rust boundary.
    let mut binding_ids = declared_types.keys().cloned().collect::<HashSet<_>>();
    for plan in immutable_for_groups.values() {
        for carry in &plan.carries {
            binding_ids.insert(carry.binding_id.clone());
            declared_types.insert(carry.binding_id.clone(), carry.declared_type.clone());
            binding_ids.insert(carry.next_binding_id.clone());
            declared_types.insert(carry.next_binding_id.clone(), carry.declared_type.clone());
        }
        for carry in &plan.geometry_carries {
            binding_ids.insert(carry.binding_id.clone());
        }
        for carry in &plan.collection_carries {
            binding_ids.insert(carry.binding_id.clone());
        }
        for carry in &plan.geometry_collection_carries {
            binding_ids.insert(carry.binding_id.clone());
        }
    }
    for collection in &collection_values {
        if let super::program_payload::ValidatedScalarProgramCollectionValue::Literal(members) =
            &collection.value
        {
            for member in members {
                if let ValidatedScalarProgramCollectionMember::Binding { binding_id, .. } = member {
                    if !binding_ids.contains(binding_id) {
                        return Err(issue(
                            Code::InvalidBindingId,
                            "scalar program collection member references an unknown bindingId",
                        ));
                    }
                }
            }
        }
    }
    // Iteration bindings are issued by the compiler catalog, not by a typed
    // declaration version. Their exact owner/canonical form is validated with
    // `forGroupOwners` below; accepting only listed ids here keeps reference
    // validation fail-closed without forcing a second source parse.
    let listed_iteration_binding_ids = object
        .get("forGroupOwners")
        .and_then(Value::as_array)
        .map(|owners| {
            owners
                .iter()
                .filter_map(|owner| owner.get("iterationBindingId").and_then(Value::as_str))
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();
    for version in &versions {
        let expression = match &version.kind {
            ValidatedBindingVersionKind::Declare { initializer } => initializer.as_ref(),
        };
        if let Some(expression) = expression {
            let mut references = Vec::new();
            collect_references(expression, &mut references);
            for reference in references {
                if binding_ids.contains(reference) {
                    continue;
                }
                if listed_iteration_binding_ids.contains(reference) {
                    continue;
                }
                return Err(issue(
                    Code::InvalidBindingId,
                    format!("unknown binding reference {reference}"),
                ));
            }
        }
    }
    for plan in immutable_for_groups.values() {
        for carry in &plan.carries {
            for expression in [&carry.initializer, &carry.next_expression] {
                let mut references = Vec::new();
                collect_references(expression, &mut references);
                for reference in references {
                    if binding_ids.contains(reference)
                        || listed_iteration_binding_ids.contains(reference)
                    {
                        continue;
                    }
                    return Err(issue(
                        Code::InvalidBindingId,
                        format!("unknown binding reference {reference}"),
                    ));
                }
            }
        }
    }
    let source_json = require_field(object, "elementSourceOrders", "binding versions payload")?
        .as_array()
        .ok_or_else(|| {
            issue(
                Code::InvalidElementSourceOrder,
                "elementSourceOrders must be an array",
            )
        })?;
    if source_json.len() != elements.len() {
        return Err(issue(
            Code::InvalidElementSourceOrder,
            "elementSourceOrders must cover every input element",
        ));
    }
    let mut element_source_orders = HashMap::new();
    let element_source_execution_units = object
        .get("elementSourceExecutionUnits")
        .map(|value| {
            let unit_json = value.as_array().ok_or_else(|| {
                issue(
                    Code::InvalidElementSourceOrder,
                    "elementSourceExecutionUnits must be an array",
                )
            })?;
            if unit_json.len() != elements.len() {
                return Err(issue(
                    Code::InvalidElementSourceOrder,
                    "elementSourceExecutionUnits must cover every input element",
                ));
            }
            let mut units = HashMap::new();
            for (index, item) in unit_json.iter().enumerate() {
                let item = as_object(item, "element source execution unit")?;
                reject_unexpected_fields(
                    item,
                    &["elementId", "executionUnit"],
                    "element source execution unit",
                )?;
                let id = string(
                    require_field(item, "elementId", "element source execution unit")?,
                    "element source execution unit elementId",
                )?;
                let expected = elements[index]
                    .get("id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        issue(
                            Code::InvalidElementSourceOrder,
                            "input element id is missing",
                        )
                    })?;
                if id != expected
                    || units
                        .insert(
                            id.to_owned(),
                            integer(
                                require_field(
                                    item,
                                    "executionUnit",
                                    "element source execution unit",
                                )?,
                                "element source execution unit executionUnit",
                            )?,
                        )
                        .is_some()
                {
                    return Err(issue(
                        Code::InvalidElementSourceOrder,
                        "elementSourceExecutionUnits contains an unknown or duplicate element id",
                    ));
                }
            }
            Ok(units)
        })
        .transpose()?;
    let mut prior_source_order = None;
    let mut prior_execution_unit = None;
    for (index, item) in source_json.iter().enumerate() {
        let item = as_object(item, "element source order")?;
        reject_unexpected_fields(item, &["elementId", "sourceOrder"], "element source order")?;
        let id = string(
            require_field(item, "elementId", "element source order")?,
            "element source order elementId",
        )?;
        let expected = elements[index]
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                issue(
                    Code::InvalidElementSourceOrder,
                    "input element id is missing",
                )
            })?;
        if id != expected
            || element_source_orders
                .insert(
                    id.to_owned(),
                    integer(
                        require_field(item, "sourceOrder", "element source order")?,
                        "element source order sourceOrder",
                    )?,
                )
                .is_some()
        {
            return Err(issue(
                Code::InvalidElementSourceOrder,
                "elementSourceOrders contains an unknown or duplicate element id",
            ));
        }
        let order = element_source_orders[id];
        if prior_source_order.is_some_and(|previous| previous > order) {
            return Err(issue(
                Code::InvalidElementSourceOrder,
                "elementSourceOrders must not move backwards",
            ));
        }
        if prior_source_order == Some(order) {
            let Some(units) = element_source_execution_units.as_ref() else {
                return Err(issue(
                    Code::InvalidElementSourceOrder,
                    "elementSourceOrders must be strict source order unless execution units are explicit",
                ));
            };
            let execution_unit = units.get(id).copied().ok_or_else(|| {
                issue(
                    Code::InvalidElementSourceOrder,
                    "elementSourceExecutionUnits is missing an element",
                )
            })?;
            if prior_execution_unit != Some(execution_unit) {
                return Err(issue(
                    Code::InvalidElementSourceOrder,
                    "equal element source positions must belong to one execution unit",
                ));
            }
        }
        prior_execution_unit = element_source_execution_units
            .as_ref()
            .and_then(|units| units.get(id).copied());
        prior_source_order = Some(order);
    }
    let empty_conditional_owners = Value::Array(Vec::new());
    let conditional_owners_json = object
        .get("conditionalOwners")
        .unwrap_or(&empty_conditional_owners)
        .as_array()
        .ok_or_else(|| {
            issue(
                Code::InvalidControlOwner,
                "conditionalOwners must be an array",
            )
        })?;
    let conditional_elements = elements
        .iter()
        .filter(|element| element.get("type").and_then(Value::as_str) == Some("conditionalGroup"))
        .filter_map(|element| element.get("id").and_then(Value::as_str))
        .collect::<HashSet<_>>();
    let mut conditional_owners_by_element_id = HashMap::new();
    let mut conditional_owner_ids = HashSet::new();
    for owner in conditional_owners_json {
        let owner = as_object(owner, "conditional mutation owner")?;
        reject_unexpected_fields(
            owner,
            &["ownerStatementId", "elementId"],
            "conditional mutation owner",
        )?;
        let owner_id = string(
            require_field(owner, "ownerStatementId", "conditional mutation owner")?,
            "conditional mutation ownerStatementId",
        )?
        .to_owned();
        let element_id = string(
            require_field(owner, "elementId", "conditional mutation owner")?,
            "conditional mutation owner elementId",
        )?
        .to_owned();
        if !conditional_elements.contains(element_id.as_str())
            || !conditional_owner_ids.insert(owner_id.clone())
            || conditional_owners_by_element_id
                .insert(element_id, owner_id)
                .is_some()
        {
            return Err(issue(
                Code::InvalidControlOwner,
                "conditionalOwners contains an unknown or duplicate owner",
            ));
        }
    }
    for version in &versions {
        let Some(chain) = version.control.get("ownerChain").and_then(Value::as_array) else {
            continue;
        };
        for owner in chain {
            if owner.get("kind").and_then(Value::as_str) == Some("conditionalBranch") {
                let id = owner
                    .get("ownerStatementId")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if !conditional_owner_ids.contains(id) {
                    return Err(issue(
                        Code::InvalidControlOwner,
                        "conditional owner chain has no matching conditionalOwners entry",
                    ));
                }
            }
        }
    }
    let for_group_json = object
        .get("forGroupOwners")
        .unwrap_or(&empty_conditional_owners)
        .as_array()
        .ok_or_else(|| issue(Code::InvalidControlOwner, "forGroupOwners must be an array"))?;
    let for_group_elements = elements
        .iter()
        .filter(|element| element.get("type").and_then(Value::as_str) == Some("forGroup"))
        .filter_map(|element| element.get("id").and_then(Value::as_str))
        .collect::<HashSet<_>>();
    let mut for_group_owners_by_element_id = HashMap::new();
    let mut for_group_owner_ids = HashSet::new();
    for owner in for_group_json {
        let owner = as_object(owner, "forGroup mutation owner")?;
        reject_unexpected_fields(
            owner,
            &[
                "ownerStatementId",
                "elementId",
                "scopeId",
                "exitSourceOrder",
                "iterationBindingId",
            ],
            "forGroup mutation owner",
        )?;
        let owner_statement_id = string(
            require_field(owner, "ownerStatementId", "forGroup mutation owner")?,
            "forGroup ownerStatementId",
        )?
        .to_owned();
        let element_id = string(
            require_field(owner, "elementId", "forGroup mutation owner")?,
            "forGroup elementId",
        )?
        .to_owned();
        let scope_id = string(
            require_field(owner, "scopeId", "forGroup mutation owner")?,
            "forGroup scopeId",
        )?
        .to_owned();
        let iteration_binding_id = string(
            require_field(owner, "iterationBindingId", "forGroup mutation owner")?,
            "forGroup iterationBindingId",
        )?
        .to_owned();
        let exit_source_order = integer(
            require_field(owner, "exitSourceOrder", "forGroup mutation owner")?,
            "forGroup exitSourceOrder",
        )?;
        if !for_group_elements.contains(element_id.as_str())
            || !for_group_owner_ids.insert(owner_statement_id.clone())
            || for_group_owners_by_element_id
                .insert(
                    element_id,
                    ValidatedForGroupOwner {
                        owner_statement_id,
                        scope_id,
                        exit_source_order,
                        iteration_binding_id,
                    },
                )
                .is_some()
        {
            return Err(issue(
                Code::InvalidControlOwner,
                "forGroupOwners contains an unknown or duplicate owner",
            ));
        }
    }
    let mut referenced_for_group_owner_ids = HashSet::new();
    for version in &versions {
        let Some(chain) = version.control.get("ownerChain").and_then(Value::as_array) else {
            continue;
        };
        for owner in chain {
            if owner.get("kind").and_then(Value::as_str) != Some("forGroup") {
                continue;
            }
            let owner_statement_id = owner
                .get("ownerStatementId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let Some(payload_owner) = for_group_owners_by_element_id
                .values()
                .find(|candidate| candidate.owner_statement_id == owner_statement_id)
            else {
                return Err(issue(
                    Code::InvalidControlOwner,
                    "forGroup owner chain has no matching forGroupOwners entry",
                ));
            };
            let expected_iteration_binding_id = owner
                .get("iterationBindingId")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
                .unwrap_or_else(|| format!("binding:iteration:{owner_statement_id}"));
            if owner.get("scopeId").and_then(Value::as_str) != Some(payload_owner.scope_id.as_str())
                || owner.get("exitSourceOrder").and_then(Value::as_u64)
                    != Some(payload_owner.exit_source_order as u64)
                || payload_owner.iteration_binding_id != expected_iteration_binding_id
            {
                return Err(issue(
                    Code::InvalidControlOwner,
                    "forGroup owner metadata disagrees with ownerChain",
                ));
            }
            referenced_for_group_owner_ids.insert(owner_statement_id.to_owned());
        }
    }
    for owner_statement_id in immutable_for_groups.keys() {
        if !for_group_owner_ids.contains(owner_statement_id) {
            return Err(issue(
                Code::InvalidControlOwner,
                "immutable forGroup plan has no matching forGroupOwners entry",
            ));
        }
        referenced_for_group_owner_ids.insert(owner_statement_id.clone());
    }
    if referenced_for_group_owner_ids.len() != for_group_owner_ids.len() {
        return Err(issue(
            Code::InvalidControlOwner,
            "forGroupOwners contains an unused owner",
        ));
    }
    Ok(ValidatedBindingVersions {
        versions,
        binding_ids,
        declared_types,
        element_source_orders,
        conditional_owners_by_element_id,
        for_group_owners_by_element_id,
        collection_values,
        immutable_for_groups,
    })
}
