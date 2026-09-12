//! Task 19 scalar-program boundary decoding. The compiler has already
//! resolved names; this module only turns its JSON IR into validated Rust
//! values for Task 21's document-context evaluator.

use std::collections::HashSet;

use serde_json::Value;

use super::expression_payload::validate_typed_expression_payload;
use super::issue::{ScalarPayloadIssue, ScalarPayloadIssueCode as Code};
use super::json_helpers::{as_object, issue, reject_unexpected_fields, require_field};
use super::scalar_payload::{decode_scalar_type, decode_scalar_value, scalar_value_matches_type};
use super::types::{BindingId, ScalarType, TypedScalarExpression};

#[derive(Debug)]
pub(crate) struct ValidatedScalarProgram {
    pub(crate) statements: Vec<ValidatedScalarProgramStatement>,
    pub(crate) collection_values: Vec<ValidatedScalarProgramCollection>,
    pub(crate) evaluation_limit_source_order: Option<usize>,
    pub(crate) post_stop_binding_ids: HashSet<BindingId>,
}

#[derive(Debug)]
pub(crate) struct ValidatedScalarProgramCollection {
    pub(crate) value_id: String,
    pub(crate) value: ValidatedScalarProgramCollectionValue,
}

#[derive(Debug)]
pub(crate) enum ValidatedScalarProgramCollectionValue {
    None,
    Literal(Vec<ValidatedScalarProgramCollectionMember>),
    Alias(String),
    Coalesce {
        left_value_id: String,
        right_value_id: String,
    },
    Map {
        source_value_id: String,
        source_element_type: ScalarType,
        result_element_type: ScalarType,
        binder_id: BindingId,
        body: Box<TypedScalarExpression>,
        source_order: usize,
    },
    RecordMap {
        source_value_id: String,
        source_type_identity: String,
        result_type_identity: String,
        binder_fields: Vec<ValidatedScalarProgramRecordField>,
        fields: Vec<ValidatedScalarProgramRecordFieldBody>,
        source_order: usize,
    },
    RecordField {
        source_value_id: String,
        field: ValidatedScalarProgramRecordFieldIdentity,
    },
    If {
        condition: Box<TypedScalarExpression>,
        then_value_id: String,
        else_value_id: String,
        source_order: f64,
    },
    Match {
        scrutinee: Box<TypedScalarExpression>,
        arms: Vec<(String, String)>,
        source_order: f64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ValidatedScalarProgramRecordFieldPathEntry {
    pub(crate) record_statement_id: String,
    pub(crate) field_index: usize,
}

#[derive(Debug, Clone)]
pub(crate) struct ValidatedScalarProgramRecordFieldIdentity {
    pub(crate) record_statement_id: String,
    pub(crate) field_index: usize,
    pub(crate) r#type: ScalarType,
    pub(crate) field_path: Option<Vec<ValidatedScalarProgramRecordFieldPathEntry>>,
}

#[derive(Debug, Clone)]
pub(crate) struct ValidatedScalarProgramRecordField {
    pub(crate) record_statement_id: String,
    pub(crate) field_index: usize,
    pub(crate) r#type: ScalarType,
    pub(crate) binding_id: BindingId,
    pub(crate) field_path: Option<Vec<ValidatedScalarProgramRecordFieldPathEntry>>,
}

#[derive(Debug)]
pub(crate) struct ValidatedScalarProgramRecordFieldBody {
    pub(crate) record_statement_id: String,
    pub(crate) field_index: usize,
    pub(crate) r#type: ScalarType,
    pub(crate) body: Box<TypedScalarExpression>,
    pub(crate) field_path: Option<Vec<ValidatedScalarProgramRecordFieldPathEntry>>,
}

#[derive(Debug)]
pub(crate) enum ValidatedScalarProgramCollectionMember {
    Literal {
        r#type: ScalarType,
        value: super::types::ScalarValue,
    },
    Binding {
        r#type: ScalarType,
        binding_id: BindingId,
    },
    Record {
        type_identity: String,
        fields: Vec<ValidatedScalarProgramRecordField>,
    },
}

#[derive(Debug)]
pub(crate) struct ValidatedScalarProgramStatement {
    pub(crate) binding_id: BindingId,
    pub(crate) source_order: usize,
    pub(crate) declared_type: ScalarType,
    /// An initializer error becomes a typed poison only after the statement's
    /// identity, declared type, and source position have been decoded.
    pub(crate) initializer: Result<TypedScalarExpression, String>,
}

pub(crate) fn decode_collection_values(
    value: &Value,
) -> Result<Vec<ValidatedScalarProgramCollection>, ScalarPayloadIssue> {
    let values = value.as_array().ok_or_else(|| {
        issue(
            Code::InvalidFieldType,
            "scalar program collectionValues must be an array",
        )
    })?;
    let mut ids = HashSet::new();
    let mut decoded = Vec::with_capacity(values.len());
    for entry in values {
        let entry = as_object(entry, "scalar program collection value")?;
        reject_unexpected_fields(
            entry,
            &[
                "valueId",
                "kind",
                "members",
                "targetValueId",
                "sourceValueId",
                "sourceElementType",
                "resultElementType",
                "binderId",
                "body",
                "sourceOrder",
                "sourceTypeIdentity",
                "resultTypeIdentity",
                "binderFields",
                "fields",
                "field",
                "condition",
                "thenValueId",
                "elseValueId",
                "scrutinee",
                "arms",
                "leftValueId",
                "rightValueId",
            ],
            "scalar program collection value",
        )?;
        let value_id = non_empty_string(
            require_field(entry, "valueId", "scalar program collection value")?,
            "scalar program collection value valueId",
        )?
        .to_owned();
        if !ids.insert(value_id.clone()) {
            return Err(issue(
                Code::InvalidBindingId,
                "scalar program collection valueId must be unique",
            ));
        }
        let kind = non_empty_string(
            require_field(entry, "kind", "scalar program collection value")?,
            "scalar program collection value kind",
        )?;
        let decoded_value = match kind {
            "none" => {
                reject_unexpected_fields(
                    entry,
                    &["valueId", "kind"],
                    "scalar program collection none",
                )?;
                ValidatedScalarProgramCollectionValue::None
            }
            "alias" => {
                reject_unexpected_fields(
                    entry,
                    &["valueId", "kind", "targetValueId"],
                    "scalar program collection alias",
                )?;
                ValidatedScalarProgramCollectionValue::Alias(
                    non_empty_string(
                        require_field(entry, "targetValueId", "scalar program collection alias")?,
                        "scalar program collection alias targetValueId",
                    )?
                    .to_owned(),
                )
            }
            "coalesce" => {
                reject_unexpected_fields(
                    entry,
                    &[
                        "valueId",
                        "kind",
                        "leftValueId",
                        "rightValueId",
                        "sourceOrder",
                    ],
                    "scalar program collection coalesce",
                )?;
                let left_value_id = non_empty_string(
                    require_field(entry, "leftValueId", "scalar program collection coalesce")?,
                    "scalar program collection coalesce leftValueId",
                )?
                .to_owned();
                let right_value_id = non_empty_string(
                    require_field(entry, "rightValueId", "scalar program collection coalesce")?,
                    "scalar program collection coalesce rightValueId",
                )?
                .to_owned();
                let _source_order = require_field(entry, "sourceOrder", "scalar program collection coalesce")?
                    .as_f64()
                    .filter(|value| value.is_finite() && *value >= 0.0)
                    .ok_or_else(|| issue(Code::InvalidFieldType, "scalar program collection coalesce sourceOrder must be a non-negative number"))?;
                ValidatedScalarProgramCollectionValue::Coalesce {
                    left_value_id,
                    right_value_id,
                }
            }
            "literal" => {
                reject_unexpected_fields(
                    entry,
                    &["valueId", "kind", "members"],
                    "scalar program collection literal",
                )?;
                let members = require_field(entry, "members", "scalar program collection literal")?
                    .as_array()
                    .ok_or_else(|| {
                        issue(
                            Code::InvalidFieldType,
                            "scalar program collection members must be an array",
                        )
                    })?;
                let mut decoded_members = Vec::with_capacity(members.len());
                for member in members {
                    let member = as_object(member, "scalar program collection member")?;
                    reject_unexpected_fields(
                        member,
                        &[
                            "kind",
                            "type",
                            "value",
                            "bindingId",
                            "typeIdentity",
                            "fields",
                        ],
                        "scalar program collection member",
                    )?;
                    let member_kind = non_empty_string(
                        require_field(member, "kind", "scalar program collection member")?,
                        "scalar program collection member kind",
                    )?;
                    match member_kind {
                        "literal" => {
                            let member_type = decode_scalar_type(require_field(
                                member,
                                "type",
                                "scalar program collection literal member",
                            )?)?;
                            reject_unexpected_fields(
                                member,
                                &["kind", "type", "value"],
                                "scalar program literal member",
                            )?;
                            let scalar_value = decode_scalar_value(require_field(
                                member,
                                "value",
                                "scalar program literal member",
                            )?)?;
                            if !scalar_value_matches_type(&member_type, &scalar_value) {
                                return Err(issue(Code::InvalidEvaluationValue, "scalar program literal member value does not match its declared type"));
                            }
                            decoded_members.push(ValidatedScalarProgramCollectionMember::Literal {
                                r#type: member_type,
                                value: scalar_value,
                            });
                        }
                        "binding" => {
                            let member_type = decode_scalar_type(require_field(
                                member,
                                "type",
                                "scalar program binding member",
                            )?)?;
                            reject_unexpected_fields(
                                member,
                                &["kind", "type", "bindingId"],
                                "scalar program binding member",
                            )?;
                            let binding_id = non_empty_string(
                                require_field(
                                    member,
                                    "bindingId",
                                    "scalar program binding member",
                                )?,
                                "scalar program binding member bindingId",
                            )?
                            .to_owned();
                            decoded_members.push(ValidatedScalarProgramCollectionMember::Binding {
                                r#type: member_type,
                                binding_id,
                            });
                        }
                        "record" => {
                            reject_unexpected_fields(
                                member,
                                &["kind", "typeIdentity", "fields"],
                                "scalar program record member",
                            )?;
                            let type_identity = non_empty_string(
                                require_field(
                                    member,
                                    "typeIdentity",
                                    "scalar program record member",
                                )?,
                                "scalar program record member typeIdentity",
                            )?
                            .to_owned();
                            let fields = decode_record_fields(
                                require_field(member, "fields", "scalar program record member")?,
                                true,
                            )?;
                            decoded_members.push(ValidatedScalarProgramCollectionMember::Record {
                                type_identity,
                                fields,
                            });
                        }
                        _ => {
                            return Err(issue(
                                Code::UnknownKind,
                                "unknown scalar program collection member kind",
                            ))
                        }
                    }
                }
                ValidatedScalarProgramCollectionValue::Literal(decoded_members)
            }
            "map" => {
                reject_unexpected_fields(
                    entry,
                    &[
                        "valueId",
                        "kind",
                        "sourceValueId",
                        "sourceElementType",
                        "resultElementType",
                        "binderId",
                        "body",
                        "sourceOrder",
                    ],
                    "scalar program collection map",
                )?;
                let source_value_id = non_empty_string(
                    require_field(entry, "sourceValueId", "scalar program collection map")?,
                    "scalar program collection map sourceValueId",
                )?
                .to_owned();
                let source_element_type = decode_scalar_type(require_field(
                    entry,
                    "sourceElementType",
                    "scalar program collection map",
                )?)?;
                let result_element_type = decode_scalar_type(require_field(
                    entry,
                    "resultElementType",
                    "scalar program collection map",
                )?)?;
                let binder_id = non_empty_string(
                    require_field(entry, "binderId", "scalar program collection map")?,
                    "scalar program collection map binderId",
                )?
                .to_owned();
                let body = validate_typed_expression_payload(require_field(
                    entry,
                    "body",
                    "scalar program collection map",
                )?)?;
                let source_order_value =
                    require_field(entry, "sourceOrder", "scalar program collection map")?;
                let source_order = source_order_value.as_u64().ok_or_else(|| {
                    issue(
                        Code::InvalidFieldType,
                        "scalar program collection map sourceOrder must be a non-negative integer",
                    )
                })? as usize;
                ValidatedScalarProgramCollectionValue::Map {
                    source_value_id,
                    source_element_type,
                    result_element_type,
                    binder_id,
                    body: Box::new(body),
                    source_order,
                }
            }
            "recordMap" => {
                reject_unexpected_fields(
                    entry,
                    &[
                        "valueId",
                        "kind",
                        "sourceValueId",
                        "sourceTypeIdentity",
                        "resultTypeIdentity",
                        "binderId",
                        "binderFields",
                        "fields",
                        "sourceOrder",
                    ],
                    "scalar program record map",
                )?;
                let source_value_id = non_empty_string(
                    require_field(entry, "sourceValueId", "scalar program record map")?,
                    "scalar program record map sourceValueId",
                )?
                .to_owned();
                let source_type_identity = non_empty_string(
                    require_field(entry, "sourceTypeIdentity", "scalar program record map")?,
                    "scalar program record map sourceTypeIdentity",
                )?
                .to_owned();
                let result_type_identity = non_empty_string(
                    require_field(entry, "resultTypeIdentity", "scalar program record map")?,
                    "scalar program record map resultTypeIdentity",
                )?
                .to_owned();
                let _binder_id = non_empty_string(
                    require_field(entry, "binderId", "scalar program record map")?,
                    "scalar program record map binderId",
                )?
                .to_owned();
                let binder_fields = decode_record_fields(
                    require_field(entry, "binderFields", "scalar program record map")?,
                    true,
                )?;
                let fields = decode_record_field_bodies(require_field(
                    entry,
                    "fields",
                    "scalar program record map",
                )?)?;
                let source_order = require_non_negative_usize(
                    require_field(entry, "sourceOrder", "scalar program record map")?,
                    "scalar program record map sourceOrder",
                )?;
                ValidatedScalarProgramCollectionValue::RecordMap {
                    source_value_id,
                    source_type_identity,
                    result_type_identity,
                    binder_fields,
                    fields,
                    source_order,
                }
            }
            "recordField" => {
                reject_unexpected_fields(
                    entry,
                    &["valueId", "kind", "sourceValueId", "field", "sourceOrder"],
                    "scalar program record field",
                )?;
                let source_value_id = non_empty_string(
                    require_field(entry, "sourceValueId", "scalar program record field")?,
                    "scalar program record field sourceValueId",
                )?
                .to_owned();
                let field = decode_record_field_identity(require_field(
                    entry,
                    "field",
                    "scalar program record field",
                )?)?;
                let _source_order = require_non_negative_usize(
                    require_field(entry, "sourceOrder", "scalar program record field")?,
                    "scalar program record field sourceOrder",
                )?;
                ValidatedScalarProgramCollectionValue::RecordField {
                    source_value_id,
                    field,
                }
            }
            "if" => {
                reject_unexpected_fields(
                    entry,
                    &[
                        "valueId",
                        "kind",
                        "condition",
                        "thenValueId",
                        "elseValueId",
                        "sourceOrder",
                    ],
                    "scalar program collection if",
                )?;
                let condition = validate_typed_expression_payload(require_field(
                    entry,
                    "condition",
                    "scalar program collection if",
                )?)?;
                let then_value_id = non_empty_string(
                    require_field(entry, "thenValueId", "scalar program collection if")?,
                    "scalar program collection if thenValueId",
                )?
                .to_owned();
                let else_value_id = non_empty_string(
                    require_field(entry, "elseValueId", "scalar program collection if")?,
                    "scalar program collection if elseValueId",
                )?
                .to_owned();
                let source_order =
                    require_field(entry, "sourceOrder", "scalar program collection if")?
                        .as_f64()
                        .filter(|value| value.is_finite() && *value >= 0.0)
                        .ok_or_else(|| {
                            issue(
                        Code::InvalidFieldType,
                        "scalar program collection if sourceOrder must be a non-negative number",
                    )
                        })?;
                ValidatedScalarProgramCollectionValue::If {
                    condition: Box::new(condition),
                    then_value_id,
                    else_value_id,
                    source_order,
                }
            }
            "match" => {
                reject_unexpected_fields(
                    entry,
                    &["valueId", "kind", "scrutinee", "arms", "sourceOrder"],
                    "scalar program collection match",
                )?;
                let scrutinee = validate_typed_expression_payload(require_field(
                    entry,
                    "scrutinee",
                    "scalar program collection match",
                )?)?;
                let arms = require_field(entry, "arms", "scalar program collection match")?
                    .as_array()
                    .ok_or_else(|| {
                        issue(
                            Code::InvalidFieldType,
                            "scalar program collection match arms must be an array",
                        )
                    })?;
                let mut decoded_arms = Vec::with_capacity(arms.len());
                for arm in arms {
                    let arm = as_object(arm, "scalar program collection match arm")?;
                    reject_unexpected_fields(
                        arm,
                        &["label", "valueId"],
                        "scalar program collection match arm",
                    )?;
                    let label = non_empty_string(
                        require_field(arm, "label", "scalar program collection match arm")?,
                        "scalar program collection match arm label",
                    )?
                    .to_owned();
                    let value_id = non_empty_string(
                        require_field(arm, "valueId", "scalar program collection match arm")?,
                        "scalar program collection match arm valueId",
                    )?
                    .to_owned();
                    decoded_arms.push((label, value_id));
                }
                let source_order =
                    require_field(entry, "sourceOrder", "scalar program collection match")?
                        .as_f64()
                        .filter(|value| value.is_finite() && *value >= 0.0)
                        .ok_or_else(|| {
                            issue(
                        Code::InvalidFieldType,
                        "scalar program collection match sourceOrder must be a non-negative number",
                    )
                        })?;
                ValidatedScalarProgramCollectionValue::Match {
                    scrutinee: Box::new(scrutinee),
                    arms: decoded_arms,
                    source_order,
                }
            }
            _ => {
                return Err(issue(
                    Code::UnknownKind,
                    "unknown scalar program collection value kind",
                ))
            }
        };
        decoded.push(ValidatedScalarProgramCollection {
            value_id,
            value: decoded_value,
        });
    }
    Ok(decoded)
}

fn non_empty_string<'a>(json: &'a Value, context: &str) -> Result<&'a str, ScalarPayloadIssue> {
    json.as_str()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            issue(
                Code::InvalidFieldType,
                format!("{context} must be a non-empty string"),
            )
        })
}

fn require_non_negative_usize(json: &Value, context: &str) -> Result<usize, ScalarPayloadIssue> {
    json.as_u64().map(|value| value as usize).ok_or_else(|| {
        issue(
            Code::InvalidFieldType,
            format!("{context} must be a non-negative integer"),
        )
    })
}

fn decode_record_field_path(
    json: Option<&Value>,
    context: &str,
) -> Result<Option<Vec<ValidatedScalarProgramRecordFieldPathEntry>>, ScalarPayloadIssue> {
    let Some(json) = json else {
        return Ok(None);
    };
    let entries = json.as_array().ok_or_else(|| {
        issue(
            Code::InvalidFieldType,
            format!("{context} fieldPath must be an array"),
        )
    })?;
    let mut decoded = Vec::with_capacity(entries.len());
    for entry in entries {
        let object = as_object(entry, &format!("{context} fieldPath entry"))?;
        reject_unexpected_fields(
            object,
            &["recordStatementId", "fieldIndex"],
            &format!("{context} fieldPath entry"),
        )?;
        decoded.push(ValidatedScalarProgramRecordFieldPathEntry {
            record_statement_id: non_empty_string(
                require_field(
                    object,
                    "recordStatementId",
                    &format!("{context} fieldPath entry"),
                )?,
                &format!("{context} fieldPath entry recordStatementId"),
            )?
            .to_owned(),
            field_index: require_non_negative_usize(
                require_field(object, "fieldIndex", &format!("{context} fieldPath entry"))?,
                &format!("{context} fieldPath entry fieldIndex"),
            )?,
        });
    }
    if decoded.is_empty() {
        return Err(issue(
            Code::InvalidFieldType,
            format!("{context} fieldPath must not be empty"),
        ));
    }
    Ok(Some(decoded))
}

fn decode_record_field_identity(
    json: &Value,
) -> Result<ValidatedScalarProgramRecordFieldIdentity, ScalarPayloadIssue> {
    let object = as_object(json, "scalar program record field identity")?;
    reject_unexpected_fields(
        object,
        &["recordStatementId", "fieldIndex", "type", "fieldPath"],
        "scalar program record field identity",
    )?;
    Ok(ValidatedScalarProgramRecordFieldIdentity {
        record_statement_id: non_empty_string(
            require_field(
                object,
                "recordStatementId",
                "scalar program record field identity",
            )?,
            "scalar program record field identity recordStatementId",
        )?
        .to_owned(),
        field_index: require_non_negative_usize(
            require_field(object, "fieldIndex", "scalar program record field identity")?,
            "scalar program record field identity fieldIndex",
        )?,
        r#type: decode_scalar_type(require_field(
            object,
            "type",
            "scalar program record field identity",
        )?)?,
        field_path: decode_record_field_path(
            object.get("fieldPath"),
            "scalar program record field identity",
        )?,
    })
}

fn decode_record_fields(
    json: &Value,
    with_binding_id: bool,
) -> Result<Vec<ValidatedScalarProgramRecordField>, ScalarPayloadIssue> {
    let fields = json.as_array().ok_or_else(|| {
        issue(
            Code::InvalidFieldType,
            "scalar program record fields must be an array",
        )
    })?;
    let mut decoded = Vec::with_capacity(fields.len());
    for field in fields {
        let object = as_object(field, "scalar program record field")?;
        let allowed = if with_binding_id {
            &[
                "recordStatementId",
                "fieldIndex",
                "type",
                "bindingId",
                "fieldPath",
            ][..]
        } else {
            &["recordStatementId", "fieldIndex", "type", "fieldPath"][..]
        };
        reject_unexpected_fields(object, allowed, "scalar program record field")?;
        let binding_id = if with_binding_id {
            Some(
                non_empty_string(
                    require_field(object, "bindingId", "scalar program record field")?,
                    "scalar program record field bindingId",
                )?
                .to_owned(),
            )
        } else {
            None
        };
        decoded.push(ValidatedScalarProgramRecordField {
            record_statement_id: non_empty_string(
                require_field(object, "recordStatementId", "scalar program record field")?,
                "scalar program record field recordStatementId",
            )?
            .to_owned(),
            field_index: require_non_negative_usize(
                require_field(object, "fieldIndex", "scalar program record field")?,
                "scalar program record field fieldIndex",
            )?,
            r#type: decode_scalar_type(require_field(
                object,
                "type",
                "scalar program record field",
            )?)?,
            binding_id: binding_id.unwrap_or_default(),
            field_path: decode_record_field_path(
                object.get("fieldPath"),
                "scalar program record field",
            )?,
        });
    }
    Ok(decoded)
}

fn decode_record_field_bodies(
    json: &Value,
) -> Result<Vec<ValidatedScalarProgramRecordFieldBody>, ScalarPayloadIssue> {
    let fields = json.as_array().ok_or_else(|| {
        issue(
            Code::InvalidFieldType,
            "scalar program record map fields must be an array",
        )
    })?;
    let mut decoded = Vec::with_capacity(fields.len());
    for field in fields {
        let object = as_object(field, "scalar program record map field")?;
        reject_unexpected_fields(
            object,
            &[
                "recordStatementId",
                "fieldIndex",
                "type",
                "body",
                "fieldPath",
            ],
            "scalar program record map field",
        )?;
        decoded.push(ValidatedScalarProgramRecordFieldBody {
            record_statement_id: non_empty_string(
                require_field(
                    object,
                    "recordStatementId",
                    "scalar program record map field",
                )?,
                "scalar program record map field recordStatementId",
            )?
            .to_owned(),
            field_index: require_non_negative_usize(
                require_field(object, "fieldIndex", "scalar program record map field")?,
                "scalar program record map field fieldIndex",
            )?,
            r#type: decode_scalar_type(require_field(
                object,
                "type",
                "scalar program record map field",
            )?)?,
            body: Box::new(validate_typed_expression_payload(require_field(
                object,
                "body",
                "scalar program record map field",
            )?)?),
            field_path: decode_record_field_path(
                object.get("fieldPath"),
                "scalar program record map field",
            )?,
        });
    }
    Ok(decoded)
}

fn decode_declaration(
    json: &Value,
) -> Result<(ScalarType, Result<TypedScalarExpression, String>), ScalarPayloadIssue> {
    let object = as_object(json, "scalar program declaration")?;
    reject_unexpected_fields(
        object,
        &["bindingKind", "declaredType", "initializer"],
        "scalar program declaration",
    )?;
    match non_empty_string(
        require_field(object, "bindingKind", "scalar program declaration")?,
        "scalar program declaration bindingKind",
    )? {
        "const" | "let" => {}
        _ => {
            return Err(issue(
                Code::InvalidFieldType,
                "scalar program declaration bindingKind must be const or let",
            ))
        }
    }
    let declared_type = decode_scalar_type(require_field(
        object,
        "declaredType",
        "scalar program declaration",
    )?)?;
    let initializer = validate_typed_expression_payload(require_field(
        object,
        "initializer",
        "scalar program declaration",
    )?)
    .map_err(|error| error.code.as_str().to_owned());
    Ok((declared_type, initializer))
}

fn decode_statement(
    json: &Value,
    binding_ids: &mut HashSet<String>,
) -> Result<ValidatedScalarProgramStatement, ScalarPayloadIssue> {
    let object = as_object(json, "scalar program statement")?;
    reject_unexpected_fields(
        object,
        &["kind", "bindingId", "scopeId", "sourceOrder", "declaration"],
        "scalar program statement",
    )?;
    if non_empty_string(
        require_field(object, "kind", "scalar program statement")?,
        "scalar program statement kind",
    )? != "declare"
    {
        return Err(issue(
            Code::UnknownKind,
            "unknown scalar program statement kind",
        ));
    }
    let binding_id = non_empty_string(
        require_field(object, "bindingId", "scalar program statement")?,
        "scalar program statement bindingId",
    )?;
    if !binding_ids.insert(binding_id.to_owned()) {
        return Err(issue(
            Code::InvalidBindingId,
            "scalar program bindingId must be unique",
        ));
    }
    non_empty_string(
        require_field(object, "scopeId", "scalar program statement")?,
        "scalar program statement scopeId",
    )?;
    let source_order = require_field(object, "sourceOrder", "scalar program statement")?
        .as_u64()
        .ok_or_else(|| {
            issue(
                Code::InvalidFieldType,
                "scalar program sourceOrder must be a non-negative integer",
            )
        })? as usize;
    let (declared_type, initializer) = decode_declaration(require_field(
        object,
        "declaration",
        "scalar program statement",
    )?)?;
    Ok(ValidatedScalarProgramStatement {
        binding_id: binding_id.to_owned(),
        source_order,
        declared_type,
        initializer,
    })
}

pub(crate) fn validate_scalar_program_payload(
    json: &Value,
) -> Result<ValidatedScalarProgram, ScalarPayloadIssue> {
    let object = as_object(json, "scalar program")?;
    reject_unexpected_fields(
        object,
        &[
            "statements",
            "collectionValues",
            "evaluationLimitSourceOrder",
            "postStopBindingIds",
        ],
        "scalar program",
    )?;
    let statements = require_field(object, "statements", "scalar program")?
        .as_array()
        .ok_or_else(|| {
            issue(
                Code::InvalidFieldType,
                "scalar program statements must be an array",
            )
        })?;
    let mut binding_ids = HashSet::new();
    let mut decoded = Vec::with_capacity(statements.len());
    for statement in statements {
        decoded.push(decode_statement(statement, &mut binding_ids)?);
    }
    let collection_values = object
        .get("collectionValues")
        .map(decode_collection_values)
        .transpose()?
        .unwrap_or_default();
    let post_stop_binding_ids = object
        .get("postStopBindingIds")
        .map(|value| {
            let ids = value.as_array().ok_or_else(|| {
                issue(
                    Code::InvalidFieldType,
                    "scalar program postStopBindingIds must be an array",
                )
            })?;
            let mut result = HashSet::new();
            for id in ids {
                let id = non_empty_string(id, "scalar program postStopBindingIds entry")?;
                if !binding_ids.contains(id) || !result.insert(id.to_owned()) {
                    return Err(issue(
                        Code::InvalidBindingId,
                        "scalar program postStopBindingIds contains an unknown or duplicate bindingId",
                    ));
                }
            }
            Ok(result)
        })
        .transpose()?
        .unwrap_or_default();
    let evaluation_limit_source_order = match object.get("evaluationLimitSourceOrder") {
        Some(limit) => Some(limit.as_u64().ok_or_else(|| {
            issue(
                Code::InvalidFieldType,
                "scalar program evaluationLimitSourceOrder must be a non-negative integer",
            )
        })? as usize),
        None => None,
    };
    Ok(ValidatedScalarProgram {
        statements: decoded,
        collection_values,
        evaluation_limit_source_order,
        post_stop_binding_ids,
    })
}
