// Task 34's production-unconnected loop mutation primitive. The caller owns
// statement/version/binding identities && the body callback; this module only
// owns iteration frame lifetime && in-place outer-slot carry.

export type LoopMutationSlot<T> = ReadonlyMap<string, T>;

export type ForGroupMutationPlan<Statement> = {
  loopScopeId: string;
  iterationBindingId: string;
  iterationValues: readonly number[];
  generatedStatements: readonly Statement[];
};

export type ForGroupIterationContext<Statement> = {
  loopScopeId: string;
  iterationBindingId: string;
  iterationIndex: number;
  iterationValue: number;
  statement: Statement;
};

export type ForGroupMutationFrame<T> = {
  readonly loopScopeId: string;
  readonly iterationBindingId: string;
  readonly iterationIndex: number;
  readonly iterationValue: number;
  read: (bindingId: string) => T | number | undefined;
  declareLocal: (bindingId: string, value: T) => void;
  set: (bindingId: string, value: T) => void;
};

export type ForGroupMutationEnvironment<T> = {
  run: <Statement>(
    plan: ForGroupMutationPlan<Statement>,
    executeStatement: (
      frame: ForGroupMutationFrame<T>,
      context: ForGroupIterationContext<Statement>
    ) => ForGroupMutationRunOutcome | void
  ) => ForGroupMutationRunOutcome;
  read: (bindingId: string) => T | number | undefined;
  finalSlots: () => ReadonlyMap<string, T>;
};

type ActiveFrame<T> = {
  loopScopeId: string;
  iterationBindingId: string;
  iterationIndex: number;
  iterationValue: number;
  locals: Map<string, T>;
};

export class ForGroupMutationError extends Error {}

/**
 * Existing forGroup expansion supplies this at a generated-statement boundary
 * when its compiled evaluation limit has been reached. The core propagates it
 * through all remaining statements, iterations, && nested runs.
 */
export type ForGroupMutationRunOutcome = "completed" | "stopped";

/**
 * Creates one mutable outer environment. Every iteration gets a fresh local
 * frame, while writes not targeting a local survive into the next iteration.
 * No environment is cloned per iteration.
 */
export const createForGroupMutationEnvironment = <T>(initialSlots: LoopMutationSlot<T>): ForGroupMutationEnvironment<T> => {
  const outerSlots = new Map(initialSlots);
  const frames: ActiveFrame<T>[] = [];

  const frameFor = (): ActiveFrame<T> => {
    const frame = frames.at(-1);
    if (!frame) throw new ForGroupMutationError("forGroup mutation requires an active iteration frame");
    return frame;
  };

  const read = (bindingId: string): T | number | undefined => {
    for (let index = frames.length - 1; index >= 0; index -= 1) {
      const frame = frames[index];
      if (bindingId === frame.iterationBindingId) return frame.iterationValue;
      const local = frame.locals.get(bindingId);
      if (local !== undefined) return local;
    }
    return outerSlots.get(bindingId);
  };

  const set = (bindingId: string, value: T): void => {
    for (let index = frames.length - 1; index >= 0; index -= 1) {
      const frame = frames[index];
      if (bindingId === frame.iterationBindingId) {
        throw new ForGroupMutationError(`forGroup iteration binding ${bindingId} is read-only`);
      }
      if (frame.locals.has(bindingId)) {
        frame.locals.set(bindingId, value);
        return;
      }
    }
    outerSlots.set(bindingId, value);
  };

  const declareLocal = (bindingId: string, value: T): void => {
    const frame = frameFor();
    if (bindingId === frame.iterationBindingId || frame.locals.has(bindingId)) {
      throw new ForGroupMutationError(`forGroup local binding ${bindingId} is already defined`);
    }
    frame.locals.set(bindingId, value);
  };

  const run: ForGroupMutationEnvironment<T>["run"] = (plan, executeStatement) => {
    for (let iterationIndex = 0; iterationIndex < plan.iterationValues.length; iterationIndex += 1) {
      const iterationValue = plan.iterationValues[iterationIndex];
      const active: ActiveFrame<T> = {
        loopScopeId: plan.loopScopeId,
        iterationBindingId: plan.iterationBindingId,
        iterationIndex,
        iterationValue,
        locals: new Map()
      };
      frames.push(active);
      try {
        for (const statement of plan.generatedStatements) {
          const frame: ForGroupMutationFrame<T> = {
            loopScopeId: active.loopScopeId,
            iterationBindingId: active.iterationBindingId,
            iterationIndex: active.iterationIndex,
            iterationValue: active.iterationValue,
            read,
            declareLocal,
            set
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
      } finally {
        // Exactly Task 33's frame-lifetime rule: locals disappear at the
        // explicit frame boundary, including when a body callback throws.
        frames.pop();
      }
    }
    return "completed";
  };

  return { run, read, finalSlots: () => new Map(outerSlots) };
};
