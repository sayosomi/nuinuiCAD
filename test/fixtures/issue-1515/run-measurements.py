"""Sequential comparable measurements of the already sealed 12 units."""
from pathlib import Path
import gzip
import json
import subprocess
import sys

directory = Path(__file__).parent
bundle, rust_target = sys.argv[1:]
manifest = json.loads(gzip.decompress((directory / "acceptance-v2.json.gz").read_bytes()))
for unit in manifest["units"]:
    for label, binary in [("normal", "normal.mjs"), ("staged", "staged.mjs"), ("rust-timed", "normal.mjs")]:
        args = ["python3", str(directory / "run-bounded.py"), f"{label}-{unit['id']}-final", "180", "node", "--enable-source-maps", str(Path(bundle) / binary), unit["id"], label, "timing"]
        if label == "rust-timed":
            args.append(str(Path(rust_target) / "debug/evaluation_stdio"))
        run = subprocess.run(args, capture_output=True, text=True, timeout=195)
        print(f"{unit['id']} {label} exit={run.returncode}", flush=True)
        if run.returncode:
            print(run.stdout, run.stderr, flush=True)
            sys.exit(run.returncode)
