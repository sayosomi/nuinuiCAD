"""Work observations of the same sealed primary units and reducer R1."""
from pathlib import Path
import gzip
import json
import subprocess
import sys

directory = Path(__file__).parent
bundle = sys.argv[1]
manifest = json.loads(gzip.decompress((directory / "acceptance-v2.json.gz").read_bytes()))
units = manifest["units"] + json.loads(gzip.decompress((directory / "conditional-v2.json.gz").read_bytes()))["units"]
for unit in units:
    args = ["python3", str(directory / "run-bounded.py"), f"work-{unit['id']}", "60", "node", "--enable-source-maps", str(Path(bundle) / "staged.mjs"), unit["id"], "work", "work"]
    run = subprocess.run(args, capture_output=True, text=True, timeout=75)
    print(f"{unit['id']} work exit={run.returncode}", flush=True)
    if run.returncode:
        print(run.stdout, run.stderr, flush=True)
        sys.exit(run.returncode)
