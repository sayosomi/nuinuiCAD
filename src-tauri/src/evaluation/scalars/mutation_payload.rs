//! Fail-closed Task 32 decoder for Task 30's already-resolved binding-version
//! graph. This boundary never parses source, resolves names, or creates IDs.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use super::expression_payload::validate_typed_expression_payload;
use super::issue::{ScalarPayloadIssue, ScalarPayloadIssueCode as Code};
use super::json_helpers::{as_object, issue, reject_unexpected_fields, require_field};
use super::scalar_payload::decode_scalar_type;
use super::types::{BindingId, ScalarType, TypedScalarExpression};

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
    Set {
        expression: TypedScalarExpression,
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
    pub(crate) evaluation_limit_source_order: Option<usize>,
    pub(crate) conditional_owners_by_element_id: HashMap<String, String>,
    pub(crate) for_group_owners_by_element_id: HashMap<String, ValidatedForGroupOwner>,
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

fn expression_type(expression: &TypedScalarExpression) -> Option<&ScalarType> {
    match expression {
        TypedScalarExpression::NumberLiteral { r#type, .. }
        | TypedScalarExpression::StringLiteral { r#type, .. }
        | TypedScalarExpression::BooleanLiteral { r#type, .. }
        | TypedScalarExpression::GeometryProperty { r#type, .. } => Some(r#type),
        TypedScalarExpression::ChoiceLiteral { r#type, .. }
        | TypedScalarExpression::Reference { r#type, .. }
        | TypedScalarExpression::Unary { r#type, .. }
        | TypedScalarExpression::Binary { r#type, .. }
        | TypedScalarExpression::Group { r#type, .. } => r#type.as_ref(),
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
                    &["kind", "ownerStatementId", "scopeId", "exitSourceOrder"],
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
        "set" => &[
            "versionId",
            "statementId",
            "kind",
            "bindingId",
            "targetBindingId",
            "bindingKind",
            "declaredType",
            "sourceOrder",
            "scopeId",
            "scopeExitSourceOrder",
            "control",
            "predecessorId",
            "initialState",
            "expression",
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
            if version_id != statement_id || !matches!(binding_kind, "const" | "let") {
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
                if expression_type(expression) != Some(&declared_type) {
                    return Err(issue(
                        Code::LiteralTypeMismatch,
                        "declaration initializer type must match declaredType",
                    ));
                }
            }
            ValidatedBindingVersionKind::Declare { initializer }
        }
        "set" => {
            if binding_kind != "let"
                || version_id != statement_id
                || string(
                    require_field(object, "targetBindingId", "set binding version")?,
                    "set binding version targetBindingId",
                )? != binding_id
            {
                return Err(issue(
                    Code::InvalidBindingId,
                    "set target/binding/version identity is inconsistent",
                ));
            }
            if initial_state != InitialState::Uncomputed {
                return Err(issue(
                    Code::InvalidFieldType,
                    "set initialState must be uncomputed",
                ));
            }
            let expression = validate_typed_expression_payload(require_field(
                object,
                "expression",
                "set binding version",
            )?)?;
            if expression_type(&expression) != Some(&declared_type) {
                return Err(issue(
                    Code::LiteralTypeMismatch,
                    "set expression type must match declaredType",
                ));
            }
            ValidatedBindingVersionKind::Set { expression }
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
            TypedScalarExpression::Unary { operand, .. }
            | TypedScalarExpression::Group {
                expression: operand,
                ..
            } => work.push(operand),
            TypedScalarExpression::Binary { left, right, .. } => {
                work.push(left);
                work.push(right);
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
            "conditionalOwners",
            "forGroupOwners",
            "evaluationLimitSourceOrder",
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
            (ValidatedBindingVersionKind::Set { .. }, Some(r#type))
                if r#type == &version.declared_type => {}
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
    let binding_ids = declared_types.keys().cloned().collect::<HashSet<_>>();
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
            ValidatedBindingVersionKind::Set { expression } => Some(expression),
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
    let mut prior_source_order = None;
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
        if prior_source_order.is_some_and(|previous| previous >= order) {
            return Err(issue(
                Code::InvalidElementSourceOrder,
                "elementSourceOrders must be strict source order",
            ));
        }
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
    let evaluation_limit_source_order = object
        .get("evaluationLimitSourceOrder")
        .map(|value| integer(value, "evaluationLimitSourceOrder"))
        .transpose()?;
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
        if iteration_binding_id != format!("binding:iteration:{owner_statement_id}") {
            return Err(issue(
                Code::InvalidControlOwner,
                "forGroup owner iterationBindingId is not canonical",
            ));
        }
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
            if owner.get("scopeId").and_then(Value::as_str) != Some(payload_owner.scope_id.as_str())
                || owner.get("exitSourceOrder").and_then(Value::as_u64)
                    != Some(payload_owner.exit_source_order as u64)
            {
                return Err(issue(
                    Code::InvalidControlOwner,
                    "forGroup owner metadata disagrees with ownerChain",
                ));
            }
            referenced_for_group_owner_ids.insert(owner_statement_id.to_owned());
        }
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
        evaluation_limit_source_order,
        conditional_owners_by_element_id,
        for_group_owners_by_element_id,
    })
}
