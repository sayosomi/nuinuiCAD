//! Validated document-order path reversal. This boundary receives resolved
//! ids and statement positions from TypeScript; it never parses DSL text.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use super::path_reverse_geometry::reverse_line_like_geometry;
use super::types::{element_name, DependencyError, ElementId, EvaluationState};

#[derive(Debug)]
pub(crate) struct PathMutationIssue {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

#[derive(Debug)]
struct ValidatedPathReversal {
    source_order: usize,
    target_element_id: ElementId,
    conditional_owner_element_id: Option<ElementId>,
    conditional_branch: Option<&'static str>,
}

#[derive(Debug)]
pub(crate) struct ValidatedPathMutations {
    element_source_orders: HashMap<ElementId, usize>,
    reversals: Vec<ValidatedPathReversal>,
}

fn issue(code: &'static str, message: impl Into<String>) -> PathMutationIssue {
    PathMutationIssue {
        code,
        message: message.into(),
    }
}

fn object<'a>(
    value: &'a Value,
    context: &str,
) -> Result<&'a serde_json::Map<String, Value>, PathMutationIssue> {
    value.as_object().ok_or_else(|| {
        issue(
            "path-mutation-invalid-field-type",
            format!("{context} must be an object"),
        )
    })
}

fn array<'a>(value: &'a Value, context: &str) -> Result<&'a Vec<Value>, PathMutationIssue> {
    value.as_array().ok_or_else(|| {
        issue(
            "path-mutation-invalid-field-type",
            format!("{context} must be an array"),
        )
    })
}

fn non_empty_string<'a>(value: &'a Value, context: &str) -> Result<&'a str, PathMutationIssue> {
    value
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            issue(
                "path-mutation-invalid-field-type",
                format!("{context} must be a non-empty string"),
            )
        })
}

fn source_order(value: &Value, context: &str) -> Result<usize, PathMutationIssue> {
    value.as_u64().map(|value| value as usize).ok_or_else(|| {
        issue(
            "path-mutation-invalid-source-order",
            format!("{context} must be a non-negative integer"),
        )
    })
}

fn reject_unexpected_fields(
    object: &serde_json::Map<String, Value>,
    allowed: &[&str],
    context: &str,
) -> Result<(), PathMutationIssue> {
    if let Some(field) = object
        .keys()
        .find(|field| !allowed.contains(&field.as_str()))
    {
        return Err(issue(
            "path-mutation-unexpected-field",
            format!("{context} has unexpected field {field}"),
        ));
    }
    Ok(())
}

fn is_line_like_element(element: &Value) -> bool {
    matches!(
        element.get("type").and_then(Value::as_str),
        Some(
            "line"
                | "angleLengthLine"
                | "arcLine"
                | "threePointArcLine"
                | "cornerRadiusArcLine"
                | "bezierCurve"
                | "offsetLine"
                | "splitLine"
                | "copyLine"
                | "symmetricCopyLine"
        )
    )
}

pub(crate) fn validate_path_mutations_payload(
    payload: &Value,
    elements: &[Value],
) -> Result<ValidatedPathMutations, PathMutationIssue> {
    let payload = object(payload, "pathMutations")?;
    reject_unexpected_fields(
        payload,
        &["elementSourceOrders", "reversals"],
        "pathMutations",
    )?;
    let source_entries = array(
        payload.get("elementSourceOrders").ok_or_else(|| {
            issue(
                "path-mutation-missing-field",
                "pathMutations.elementSourceOrders is required",
            )
        })?,
        "pathMutations.elementSourceOrders",
    )?;
    let reversals = array(
        payload.get("reversals").ok_or_else(|| {
            issue(
                "path-mutation-missing-field",
                "pathMutations.reversals is required",
            )
        })?,
        "pathMutations.reversals",
    )?;
    let elements_by_id = elements
        .iter()
        .filter_map(|element| Some((element.get("id")?.as_str()?.to_owned(), element)))
        .collect::<HashMap<_, _>>();
    let mut element_source_orders = HashMap::new();
    for (index, entry) in source_entries.iter().enumerate() {
        let entry = object(entry, "pathMutations.elementSourceOrders entry")?;
        reject_unexpected_fields(
            entry,
            &["elementId", "sourceOrder"],
            "pathMutations.elementSourceOrders entry",
        )?;
        let element_id = non_empty_string(
            entry.get("elementId").ok_or_else(|| {
                issue(
                    "path-mutation-missing-field",
                    "elementSourceOrders entry elementId is required",
                )
            })?,
            "elementSourceOrders entry elementId",
        )?;
        let order = source_order(
            entry.get("sourceOrder").ok_or_else(|| {
                issue(
                    "path-mutation-missing-field",
                    "elementSourceOrders entry sourceOrder is required",
                )
            })?,
            "elementSourceOrders entry sourceOrder",
        )?;
        if !elements_by_id.contains_key(element_id) {
            return Err(issue(
                "path-mutation-unknown-element",
                format!(
                    "elementSourceOrders entry {index} references unknown element {element_id}"
                ),
            ));
        }
        if element_source_orders
            .insert(element_id.to_owned(), order)
            .is_some()
        {
            return Err(issue(
                "path-mutation-duplicate-element",
                format!("elementSourceOrders duplicates {element_id}"),
            ));
        }
    }
    if element_source_orders.len() != elements_by_id.len() {
        return Err(issue(
            "path-mutation-missing-element",
            "elementSourceOrders must contain every input element",
        ));
    }
    let mut seen_orders = HashSet::new();
    let mut validated = Vec::with_capacity(reversals.len());
    for (index, reversal) in reversals.iter().enumerate() {
        let reversal = object(reversal, "pathMutations reversal")?;
        reject_unexpected_fields(
            reversal,
            &[
                "statementId",
                "sourceOrder",
                "targetElementId",
                "conditionalOwnerElementId",
                "conditionalBranch",
            ],
            "pathMutations reversal",
        )?;
        let _statement_id = non_empty_string(
            reversal.get("statementId").ok_or_else(|| {
                issue(
                    "path-mutation-missing-field",
                    "reversal statementId is required",
                )
            })?,
            "reversal statementId",
        )?
        .to_owned();
        let order = source_order(
            reversal.get("sourceOrder").ok_or_else(|| {
                issue(
                    "path-mutation-missing-field",
                    "reversal sourceOrder is required",
                )
            })?,
            "reversal sourceOrder",
        )?;
        if !seen_orders.insert(order) {
            return Err(issue(
                "path-mutation-duplicate-source-order",
                format!("reversal {index} duplicates sourceOrder {order}"),
            ));
        }
        let target_id = non_empty_string(
            reversal.get("targetElementId").ok_or_else(|| {
                issue(
                    "path-mutation-missing-field",
                    "reversal targetElementId is required",
                )
            })?,
            "reversal targetElementId",
        )?
        .to_owned();
        let Some(target) = elements_by_id.get(&target_id) else {
            return Err(issue(
                "path-mutation-unknown-target",
                format!("reversal {index} references unknown target {target_id}"),
            ));
        };
        if !is_line_like_element(target) {
            return Err(issue(
                "path-mutation-invalid-target",
                format!("reversal {index} target {target_id} is not line-like"),
            ));
        }
        if element_source_orders[&target_id] >= order {
            return Err(issue(
                "path-mutation-target-order",
                format!("reversal {index} target {target_id} must occur earlier"),
            ));
        }
        let owner = reversal.get("conditionalOwnerElementId");
        let branch = reversal.get("conditionalBranch");
        let (conditional_owner_element_id, conditional_branch) = match (owner, branch) {
            (None, None) => (None, None),
            (Some(owner), Some(branch)) => {
                let owner =
                    non_empty_string(owner, "reversal conditionalOwnerElementId")?.to_owned();
                let branch = match non_empty_string(branch, "reversal conditionalBranch")? {
                    "then" => "then",
                    "else" => "else",
                    _ => {
                        return Err(issue(
                            "path-mutation-invalid-branch",
                            "reversal conditionalBranch must be then or else",
                        ))
                    }
                };
                if elements_by_id
                    .get(&owner)
                    .and_then(|element| element.get("type"))
                    .and_then(Value::as_str)
                    != Some("conditionalGroup")
                {
                    return Err(issue(
                        "path-mutation-invalid-owner",
                        format!("reversal {index} owner {owner} is not a conditionalGroup"),
                    ));
                }
                if element_source_orders[&owner] >= order {
                    return Err(issue(
                        "path-mutation-owner-order",
                        format!("reversal {index} owner {owner} must occur earlier"),
                    ));
                }
                (Some(owner), Some(branch))
            }
            _ => {
                return Err(issue(
                    "path-mutation-invalid-conditional",
                    "conditional owner and branch must be supplied together",
                ))
            }
        };
        validated.push(ValidatedPathReversal {
            source_order: order,
            target_element_id: target_id,
            conditional_owner_element_id,
            conditional_branch,
        });
    }
    validated.sort_by_key(|reversal| reversal.source_order);
    Ok(ValidatedPathMutations {
        element_source_orders,
        reversals: validated,
    })
}

pub(crate) struct PathMutationResolver<'a> {
    program: &'a ValidatedPathMutations,
    next_reversal: usize,
}

impl<'a> PathMutationResolver<'a> {
    pub(crate) fn new(program: &'a ValidatedPathMutations) -> Self {
        Self {
            program,
            next_reversal: 0,
        }
    }

    pub(crate) fn source_order_for_element(&self, element_id: &str) -> Option<usize> {
        self.program.element_source_orders.get(element_id).copied()
    }

    pub(crate) fn advance_before(
        &mut self,
        source_order: usize,
        state: &mut EvaluationState,
        conditional_group_states: &HashMap<ElementId, Option<&'static str>>,
    ) {
        while self.next_reversal < self.program.reversals.len()
            && self.program.reversals[self.next_reversal].source_order < source_order
        {
            let reversal = &self.program.reversals[self.next_reversal];
            self.next_reversal += 1;
            if let Some(owner) = &reversal.conditional_owner_element_id {
                if conditional_group_states.get(owner).copied().flatten()
                    != reversal.conditional_branch
                {
                    continue;
                }
            }
            apply_reversal(reversal, state);
        }
    }

    pub(crate) fn finalize(
        &mut self,
        state: &mut EvaluationState,
        conditional_group_states: &HashMap<ElementId, Option<&'static str>>,
    ) {
        self.advance_before(usize::MAX, state, conditional_group_states);
    }
}

fn apply_reversal(reversal: &ValidatedPathReversal, state: &mut EvaluationState) {
    let reversed = state
        .computed_geometry
        .get(&reversal.target_element_id)
        .and_then(reverse_line_like_geometry);
    if let Some(geometry) = reversed {
        state
            .computed_geometry
            .insert(reversal.target_element_id.clone(), geometry);
        return;
    }
    let target_name = state
        .elements_by_id
        .get(&reversal.target_element_id)
        .and_then(|index| state.elements.get(*index))
        .map(element_name)
        .unwrap_or_else(|| reversal.target_element_id.clone());
    state.errors.push(DependencyError {
        element_id: reversal.target_element_id.clone(),
        element_name: target_name.clone(),
        missing_dependency_id: reversal.target_element_id.clone(),
        missing_dependency_name: Some(target_name.clone()),
        message: format!("reverse の対象「{target_name}」はこの時点で有効な線ではありません。"),
    });
}
