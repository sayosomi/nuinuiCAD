from __future__ import annotations

import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ".github/workflows/say145-runtime-diagnostics-integration.yml"
SCRIPT = "scripts/say145-runtime-diagnostics-integration.py"


def run(*args: str) -> None:
    subprocess.run(args, cwd=ROOT, check=True, text=True)


def replace_exact(path: str, old: str, new: str, count: int = 1) -> None:
    file_path = ROOT / path
    text = file_path.read_text()
    actual = text.count(old)
    if actual != count:
        raise RuntimeError(
            f"{path}: expected {count} occurrence(s), found {actual}: {old[:120]!r}"
        )
    file_path.write_text(text.replace(old, new, count))


def patch_extension() -> None:
    replace_exact(
        "vscode-extension/src/extension.ts",
        '''import {\n  type CompilerDiagnostic,\n  type CompilerDiagnosticRange\n} from "./compilerDiagnostics";\n''',
        '''import {\n  toCompilerDiagnostic,\n  type CompilerDiagnostic,\n  type CompilerDiagnosticRange\n} from "./compilerDiagnostics";\n'''
    )
    replace_exact(
        "vscode-extension/src/extension.ts",
        '''import {\n  createLanguageAnalysisSession,\n  type NuiLanguageAnalysisSession\n} from "./languageAnalysisSession";\n''',
        '''import {\n  createLanguageAnalysisSession,\n  type NuiLanguageAnalysisSession\n} from "./languageAnalysisSession";\nimport {\n  createRuntimeDiagnosticsSidecar,\n  type RuntimeDiagnosticsSidecar\n} from "./runtimeDiagnosticsSidecar";\n'''
    )
    replace_exact(
        "vscode-extension/src/extension.ts",
        '''  const sessions = new VscodeWebviewSessionRegistry<WebviewSession>();\n  const languageAnalysisSessions = new Map<string, NuiLanguageAnalysisSession>();\n  const compilerDiagnosticCollection = vscode.languages.createDiagnosticCollection("nuinuiCAD");\n''',
        '''  const sessions = new VscodeWebviewSessionRegistry<WebviewSession>();\n  const languageAnalysisSessions = new Map<string, NuiLanguageAnalysisSession>();\n  const runtimeDiagnosticsSidecars = new Map<string, RuntimeDiagnosticsSidecar>();\n  const compilerDiagnosticCollection = vscode.languages.createDiagnosticCollection("nuinuiCAD");\n'''
    )
    replace_exact(
        "vscode-extension/src/extension.ts",
        '''  const publishCompilerDiagnostics = (document: vscode.TextDocument): void => {\n''',
        '''  const runtimeDiagnosticsSidecarFor = (document: vscode.TextDocument): RuntimeDiagnosticsSidecar => {\n    const key = documentKey(document);\n    const existing = runtimeDiagnosticsSidecars.get(key);\n    if (existing) return existing;\n    const sidecar = createRuntimeDiagnosticsSidecar();\n    runtimeDiagnosticsSidecars.set(key, sidecar);\n    return sidecar;\n  };\n\n  const publishCurrentDiagnostics = (\n    document: vscode.TextDocument,\n    session: NuiLanguageAnalysisSession\n  ): void => {\n    const key = documentKey(document);\n    const sourceText = document.getText();\n    if (\n      !isOpenDocument(document) ||\n      languageAnalysisSessions.get(key) !== session ||\n      session.getSource() !== sourceText\n    ) return;\n\n    const runtimeDiagnostics = runtimeDiagnosticsSidecars\n      .get(key)\n      ?.snapshotFor(document.version)\n      ?.diagnostics ?? [];\n    const projectedRuntimeDiagnostics = runtimeDiagnostics\n      .map((diagnostic) => toCompilerDiagnostic(sourceText, diagnostic))\n      .filter((diagnostic): diagnostic is CompilerDiagnostic => diagnostic !== null);\n    const diagnostics = [\n      ...session.getDiagnostics(),\n      ...projectedRuntimeDiagnostics\n    ].map((diagnostic) => toVscodeDiagnostic(document, diagnostic));\n    compilerDiagnosticCollection.set(document.uri, diagnostics);\n  };\n\n  const publishCompilerDiagnostics = (document: vscode.TextDocument): void => {\n'''
    )
    replace_exact(
        "vscode-extension/src/extension.ts",
        '''    compilerDiagnosticCollection.set(document.uri, session.getDiagnostics().map((diagnostic) => toVscodeDiagnostic(document, diagnostic)));\n''',
        '''    publishCurrentDiagnostics(document, session);\n'''
    )
    replace_exact(
        "vscode-extension/src/extension.ts",
        '''  const languageAnalysisSessionFor = (document: vscode.TextDocument): NuiLanguageAnalysisSession => {\n    const key = documentKey(document);\n    const existing = languageAnalysisSessions.get(key);\n    if (existing) return existing;\n    const session = createLanguageAnalysisSession(document.getText());\n    languageAnalysisSessions.set(key, session);\n    return session;\n  };\n\n  const hoverFeature = registerNuiHoverFeature({\n''',
        '''  const languageAnalysisSessionFor = (document: vscode.TextDocument): NuiLanguageAnalysisSession => {\n    const key = documentKey(document);\n    const existing = languageAnalysisSessions.get(key);\n    if (existing) return existing;\n    const session = createLanguageAnalysisSession(document.getText());\n    languageAnalysisSessions.set(key, session);\n    return session;\n  };\n\n  const acceptRuntimeDiagnosticsPublication = (\n    session: DocumentSession,\n    message: Extract<VscodeToExtensionMessage, { type: "runtimeDiagnosticsPublication" }>\n  ): void => {\n    if (\n      sessions.get(session.documentUri, "canvas") !== session ||\n      !isOpenDocument(session.document) ||\n      session.authoritativeDocumentVersion !== message.documentVersion ||\n      session.document.version !== message.documentVersion\n    ) return;\n\n    const analysis = languageAnalysisSessions.get(session.documentUri);\n    if (!analysis || analysis.getSource() !== session.document.getText()) return;\n    const sidecar = runtimeDiagnosticsSidecarFor(session.document);\n    if (!sidecar.accept(session.document.version, message)) return;\n    publishCurrentDiagnostics(session.document, analysis);\n  };\n\n  const hoverFeature = registerNuiHoverFeature({\n'''
    )
    replace_exact(
        "vscode-extension/src/extension.ts",
        '''  const compilerDiagnosticChangeListener = vscode.workspace.onDidChangeTextDocument((event) => {\n    if (isSupportedNuiDocument(event.document) && event.contentChanges.length > 0) {\n      vscodeObservationState.invalidateCanvasRuntime(documentKey(event.document));\n    }\n    publishCompilerDiagnostics(event.document);\n  });\n''',
        '''  const compilerDiagnosticChangeListener = vscode.workspace.onDidChangeTextDocument((event) => {\n    if (isSupportedNuiDocument(event.document) && event.contentChanges.length > 0) {\n      const key = documentKey(event.document);\n      runtimeDiagnosticsSidecars.get(key)?.clear();\n      vscodeObservationState.invalidateCanvasRuntime(key);\n    }\n    publishCompilerDiagnostics(event.document);\n  });\n'''
    )
    replace_exact(
        "vscode-extension/src/extension.ts",
        '''    const key = documentKey(document);\n    languageAnalysisSessions.delete(key);\n    compilerDiagnosticCollection.delete(document.uri);\n    vscodeObservationState.removeDocument(key);\n''',
        '''    const key = documentKey(document);\n    languageAnalysisSessions.delete(key);\n    runtimeDiagnosticsSidecars.delete(key);\n    compilerDiagnosticCollection.delete(document.uri);\n    vscodeObservationState.removeDocument(key);\n'''
    )
    replace_exact(
        "vscode-extension/src/extension.ts",
        '''  const disposeCompilerDiagnosticSessions = {\n    dispose: () => languageAnalysisSessions.clear()\n  };\n''',
        '''  const disposeCompilerDiagnosticSessions = {\n    dispose: () => {\n      languageAnalysisSessions.clear();\n      runtimeDiagnosticsSidecars.clear();\n    }\n  };\n'''
    )
    replace_exact(
        "vscode-extension/src/extension.ts",
        '''      if (message.type === "canvasObservationPublication") {\n''',
        '''      if (message.type === "runtimeDiagnosticsPublication") {\n        acceptRuntimeDiagnosticsPublication(session, message);\n        return;\n      }\n      if (message.type === "canvasObservationPublication") {\n'''
    )


def patch_extension_tests() -> None:
    path = "vscode-extension/src/extension.test.ts"
    replace_exact(
        path,
        '''afterEach(() => {\n''',
        '''const runtimeDiagnosticFor = (\n  code = "runtime-test",\n  options: { exactSpan?: boolean } = {}\n) => ({\n  severity: "error" as const,\n  line: 2,\n  column: 7,\n  code,\n  message: `runtime ${code}`,\n  exactSpanOnly: true as const,\n  ...(options.exactSpan === false ? {} : {\n    physicalSpan: {\n      segments: [{ from: 12, to: 13 }],\n      sourceRevision: 1\n    }\n  }),\n  origin: "runtime" as const,\n  bindingId: `binding:${code}`,\n  navigationTarget: { kind: "binding" as const, bindingId: `binding:${code}` }\n});\n\nafterEach(() => {\n'''
    )

    marker = '''  it("registers and opens the Output Preview production surface", () => {\n'''
    addition = '''  it("aggregates exact-current runtime diagnostics after compiler diagnostics", async () => {\n    const source = "nui 4\\npoint A = offset(from: @missing, dx: 1, dy: 2)\\n";\n    const document = documentFor("/tmp/runtime-diagnostics.nui", "file:///tmp/runtime-diagnostics.nui", source);\n    const editor = editorFor(document);\n    setup(false, editor, [document]);\n    const collection = mocks.diagnosticCollections[0]!;\n    const compilerPublished = collection.set.mock.calls.at(-1)?.[1] as Array<{ code?: string | number; message: string }>;\n    expect(compilerPublished.length).toBeGreaterThan(0);\n    const panel = openPanelFor(editor);\n    await messageHandlerFor(panel)({ type: "webviewReady" });\n    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });\n    collection.set.mockClear();\n\n    await messageHandlerFor(panel)({\n      type: "runtimeDiagnosticsPublication",\n      documentVersion: document.version,\n      diagnostics: [runtimeDiagnosticFor("runtime-current")]\n    });\n\n    const published = collection.set.mock.calls.at(-1)?.[1] as Array<{ code?: string | number; message: string }>;\n    expect(published.slice(0, compilerPublished.length).map(({ code, message }) => ({ code, message }))).toEqual(\n      compilerPublished.map(({ code, message }) => ({ code, message }))\n    );\n    expect(published.at(-1)?.code).toBe("runtime-current");\n  });\n\n  it("ignores stale and non-current-session runtime diagnostic publications", async () => {\n    const source = "nui 4\\nconst x: number = 1\\n";\n    const document = documentFor("/tmp/runtime-stale.nui", "file:///tmp/runtime-stale.nui", source);\n    const editor = editorFor(document);\n    setup(false, editor, [document]);\n    const panel = openPanelFor(editor);\n    const handler = messageHandlerFor(panel);\n    await handler({ type: "webviewReady" });\n    await handler({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });\n    await handler({\n      type: "runtimeDiagnosticsPublication",\n      documentVersion: document.version,\n      diagnostics: [runtimeDiagnosticFor("runtime-current")]\n    });\n    const collection = mocks.diagnosticCollections[0]!;\n    collection.set.mockClear();\n\n    await handler({\n      type: "runtimeDiagnosticsPublication",\n      documentVersion: document.version - 1,\n      diagnostics: [runtimeDiagnosticFor("runtime-stale")]\n    });\n    expect(collection.set).not.toHaveBeenCalled();\n\n    panel.dispose();\n    await handler({\n      type: "runtimeDiagnosticsPublication",\n      documentVersion: document.version,\n      diagnostics: [runtimeDiagnosticFor("runtime-after-dispose")]\n    });\n    expect(collection.set).not.toHaveBeenCalled();\n  });\n\n  it("clears runtime diagnostics synchronously on source change", async () => {\n    const source = "nui 4\\nconst x: number = 1\\n";\n    const document = documentFor("/tmp/runtime-change.nui", "file:///tmp/runtime-change.nui", source);\n    const editor = editorFor(document);\n    setup(false, editor, [document]);\n    const panel = openPanelFor(editor);\n    await messageHandlerFor(panel)({ type: "webviewReady" });\n    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });\n    await messageHandlerFor(panel)({\n      type: "runtimeDiagnosticsPublication",\n      documentVersion: document.version,\n      diagnostics: [runtimeDiagnosticFor("runtime-before-change")]\n    });\n\n    document.setSourceText("nui 4\\nconst y: number = 2\\n");\n    document.version += 1;\n    emitDocumentChange(document);\n\n    const published = mocks.diagnosticCollections[0]!.set.mock.calls.at(-1)?.[1] as Array<{ code?: string | number }>;\n    expect(published.map((item) => item.code)).not.toContain("runtime-before-change");\n  });\n\n  it("treats a current empty runtime publication as clearing only the runtime layer", async () => {\n    const source = "nui 4\\npoint A = offset(from: @missing, dx: 1, dy: 2)\\n";\n    const document = documentFor("/tmp/runtime-empty.nui", "file:///tmp/runtime-empty.nui", source);\n    const editor = editorFor(document);\n    setup(false, editor, [document]);\n    const collection = mocks.diagnosticCollections[0]!;\n    const compilerPublished = collection.set.mock.calls.at(-1)?.[1] as Array<{ code?: string | number; message: string }>;\n    const panel = openPanelFor(editor);\n    await messageHandlerFor(panel)({ type: "webviewReady" });\n    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });\n    await messageHandlerFor(panel)({\n      type: "runtimeDiagnosticsPublication",\n      documentVersion: document.version,\n      diagnostics: [runtimeDiagnosticFor("runtime-to-clear")]\n    });\n\n    await messageHandlerFor(panel)({\n      type: "runtimeDiagnosticsPublication",\n      documentVersion: document.version,\n      diagnostics: []\n    });\n\n    const published = collection.set.mock.calls.at(-1)?.[1] as Array<{ code?: string | number; message: string }>;\n    expect(published.map(({ code, message }) => ({ code, message }))).toEqual(\n      compilerPublished.map(({ code, message }) => ({ code, message }))\n    );\n  });\n\n  it("retains runtime diagnostics across Canvas close but clears them on document close", async () => {\n    const source = "nui 4\\nconst x: number = 1\\n";\n    const document = documentFor("/tmp/runtime-close.nui", "file:///tmp/runtime-close.nui", source);\n    const editor = editorFor(document);\n    setup(false, editor, [document]);\n    const panel = openPanelFor(editor);\n    await messageHandlerFor(panel)({ type: "webviewReady" });\n    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });\n    await messageHandlerFor(panel)({\n      type: "runtimeDiagnosticsPublication",\n      documentVersion: document.version,\n      diagnostics: [runtimeDiagnosticFor("runtime-retained")]\n    });\n    const collection = mocks.diagnosticCollections[0]!;\n\n    panel.dispose();\n    collection.set.mockClear();\n    emitDocumentChange(document, undefined, []);\n    const retained = collection.set.mock.calls.at(-1)?.[1] as Array<{ code?: string | number }>;\n    expect(retained.map((item) => item.code)).toContain("runtime-retained");\n\n    emitDocumentClose(document);\n    const reopened = documentFor("/tmp/runtime-close.nui", "file:///tmp/runtime-close.nui", source);\n    mocks.textDocuments = [reopened];\n    emitDocumentOpen(reopened);\n    const reopenedPublished = collection.set.mock.calls.at(-1)?.[1] as Array<{ code?: string | number }>;\n    expect(reopenedPublished.map((item) => item.code)).not.toContain("runtime-retained");\n  });\n\n  it("preserves exactSpanOnly fail-closed projection for runtime diagnostics", async () => {\n    const source = "nui 4\\nconst x: number = 1\\n";\n    const document = documentFor("/tmp/runtime-span.nui", "file:///tmp/runtime-span.nui", source);\n    const editor = editorFor(document);\n    setup(false, editor, [document]);\n    const panel = openPanelFor(editor);\n    await messageHandlerFor(panel)({ type: "webviewReady" });\n    await messageHandlerFor(panel)({ type: "webviewAuthoritativeDocumentReady", documentVersion: document.version });\n\n    await messageHandlerFor(panel)({\n      type: "runtimeDiagnosticsPublication",\n      documentVersion: document.version,\n      diagnostics: [runtimeDiagnosticFor("runtime-no-span", { exactSpan: false })]\n    });\n\n    const published = mocks.diagnosticCollections[0]!.set.mock.calls.at(-1)?.[1] as Array<{ code?: string | number }>;\n    expect(published.map((item) => item.code)).not.toContain("runtime-no-span");\n  });\n\n'''
    replace_exact(path, marker, addition + marker)


def main() -> None:
    run("git", "config", "user.name", "github-actions[bot]")
    run("git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com")
    run("git", "fetch", "origin", "main")
    run("git", "merge", "--no-edit", "origin/main")

    patch_extension()
    patch_extension_tests()

    run("npm", "ci")
    run("npm", "test", "--", "vscode-extension/src/runtimeDiagnosticsSidecar.test.ts", "vscode-extension/src/extension.test.ts")
    run("npm", "run", "build:vscode")
    run("npm", "run", "build")
    run("npm", "run", "lint")

    run("git", "add", "vscode-extension/src/extension.ts", "vscode-extension/src/extension.test.ts")
    run("git", "rm", "-f", WORKFLOW, SCRIPT)
    run("git", "commit", "-m", "SAY-145 integrate runtime diagnostics into native Problems")

    head_ref = os.environ.get("GITHUB_REF_NAME")
    if not head_ref:
        raise RuntimeError("cannot determine branch ref")
    run("git", "push", "origin", f"HEAD:{head_ref}")


if __name__ == "__main__":
    main()
