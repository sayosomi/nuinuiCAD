from pathlib import Path
import runpy

script = Path('.github/say125_apply.py')
text = script.read_text()
old = '''replace_once(
    "src/vscode/VSCodeDrawingCanvas.tsx",
    ''' + "'''      moduleSemanticContext,\\n      palette,\\n'''," + '''
    ''' + "'''      moduleSemanticContext,\\n      measureCanvasTextWidth,\\n      palette,\\n'''," + '''
    "VSCode host adapter measurer dependency"
)
'''
new = '''replace_once(
    "src/vscode/VSCodeDrawingCanvas.tsx",
    ''' + "'''      evaluationState,\\n      moduleSemanticContext,\\n      palette,\\n'''," + '''
    ''' + "'''      evaluationState,\\n      moduleSemanticContext,\\n      measureCanvasTextWidth,\\n      palette,\\n'''," + '''
    "VSCode host adapter measurer dependency"
)
'''
count = text.count(old)
if count != 1:
    raise SystemExit(f'apply helper anchor: expected one target, found {count}')
script.write_text(text.replace(old, new, 1))
runpy.run_path(str(script), run_name='__main__')
