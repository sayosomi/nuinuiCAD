import * as vscode from "vscode";
import type { DslDocumentSymbol } from "../../src/dsl/dslDocumentSymbolQuery";
import {
  currentNuiDocumentSymbolSnapshot,
  type NuiDocumentSymbolSessionFor
} from "./documentSymbolProvider";

export const NUI_ELEMENTS_VIEW_ID = "nuinuiCAD.elements";

export type NuiElementsTreeNode = {
  symbol: DslDocumentSymbol;
};

export type NuiElementsDocumentFor = () => vscode.TextDocument | undefined;
export type NuiElementsTreeItemContextValueFor = (node: NuiElementsTreeNode) => string | undefined;

type TreeChange = NuiElementsTreeNode | undefined | null | void;

type TreeChangeListener = (event: TreeChange) => unknown;

export class NuiElementsTreeProvider implements vscode.TreeDataProvider<NuiElementsTreeNode> {
  private readonly listeners = new Set<TreeChangeListener>();

  readonly onDidChangeTreeData: vscode.Event<TreeChange> = (listener, thisArgs, disposables) => {
    const boundListener: TreeChangeListener = thisArgs
      ? (event) => listener.call(thisArgs, event)
      : listener;
    this.listeners.add(boundListener);
    const disposable: vscode.Disposable = {
      dispose: () => this.listeners.delete(boundListener)
    };
    disposables?.push(disposable);
    return disposable;
  };

  constructor(
    private readonly documentFor: NuiElementsDocumentFor,
    private readonly sessionFor: NuiDocumentSymbolSessionFor,
    private readonly contextValueFor?: NuiElementsTreeItemContextValueFor
  ) {}

  refresh(): void {
    for (const listener of [...this.listeners]) listener(undefined);
  }

  getTreeItem(element: NuiElementsTreeNode): vscode.TreeItem {
    const { symbol } = element;
    return {
      label: symbol.name,
      description: symbol.detail || undefined,
      collapsibleState: symbol.children.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
      ...(this.contextValueFor ? { contextValue: this.contextValueFor(element) } : {})
    };
  }

  getChildren(element?: NuiElementsTreeNode): NuiElementsTreeNode[] {
    if (element) return element.symbol.children.map((symbol) => ({ symbol }));

    const document = this.documentFor();
    if (!document) return [];
    const snapshot = currentNuiDocumentSymbolSnapshot(document, this.sessionFor);
    return snapshot?.symbols.map((symbol) => ({ symbol })) ?? [];
  }
}

export const createNuiElementsTreeProvider = (
  documentFor: NuiElementsDocumentFor,
  sessionFor: NuiDocumentSymbolSessionFor,
  contextValueFor?: NuiElementsTreeItemContextValueFor
): NuiElementsTreeProvider => new NuiElementsTreeProvider(documentFor, sessionFor, contextValueFor);
