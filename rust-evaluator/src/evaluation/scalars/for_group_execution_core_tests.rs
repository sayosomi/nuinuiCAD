use std::collections::HashMap;

use super::for_group_execution_core::{
    ForGroupExecutionEnvironment, ForGroupExecutionPlan, ForGroupExecutionRunOutcome, LoopRead,
};

#[test]
fn commits_multiple_carries_from_one_iteration_snapshot() {
    let mut environment = ForGroupExecutionEnvironment::new(HashMap::from([
        ("a".to_owned(), 1.0),
        ("b".to_owned(), 2.0),
    ]));
    let plan = ForGroupExecutionPlan {
        loop_scope_id: "scope:loop".to_owned(),
        iteration_binding_id: "binding:iteration:i".to_owned(),
        iteration_values: vec![0.0],
        generated_statements: vec![()],
    };
    environment
        .run(&plan, |environment, _| {
            let value_a = match environment.read("b") {
                Some(LoopRead::Slot(value)) => value,
                _ => panic!("missing b snapshot"),
            };
            let value_b = match environment.read("a") {
                Some(LoopRead::Slot(value)) => value,
                _ => panic!("missing a snapshot"),
            };
            environment.commit("a", value_a)?;
            environment.commit("b", value_b)?;
            Ok(ForGroupExecutionRunOutcome::Completed)
        })
        .unwrap();
    assert_eq!(environment.final_values().get("a"), Some(&2.0));
    assert_eq!(environment.final_values().get("b"), Some(&1.0));
}

#[test]
fn empty_execution_preserves_seeded_initial_value() {
    let mut environment = ForGroupExecutionEnvironment::new(HashMap::new());
    environment.seed("carry", 7.0).unwrap();
    let plan = ForGroupExecutionPlan {
        loop_scope_id: "scope:empty".to_owned(),
        iteration_binding_id: "binding:iteration:i".to_owned(),
        iteration_values: vec![],
        generated_statements: vec![()],
    };
    environment
        .run(&plan, |_environment, _| {
            Ok(ForGroupExecutionRunOutcome::Completed)
        })
        .unwrap();
    assert_eq!(environment.final_values().get("carry"), Some(&7.0));
}
