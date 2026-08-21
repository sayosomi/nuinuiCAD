from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one target, found {count}")
    file.write_text(text.replace(old, new, 1))

replace_once(
    "src/components/TauriDrawingCanvas.tsx",
    'import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";\n',
    'import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";\nimport type { CanvasTextWidthMeasurer } from "../geometry/canvasDrawingBounds";\n',
    "Tauri measurer import"
)
replace_once(
    "src/components/TauriDrawingCanvas.tsx",
    '''  canvasFocusRef: RefObject<HTMLDivElement | null>;\n  commandContext?: CommandContext;\n''',
    '''  canvasFocusRef: RefObject<HTMLDivElement | null>;\n  measureCanvasTextWidth: CanvasTextWidthMeasurer;\n  commandContext?: CommandContext;\n''',
    "Tauri measurer prop"
)
replace_once(
    "src/components/TauriDrawingCanvas.tsx",
    '''    canvasFocusRef,\n    commandContext = {},\n''',
    '''    canvasFocusRef,\n    measureCanvasTextWidth,\n    commandContext = {},\n''',
    "Tauri measurer destructure"
)
replace_once(
    "src/components/TauriDrawingCanvas.tsx",
    '''      moduleSemanticContext: canvasPresentation.moduleSemanticContext,\n      selectedElementId,\n''',
    '''      moduleSemanticContext: canvasPresentation.moduleSemanticContext,\n      measureCanvasTextWidth,\n      selectedElementId,\n''',
    "Tauri adapter measurer"
)
replace_once(
    "src/components/TauriDrawingCanvas.tsx",
    '''      leftPanelDockRef,\n      moduleSemanticContext,\n      palette,\n''',
    '''      leftPanelDockRef,\n      measureCanvasTextWidth,\n      moduleSemanticContext,\n      palette,\n''',
    "Tauri adapter dependency"
)
replace_once(
    "src/components/AppLayout.tsx",
    '''            canvasFocusRef={canvasFocusRef}\n            commandContext={commandContext}\n''',
    '''            canvasFocusRef={canvasFocusRef}\n            measureCanvasTextWidth={measureCanvasTextWidth}\n            commandContext={commandContext}\n''',
    "AppLayout Tauri measurer"
)
