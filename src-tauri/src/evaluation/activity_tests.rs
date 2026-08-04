use serde_json::json;

use super::activity::{
    activity_allows_drawing, activity_allows_evaluation, activity_from_element,
    effective_activity_by_element_id, ElementActivity,
};

#[test]
fn activity_values_use_the_shared_three_state_truth_table() {
    let cases = [
        (json!({ "activity": "visible" }), ElementActivity::Visible),
        (json!({ "activity": "hidden" }), ElementActivity::Hidden),
        (json!({ "activity": "disabled" }), ElementActivity::Disabled),
    ];

    for (element, activity) in cases {
        assert_eq!(activity_from_element(&element), activity);
        assert_eq!(
            activity_allows_evaluation(activity),
            activity != ElementActivity::Disabled
        );
        assert_eq!(
            activity_allows_drawing(activity),
            activity == ElementActivity::Visible
        );
    }
}

#[test]
fn parent_disabled_takes_precedence_over_hidden() {
    let activities = effective_activity_by_element_id(&[
        json!({ "id": "hidden", "type": "group", "activity": "hidden" }),
        json!({ "id": "nested", "type": "group", "parentGroupId": "hidden", "activity": "disabled" }),
        json!({ "id": "child", "type": "freePoint", "parentGroupId": "nested", "activity": "visible" }),
    ]);

    assert_eq!(activities["child"].activity, ElementActivity::Disabled);
    assert_eq!(
        activities["child"].disabled_by_element_id.as_deref(),
        Some("nested")
    );
}
