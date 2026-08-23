import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  host: null as null | {
    provideDefinition: ReturnType<typeof vi.fn>;
    provideReferences: ReturnType<typeof vi.fn>;
    prepareRename: ReturnType<typeof vi.fn>;
    provideRenameEdits: ReturnType<typeof vi.fn>;
  }
}));

vi.mock("vscode", () => ({}), { virtual: true });
vi.mock("./multiDocumentHost", () => ({
  activeVscodeMultiDocumentHost: () => mocks.host
}));

import type * as vscode from "vscode";
import { createNuiDefinitionProvider } from "./definitionProvider";
import { createNuiReferenceProvider } from "./referenceProvider";
import { createNuiRenameProvider } from "./renameProvider";

const document = {
  fileName: "/tmp/root.nui",
  uri: { scheme: "file", toString: () => "file:///tmp/root.nui" }
} as vscode.TextDocument;

const position = { line: 2, character: 5 } as vscode.Position;
const unusedSessionFor = vi.fn(() => {
  throw new Error("single-document fallback must not run when the multi-document host handles the query");
});

const hostFor = () => ({
  provideDefinition: vi.fn(),
  provideReferences: vi.fn(),
  prepareRename: vi.fn(),
  provideRenameEdits: vi.fn()
});

afterEach(() => {
  mocks.host = null;
  unusedSessionFor.mockClear();
});

describe("VS Code multi-document provider adapters", () => {
  it("uses a handled multi-document Definition result without running the single-document session", async () => {
    const host = hostFor();
    const definition = [{ targetUri: "file:///tmp/library.nui" }] as unknown as vscode.DefinitionLink[];
    host.provideDefinition.mockResolvedValue({ handled: true, value: definition });
    mocks.host = host;

    const provider = createNuiDefinitionProvider(unusedSessionFor as never);
    const result = await provider.provideDefinition(document, position, undefined as never);

    expect(result).toBe(definition);
    expect(host.provideDefinition).toHaveBeenCalledWith(document, position);
    expect(unusedSessionFor).not.toHaveBeenCalled();
  });

  it("passes includeDeclaration through to a handled multi-document References result", async () => {
    const host = hostFor();
    const references = [{ uri: "file:///tmp/library.nui" }] as unknown as vscode.Location[];
    host.provideReferences.mockResolvedValue({ handled: true, value: references });
    mocks.host = host;

    const provider = createNuiReferenceProvider(unusedSessionFor as never);
    const result = await provider.provideReferences(
      document,
      position,
      { includeDeclaration: true },
      undefined as never
    );

    expect(result).toBe(references);
    expect(host.provideReferences).toHaveBeenCalledWith(document, position, true);
    expect(unusedSessionFor).not.toHaveBeenCalled();
  });

  it("uses handled multi-document prepare and edit results for Rename", async () => {
    const host = hostFor();
    const prepared = { range: { marker: "range" }, placeholder: "Pocket" } as unknown as {
      range: vscode.Range;
      placeholder: string;
    };
    const workspaceEdit = { marker: "workspace-edit" } as unknown as vscode.WorkspaceEdit;
    host.prepareRename.mockResolvedValue({ handled: true, value: prepared });
    host.provideRenameEdits.mockResolvedValue({ handled: true, value: workspaceEdit });
    mocks.host = host;

    const provider = createNuiRenameProvider(unusedSessionFor as never);
    const prepareResult = await provider.prepareRename?.(document, position, undefined as never);
    const editResult = await provider.provideRenameEdits(
      document,
      position,
      "PocketRenamed",
      undefined as never
    );

    expect(prepareResult).toBe(prepared);
    expect(editResult).toBe(workspaceEdit);
    expect(host.prepareRename).toHaveBeenCalledWith(document, position);
    expect(host.provideRenameEdits).toHaveBeenCalledWith(document, position, "PocketRenamed");
    expect(unusedSessionFor).not.toHaveBeenCalled();
  });
});
