"""Issue-owned bounded gate recorder; no product semantics or transformations."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

root = Path(__file__).resolve().parents[3]
os.chdir(root)
label, timeout, *command = sys.argv[1:]
folder = Path(__file__).resolve().parent
started = time.monotonic()
timed_out = False
with (folder / (label + ".log")).open("x") as output:
    child = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT,
                             start_new_session=True)
    try:
        code = child.wait(timeout=float(timeout))
    except subprocess.TimeoutExpired:
        timed_out = True
        os.killpg(child.pid, signal.SIGTERM)
        try:
            code = child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            code = child.wait(timeout=10)
result = dict(label=label, command=command, exit=code, timeout=timed_out,
              bound_seconds=float(timeout), seconds=round(time.monotonic()-started, 3))
with (folder / "gates.jsonl").open("a") as output:
    output.write(json.dumps(result) + "\n")
print(json.dumps(result), flush=True)
sys.exit(124 if timed_out else code)
