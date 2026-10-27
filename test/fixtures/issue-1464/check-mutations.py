"""Temporarily restore only Issue-owned producer files; always restore candidates.

No Git reset/switch, worktree, or user-owned artifact is involved. Expected
failure logs and original Base inputs are retained by the ordinary test recorder.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[3]
os.chdir(root)
folder = Path(__file__).resolve().parent
base = "30e376a1efdb00c1645bab9a0f17a622e3e11a14"
assert subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip() == base
mutations = [
    ("F1", "packages/nui-language/src/document/inlineModulePlanner.ts", "R01|I01", "R01"),
    ("F2", "packages/nui-language/src/dsl/dslSemanticOccurrenceIndex.ts", "R02|I01", "R02"),
    ("F3", "packages/nui-language/src/dsl/moduleSemanticEditor.ts", "R03|E01", "R03"),
    ("F4", "packages/nui-language/src/dsl/moduleSemanticAnalysis.ts", "R04|I01", "R04"),
    ("F5", "packages/nui-language/src/document/extractModulePlanner.ts", "R05|E01", "R05"),
]
saved = {path: Path(path).read_bytes() for _, path, _, _ in mutations}
original = {path: subprocess.check_output(["git", "show", base + ":" + path]) for path in saved}
results = []

def run(label, pattern=None):
    env = dict(os.environ, ISSUE1464_RECORD=str(folder / (label + ".json")))
    command = ["python3", str(folder / "run-gate.py"), label, "120", "npm", "test", "--",
               "test/issue1464CompositeSourceTransform.integration.test.ts", "--maxWorkers=1"]
    if pattern:
        command += ["-t", pattern]
    exit_code = subprocess.run(command, env=env, timeout=140, check=False).returncode
    assert exit_code == 1, (label, exit_code)
    records = json.loads((folder / (label + ".json")).read_text())["records"]
    results.append(dict(label=label, exit=exit_code,
                        outcomes={r["id"]: dict(disposition=r["disposition"], failure=r.get("failure")) for r in records}))
    return records

try:
    for path in saved:
        Path(path).write_bytes(original[path])
    run("base-confirmed")
    for path in saved:
        Path(path).write_bytes(saved[path])
    for family, path, pattern, failing_id in mutations:
        try:
            assert Path(path).read_bytes() == saved[path]
            Path(path).write_bytes(original[path])
            records = run("mutation-" + family, pattern)
            assert next(r for r in records if r["id"] == failing_id)["disposition"] == "BLOCKED"
            assert any(r["disposition"] == "PASS" for r in records)
        finally:
            Path(path).write_bytes(saved[path])
finally:
    for path in saved:
        Path(path).write_bytes(saved[path])
    assert all(Path(path).read_bytes() == saved[path] for path in saved)
    (folder / "mutations.json").write_text(json.dumps(dict(base=base, results=results, restored=True,
        candidateSha256={p: hashlib.sha256(v).hexdigest() for p,v in saved.items()}), indent=2) + "\n")
