use serde_json::Value;

use super::types::{
    element_display_name, element_id, find_element_name, DependencyError, EvaluationState,
    NumericEvalError,
};

pub(crate) fn dependency_error(
    state: &EvaluationState,
    element: &Value,
    missing_dependency_id: &str,
) -> DependencyError {
    let missing_dependency_name = find_element_name(state, missing_dependency_id);
    let dependency_label = missing_dependency_name
        .clone()
        .unwrap_or_else(|| missing_dependency_id.to_owned());
    let disabled_group_id = state
        .group_states
        .get(missing_dependency_id)
        .and_then(|state| state.disabled_by_group_id.clone());
    let disabled_group_name = disabled_group_id
        .as_deref()
        .and_then(|id| find_element_name(state, id));
    let dependency_directly_disabled = state
        .elements_by_id
        .get(missing_dependency_id)
        .and_then(|index| state.elements.get(*index))
        .and_then(|dependency| dependency.get("activity"))
        .and_then(Value::as_str)
        == Some("disabled");
    let element_name = element_display_name(element);
    let dependency_evaluation_failed = disabled_group_name.is_none()
        && !dependency_directly_disabled
        && state.elements_by_id.contains_key(missing_dependency_id)
        && state
            .errors
            .iter()
            .any(|error| error.element_id == missing_dependency_id);

    DependencyError {
        element_id: element_id(element).unwrap_or_default(),
        element_name: element_name.clone(),
        missing_dependency_id: missing_dependency_id.to_owned(),
        missing_dependency_name,
        message: if let Some(group_name) = disabled_group_name {
            format!(
                "{element_name} は {dependency_label} を参照していますが、{dependency_label} はグループ {group_name} により評価OFFです。{group_name} を評価ONにするか、参照先を変更してください。"
            )
        } else if dependency_directly_disabled {
            format!(
                "{element_name} は {dependency_label} を参照していますが、{dependency_label} は評価OFFです。{dependency_label} を評価ONにするか、参照先を変更してください。"
            )
        } else if dependency_evaluation_failed {
            format!(
                "{element_name} は {dependency_label} を参照していますが、{dependency_label} の評価に失敗しているため評価できません。先に {dependency_label} のエラーを解消してください。"
            )
        } else {
            format!(
                "{element_name} は {dependency_label} を参照していますが、{dependency_label} はこの要素より後にあるか、存在しません。{dependency_label} を {element_name} より前に移動してください。"
            )
        },
    }
}

pub(crate) fn geometry_error(element: &Value, message: String) -> DependencyError {
    DependencyError {
        element_id: element_id(element).unwrap_or_default(),
        element_name: element_display_name(element),
        missing_dependency_id: element_id(element).unwrap_or_default(),
        missing_dependency_name: Some(element_display_name(element)),
        message,
    }
}

pub(crate) fn for_group_ancestor_error(element: &Value, target: &Value) -> DependencyError {
    let element_name = element_display_name(element);
    let target_name = element_display_name(target);
    DependencyError {
        element_id: element_id(element).unwrap_or_default(),
        element_name: element_name.clone(),
        missing_dependency_id: element_id(target).unwrap_or_default(),
        missing_dependency_name: Some(target_name.clone()),
        message: format!(
            "{element_name} の対象「{target_name}」はこの反転が属する for の外側にあるため反転できません。対象を同じ for の内側の要素にしてください。"
        ),
    }
}

pub(crate) fn numeric_error(state: &mut EvaluationState, element: &Value, error: NumericEvalError) {
    let disabled_group_id = state
        .group_states
        .get(&error.dependency_id)
        .and_then(|state| state.disabled_by_group_id.clone());
    let disabled_group_name = disabled_group_id
        .as_deref()
        .and_then(|id| find_element_name(state, id));
    let element_name = element_display_name(element);

    state.errors.push(DependencyError {
        element_id: element_id(element).unwrap_or_default(),
        element_name: element_name.clone(),
        missing_dependency_id: error.dependency_id,
        missing_dependency_name: error.dependency_name,
        message: disabled_group_name.map_or_else(
            || format!("{element_name} の数値式を評価できません。{}", error.message),
            |group_name| {
                format!(
                    "{element_name} の数値式を評価できません。参照先はグループ {group_name} により評価OFFです。{group_name} を評価ONにするか、数値式を変更してください。"
                )
            },
        ),
    });
}
