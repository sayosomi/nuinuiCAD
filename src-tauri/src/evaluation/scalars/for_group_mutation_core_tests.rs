use std::collections::HashMap;
use std::time::Instant;

use serde_json::Value;

use super::for_group_mutation_core::{
    ForGroupIterationContext, ForGroupMutationEnvironment, ForGroupMutationError,
    ForGroupMutationPlan, ForGroupMutationRunOutcome, LoopRead,
};

fn fixture_cases() -> Vec<Value> {
    serde_json::from_str(include_str!(
        "../../../../test/fixtures/scalars/for_group_mutation_core.json"
    ))
    .expect("shared forGroup mutation fixture must be valid JSON")
}

fn number(value: Option<LoopRead<f64>>) -> f64 {
    match value {
        Some(LoopRead::Iteration(value)) | Some(LoopRead::Slot(value)) => value,
        None => panic!("expected numeric loop slot"),
    }
}

#[test]
fn matches_shared_for_group_mutation_fixture() {
    for case in fixture_cases() {
        let name = case["name"].as_str().unwrap();
        let initial = case["initial"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(key, value)| (key.clone(), value.as_f64().unwrap()))
            .collect::<HashMap<_, _>>();
        let values = case["iterations"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_f64().unwrap())
            .collect::<Vec<_>>();
        let mut environment = ForGroupMutationEnvironment::new(initial);
        let plan = ForGroupMutationPlan {
            loop_scope_id: "scope:loop".to_owned(),
            iteration_binding_id: "binding:iteration:i".to_owned(),
            iteration_values: values,
            generated_statements: vec![name],
        };
        environment
            .run(&plan, |environment, context| {
                match *context.statement {
                    "local_reset" => {
                        environment.declare_local("binding:local", 0.0)?;
                        environment.set(
                            "binding:local",
                            number(environment.read("binding:local")) + 1.0,
                        )?;
                        environment.set("sum", number(environment.read("binding:local")))?;
                    }
                    "poison_recovery" => environment.set("sum", context.iteration_value)?,
                    _ => environment.set(
                        "sum",
                        number(environment.read("sum")) + context.iteration_value,
                    )?,
                }
                Ok(ForGroupMutationRunOutcome::Completed)
            })
            .unwrap_or_else(|error| panic!("{name}: {error:?}"));
        let expected = case["expected"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(key, value)| (key.clone(), value.as_f64().unwrap()))
            .collect::<HashMap<_, _>>();
        assert_eq!(environment.final_slots(), expected, "{name}");
    }
}

#[test]
fn carries_outer_slots_and_retires_nested_locals() {
    let mut environment =
        ForGroupMutationEnvironment::new(HashMap::from([("sum".to_owned(), 0.0)]));
    let outer = ForGroupMutationPlan {
        loop_scope_id: "scope:outer".to_owned(),
        iteration_binding_id: "binding:iteration:i".to_owned(),
        iteration_values: vec![1.0, 2.0],
        generated_statements: vec!["if", "nested"],
    };
    environment
        .run(&outer, |environment, context| {
            if *context.statement == "if" {
                if context.iteration_index == 0 {
                    environment.set(
                        "sum",
                        number(environment.read("sum")) + context.iteration_value,
                    )?;
                }
                return Ok(ForGroupMutationRunOutcome::Completed);
            }
            let inner = ForGroupMutationPlan {
                loop_scope_id: "scope:inner".to_owned(),
                iteration_binding_id: "binding:iteration:j".to_owned(),
                iteration_values: vec![10.0],
                generated_statements: vec!["body"],
            };
            environment
                .run(&inner, |environment, inner_context| {
                    environment.declare_local("binding:local", inner_context.iteration_value)?;
                    environment.set(
                        "sum",
                        number(environment.read("sum")) + number(environment.read("binding:local")),
                    )?;
                    Ok(ForGroupMutationRunOutcome::Completed)
                })
                .map(|_| ForGroupMutationRunOutcome::Completed)
        })
        .unwrap();
    assert_eq!(
        environment.final_slots(),
        HashMap::from([("sum".to_owned(), 21.0)])
    );
    assert_eq!(environment.read("binding:local"), None);
}

#[test]
fn rejects_iteration_binding_assignment_and_retires_failed_frame() {
    let mut environment = ForGroupMutationEnvironment::new(HashMap::<String, f64>::new());
    let plan = ForGroupMutationPlan {
        loop_scope_id: "scope:loop".to_owned(),
        iteration_binding_id: "binding:iteration:i".to_owned(),
        iteration_values: vec![0.0],
        generated_statements: vec!["set"],
    };
    let error = environment.run(
        &plan,
        |environment, _: ForGroupIterationContext<'_, &str>| {
            environment.declare_local("binding:local", 1.0)?;
            environment
                .set("binding:iteration:i", 1.0)
                .map(|_| ForGroupMutationRunOutcome::Completed)
        },
    );
    assert_eq!(
        error,
        Err(ForGroupMutationError::ReadOnlyIterationBinding(
            "binding:iteration:i".to_owned()
        ))
    );
    assert_eq!(environment.read("binding:local"), None);
}

#[test]
fn stopped_callback_retires_its_frame_and_stops_remaining_iterations() {
    let mut environment =
        ForGroupMutationEnvironment::new(HashMap::from([("sum".to_owned(), 0.0)]));
    let plan = ForGroupMutationPlan {
        loop_scope_id: "scope:loop".to_owned(),
        iteration_binding_id: "binding:iteration:i".to_owned(),
        iteration_values: vec![1.0, 2.0],
        generated_statements: vec!["body"],
    };
    let outcome = environment
        .run(&plan, |environment, context| {
            environment.declare_local("binding:local", context.iteration_value)?;
            environment.set("sum", context.iteration_value)?;
            Ok(ForGroupMutationRunOutcome::Stopped)
        })
        .unwrap();
    assert_eq!(outcome, ForGroupMutationRunOutcome::Stopped);
    assert_eq!(environment.final_slots().get("sum"), Some(&1.0));
    assert_eq!(environment.read("binding:local"), None);
}

#[derive(Clone, Debug, PartialEq)]
enum Poisonable {
    Value(f64),
    Poisoned,
}

#[test]
fn a_later_body_statement_recovers_a_poisoned_outer_slot() {
    let mut environment = ForGroupMutationEnvironment::new(HashMap::from([(
        "sum".to_owned(),
        Poisonable::Value(0.0),
    )]));
    let plan = ForGroupMutationPlan {
        loop_scope_id: "scope:loop".to_owned(),
        iteration_binding_id: "binding:iteration:i".to_owned(),
        iteration_values: vec![4.0],
        generated_statements: vec!["poison", "recover"],
    };
    environment
        .run(&plan, |environment, context| match *context.statement {
            "poison" => environment
                .set("sum", Poisonable::Poisoned)
                .map(|_| ForGroupMutationRunOutcome::Completed),
            "recover" => environment
                .set("sum", Poisonable::Value(context.iteration_value))
                .map(|_| ForGroupMutationRunOutcome::Completed),
            _ => unreachable!(),
        })
        .unwrap();
    assert_eq!(
        environment.final_slots().get("sum"),
        Some(&Poisonable::Value(4.0))
    );
}

fn run_sum(iteration_count: usize) -> f64 {
    let mut environment =
        ForGroupMutationEnvironment::new(HashMap::from([("sum".to_owned(), 0.0)]));
    let plan = ForGroupMutationPlan {
        loop_scope_id: "scope:benchmark".to_owned(),
        iteration_binding_id: "binding:iteration:i".to_owned(),
        iteration_values: (0..iteration_count).map(|index| index as f64).collect(),
        generated_statements: vec!["sum"],
    };
    environment
        .run(&plan, |environment, context| {
            environment.set(
                "sum",
                number(environment.read("sum")) + context.iteration_value,
            )?;
            Ok(ForGroupMutationRunOutcome::Completed)
        })
        .unwrap();
    number(environment.read("sum"))
}

fn timing_stats(iteration_count: usize) -> (f64, f64) {
    const WARM_UP_RUNS: usize = 5;
    const TRIALS: usize = 21;
    for _ in 0..WARM_UP_RUNS {
        let _ = run_sum(iteration_count);
    }
    let mut samples = Vec::with_capacity(TRIALS);
    for _ in 0..TRIALS {
        let started = Instant::now();
        let _ = run_sum(iteration_count);
        samples.push(started.elapsed().as_secs_f64() * 1_000.0);
    }
    samples.sort_by(f64::total_cmp);
    (
        samples[TRIALS / 2],
        samples[(TRIALS * 95).div_ceil(100) - 1],
    )
}

#[test]
#[ignore]
fn performance_for_group_mutation_core_baseline() {
    let (small_median, small_p95) = timing_stats(250);
    let (large_median, large_p95) = timing_stats(1_000);
    assert!(small_median.is_finite() && small_p95.is_finite());
    assert!(large_median.is_finite() && large_p95.is_finite());
    eprintln!(
        "[typedVariables baseline] {{\"area\":\"forGroupMutationCore\",\"metric\":\"wallTimeMs\",\"warmUpRuns\":5,\"trials\":21,\"small\":{{\"iterationCount\":250,\"medianMs\":{small_median},\"p95Ms\":{small_p95}}},\"large\":{{\"iterationCount\":1000,\"medianMs\":{large_median},\"p95Ms\":{large_p95}}}}}"
    );
}
