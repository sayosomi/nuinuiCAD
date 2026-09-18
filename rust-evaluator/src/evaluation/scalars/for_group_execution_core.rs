//! Host-neutral statement-for execution runner.
//!
//! The caller supplies opaque binding/version/statement identities and a body
//! callback. This module owns only frame lifetime and in-place outer carry;
//! it deliberately has no IPC, geometry, or evaluator dependency.

use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ForGroupExecutionPlan<Statement> {
    pub(crate) loop_scope_id: String,
    pub(crate) iteration_binding_id: String,
    pub(crate) iteration_values: Vec<f64>,
    pub(crate) generated_statements: Vec<Statement>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum LoopRead<T> {
    Iteration(f64),
    Slot(T),
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct ForGroupIterationContext<'a, Statement> {
    pub(crate) loop_scope_id: &'a str,
    pub(crate) iteration_binding_id: &'a str,
    pub(crate) iteration_index: usize,
    pub(crate) iteration_value: f64,
    pub(crate) statement: &'a Statement,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ForGroupExecutionError {
    NoActiveFrame,
    ReadOnlyIterationBinding(String),
    DuplicateLocalBinding(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ForGroupExecutionRunOutcome {
    Completed,
    Stopped,
}

#[derive(Debug)]
struct ActiveFrame<T> {
    loop_scope_id: String,
    iteration_binding_id: String,
    iteration_index: usize,
    iteration_value: f64,
    locals: HashMap<String, T>,
}

/// A stack of Task 33-style lexical frames around one shared outer slot map.
/// Entering/leaving an iteration allocates/drops only the frame's locals.
#[derive(Debug)]
pub(crate) struct ForGroupExecutionEnvironment<T> {
    outer_slots: HashMap<String, T>,
    frames: Vec<ActiveFrame<T>>,
}

impl<T: Clone> ForGroupExecutionEnvironment<T> {
    pub(crate) fn new(initial_slots: HashMap<String, T>) -> Self {
        Self {
            outer_slots: initial_slots,
            frames: Vec::new(),
        }
    }

    pub(crate) fn read(&self, binding_id: &str) -> Option<LoopRead<T>> {
        for frame in self.frames.iter().rev() {
            if binding_id == frame.iteration_binding_id {
                return Some(LoopRead::Iteration(frame.iteration_value));
            }
            if let Some(value) = frame.locals.get(binding_id) {
                return Some(LoopRead::Slot(value.clone()));
            }
        }
        self.outer_slots
            .get(binding_id)
            .cloned()
            .map(LoopRead::Slot)
    }

    pub(crate) fn declare_local(
        &mut self,
        binding_id: &str,
        value: T,
    ) -> Result<(), ForGroupExecutionError> {
        let Some(frame) = self.frames.last_mut() else {
            return Err(ForGroupExecutionError::NoActiveFrame);
        };
        if binding_id == frame.iteration_binding_id || frame.locals.contains_key(binding_id) {
            return Err(ForGroupExecutionError::DuplicateLocalBinding(
                binding_id.to_owned(),
            ));
        }
        frame.locals.insert(binding_id.to_owned(), value);
        Ok(())
    }

    pub(crate) fn seed(
        &mut self,
        binding_id: &str,
        value: T,
    ) -> Result<(), ForGroupExecutionError> {
        self.outer_slots.insert(binding_id.to_owned(), value);
        Ok(())
    }

    pub(crate) fn commit(
        &mut self,
        binding_id: &str,
        value: T,
    ) -> Result<(), ForGroupExecutionError> {
        let Some(frame) = self.frames.last() else {
            return Err(ForGroupExecutionError::NoActiveFrame);
        };
        if binding_id == frame.iteration_binding_id {
            return Err(ForGroupExecutionError::ReadOnlyIterationBinding(
                binding_id.to_owned(),
            ));
        }
        self.outer_slots.insert(binding_id.to_owned(), value);
        Ok(())
    }

    pub(crate) fn final_values(&self) -> HashMap<String, T> {
        self.outer_slots.clone()
    }

    pub(crate) fn run<Statement, F>(
        &mut self,
        plan: &ForGroupExecutionPlan<Statement>,
        mut execute_statement: F,
    ) -> Result<ForGroupExecutionRunOutcome, ForGroupExecutionError>
    where
        F: FnMut(
            &mut Self,
            ForGroupIterationContext<'_, Statement>,
        ) -> Result<ForGroupExecutionRunOutcome, ForGroupExecutionError>,
    {
        for (iteration_index, iteration_value) in plan.iteration_values.iter().copied().enumerate()
        {
            self.frames.push(ActiveFrame {
                loop_scope_id: plan.loop_scope_id.clone(),
                iteration_binding_id: plan.iteration_binding_id.clone(),
                iteration_index,
                iteration_value,
                locals: HashMap::new(),
            });
            let outcome = (|| {
                for statement in &plan.generated_statements {
                    let frame = self
                        .frames
                        .last()
                        .expect("iteration frame must remain active");
                    let loop_scope_id = frame.loop_scope_id.clone();
                    let iteration_binding_id = frame.iteration_binding_id.clone();
                    let iteration_index = frame.iteration_index;
                    let iteration_value = frame.iteration_value;
                    let outcome = execute_statement(
                        self,
                        ForGroupIterationContext {
                            loop_scope_id: &loop_scope_id,
                            iteration_binding_id: &iteration_binding_id,
                            iteration_index,
                            iteration_value,
                            statement,
                        },
                    )?;
                    if outcome == ForGroupExecutionRunOutcome::Stopped {
                        return Ok(ForGroupExecutionRunOutcome::Stopped);
                    }
                }
                Ok(ForGroupExecutionRunOutcome::Completed)
            })();
            // Match Task 33's frame retirement even on callback failure.
            self.frames.pop();
            if outcome? == ForGroupExecutionRunOutcome::Stopped {
                return Ok(ForGroupExecutionRunOutcome::Stopped);
            }
        }
        Ok(ForGroupExecutionRunOutcome::Completed)
    }
}
