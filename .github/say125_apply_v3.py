from pathlib import Path
import runpy

script = Path(".github/say125_apply.py")
text = script.read_text()
label = '    "VSCode host adapter measurer dependency"\n'
label_index = text.find(label)
if label_index < 0:
    raise SystemExit("dependency helper label not found")
start = text.rfind("replace_once(\n", 0, label_index)
end = text.find(")\n", label_index)
if start < 0 or end < 0:
    raise SystemExit("dependency helper block not found")
end += 2
replacement = r'''replace_once(
    "src/vscode/VSCodeDrawingCanvas.tsx",
    ''' + "'''      evaluationState,\\n      moduleSemanticContext,\\n      palette,\\n'''," + r'''
    ''' + "'''      evaluationState,\\n      moduleSemanticContext,\\n      measureCanvasTextWidth,\\n      palette,\\n'''," + r'''
    "VSCode host adapter measurer dependency"
)
'''
script.write_text(text[:start] + replacement + text[end:])
runpy.run_path(str(script), run_name="__main__")
