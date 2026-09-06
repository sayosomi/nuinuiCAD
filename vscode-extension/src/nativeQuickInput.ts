import * as vscode from "vscode";

type NativeQuickPickItems =
  | readonly { label: string }[]
  | readonly string[]
  | Thenable<readonly { label: string }[]>
  | Thenable<readonly string[]>;

type NativeQuickPickResult =
  | string
  | string[]
  | { label: string }
  | { label: string }[]
  | undefined;

const optionsWithFocusOutPersistence = <T extends object>(
  options: T | undefined
): T & { ignoreFocusOut: true } => ({
  ...(options ?? {}),
  ignoreFocusOut: true
} as T & { ignoreFocusOut: true });

export function nativeShowQuickPick(
  items: readonly string[] | Thenable<readonly string[]>,
  options: vscode.QuickPickOptions & { canPickMany: true },
  token?: vscode.CancellationToken
): Thenable<string[] | undefined>;

export function nativeShowQuickPick(
  items: readonly string[] | Thenable<readonly string[]>,
  options?: vscode.QuickPickOptions,
  token?: vscode.CancellationToken
): Thenable<string | undefined>;

export function nativeShowQuickPick<T extends { label: string }>(
  items: readonly T[] | Thenable<readonly T[]>,
  options: vscode.QuickPickOptions & { canPickMany: true },
  token?: vscode.CancellationToken
): Thenable<T[] | undefined>;

export function nativeShowQuickPick<T extends { label: string }>(
  items: readonly T[] | Thenable<readonly T[]>,
  options?: vscode.QuickPickOptions,
  token?: vscode.CancellationToken
): Thenable<T | undefined>;

export function nativeShowQuickPick(
  items: NativeQuickPickItems,
  options: vscode.QuickPickOptions | undefined,
  token: vscode.CancellationToken | undefined
): Thenable<NativeQuickPickResult> {
  const persistentOptions = optionsWithFocusOutPersistence(options);
  return token === undefined
    ? vscode.window.showQuickPick(items as never, persistentOptions) as Thenable<NativeQuickPickResult>
    : vscode.window.showQuickPick(items as never, persistentOptions, token) as Thenable<NativeQuickPickResult>;
}

/** The product-owned show-style Input Box always survives incidental focus movement. */
export const nativeShowInputBox: typeof vscode.window.showInputBox = (
  options,
  token
) => {
  const persistentOptions = optionsWithFocusOutPersistence(options);
  return token === undefined
    ? vscode.window.showInputBox(persistentOptions)
    : vscode.window.showInputBox(persistentOptions, token);
};

/** The product-owned Quick Pick is configured before any caller can use it. */
export const nativeCreateQuickPick = <T extends vscode.QuickPickItem>(): vscode.QuickPick<T> => {
  const picker = vscode.window.createQuickPick<T>();
  picker.ignoreFocusOut = true;
  return picker;
};

/** The product-owned Input Box is configured before any caller can use it. */
export const nativeCreateInputBox = (): vscode.InputBox => {
  const inputBox = vscode.window.createInputBox();
  inputBox.ignoreFocusOut = true;
  return inputBox;
};
