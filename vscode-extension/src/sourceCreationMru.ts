import type { VscodeCanvasCreationCommandId } from "../../src/vscode/vscodeCanvasCreationCommands";

const MAX_SOURCE_CREATION_MRU_SIZE = 5;

export type SourceCreationMru = {
  readonly recentCommandIds: readonly VscodeCanvasCreationCommandId[];
  record: (commandId: VscodeCanvasCreationCommandId) => void;
};

export const createSourceCreationMru = (): SourceCreationMru => {
  let recentCommandIds: VscodeCanvasCreationCommandId[] = [];

  return {
    get recentCommandIds(): readonly VscodeCanvasCreationCommandId[] {
      return [...recentCommandIds];
    },
    record: (commandId): void => {
      recentCommandIds = [
        commandId,
        ...recentCommandIds.filter((recentCommandId) => recentCommandId !== commandId)
      ].slice(0, MAX_SOURCE_CREATION_MRU_SIZE);
    }
  };
};
