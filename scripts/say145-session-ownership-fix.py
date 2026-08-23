from __future__ import annotations

import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ".github/workflows/say145-session-ownership-fix.yml"
SCRIPT = "scripts/say145-session-ownership-fix.py"


def run(*args: str) -> None:
    subprocess.run(args, cwd=ROOT, check=True, text=True)


def replace_exact(path: str, old: str, new: str, count: int = 1) -> None:
    file_path = ROOT / path
    text = file_path.read_text()
    actual = text.count(old)
    if actual != count:
        raise RuntimeError(f"{path}: expected {count}, found {actual}: {old[:120]!r}")
    file_path.write_text(text.replace(old, new, count))


def patch_language_session() -> None:
    path = "vscode-extension/src/languageAnalysisSession.ts"
    replace_exact(path,
        'import { projectConfiguredCompilerDiagnosticsWithTypoSuggestions } from "./typoDiagnosticPresentation";\n',
        'import { projectConfiguredCompilerDiagnosticsWithTypoSuggestions } from "./typoDiagnosticPresentation";\nimport { createRuntimeDiagnosticsSidecar, type RuntimeDiagnosticsSidecarSnapshot } from "./runtimeDiagnosticsSidecar";\nimport type { VscodeRuntimeDiagnosticsPublication } from "../../src/vscode/protocol";\n')
    replace_exact(path,
        '  getDiagnostics: () => CompilerDiagnostic[];\n  runtimeEvaluationSemanticSnapshot: (\n',
        '  getDiagnostics: () => CompilerDiagnostic[];\n  acceptRuntimeDiagnostics: (\n    currentDocumentVersion: number,\n    publication: VscodeRuntimeDiagnosticsPublication\n  ) => boolean;\n  clearRuntimeDiagnostics: () => void;\n  runtimeDiagnosticsSnapshotFor: (\n    currentDocumentVersion: number\n  ) => RuntimeDiagnosticsSidecarSnapshot | null;\n  runtimeEvaluationSemanticSnapshot: (\n')
    replace_exact(path,
        '  let diagnostics = compilerDiagnosticsForState(document.getSource(), document.getState());\n  let completionRecovery = completionRecoveryFor(document.getState());\n',
        '  let diagnostics = compilerDiagnosticsForState(document.getSource(), document.getState());\n  let completionRecovery = completionRecoveryFor(document.getState());\n  const runtimeDiagnostics = createRuntimeDiagnosticsSidecar();\n')
    replace_exact(path,
        '    replaceSource: (nextSourceText) => {\n      document.replaceSource(nextSourceText);\n      diagnostics = compilerDiagnosticsForState(document.getSource(), document.getState());\n      completionRecovery = completionRecoveryFor(document.getState());\n    },\n',
        '    replaceSource: (nextSourceText) => {\n      if (nextSourceText !== document.getSource()) runtimeDiagnostics.clear();\n      document.replaceSource(nextSourceText);\n      diagnostics = compilerDiagnosticsForState(document.getSource(), document.getState());\n      completionRecovery = completionRecoveryFor(document.getState());\n    },\n')
    replace_exact(path,
        '        ? projectConfiguredCompilerDiagnosticsWithTypoSuggestions(diagnostics, source, semantic)\n        : diagnostics;\n    },\n    runtimeEvaluationSemanticSnapshot,\n',
        '        ? projectConfiguredCompilerDiagnosticsWithTypoSuggestions(diagnostics, source, semantic)\n        : diagnostics;\n    },\n    acceptRuntimeDiagnostics: runtimeDiagnostics.accept,\n    clearRuntimeDiagnostics: runtimeDiagnostics.clear,\n    runtimeDiagnosticsSnapshotFor: runtimeDiagnostics.snapshotFor,\n    runtimeEvaluationSemanticSnapshot,\n')


def patch_extension() -> None:
    path = "vscode-extension/src/extension.ts"
    replace_exact(path,
        'import {\n  createRuntimeDiagnosticsSidecar,\n  type RuntimeDiagnosticsSidecar\n} from "./runtimeDiagnosticsSidecar";\n', '')
    replace_exact(path,
        '  const sessions = new VscodeWebviewSessionRegistry<WebviewSession>();\n  const languageAnalysisSessions = new Map<string, NuiLanguageAnalysisSession>();\n  const runtimeDiagnosticsSidecars = new Map<string, RuntimeDiagnosticsSidecar>();\n  const compilerDiagnosticCollection = vscode.languages.createDiagnosticCollection("nuinuiCAD");\n',
        '  const sessions = new VscodeWebviewSessionRegistry<WebviewSession>();\n  const languageAnalysisSessions = new Map<string, NuiLanguageAnalysisSession>();\n  const compilerDiagnosticCollection = vscode.languages.createDiagnosticCollection("nuinuiCAD");\n')
    replace_exact(path,
        '  const runtimeDiagnosticsSidecarFor = (document: vscode.TextDocument): RuntimeDiagnosticsSidecar => {\n    const key = documentKey(document);\n    const existing = runtimeDiagnosticsSidecars.get(key);\n    if (existing) return existing;\n    const sidecar = createRuntimeDiagnosticsSidecar();\n    runtimeDiagnosticsSidecars.set(key, sidecar);\n    return sidecar;\n  };\n\n', '')
    replace_exact(path,
        '    const runtimeDiagnostics = runtimeDiagnosticsSidecars\n      .get(key)\n      ?.snapshotFor(document.version)\n      ?.diagnostics ?? [];\n',
        '    const runtimeDiagnostics = session\n      .runtimeDiagnosticsSnapshotFor(document.version)\n      ?.diagnostics ?? [];\n')
    replace_exact(path,
        '    const sidecar = runtimeDiagnosticsSidecarFor(session.document);\n    if (!sidecar.accept(session.document.version, message)) return;\n    publishCurrentDiagnostics(session.document, analysis);\n',
        '    if (!analysis.acceptRuntimeDiagnostics(session.document.version, message)) return;\n    publishCurrentDiagnostics(session.document, analysis);\n')
    replace_exact(path,
        '      const key = documentKey(event.document);\n      runtimeDiagnosticsSidecars.get(key)?.clear();\n      vscodeObservationState.invalidateCanvasRuntime(key);\n',
        '      const key = documentKey(event.document);\n      languageAnalysisSessions.get(key)?.clearRuntimeDiagnostics();\n      vscodeObservationState.invalidateCanvasRuntime(key);\n')
    replace_exact(path,
        '    const key = documentKey(document);\n    languageAnalysisSessions.delete(key);\n    runtimeDiagnosticsSidecars.delete(key);\n    compilerDiagnosticCollection.delete(document.uri);\n',
        '    const key = documentKey(document);\n    languageAnalysisSessions.delete(key);\n    compilerDiagnosticCollection.delete(document.uri);\n')
    replace_exact(path,
        '  const disposeCompilerDiagnosticSessions = {\n    dispose: () => {\n      languageAnalysisSessions.clear();\n      runtimeDiagnosticsSidecars.clear();\n    }\n  };\n',
        '  const disposeCompilerDiagnosticSessions = {\n    dispose: () => languageAnalysisSessions.clear()\n  };\n')


def patch_language_session_tests() -> None:
    path = "vscode-extension/src/languageAnalysisSession.test.ts"
    marker = '  it("updates diagnostics and source for unsaved text", () => {\n'
    tests = '''  it("owns exact-current structured runtime diagnostics inside the language-analysis session", () => {\n    const session = createLanguageAnalysisSession(validSource);\n    const diagnostics = [{\n      severity: "error" as const,\n      line: 2,\n      column: 1,\n      code: "geometry-builtin-target-unavailable",\n      message: "runtime failure",\n      exactSpanOnly: true as const,\n      physicalSpan: { segments: [{ from: 6, to: 7 }], sourceRevision: 1 },\n      origin: "runtime" as const,\n      bindingId: "binding:runtime",\n      navigationTarget: { kind: "binding" as const, bindingId: "binding:runtime" },\n      runtimeContext: { kind: "geometryBuiltinTarget" as const, targetElementId: "Target", pointKey: "center" }\n    }];\n\n    expect(session.acceptRuntimeDiagnostics(3, { type: "runtimeDiagnosticsPublication", documentVersion: 3, diagnostics })).toBe(true);\n    const snapshot = session.runtimeDiagnosticsSnapshotFor(3);\n    expect(snapshot?.diagnostics).toBe(diagnostics);\n    expect(snapshot?.diagnostics[0]).toMatchObject({\n      bindingId: "binding:runtime",\n      runtimeContext: { kind: "geometryBuiltinTarget", targetElementId: "Target", pointKey: "center" }\n    });\n  });\n\n  it("rejects stale runtime publications and clears the runtime layer when source changes", () => {\n    const session = createLanguageAnalysisSession(validSource);\n    const diagnostics = [{\n      severity: "error" as const,\n      line: 2,\n      column: 1,\n      code: "runtime-test",\n      message: "runtime failure",\n      exactSpanOnly: true as const,\n      physicalSpan: { segments: [{ from: 6, to: 7 }], sourceRevision: 1 },\n      origin: "runtime" as const,\n      bindingId: "binding:runtime",\n      navigationTarget: { kind: "binding" as const, bindingId: "binding:runtime" }\n    }];\n    expect(session.acceptRuntimeDiagnostics(5, { type: "runtimeDiagnosticsPublication", documentVersion: 5, diagnostics })).toBe(true);\n    expect(session.acceptRuntimeDiagnostics(5, { type: "runtimeDiagnosticsPublication", documentVersion: 4, diagnostics: [] })).toBe(false);\n    expect(session.runtimeDiagnosticsSnapshotFor(5)?.diagnostics).toBe(diagnostics);\n\n    session.replaceSource("nui 4\\npoint B = coordinate(x: 0, y: 1)\\n");\n\n    expect(session.runtimeDiagnosticsSnapshotFor(5)).toBeNull();\n  });\n\n'''
    replace_exact(path, marker, tests + marker)


def main() -> None:
    run("git", "config", "user.name", "github-actions[bot]")
    run("git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com")
    run("git", "fetch", "origin", "main")
    run("git", "merge", "--no-edit", "origin/main")
    patch_language_session()
    patch_extension()
    patch_language_session_tests()
    run("npm", "ci")
    run("npm", "test", "--", "vscode-extension/src/runtimeDiagnosticsSidecar.test.ts", "vscode-extension/src/languageAnalysisSession.test.ts", "vscode-extension/src/extension.test.ts")
    run("npm", "run", "build:vscode")
    run("npm", "run", "build")
    run("npm", "run", "lint")
    run("git", "add", "vscode-extension/src/extension.ts", "vscode-extension/src/languageAnalysisSession.ts", "vscode-extension/src/languageAnalysisSession.test.ts")
    run("git", "rm", "-f", WORKFLOW, SCRIPT)
    run("git", "commit", "-m", "fix(SAY-145): keep runtime diagnostics in language session")
    head_ref = os.environ.get("GITHUB_REF_NAME")
    if not head_ref:
        raise RuntimeError("cannot determine branch ref")
    run("git", "push", "origin", f"HEAD:{head_ref}")


if __name__ == "__main__":
    main()
