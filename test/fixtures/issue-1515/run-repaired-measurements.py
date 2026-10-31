"""Post-repair repeats without overwriting any original Base observations."""
from pathlib import Path
import gzip
import json
import os
import subprocess
import sys

p = Path(__file__).parent
bundle = Path(sys.argv[1])
units = json.loads(gzip.decompress((p / "acceptance-v2.json.gz").read_bytes()))["units"]
for unit in units:
    # All twelve normal production timings are repeated. Nested stage timings
    # use the three P scale points; all edit classes get separate work probes.
    modes = [("fixed-normal", "normal.mjs")]
    if unit["id"].endswith("-P"):
        modes.append(("fixed-staged", "staged.mjs"))
    for label, entry in modes:
        args = ["python3", str(p / "run-bounded.py"), f"{label}-{unit['id']}", "180", "node", "--enable-source-maps", str(bundle / entry), unit["id"], label, "timing"]
        run = subprocess.run(args, env={**os.environ, "ISSUE1515_MEASUREMENT_DIR": str(p / "measurements-v3")}, capture_output=True, text=True, timeout=195)
        print(unit["id"], label, "exit", run.returncode, flush=True)
        if run.returncode:
            print(run.stdout, run.stderr, flush=True)
            sys.exit(run.returncode)
