import { selectedParameterDefinition } from "./commandRuntime";
import {
  applyParameterDirectKey,
  cycleReferenceParameter,
  selectParameterByOffset,
  setSelectedPointAnchorMode,
  toggleBooleanParameter,
  toggleBooleanParameterByDirectKey,
  toggleSelectedParameterValue,
  toggleSelectedPointAnchorMode,
  updateNumericParameter,
  updateSelectedNumericParameterStep
} from "./parameterCommands";
import { startLinePick, startNumericReferencePick, startPointPick } from "./pickCommands";
import type { Command, CommandContext, CommandId } from "./commandTypes";

const activateSelectedParameter = (context?: CommandContext) => {
  const definition = selectedParameterDefinition();
  if (definition?.kind === "reference") {
    startPointPick();
    return;
  }
  if (definition?.kind === "lineReferenceList") {
    startLinePick();
    return;
  }
  if (definition?.kind === "lineReference") {
    startLinePick();
    return;
  }
  if (definition?.kind === "lineEndpointReference") {
    startPointPick();
    return;
  }
  if (definition?.kind === "number") {
    startNumericReferencePick();
    return;
  }
  context?.focusSelectedParameterInput?.();
};

export const parameterCommandDefinitions = {
  selectNextParameter: {
    id: "selectNextParameter",
    label: "次のパラメーターを選択",
    shortcuts: [{ keys: "ArrowDown" }],
    run: (context) => {
      if (context?.inspectorHasFocus?.()) return context.moveInspectorParameterRow?.(1) ?? false;
      return selectParameterByOffset(1);
    }
  },
  selectPreviousParameter: {
    id: "selectPreviousParameter",
    label: "前のパラメーターを選択",
    shortcuts: [{ keys: "ArrowUp" }],
    run: (context) => {
      if (context?.inspectorHasFocus?.()) return context.moveInspectorParameterRow?.(-1) ?? false;
      return selectParameterByOffset(-1);
    }
  },
  selectParameterByKey: {
    id: "selectParameterByKey",
    label: "キーでパラメーターを選択",
    shortcuts: [
      {
        keys: "n / x / y / b / s / t / r / h / m / u / i / o / e / g / 1 / 2 / 3",
        label: "名前キーでパラメーターを選択"
      }
    ],
    run: (context) => {
      if (context?.inspectorHasFocus?.()) return false;
      return applyParameterDirectKey(context?.parameterDirectKey, context?.focusSelectedParameterInput);
    }
  },
  incrementSelectedParameter: {
    id: "incrementSelectedParameter",
    label: "選択パラメーターを増やす",
    shortcuts: [{ keys: "ArrowRight / Shift / Alt", label: "数値を増やす" }],
    run: (context) => updateNumericParameter(1, context)
  },
  decrementSelectedParameter: {
    id: "decrementSelectedParameter",
    label: "選択パラメーターを減らす",
    shortcuts: [{ keys: "ArrowLeft / Shift / Alt", label: "数値を減らす" }],
    run: (context) => updateNumericParameter(-1, context)
  },
  increaseSelectedParameterStep: {
    id: "increaseSelectedParameterStep",
    label: "増減単位を大きくする",
    shortcuts: [{ keys: "]" }],
    run: () => updateSelectedNumericParameterStep(1)
  },
  decreaseSelectedParameterStep: {
    id: "decreaseSelectedParameterStep",
    label: "増減単位を小さくする",
    shortcuts: [{ keys: "[" }],
    run: () => updateSelectedNumericParameterStep(-1)
  },
  cycleSelectedReferenceForward: {
    id: "cycleSelectedReferenceForward",
    label: "参照パラメーターを次へ",
    run: () => cycleReferenceParameter(1)
  },
  cycleSelectedReferenceBackward: {
    id: "cycleSelectedReferenceBackward",
    label: "参照パラメーターを前へ",
    run: () => cycleReferenceParameter(-1)
  },
  toggleSelectedParameterValue: {
    id: "toggleSelectedParameterValue",
    label: "選択パラメーターを切替",
    shortcuts: [{ keys: "Space", label: "値または指定方法を切替" }],
    run: () => toggleSelectedParameterValue()
  },
  toggleSelectedPointAnchorMode: {
    id: "toggleSelectedPointAnchorMode",
    label: "点指定方法を切替",
    run: (context) => toggleSelectedPointAnchorMode(context)
  },
  setSelectedPointAnchorReferenceMode: {
    id: "setSelectedPointAnchorReferenceMode",
    label: "点指定を既存点にする",
    run: (context) => setSelectedPointAnchorMode("reference", context)
  },
  setSelectedPointAnchorCoordinateMode: {
    id: "setSelectedPointAnchorCoordinateMode",
    label: "点指定を座標にする",
    run: (context) => setSelectedPointAnchorMode("coordinate", context)
  },
  toggleSelectedBooleanParameter: {
    id: "toggleSelectedBooleanParameter",
    label: "真偽値パラメーターを切替",
    run: () => toggleBooleanParameter()
  },
  toggleBooleanParameterByDirectKey: {
    id: "toggleBooleanParameterByDirectKey",
    label: "キーに対応する真偽値パラメーターを切替",
    shortcuts: [{ keys: "v / a", label: "表示/評価を切替" }],
    run: (context) => toggleBooleanParameterByDirectKey(context?.parameterDirectKey)
  },
  activateSelectedParameter: {
    id: "activateSelectedParameter",
    label: "選択パラメーターを実行",
    shortcuts: [{ keys: "Enter" }],
    run: (context) => {
      if (context?.inspectorHasFocus?.()) return context.activateInspectorRow?.() ?? false;
      return activateSelectedParameter(context);
    }
  },
  focusSelectedParameterInput: {
    id: "focusSelectedParameterInput",
    label: "選択パラメーターの入力欄へフォーカス",
    palette: { order: 48, keywords: ["parameter", "input", "direct", "パラメーター", "入力"] },
    run: (context) => activateSelectedParameter(context)
  }
} satisfies Partial<Record<CommandId, Command>>;
