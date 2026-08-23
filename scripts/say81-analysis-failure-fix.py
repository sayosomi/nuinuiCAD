from __future__ import annotations

import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ".github/workflows/say81-analysis-failure-fix.yml"
SCRIPT = "scripts/say81-analysis-failure-fix.py"
TRIGGER = "say81-ci-trigger.txt"


def run(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=ROOT, check=check, text=True)


def replace_exact(path: str, old: str, new: str, count: int = 1) -> None:
    file_path = ROOT / path
    text = file_path.read_text()
    actual = text.count(old)
    if actual != count:
        raise RuntimeError(f"{path}: expected {count} occurrence(s), found {actual}: {old[:100]!r}")
    file_path.write_text(text.replace(old, new, count))


def patch_extension() -> None:
    replace_exact(
        "vscode-extension/src/extension.ts",
        '''    if (!semantic?.compiled) {\n      presentRevealInCanvasOutcome({ status: "failed", reason: "analysis-unavailable" });\n      return;\n    }\n''',
        '''    if (!semantic?.compiled?.statementMap) {\n      presentRevealInCanvasOutcome({ status: "failed", reason: "analysis-unavailable" });\n      return;\n    }\n'''
    )


def patch_extension_test() -> None:
    path = "vscode-extension/src/extension.test.ts"
    marker = '''  it("does not open Canvas when the source cursor has no runtime target", () => {\n    const source = "nui 4\\n// comment only";\n    const document = documentFor("/tmp/no-target.nui", "file:///tmp/no-target.nui", source);\n    const editor = editorFor(document);\n    editor.selection.active = { line: 1, character: 3 };\n    setup(false, editor, [document]);\n\n    commandHandlerFor("nuinuiCAD.revealInCanvas")?.();\n\n    expect(mocks.createWebviewPanel).not.toHaveBeenCalled();\n  });\n\n'''
    addition = marker + '''  it("reports source analysis unavailable for a fatal exact-current source without opening Canvas", () => {\n    const source = "nui 4\\npoint Broken = coordinate(";\n    const document = documentFor("/tmp/reveal-fatal.nui", "file:///tmp/reveal-fatal.nui", source);\n    const editor = editorFor(document);\n    editor.selection.active = { line: 1, character: 8 };\n    setup(false, editor, [document]);\n\n    commandHandlerFor("nuinuiCAD.revealInCanvas")?.();\n\n    expect(mocks.createWebviewPanel).not.toHaveBeenCalled();\n    expect(mocks.showErrorMessage).toHaveBeenCalledWith(\n      "Reveal in Canvas is unavailable because source analysis is not ready."\n    );\n  });\n\n'''
    replace_exact(path, marker, addition)


def patch_runtime_test() -> None:
    path = "src/dsl/dslCanvasRevealRuntime.test.ts"
    old = '''    expect(queryDslCanvasRevealRuntimeTarget({\n      target: geometryTarget({ sourceStatementIndex: 2, target: null, resolution: "invalid", referenceText: "@dup" }),\n      compiled: compiled({\n        direct: [[2, "Owner"]],\n        diagnostics: [{\n          severity: "error",\n          line: 1,\n          column: 1,\n          code: "module-ambiguous-geometry-reference",\n          message: "ambiguous",\n          statementIndex: 2\n        }]\n      }),\n      elements,\n      ...revealability(["Owner"], { enabled: [] })\n    })).toEqual({ status: "failed", reason: "no-revealable-runtime-target" });\n'''
    new = '''    expect(queryDslCanvasRevealRuntimeTarget({\n      target: geometryTarget({ sourceStatementIndex: 2, target: null, resolution: "invalid", referenceText: "@dup" }),\n      compiled: compiled({\n        direct: [[2, "Owner"]],\n        diagnostics: [{\n          severity: "error",\n          line: 1,\n          column: 1,\n          code: "module-ambiguous-geometry-reference",\n          message: "ambiguous",\n          statementIndex: 2\n        }]\n      }),\n      elements,\n      ...revealability(["Owner"])\n    })).toEqual({\n      status: "resolved",\n      runtimeElementIds: ["Owner"],\n      primaryRuntimeElementId: "Owner",\n      degradations: [{ kind: "owner-fallback", cause: "ambiguous", referenceText: "@dup" }]\n    });\n\n    expect(queryDslCanvasRevealRuntimeTarget({\n      target: geometryTarget({ sourceStatementIndex: 2, target: null, resolution: "undefined", referenceText: "@missing" }),\n      compiled: compiled({ direct: [[2, "Owner"]] }),\n      elements,\n      ...revealability(["Owner"], { enabled: [] })\n    })).toEqual({ status: "failed", reason: "no-revealable-runtime-target" });\n'''
    replace_exact(path, old, new)


def main() -> None:
    run("git", "config", "user.name", "github-actions[bot]")
    run("git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com")
    run("git", "fetch", "origin", "main")
    run("git", "merge-base", "--is-ancestor", "origin/main", "HEAD")

    patch_extension()
    patch_extension_test()
    patch_runtime_test()

    run("npm", "ci")
    run("npm", "test", "--", "vscode-extension/src/extension.test.ts", "src/dsl/dslCanvasRevealRuntime.test.ts")

    (ROOT / TRIGGER).write_text("temporary SAY-81 CI trigger; delete via GitHub connector after helper completes\n")
    run("git", "add", "vscode-extension/src/extension.ts", "vscode-extension/src/extension.test.ts", "src/dsl/dslCanvasRevealRuntime.test.ts", TRIGGER)
    run("git", "rm", "-f", WORKFLOW, SCRIPT)
    run("git", "commit", "-m", "fix(SAY-81): distinguish unavailable source analysis")
    head_ref = os.environ.get("GITHUB_HEAD_REF") or os.environ.get("GITHUB_REF_NAME")
    if not head_ref:
        raise RuntimeError("cannot determine branch ref")
    run("git", "push", "origin", f"HEAD:{head_ref}")


if __name__ == "__main__":
    main()
