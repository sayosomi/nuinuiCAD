"""Issue #1515 adjudicated oracle. No product imports/execution."""
import copy
import datetime
import gzip
import hashlib
import json
import math
from pathlib import Path

p = Path(__file__).parent
original = gzip.decompress((p / "manifest.json.gz").read_bytes())
manifest = copy.deepcopy(json.loads(original))
accuracy = []
for unit in manifest["units"]:
    for cp in unit["checkpoints"]:
        assert hashlib.sha256((p / cp["file"]).read_bytes()).hexdigest() == cp["sha256"]
        for name, g in cp["expected"].items():
            if g.get("kind") != "bezierCurve":
                continue
            total = 0
            for segment in g["segments"]:
                controls = [segment[key] for key in ["start", "control1", "control2", "end"]]
                points = []
                for i in range(33):
                    t = i / 32
                    coefficients = [(1-t)**3, 3*(1-t)**2*t, 3*(1-t)*t*t, t**3]
                    points.append(tuple(sum(c[k] * a for c, a in zip(controls, coefficients)) for k in ["x", "y"]))
                total += sum(math.dist(a, b) for a, b in zip(points, points[1:]))
            accuracy.append({"file": cp["file"], "geometry": name, "continuousIntegral": g["length"], "discrete32Chord": total, "difference": g["length"] - total, "gatingContinuousAccuracy": False})
            g["length"] = total
            cp["scalars"][name.removesuffix("Curve") + "curveLength"] = total

manifest["acceptanceVersion"] = 2
manifest["authority"] = "https://github.com/sayosomi/nuinuiCAD/issues/1515#issuecomment-6535672873"
manifest["originalDecodedSha256"] = hashlib.sha256(original).hexdigest()
manifest["bezierLengthTolerance"] = 1e-6
manifest["freeze"] = "Independent polynomial cubic at i/32, i=0..32; Euclidean chord sum; before v2 product execution"
raw = (json.dumps(manifest, indent=2) + "\n").encode()
(p / "acceptance-v2.json.gz").write_bytes(gzip.compress(raw, mtime=0))
(p / "accuracy-v2.json.gz").write_bytes(gzip.compress((json.dumps(accuracy, indent=2) + "\n").encode(), mtime=0))
(p / "seal-v2.json").write_text(json.dumps({"sealedAtJST": datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).isoformat(), "acceptanceDecodedSha256": hashlib.sha256(raw).hexdigest(), "originalDecodedSha256": hashlib.sha256(original).hexdigest(), "generatorSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "units": 12, "ceiling": 20, "conditionalSlotsConsumed": 0, "originalSourcesUnchanged": True}, indent=2) + "\n")
print("Acceptance v2 sealed:", hashlib.sha256(raw).hexdigest())
