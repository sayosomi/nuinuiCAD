from __future__ import annotations

import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPECTED_CONFLICTS = {"src/dsl/dslDocument.ts", "src/vscode/protocol.ts"}
WORKFLOW = ".github/workflows/say81-merge-diagnose.yml"
SCRIPT = "scripts/say81-merge-diagnose.py"
DIAGNOSTIC = ROOT / "say81-ci-diagnostic.txt"


def run(*args: str, check: bool = True, capture: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=ROOT,
        check=check,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.STDOUT if capture else None,
    )


def ensure_dsl_document_merge() -> None:
    path = ROOT / "src/dsl/dslDocument.ts"
    text = path.read_text()
    namespace_marker = "      (\n        statement.kind === \"group\" ||"
    namespace_replacement = "      (\n        statement.kind === \"recordDefinition\" ||\n        statement.kind === \"group\" ||"
    if 'statement.kind === "recordDefinition" ||\n        statement.kind === "group" ||' not in text:
        if namespace_marker not in text:
            raise RuntimeError("SAY-81 merge: source namespace marker not found")
        text = text.replace(namespace_marker, namespace_replacement, 1)

    identity_marker = (
        "  const sourceNamespaceRequiresIdentity = (statement: DslStatement) =>\n"
        "    statement.kind === \"moduleDefinition\" ||"
    )
    identity_replacement = (
        "  const sourceNamespaceRequiresIdentity = (statement: DslStatement) =>\n"
        "    statement.kind === \"recordDefinition\" ||\n"
        "    statement.kind === \"moduleDefinition\" ||"
    )
    if 'sourceNamespaceRequiresIdentity = (statement: DslStatement) =>\n    statement.kind === "recordDefinition" ||' not in text:
        if identity_marker not in text:
            raise RuntimeError("SAY-81 merge: source identity marker not found")
        text = text.replace(identity_marker, identity_replacement, 1)

    if "moduleGeometryRuntime?: ModuleGeometryRuntimeCompilation;" not in text:
        raise RuntimeError("SAY-81 merge: moduleGeometryRuntime contract was lost")
    path.write_text(text)


def ensure_protocol_merge() -> None:
    path = ROOT / "src/vscode/protocol.ts"
    text = path.read_text()
    reveal_import = (
        'import type { DslCanvasRevealDegradation, DslCanvasRevealFailureReason } '
        'from "../dsl/dslCanvasRevealQuery";'
    )
    if reveal_import not in text:
        marker = 'import type { NormalizedSourceRange } from "../dsl/dslNavigationQuery";\n'
        if marker not in text:
            raise RuntimeError("SAY-81 merge: protocol import marker not found")
        text = text.replace(marker, marker + reveal_import + "\n", 1)

    reveal_type = (
        'export type VscodeCanvasNavigationResult =\n'
        '  | { type: "canvasNavigationResult"; requestId: number; status: "resolved"; degradations: readonly DslCanvasRevealDegradation[] }\n'
        '  | { type: "canvasNavigationResult"; requestId: number; status: "failed"; reason: DslCanvasRevealFailureReason }\n'
        '  | { type: "canvasNavigationResult"; requestId: number; status: "focused" };\n\n'
    )
    if "export type VscodeCanvasNavigationResult =" not in text:
        marker = "export type VscodeToExtensionMessage =\n"
        if marker not in text:
            raise RuntimeError("SAY-81 merge: protocol result marker not found")
        text = text.replace(marker, reveal_type + marker, 1)

    legacy = (
        '  | { type: "canvasNavigationResult"; requestId: number; status: '
        '"ready" | "no-target" | "no-renderable-geometry" | "stale" | "focused" }'
    )
    if legacy in text:
        text = text.replace(legacy, "  | VscodeCanvasNavigationResult", 1)
    if "| VscodeMultiDocumentGraphPublication" not in text:
        raise RuntimeError("SAY-81 merge: SAY-149 multi-document protocol contract was lost")
    path.write_text(text)


def capture_tests() -> int:
    run("npm", "ci")
    run("cargo", "build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--example", "evaluate_fixture")
    log_path = ROOT / ".say81-test.log"
    with log_path.open("w") as log:
        result = subprocess.run(
            ["npm", "test"],
            cwd=ROOT,
            text=True,
            stdout=log,
            stderr=subprocess.STDOUT,
        )
    if result.returncode == 0:
        DIAGNOSTIC.unlink(missing_ok=True)
    else:
        lines = log_path.read_text(errors="replace").splitlines()
        tail = lines[-450:]
        DIAGNOSTIC.write_text(
            "SAY-81 temporary CI diagnostic\n"
            f"npm test exit code: {result.returncode}\n"
            "Captured tail follows. This file is temporary and must be deleted after diagnosis.\n\n"
            + "\n".join(tail)
            + "\n"
        )
    log_path.unlink(missing_ok=True)
    return result.returncode


def main() -> None:
    run("git", "config", "user.name", "github-actions[bot]")
    run("git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com")
    run("git", "fetch", "origin", "main")
    merge = run("git", "merge", "--no-commit", "--no-ff", "origin/main", check=False, capture=True)
    if merge.returncode != 0:
        conflicts_output = run("git", "diff", "--name-only", "--diff-filter=U", capture=True).stdout or ""
        conflicts = {line.strip() for line in conflicts_output.splitlines() if line.strip()}
        unexpected = conflicts - EXPECTED_CONFLICTS
        if unexpected or not conflicts:
            raise RuntimeError(f"SAY-81 merge: unexpected conflicts: {sorted(conflicts)}\n{merge.stdout}")
        if "src/dsl/dslDocument.ts" in conflicts:
            run("git", "checkout", "--ours", "--", "src/dsl/dslDocument.ts")
        if "src/vscode/protocol.ts" in conflicts:
            run("git", "checkout", "--theirs", "--", "src/vscode/protocol.ts")

    ensure_dsl_document_merge()
    ensure_protocol_merge()
    run("git", "add", "src/dsl/dslDocument.ts", "src/vscode/protocol.ts")

    test_exit = capture_tests()
    if DIAGNOSTIC.exists():
        run("git", "add", str(DIAGNOSTIC.relative_to(ROOT)))

    run("git", "rm", "-f", WORKFLOW, SCRIPT)
    message = "Merge latest main into SAY-81"
    if test_exit != 0:
        message += " and capture failing Node diagnostics"
    run("git", "commit", "-m", message)
    head_ref = os.environ.get("GITHUB_HEAD_REF") or os.environ.get("GITHUB_REF_NAME")
    if not head_ref:
        raise RuntimeError("SAY-81 merge: cannot determine branch ref")
    run("git", "push", "origin", f"HEAD:{head_ref}")


if __name__ == "__main__":
    main()
