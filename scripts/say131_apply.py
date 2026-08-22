from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old[:80]!r}")
    path.write_text(text.replace(old, new, 1))


protocol = Path("src/vscode/protocol.ts")
replace_once(
    protocol,
    'import type { LineSplice } from "../document/textPatch";\nimport type { NormalizedSourceRange } from "../dsl/dslNavigationQuery";',
    'import type { LineSplice } from "../document/textPatch";\nimport type { RuntimeScalarDiagnostic } from "../scalars/runtimeScalarDiagnostics";\nimport type { NormalizedSourceRange } from "../dsl/dslNavigationQuery";'
)
replace_once(
    protocol,
    '''export type VscodeRustEvaluationRequest = {\n  type: "rustEvaluationRequest";\n  id: number;\n  input: unknown;\n};\n\nexport type VscodeDocumentChangeReason = "edit" | "undo" | "redo";''',
    '''export type VscodeRustEvaluationRequest = {\n  type: "rustEvaluationRequest";\n  id: number;\n  input: unknown;\n};\n\n/** JSON-safe runtime layer published only from the current canonical Webview evaluation. */\nexport type VscodeRuntimeDiagnosticsPublication = {\n  type: "runtimeDiagnosticsPublication";\n  documentVersion: number;\n  diagnostics: readonly RuntimeScalarDiagnostic[];\n};\n\nexport type VscodeDocumentChangeReason = "edit" | "undo" | "redo";'''
)
replace_once(
    protocol,
    '  | { type: "webviewAuthoritativeDocumentReady"; documentVersion: number }\n  | { type: "canvasSourceDefinitionResult";',
    '  | { type: "webviewAuthoritativeDocumentReady"; documentVersion: number }\n  | VscodeRuntimeDiagnosticsPublication\n  | { type: "canvasSourceDefinitionResult";'
)

app = Path("src/vscode/VSCodeApp.tsx")
replace_once(
    app,
    'import { sourceOwnerByRuntimeElementId } from "../dsl/sourceOwnership";\nimport { canvasElementDrawingBounds } from "../geometry/canvasDrawingBounds";',
    'import { sourceOwnerByRuntimeElementId } from "../dsl/sourceOwnership";\nimport { runtimeScalarDiagnostics } from "../scalars/runtimeScalarDiagnostics";\nimport { canvasElementDrawingBounds } from "../geometry/canvasDrawingBounds";'
)
replace_once(
    app,
    '''    return {\n      state,\n      compiled,\n      source: {\n        normalizedSource,\n        sourceRevision: compiled.spans.sourceMap.sourceRevision\n      }\n    };\n  }, []);\n\n  useEffect(() => {\n    const refreshCanvasTheme = () => setCanvasTheme(readVSCodeCanvasTheme());''',
    '''    return {\n      state,\n      compiled,\n      source: {\n        normalizedSource,\n        sourceRevision: compiled.spans.sourceMap.sourceRevision\n      }\n    };\n  }, []);\n\n  const publishCanonicalRuntimeDiagnostics = useCallback((documentVersion: number) => {\n    const current = currentAuthoritativeDocument(documentVersion);\n    if (\n      !current ||\n      current.state.previewElements !== null ||\n      current.state.docText !== current.state.sourceText ||\n      !evaluationStateIsCurrentFor(\n        evaluationStateRef.current,\n        current.state.compiledDocumentRevision\n      )\n    ) return;\n\n    const bindingAnalysis = current.compiled.bindingAnalysis;\n    const diagnostics = bindingAnalysis\n      ? runtimeScalarDiagnostics({\n          computedScalarBindings: evaluationRef.current.computedScalarBindings,\n          bindingAnalysis,\n          statements: current.compiled.statements,\n          spans: current.compiled.spans,\n          elementIdByStatementIndex: current.compiled.statementMap.elementIdByStatementIndex,\n          propertySourcesByOccurrenceKey: current.compiled.propertyBindings ?? new Map(),\n          occurrenceKeysByBindingId: current.compiled.occurrenceKeysByBindingId ?? new Map(),\n          elements: current.state.elements,\n          freshness: { isSourceDirty: false, isEvaluationStale: false }\n        })\n      : [];\n    api.postMessage({\n      type: "runtimeDiagnosticsPublication",\n      documentVersion,\n      // Keep the Extension Host protocol strictly JSON-safe even if the\n      // host-neutral diagnostic type later gains readonly/prototype-backed data.\n      diagnostics: JSON.parse(JSON.stringify(diagnostics)) as typeof diagnostics\n    });\n  }, [api, currentAuthoritativeDocument]);\n\n  useEffect(() => {\n    const documentVersion = latestHostDocumentVersionRef.current;\n    if (documentVersion !== null) publishCanonicalRuntimeDiagnostics(documentVersion);\n  }, [evaluationState, publishCanonicalRuntimeDiagnostics]);\n\n  useEffect(() => {\n    const refreshCanvasTheme = () => setCanvasTheme(readVSCodeCanvasTheme());'''
)

ready = '        api.postMessage({ type: "webviewAuthoritativeDocumentReady", documentVersion: message.documentVersion });'
text = app.read_text()
count = text.count(ready)
if count != 2:
    raise SystemExit(f"{app}: expected two authoritative-ready publications, found {count}")
text = text.replace(
    ready,
    ready + '\n        publishCanonicalRuntimeDiagnostics(message.documentVersion);'
)
app.write_text(text)

replace_once(
    app,
    '  }, [api, currentAuthoritativeDocument, measureCanvasTextWidth, postCanvasCommit, pumpCanvasHistory, requestCanvasHistory, restoreCanvasFocus, rustTransport, tryCompleteCanvasFocus]);',
    '  }, [api, currentAuthoritativeDocument, measureCanvasTextWidth, postCanvasCommit, publishCanonicalRuntimeDiagnostics, pumpCanvasHistory, requestCanvasHistory, restoreCanvasFocus, rustTransport, tryCompleteCanvasFocus]);'
)
