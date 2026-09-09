import * as vscode from "vscode";
import {
  materializeSourceCreationTemplate,
  type SourceCreationTemplateMaterialization
} from "../../src/commands/sourceCreationTemplateMaterializer";
import {
  sourceCreationTemplatePlanForLegacyCommand,
  type SourceCreationTemplateForm,
  type SourceCreationTemplatePlan
} from "../../src/commands/sourceCreationTemplatePlan";
import { canvasQuickCreateTranslatorFor } from "./canvasQuickCreateLocalization";
import { pickVscodeCreationCommand } from "./creationCommandQuickPick";
import { nativeShowQuickPick } from "./nativeQuickInput";
import { insertSourceCreationSnippet } from "./sourceCreationSnippetAdapter";

type SourceCreationFormPickerItem = vscode.QuickPickItem & {
  formIndex: number;
};

const formPickerLabelFor = (form: SourceCreationTemplateForm): string | null => {
  const labels: string[] = [];
  for (const choice of form.exclusiveChoices) {
    const hole = form.argumentHoles.find(({ argName }) => argName === choice.selectedArgName);
    if (!hole) return null;
    labels.push(hole.label);
  }
  return labels.length > 0 ? labels.join(" + ") : null;
};

const formPickerItemsFor = (
  plan: SourceCreationTemplatePlan
): SourceCreationFormPickerItem[] | null => {
  const items: SourceCreationFormPickerItem[] = [];
  for (const [formIndex, form] of plan.forms.entries()) {
    const label = formPickerLabelFor(form);
    if (!label) return null;
    items.push({ label, formIndex });
  }
  return items;
};

const selectedMaterializationFor = async (
  plan: SourceCreationTemplatePlan,
  displayLanguage: string
): Promise<SourceCreationTemplateMaterialization | null> => {
  let formIndex = 0;
  if (plan.forms.length > 1) {
    const items = formPickerItemsFor(plan);
    if (!items) return null;
    const selected = await nativeShowQuickPick(items, {
      placeHolder: canvasQuickCreateTranslatorFor(displayLanguage)(
        "canvasQuickCreate.placeholder.selectForm"
      )
    });
    if (!selected) return null;
    formIndex = selected.formIndex;
  }
  return materializeSourceCreationTemplate(plan, formIndex);
};

/** Runs Source-native creation using only the caller's editor and insertion position. */
export const runSourceCreationFlow = async (
  editor: vscode.TextEditor,
  position: vscode.Position,
  displayLanguage: string
): Promise<boolean | undefined> => {
  const commandId = await pickVscodeCreationCommand({ displayLanguage });
  if (!commandId) return undefined;

  const plan = sourceCreationTemplatePlanForLegacyCommand(commandId);
  if (!plan) return undefined;

  const materialization = await selectedMaterializationFor(plan, displayLanguage);
  if (!materialization) return undefined;

  return insertSourceCreationSnippet(editor, materialization, position);
};
