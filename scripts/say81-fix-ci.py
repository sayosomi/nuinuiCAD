from __future__ import annotations

import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ".github/workflows/say81-fix-ci.yml"
SCRIPT = "scripts/say81-fix-ci.py"


def run(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=ROOT, check=check, text=True)


def replace_exact(path: str, old: str, new: str, count: int = 1) -> None:
    file_path = ROOT / path
    text = file_path.read_text()
    actual = text.count(old)
    if actual != count:
        raise RuntimeError(f"{path}: expected {count} occurrence(s), found {actual}: {old[:80]!r}")
    file_path.write_text(text.replace(old, new, count))


def patch_vscode_app() -> None:
    replace_exact(
        "src/vscode/VSCodeApp.tsx",
        '''          if (containerTarget.status === "no-renderable-geometry") {\n            api.postMessage({\n              type: "canvasNavigationResult",\n              requestId: message.requestId,\n              status: "failed",\n              reason: "no-revealable-runtime-target"\n            });\n            return;\n          }\n          if (containerTarget.status === "ready") revealBounds = containerTarget.bounds;\n''',
        '''          if (containerTarget.status === "ready") revealBounds = containerTarget.bounds;\n'''
    )


def patch_vscode_app_tests() -> None:
    path = "src/vscode/VSCodeApp.test.tsx"
    for request_id in (13, 14, 16):
        replace_exact(
            path,
            f'''      requestId: {request_id},\n      status: "stale"\n''',
            f'''      requestId: {request_id},\n      status: "failed",\n      reason: "source-mismatch"\n'''
        )
    replace_exact(
        path,
        '["non-renderable", "nui 4\\nmodule M() {\\n  point P = coordinate(x: 0, y: 0)\\n}\\ninstance A = M()", "A", false]',
        '["non-renderable", "nui 4\\nmodule M() {\\n  point P = coordinate(x: 0, y: 0)\\n}\\ninstance A = M()", "A", true]'
    )
    replace_exact(
        path,
        'it("preserves selection and viewport when a Module instance has no currently renderable descendants", async () => {',
        'it("selects a Module instance without moving the viewport when it has no renderable descendants", async () => {'
    )
    replace_exact(
        path,
        '''    const selectionBefore = {\n      selectedElementId: useCadUiStore.getState().selectedElementId,\n      selectedElementIds: [...useCadUiStore.getState().selectedElementIds],\n      selectionAnchorElementId: useCadUiStore.getState().selectionAnchorElementId\n    };\n    const viewportBefore = { ...useCadUiStore.getState().canvasViewport };\n''',
        '''    const viewportBefore = { ...useCadUiStore.getState().canvasViewport };\n'''
    )
    replace_exact(
        path,
        '''    expect(useCadUiStore.getState()).toMatchObject(selectionBefore);\n    expect(useCadUiStore.getState().canvasViewport).toEqual(viewportBefore);\n    expect(api.postMessage).toHaveBeenCalledWith({\n      type: "canvasNavigationResult",\n      requestId: 321,\n      status: "no-renderable-geometry"\n    });\n''',
        '''    expect(useCadUiStore.getState()).toMatchObject({\n      selectedElementId: instance.id,\n      selectedElementIds: [instance.id],\n      selectionAnchorElementId: instance.id\n    });\n    expect(useCadUiStore.getState().canvasViewport).toEqual(viewportBefore);\n    expect(api.postMessage).toHaveBeenCalledWith({\n      type: "canvasNavigationResult",\n      requestId: 321,\n      status: "resolved",\n      degradations: []\n    });\n'''
    )


def patch_extension_tests() -> None:
    path = "vscode-extension/src/extension.test.ts"
    replace_exact(
        path,
        '''  return {\n    window: {\n''',
        '''  return {\n    env: { language: "en" },\n    window: {\n'''
    )
    replace_exact(
        path,
        '''  it("clears deferred Canvas focus when navigation becomes stale", async () => {''',
        '''  it("clears deferred Canvas focus when navigation fails", async () => {'''
    )
    replace_exact(
        path,
        '''      type: "canvasNavigationResult",\n      requestId: navigationRequest.requestId,\n      status: "stale"\n    });\n''',
        '''      type: "canvasNavigationResult",\n      requestId: navigationRequest.requestId,\n      status: "failed",\n      reason: "source-mismatch"\n    });\n'''
    )
    replace_exact(
        path,
        '''describe("SAY-125 Module instance Reveal feedback", () => {\n  it("reports a no-renderable result without asking the Canvas to take focus", async () => {''',
        '''describe("SAY-81 Module instance Reveal feedback", () => {\n  it("treats a resolved Module instance as selectable even when viewport pan has no bounds", async () => {'''
    )
    replace_exact(
        path,
        '''    await messageHandlerFor(panel)({\n      type: "canvasNavigationResult",\n      requestId: request!.requestId,\n      status: "no-renderable-geometry"\n    });\n\n    expect(mocks.showErrorMessage).toHaveBeenCalledWith(\n      "nuinuiCAD: このModule instanceには現在表示できるgeometryがありません。"\n    );\n    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(\n      expect.objectContaining({ type: "focusCanvas", requestId: request!.requestId })\n    );\n''',
        '''    await messageHandlerFor(panel)({\n      type: "canvasNavigationResult",\n      requestId: request!.requestId,\n      status: "resolved",\n      degradations: []\n    });\n\n    expect(mocks.showErrorMessage).not.toHaveBeenCalled();\n    expect(panel.webview.postMessage).toHaveBeenCalledWith({\n      type: "focusCanvas",\n      requestId: request!.requestId\n    });\n'''
    )


def main() -> None:
    run("git", "config", "user.name", "github-actions[bot]")
    run("git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com")
    run("git", "fetch", "origin", "main")
    run("git", "merge", "--no-edit", "origin/main")

    patch_vscode_app()
    patch_vscode_app_tests()
    patch_extension_tests()

    run("npm", "ci")
    run("cargo", "build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--example", "evaluate_fixture")
    run("npm", "test", "--", "src/vscode/VSCodeApp.test.tsx", "vscode-extension/src/extension.test.ts")

    run("git", "add", "src/vscode/VSCodeApp.tsx", "src/vscode/VSCodeApp.test.tsx", "vscode-extension/src/extension.test.ts")
    run("git", "rm", "-f", WORKFLOW, SCRIPT)
    run("git", "commit", "-m", "fix(SAY-81): align Reveal bounds and protocol tests")
    head_ref = os.environ.get("GITHUB_HEAD_REF") or os.environ.get("GITHUB_REF_NAME")
    if not head_ref:
        raise RuntimeError("cannot determine branch ref")
    run("git", "push", "origin", f"HEAD:{head_ref}")


if __name__ == "__main__":
    main()
