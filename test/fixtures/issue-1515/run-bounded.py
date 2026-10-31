"""Task-only bounded command/log retention. Kill only our own process group."""
import datetime
import gzip
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

label, timeout, *command = sys.argv[1:]
p = Path(__file__).parent / "verification-v2"
p.mkdir(exist_ok=True)
started = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).isoformat()
t = time.monotonic()
out = p / (label + ".log")
timed_out = False
with out.open("wb") as log:
    process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    try:
        code = process.wait(timeout=float(timeout))
    except subprocess.TimeoutExpired:
        timed_out = True
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)
        code = 124
raw = out.read_bytes()
out.with_suffix(".log.gz").write_bytes(gzip.compress(raw, mtime=0))
out.unlink()
record = {"command": command, "startedAtJST": started, "timeoutSeconds": float(timeout), "elapsedSeconds": time.monotonic() - t, "exitCode": code, "timedOut": timed_out, "logDecodedSha256": hashlib.sha256(raw).hexdigest()}
(p / (label + ".result.json")).write_text(json.dumps(record, indent=2) + "\n")
print(raw.decode(errors="replace")[-4500:])
print(json.dumps(record))
sys.exit(code)
