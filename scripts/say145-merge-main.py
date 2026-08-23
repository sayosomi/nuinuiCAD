from __future__ import annotations

import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ".github/workflows/say145-merge-main.yml"
SCRIPT = "scripts/say145-merge-main.py"


def run(*args: str) -> None:
    subprocess.run(args, cwd=ROOT, check=True, text=True)


def main() -> None:
    run("git", "config", "user.name", "github-actions[bot]")
    run("git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com")
    run("git", "fetch", "origin", "main")
    run("git", "merge", "--no-edit", "origin/main")
    run("git", "rm", "-f", WORKFLOW, SCRIPT)
    run("git", "commit", "-m", "chore(SAY-145): remove temporary merge helper")
    head_ref = os.environ.get("GITHUB_HEAD_REF") or os.environ.get("GITHUB_REF_NAME")
    if not head_ref:
        raise RuntimeError("cannot determine branch ref")
    run("git", "push", "origin", f"HEAD:{head_ref}")


if __name__ == "__main__":
    main()
