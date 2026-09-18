// Host-neutral statement-for execution primitive. The caller owns statement,
// binding, and value identities; this module owns only lexical iteration-frame
// lifetime and the immutable carry snapshot/commit boundary.

export type LoopExecutionValue<T> = ReadonlyMap<string, T>;

export type ForGroupExecutionPlan<Statement, T = unknown> = {
  loopScopeId: string;
  iterationBindingId: string;
  iterationValues: readonly number[];
  /** Optional values corresponding to iterationValues. Collection sources use
   * the numeric index for expansion but expose the immutable member value to
   * the source binding. */
  iterationValueOverrides?: readonly T[];
  /** Optional values for synthetic scalar bindings belonging to a record
   * collection member at each iteration index. */
  iterationRecordFieldOverrides?: readonly ReadonlyMap<string, T>[];
  generatedStatements: readonly Statement[];
  /** Optional immutable carry commit performed after the complete body has
   * observed one iteration-start snapshot. */
  onIterationComplete?: (
    frame: ForGroupExecutionFrame<T>,
    context: Omit<ForGroupIterationContext<Statement>, "statement">
  ) => ForGroupExecutionRunOutcome | void;
};

export type ForGroupIterationContext<Statement> = {
  loopScopeId: string;
  iterationBindingId: string;
  iterationIndex: number;
  iterationValue: number;
  statement: Statement;
};

export type ForGroupExecutionFrame<T> = {
  readonly loopScopeId: string;
  readonly iterationBindingId: string;
  readonly iterationIndex: number;
  readonly iterationValue: number;
  read: (bindingId: string) => T | number | undefined;
  declareLocal: (bindingId: string, value: T) => void;
  commit: (bindingId: string, value: T) => void;
};

export type ForGroupExecutionEnvironment<T> = {
  run: <Statement>(
    plan: ForGroupExecutionPlan<Statement, T>,
    executeStatement: (
      frame: ForGroupExecutionFrame<T>,
      context: ForGroupIterationContext<Statement>
    ) => ForGroupExecutionRunOutcome | void
  ) => ForGroupExecutionRunOutcome;
  read: (bindingId: string) => T | number | undefined;
  /** Seeds loop-owned immutable carries before the first iteration. */
  seed: (bindingId: string, value: T) => void;
  finalValues: () => ReadonlyMap<string, T>;
};

type ActiveFrame<T> = {
  loopScopeId: string;
  iterationBindingId: string;
  iterationIndex: number;
  iterationValue: number;
  iterationValueOverride?: T;
  iterationRecordFieldOverride?: ReadonlyMap<string, T>;
  locals: Map<string, T>;
};

export class ForGroupExecutionError extends Error {}

/**
 * Existing forGroup expansion supplies this at a generated-statement boundary
 * when its compiled evaluation limit has been reached. The core propagates it
 * through all remaining statements, iterations, && nested runs.
 */
export type ForGroupExecutionRunOutcome = "completed" | "stopped";

/**
 * Creates one execution environment. Every iteration gets a fresh local frame;
 * carry state is changed only by the explicit post-snapshot commit callback.
 */
export const createForGroupExecutionEnvironment = <T>(initialSlots: LoopExecutionValue<T>): ForGroupExecutionEnvironment<T> => {
  const outerSlots = new Map(initialSlots);
  const frames: ActiveFrame<T>[] = [];

  const frameFor = (): ActiveFrame<T> => {
    const frame = frames.at(-1);
    if (!frame) throw new ForGroupExecutionError("statement-for execution requires an active iteration frame");
    return frame;
  };

  const read = (bindingId: string): T | number | undefined => {
    for (let index = frames.length - 1; index >= 0; index -= 1) {
      const frame = frames[index];
      if (bindingId === frame.iterationBindingId) return frame.iterationValueOverride ?? frame.iterationValue;
      if (frame.iterationRecordFieldOverride?.has(bindingId)) return frame.iterationRecordFieldOverride.get(bindingId);
      const local = frame.locals.get(bindingId);
      if (local !== undefined) return local;
    }
    return outerSlots.get(bindingId);
  };

  const seed = (bindingId: string, value: T): void => {
    outerSlots.set(bindingId, value);
  };

  const commit = (bindingId: string, value: T): void => {
    if (bindingId === frameFor().iterationBindingId) {
      throw new ForGroupExecutionError(`statement-for iteration binding ${bindingId} is read-only`);
    }
    outerSlots.set(bindingId, value);
  };

  const declareLocal = (bindingId: string, value: T): void => {
    const frame = frameFor();
    if (bindingId === frame.iterationBindingId || frame.locals.has(bindingId)) {
      throw new ForGroupExecutionError(`forGroup local binding ${bindingId} is already defined`);
    }
    frame.locals.set(bindingId, value);
  };

  const run: ForGroupExecutionEnvironment<T>["run"] = (plan, executeStatement) => {
    for (let iterationIndex = 0; iterationIndex < plan.iterationValues.length; iterationIndex += 1) {
      const iterationValue = plan.iterationValues[iterationIndex];
      const active: ActiveFrame<T> = {
        loopScopeId: plan.loopScopeId,
        iterationBindingId: plan.iterationBindingId,
        iterationIndex,
        iterationValue,
        ...(plan.iterationValueOverrides?.[iterationIndex] !== undefined
          ? { iterationValueOverride: plan.iterationValueOverrides[iterationIndex] }
          : {}),
        ...(plan.iterationRecordFieldOverrides?.[iterationIndex]
          ? { iterationRecordFieldOverride: plan.iterationRecordFieldOverrides[iterationIndex] }
          : {}),
        locals: new Map()
      };
      frames.push(active);
      try {
        for (const statement of plan.generatedStatements) {
          const frame: ForGroupExecutionFrame<T> = {
            loopScopeId: active.loopScopeId,
            iterationBindingId: active.iterationBindingId,
            iterationIndex: active.iterationIndex,
            iterationValue: active.iterationValue,
            read,
            declareLocal,
            commit
          };
          const outcome = executeStatement(frame, {
            loopScopeId: active.loopScopeId,
            iterationBindingId: active.iterationBindingId,
            iterationIndex: active.iterationIndex,
            iterationValue: active.iterationValue,
            statement
          });
          if (outcome === "stopped") return "stopped";
        }
        const completion = plan.onIterationComplete?.({
          loopScopeId: active.loopScopeId,
          iterationBindingId: active.iterationBindingId,
          iterationIndex: active.iterationIndex,
          iterationValue: active.iterationValue,
          read,
          declareLocal,
          commit
        }, {
          loopScopeId: active.loopScopeId,
          iterationBindingId: active.iterationBindingId,
          iterationIndex: active.iterationIndex,
          iterationValue: active.iterationValue
        });
        if (completion === "stopped") return "stopped";
      } finally {
        // Exactly Task 33's frame-lifetime rule: locals disappear at the
        // explicit frame boundary, including when a body callback throws.
        frames.pop();
      }
    }
    return "completed";
  };

  return { run, read, seed, finalValues: () => new Map(outerSlots) };
};
