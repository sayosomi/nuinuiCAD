import {
  RustEvaluationProcessOwner as SharedRustEvaluationProcessOwner,
  type RustEvaluationProcessFactory
} from "../../src/node/rustEvaluationProcess";

let activeOwner: RustEvaluationProcessOwner | null = null;

/**
 * VS Code composition wrapper around the shared lazy process owner. The active
 * accessor lets independently registered VS Code surfaces reuse the one owner
 * created by extension activation instead of spawning another Rust process.
 */
export class RustEvaluationProcessOwner extends SharedRustEvaluationProcessOwner {
  constructor(factory: RustEvaluationProcessFactory) {
    super(factory);
    activeOwner = this;
  }

  override dispose(): void {
    if (activeOwner === this) activeOwner = null;
    super.dispose();
  }
}

export const activeRustEvaluationProcessOwner = (): RustEvaluationProcessOwner | null => activeOwner;

export type { RustEvaluationProcessFactory };
