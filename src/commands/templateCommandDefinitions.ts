import {
  cancelTemplateInsertion,
  confirmTemplateInsertion,
  selectTemplateInsertionInput,
  selectTemplateInsertionInputByOffset,
  startTemplateInsertion
} from "../templates/templateInsertionCommands";
import { useCadUiStore } from "../state/cadUiStore";
import type { Command, CommandId } from "./commandTypes";

export const templateCommandDefinitions = {
  startTemplateInsertion: {
    id: "startTemplateInsertion",
    label: "テンプレート挿入を開始",
    run: (context) => {
      if (!context?.groupTemplate) return;
      startTemplateInsertion({
        template: context.groupTemplate,
        insertionIndex: context.insertionIndex,
        sourceInsertion: useCadUiStore.getState().templateInsertionSourceInsertion
      });
    }
  },
  cancelTemplateInsertion: {
    id: "cancelTemplateInsertion",
    label: "テンプレート挿入をキャンセル",
    run: () => cancelTemplateInsertion()
  },
  selectNextTemplateInsertionInput: {
    id: "selectNextTemplateInsertionInput",
    label: "次のテンプレート入力へ",
    run: () => selectTemplateInsertionInputByOffset(1)
  },
  selectPreviousTemplateInsertionInput: {
    id: "selectPreviousTemplateInsertionInput",
    label: "前のテンプレート入力へ",
    run: () => selectTemplateInsertionInputByOffset(-1)
  },
  selectTemplateInsertionInput: {
    id: "selectTemplateInsertionInput",
    label: "テンプレート入力を選択",
    run: (context) => {
      if (context?.templateInputId) selectTemplateInsertionInput(context.templateInputId);
    }
  },
  confirmTemplateInsertion: {
    id: "confirmTemplateInsertion",
    label: "テンプレートを挿入",
    run: () => confirmTemplateInsertion()
  }
} satisfies Partial<Record<CommandId, Command>>;
