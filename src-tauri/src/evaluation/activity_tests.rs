use serde_json::json;

use super::activity::{
    activity_allows_drawing, activity_allows_evaluation, activity_from_legacy_flags,
    effective_activity_by_element_id, ElementActivity,
};

#[test]
fn legacy_flags_use_the_shared_three_state_truth_table() {
    let cases = [
        (
            json!({ "visible": true, "enabled": true }),
            ElementActivity::Visible,
        ),
        (
            json!({ "visible": false, "enabled": true }),
            ElementActivity::Hidden,
        ),
        (
            json!({ "visible": true, "enabled": false }),
            ElementActivity::Disabled,
        ),
        (
            json!({ "visible": false, "enabled": false }),
            ElementActivity::Disabled,
        ),
    ];

    for (element, activity) in cases {
        assert_eq!(activity_from_legacy_flags(&element), activity);
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
        json!({ "id": "hidden", "type": "group", "visible": false, "enabled": true }),
        json!({ "id": "nested", "type": "group", "parentGroupId": "hidden", "visible": true, "enabled": false }),
        json!({ "id": "child", "type": "freePoint", "parentGroupId": "nested", "visible": true, "enabled": true }),
    ]);

    assert_eq!(activities["child"].activity, ElementActivity::Disabled);
    assert_eq!(
        activities["child"].disabled_by_element_id.as_deref(),
        Some("nested")
    );
}
