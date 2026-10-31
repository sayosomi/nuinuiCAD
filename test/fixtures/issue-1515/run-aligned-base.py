"""Align Base/fixed comparisons to the exact same ordinary Rust executable."""
from pathlib import Path
import base64
import gzip
import hashlib
import json
import subprocess
import sys

p = Path(__file__).parent
bundle = Path(sys.argv[1])
binary = Path("rust-evaluator/target/debug/evaluation_stdio")
wanted = "26de8a1bd3acbe3bd619d3026eaa4446bb331f0a51e9a0f280580dcd2edbd92d"
assert hashlib.sha256(binary.read_bytes()).hexdigest() == wanted
builds = []
for kind in ["normal", "staged"]:
    file = bundle / (kind + ".mjs")
    raw = file.read_bytes()
    source_map = json.loads(base64.b64decode(raw.decode().split("sourceMappingURL=data:application/json;base64,")[-1].strip()))
    owner = [content for name, content in zip(source_map["sources"], source_map["sourcesContent"]) if name.endswith("packages/nui-language/src/dsl/moduleExecutionCompiler.ts")]
    assert len(owner) == 1
    owner_hash = hashlib.sha256(owner[0].encode()).hexdigest()
    assert owner_hash == "94eec297951177ad0418720eb1b7707a0161e929e8b100961f5ca59a69bc1a21"
    builds.append({"bundle": str(file), "sha256": hashlib.sha256(raw).hexdigest(), "ownerSha256": owner_hash})
units = json.loads(gzip.decompress((p / "acceptance-v2.json.gz").read_bytes()))["units"]
for unit in units:
    kinds = ["normal"] + (["staged"] if unit["id"].endswith("-P") else [])
    for kind in kinds:
        assert hashlib.sha256(binary.read_bytes()).hexdigest() == wanted
        label = "aligned-base-" + kind
        args = ["python3", str(p / "run-bounded.py"), f"v3-{label}-{unit['id']}", "180", "node", "--enable-source-maps", str(bundle / (kind + ".mjs")), unit["id"], label, "timing"]
        result = subprocess.run(args, capture_output=True, text=True, timeout=195)
        print(unit["id"], label, "exit", result.returncode, flush=True)
        if result.returncode:
            print(result.stdout, result.stderr, flush=True)
            sys.exit(result.returncode)
        record = json.loads(gzip.decompress((p / f"measurements-v2/{label}-{unit['id']}.json.gz").read_bytes()))
        assert record["binarySha256"] == wanted
(p / "verification-v3/aligned-base-builds.json").write_text(json.dumps({"rustBinarySha256": wanted, "baseBundles": builds, "trialsPerComparableCase": 21, "warmups": 5, "newExploratoryUnits": 0}, indent=2) + "\n")
