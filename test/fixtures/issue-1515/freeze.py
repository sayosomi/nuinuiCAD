"""Freeze literal sources and elementary-math oracles before product execution."""
import hashlib
import gzip
import json
import math
from pathlib import Path

ROOT = Path(__file__).parent
BASE = "7fe9b0d3a39131c5bf39ea0e13e87d26caf52e28"


def panel(prefix, x, y, width):
    def p(a, b):
        return {"x": a, "y": b}
    start, end = p(x, y), p(x + width, y)
    # B(t) has controls (x,y+12),(x+w,y+12). Composite Simpson,
    # independent of either evaluator's curve subdivision/length routine.
    def speed(t):
        return math.hypot(6 * width * t * (1 - t), 36 * (1 - 2 * t))
    n = 8192
    length = (speed(0) + speed(1) + sum((4 if i % 2 else 2) * speed(i / n) for i in range(1, n))) / (3 * n)
    return {prefix + k: v for k, v in {
        "A": {"kind": "point", **start},
        "B": {"kind": "point", **end},
        "N0": {"kind": "point", **p(x + width / 2, y)},
        "N1": {"kind": "point", **p(x + width / 2, y - 2)},
        "Edge": {"kind": "line", "start": start, "end": end, "length": width},
        "Curve": {"kind": "bezierCurve", "segments": [{"start": start, "control1": p(x, y + 12), "control2": p(x + width, y + 12), "end": end}], "length": length},
        "Seam": {"kind": "offsetLine", "start": p(x, y + 3), "end": p(x + width, y + 3), "segments": [{"kind": "line", "start": p(x, y + 3), "end": p(x + width, y + 3), "length": width}], "length": width},
        "Notch": {"kind": "line", "start": p(x + width / 2, y), "end": p(x + width / 2, y - 2), "length": 2}
    }.items()}


def body(width, row, indent="", prefix=""):
    # Exactly eight drawable declarations; const measurements are source-only.
    a, b, n0, n1, edge, curve, seam, notch = [prefix + s for s in ["A", "B", "N0", "N1", "Edge", "Curve", "Seam", "Notch"]]
    return [indent + s for s in [
        f"point {a} = coordinate(x: 0, y: {row})",
        f"point {b} = offset(from: @{a}, dx: {width}, dy: 0)",
        f"point {n0} = offset(from: @{a}, dx: {width} / 2, dy: 0)",
        f"point {n1} = offset(from: @{n0}, dx: 0, dy: -2)",
        f"line {edge} = segment(start: @{a}, end: @{b})",
        f"curve {curve} = bezier(start: @{a}, end: @{b}, startAngle: 90, startLength: 12, endAngle: 270, endLength: 12)",
        f"line {seam} = offset(sources: [@{edge}], distance: 3, side: left, closed: false)",
        f"line {notch} = segment(start: @{n0}, end: @{n1})",
        f"const {prefix}seamLength: number = @{seam}.length",
        f"const {prefix}curveLength: number = @{curve}.length",
    ]]


units = []
for size, count in [("S", 32), ("M", 128), ("L", 512)]:
    instances = count // 8 - 1
    lines = ["nui 1", "// Plush panel: mm, Y-up; independent fixed-width control.", "const width: number = 48", "module Panel(width: number, row: number) {", *body("@width", "@row", "  "), "}", *body("40", "20", prefix="Control")]
    lines += [f"instance I{i} = Panel(width: @width, row: {-40 * (i + 1)})" for i in range(instances)]
    initial = "\n".join(lines) + "\n"
    for shape in ["P", "M", "C", "R"]:
        uid = size + "-" + shape
        sources = [initial]
        if shape == "P":
            sources += [initial.replace("width: number = 48", "width: number = 60")]
        elif shape == "M":
            sources += [initial.replace("I0 = Panel(width: @width", "I0 = Panel(width: 56")]
        elif shape == "C":
            sources += [initial.replace("// Plush panel:", "// Comment-only revision:\n\n// Plush panel:")]
        else:
            sources += [initial.replace("const width: number = 48", "const width: number = ("), initial.replace("width: number = 48", "width: number = 60")]
        cps = []
        for rev, source in enumerate(sources):
            file = f"{uid}-{rev}.nui"
            (ROOT / file).write_text(source)
            invalid = shape == "R" and rev == 1
            widths = [60 if shape in ["P", "R"] and rev == len(sources) - 1 else 56 if shape == "M" and rev and i == 0 else 48 for i in range(instances)]
            expected = panel("Control", 0, 20, 40)
            scalars = {"width": 60 if shape in ["P", "R"] and rev == len(sources) - 1 else 48, "ControlseamLength": 40, "ControlcurveLength": expected["ControlCurve"]["length"]}
            for i, width in enumerate(widths):
                expected.update(panel(f"I{i}::", 0, -40 * (i + 1), width))
                scalars[f"I{i}::seamLength"] = width
                scalars[f"I{i}::curveLength"] = expected[f"I{i}::Curve"]["length"]
            cps.append({"file": file, "sha256": hashlib.sha256(source.encode()).hexdigest(), "sourceRevision": rev + 1, "invalid": invalid, "docRevision": 1 if invalid else rev + 1, "expected": {} if invalid else expected, "scalars": {} if invalid else scalars})
        units.append({"id": uid, "count": count, "instances": instances, "status": "frozen-before-execution", "checkpoints": cps})

manifest = {"base": BASE, "freeze": "Python elementary arithmetic + Simpson integral, before compiler/runtime execution", "coordinateTolerance": 1e-6, "lengthTolerance": 0.02, "oracle": "Cubic controls: A,A+(0,12),B+(0,12),B; horizontal left seam at y+3; source and runtime identities stable across all revisions; Panel origin per I0..In; fatal invalid retains last-good revision 1; recovery is source revision 3", "budget": {"primary": 12, "adjacent": {f"X{i}": "unused" for i in range(1, 5)}, "reducers": {f"R{i}": "unused" for i in range(1, 5)}, "ceiling": 20}, "units": units}
(ROOT / "manifest.json.gz").write_bytes(gzip.compress((json.dumps(manifest, indent=2) + "\n").encode(), mtime=0))
print("Frozen 12 units / 27 revision files; no compiler or evaluator invoked")
