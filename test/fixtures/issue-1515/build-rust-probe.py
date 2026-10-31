"""Temporarily add one passive timer to the actual Rust stdio owner.

Build to a task-owned external target, restore exact source in finally, preserve
both source hashes and the patch. No Bezier or evaluation algorithm is changed.
"""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

target = Path(sys.argv[1])
source = Path("rust-evaluator/src/bin/evaluation_stdio.rs")
original = source.read_bytes()
p = Path(__file__).parent / "verification-v2"
needle = b"NativeRequest::Evaluation(request) => match evaluate_document(request.input) {"
replacement = b"""NativeRequest::Evaluation(request) => match {
            let started = std::time::Instant::now();
            let result = evaluate_document(request.input);
            eprintln!("issue1515-eval-ns={}", started.elapsed().as_nanos());
            result
        } {"""
assert original.count(needle) == 1
instrumented = original.replace(needle, replacement)
record = {"originalSha256": hashlib.sha256(original).hexdigest(), "instrumentedSha256": hashlib.sha256(instrumented).hexdigest(), "target": str(target)}
(p / "rust-probe-transformation.json").write_text(json.dumps({**record, "needle": needle.decode(), "replacement": replacement.decode()}, indent=2) + "\n")
try:
    source.write_bytes(instrumented)
    subprocess.run(["cargo", "build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio", "--target-dir", str(target)], check=True, timeout=120)
    record["binarySha256"] = hashlib.sha256((target / "debug/evaluation_stdio").read_bytes()).hexdigest()
finally:
    assert source.read_bytes() == instrumented
    source.write_bytes(original)
    record["restoredExactSource"] = source.read_bytes() == original
    (p / "rust-probe-build.json").write_text(json.dumps(record, indent=2) + "\n")
print(json.dumps(record))
