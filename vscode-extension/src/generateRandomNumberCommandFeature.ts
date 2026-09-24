import * as vscode from "vscode";
import type { NuiLanguageSession } from "@nuinuicad/nui-language";
import {
  normalizedOffsetFromRaw,
  normalizedSourceFor,
  vscodeRangeForNormalized
} from "./sourceOffsetAdapter";
import { isWritableNuiSourceEditor } from "./sourceEditorAvailability";

export const VSCODE_GENERATE_RANDOM_NUMBER_COMMAND_ID = "nuinuiCAD.generateRandomNumber";

type RandomNumberCommandFeatureOptions = {
  languageAnalysisSessionFor: (document: vscode.TextDocument) => NuiLanguageSession;
  random?: () => number;
};

const sameDocument = (left: vscode.TextDocument, right: vscode.TextDocument): boolean =>
  left === right || left.uri.toString() === right.uri.toString();

const plainDecimal = (value: number): string => {
  const representation = String(value);
  const exponentAt = representation.toLowerCase().indexOf("e");
  if (exponentAt < 0) return representation;

  const mantissa = representation.slice(0, exponentAt);
  const exponent = Number(representation.slice(exponentAt + 1));
  const decimalAt = mantissa.indexOf(".");
  const digitsBeforeDecimal = decimalAt < 0 ? mantissa.length : decimalAt;
  const digits = mantissa.replace(".", "");
  const nextDecimalAt = digitsBeforeDecimal + exponent;
  if (nextDecimalAt <= 0) return `0.${"0".repeat(-nextDecimalAt)}${digits}`;
  if (nextDecimalAt >= digits.length) return `${digits}${"0".repeat(nextDecimalAt - digits.length)}`;
  return `${digits.slice(0, nextDecimalAt)}.${digits.slice(nextDecimalAt)}`;
};

/** Converts one RNG result into an ordinary nui1 decimal literal. */
export const randomDecimalLiteral = (random: () => number = Math.random): string | null => {
  let value: number;
  try {
    value = random();
  } catch {
    return null;
  }
  if (!Number.isFinite(value) || value < 0 || value >= 1) return null;

  const literal = plainDecimal(value);
  return /^0(?:\.\d+)?$/.test(literal) &&
    Number.isFinite(Number(literal)) &&
    Number(literal) >= 0 &&
    Number(literal) < 1
    ? literal
    : null;
};

export const registerVscodeGenerateRandomNumberFeature = ({
  languageAnalysisSessionFor,
  random = Math.random
}: RandomNumberCommandFeatureOptions): vscode.Disposable => vscode.commands.registerCommand(
  VSCODE_GENERATE_RANDOM_NUMBER_COMMAND_ID,
  async (): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    if (!isWritableNuiSourceEditor(editor)) return;

    const document = editor.document;
    const documentVersion = document.version;
    const rawSource = document.getText();
    const selections = editor.selections.map((selection) => ({
      start: normalizedOffsetFromRaw(rawSource, document.offsetAt(selection.start)),
      end: normalizedOffsetFromRaw(rawSource, document.offsetAt(selection.end))
    }));
    const session = languageAnalysisSessionFor(document);
    if (session.getSource() !== rawSource) session.replaceSource(rawSource);

    const generatedLiteral = randomDecimalLiteral(random);
    if (!generatedLiteral) return;
    const plan = session.randomNumberSourceEditForSelections(selections, generatedLiteral);
    if (!plan) return;

    const activeEditor = vscode.window.activeTextEditor;
    if (
      activeEditor !== editor ||
      !sameDocument(activeEditor.document, document) ||
      document.version !== documentVersion ||
      document.getText() !== rawSource ||
      session.getSourceRevision() !== plan.sourceRevision ||
      normalizedSourceFor(rawSource).slice(plan.edit.from, plan.edit.to) !== plan.edit.expectedText
    ) return;

    const editRange = vscodeRangeForNormalized(document, rawSource, plan.edit);
    const applied = await editor.edit(
      (builder) => builder.replace(editRange, plan.edit.newText),
      { undoStopBefore: true, undoStopAfter: true }
    );
    if (!applied) return;

    const currentRawSource = document.getText();
    const selectionRange = vscodeRangeForNormalized(document, currentRawSource, {
      from: plan.selection.start,
      to: plan.selection.end
    });
    editor.selection = new vscode.Selection(selectionRange.start, selectionRange.end);
  }
);
