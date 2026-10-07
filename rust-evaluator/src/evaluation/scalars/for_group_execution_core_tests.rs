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
        iteration_value_overrides: vec![],
        generated_statements: vec![()],
    };
    environment
        .run(&plan, |environment, context| {
            assert_eq!(
                environment.read(context.iteration_binding_id),
                Some(LoopRead::Iteration(0.0))
            );
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
        iteration_value_overrides: vec![],
        generated_statements: vec![()],
    };
    environment
        .run(&plan, |_environment, _| {
            Ok(ForGroupExecutionRunOutcome::Completed)
        })
        .unwrap();
    assert_eq!(environment.final_values().get("carry"), Some(&7.0));
}

#[test]
fn iteration_binding_reads_exact_typed_override_and_remains_read_only() {
    use super::ForGroupExecutionError;
    use crate::evaluation::scalars::{ScalarEvaluation, ScalarType, ScalarValue};

    let expected = ScalarEvaluation::Ok {
        r#type: ScalarType::String,
        value: ScalarValue::String("a".to_owned()),
    };
    let mut environment = ForGroupExecutionEnvironment::new(HashMap::new());
    let plan = ForGroupExecutionPlan {
        loop_scope_id: "scope:collection".to_owned(),
        iteration_binding_id: "binding:iteration:item".to_owned(),
        iteration_values: vec![0.0],
        iteration_value_overrides: vec![Some(expected.clone())],
        generated_statements: vec![()],
    };

    environment
        .run(&plan, |environment, context| {
            assert_eq!(context.iteration_value, 0.0);
            assert_eq!(
                environment.read(context.iteration_binding_id),
                Some(LoopRead::TypedIteration(expected.clone()))
            );
            assert_eq!(
                environment.commit(context.iteration_binding_id, expected.clone()),
                Err(ForGroupExecutionError::ReadOnlyIterationBinding(
                    "binding:iteration:item".to_owned()
                ))
            );
            Ok(ForGroupExecutionRunOutcome::Completed)
        })
        .unwrap();
}

#[test]
fn visible_binding_snapshot_matches_current_iteration_carries_and_body_locals() {
    use crate::evaluation::scalars::{ScalarEvaluation, ScalarType, ScalarValue};

    let iteration_binding_id = "module:instance:iteration:i";
    let carry_binding_id = "module:instance:carry:total";
    let local_binding_id = "module:instance:local:selected";
    let mut environment = ForGroupExecutionEnvironment::new(HashMap::from([
        (
            iteration_binding_id.to_owned(),
            ScalarEvaluation::Ok {
                r#type: ScalarType::Number,
                value: ScalarValue::Number(99.0),
            },
        ),
        (
            carry_binding_id.to_owned(),
            ScalarEvaluation::Ok {
                r#type: ScalarType::Number,
                value: ScalarValue::Number(5.0),
            },
        ),
    ]));
    let plan = ForGroupExecutionPlan {
        loop_scope_id: "scope:module:instance:loop".to_owned(),
        iteration_binding_id: iteration_binding_id.to_owned(),
        iteration_values: vec![2.0],
        iteration_value_overrides: vec![],
        generated_statements: vec![()],
    };

    environment
        .run(&plan, |environment, _| {
            let local = ScalarEvaluation::Ok {
                r#type: ScalarType::Number,
                value: ScalarValue::Number(11.0),
            };
            environment.declare_local(local_binding_id, local.clone())?;
            let snapshot = environment.visible_bindings();

            assert_eq!(
                snapshot.get(iteration_binding_id),
                Some(&LoopRead::Iteration(2.0))
            );
            assert_eq!(
                snapshot.get(carry_binding_id),
                Some(&LoopRead::Slot(ScalarEvaluation::Ok {
                    r#type: ScalarType::Number,
                    value: ScalarValue::Number(5.0),
                }))
            );
            assert_eq!(snapshot.get(local_binding_id), Some(&LoopRead::Slot(local)));
            for binding_id in [iteration_binding_id, carry_binding_id, local_binding_id] {
                assert_eq!(
                    snapshot.get(binding_id).cloned(),
                    environment.read(binding_id)
                );
            }
            Ok(ForGroupExecutionRunOutcome::Completed)
        })
        .unwrap();
}
