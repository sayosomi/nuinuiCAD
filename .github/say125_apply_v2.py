from pathlib import Path
import runpy

script = Path(".github/say125_apply.py")
text = script.read_text()
old = (
    '    "src/vscode/VSCodeDrawingCanvas.tsx",\n'
    "    '''      moduleSemanticContext,\n"
    "      palette,\n"
    "''',\n"
    "    '''      moduleSemanticContext,\n"
    "      measureCanvasTextWidth,\n"
    "      palette,\n"
    "''',\n"
    '    "VSCode host adapter measurer dependency"\n'
)
new = (
    '    "src/vscode/VSCodeDrawingCanvas.tsx",\n'
    "    '''      evaluationState,\n"
    "      moduleSemanticContext,\n"
    "      palette,\n"
    "''',\n"
    "    '''      evaluationState,\n"
    "      moduleSemanticContext,\n"
    "      measureCanvasTextWidth,\n"
    "      palette,\n"
    "''',\n"
    '    "VSCode host adapter measurer dependency"\n'
)
count = text.count(old)
if count != 1:
    raise SystemExit(f"apply helper anchor: expected one target, found {count}")
script.write_text(text.replace(old, new, 1))
runpy.run_path(str(script), run_name="__main__")
