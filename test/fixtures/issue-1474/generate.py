"""Offline integer/coordinate oracle. No product compiler or evaluator imports."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).parent
BASE = "60f54f3ccec505821bc615e516bab8192bd20533"


def fixture(family, size, edited=False, permuted=False):
    rows, scalars, geometry, dependencies = [], {}, {}, {}

    def scalar(name, expression, value, refs=()):
        rows.append(f"const {name}: number = {expression}")
        scalars[name] = value
        dependencies[name] = list(refs)

    def point(name, xexpr, yexpr, x, y, refs=()):
        rows.append(f"point {name} = coordinate(x: {xexpr}, y: {yexpr})")
        geometry[name] = {"type": "point", "x": x, "y": y}
        dependencies[name] = list(refs)

    def line(name, start, end, startxy, endxy, refs):
        rows.append(f"line {name} = segment(start: {start}, end: {end})")
        geometry[name] = {"type": "line", "start": dict(zip(("x", "y"), startxy)),
                          "end": dict(zip(("x", "y"), endxy))}
        dependencies[name] = list(refs)

    if family == "A":
        level = []
        for i in range(size):
            value = i % 7 + 1 + (11 if edited and i == 0 else 0)
            name = f"Leaf{i}"
            scalar(name, str(value), value)
            level.append(name)
        tier = 0
        while len(level) > 1:
            next_level = []
            for i in range(0, len(level), 2):
                a, b = level[i:i + 2]
                name = f"Sum{tier}_{i // 2}"
                scalar(name, f"@{a} + @{b}", scalars[a] + scalars[b], (a, b))
                next_level.append(name)
            level, tier = next_level, tier + 1
        sink = level[0]
        point("Result", f"@{sink}", f"0 - @{sink}", scalars[sink], -scalars[sink], (sink,))
        # Forward references force the canonical dependency graph to own order.
        rows.reverse()
    elif family == "B":
        root = 5 + (11 if edited else 0)
        scalar("Root", str(root), root)
        point("Producer", "@Root", "0 - @Root", root, -root, ("Root",))
        for i in range(size):
            line(f"Fan{i}", "@Producer", f"({i + 30}, {i + 40})", (root, -root),
                 (i + 30, i + 40), ("Producer",))
        rows.reverse()
    elif family == "C":
        scalar("Root", "7", 7)
        previous, value = "Root", 7
        for i in range(size):
            a, b, c = f"Left{i}", f"Right{i}", f"Join{i}"
            scalar(a, f"@{previous} + 1", value + 1, (previous,))
            scalar(b, f"@{previous} + 2", value + 2, (previous,))
            scalar(c, f"@{a} + @{b} - @{previous}", value + 3, (a, b, previous))
            previous, value = c, value + 3
        point("Result", f"@{previous}", f"0 - @{previous}", value, -value, (previous,))
        rows.reverse()
    else:
        x, y = (14, -14) if edited else (3, -3)
        point("Producer", str(x), str(y), x, y)
        previous = "Producer"
        for i in range(size):
            left, right, join = f"Left{i}", f"Right{i}", f"Join{i}"
            line(left, f"@{previous}", f"({i + 1}, {-i - 1})", (x, y), (i + 1, -i - 1), (previous,))
            line(right, f"@{previous}", f"({i + 2}, {-i - 2})", (x, y), (i + 2, -i - 2), (previous,))
            x, y = x + i + 1, y - i - 1
            point(join, f"@{left}.endPoint.x + @{right}.startPoint.x",
                  f"@{left}.endPoint.y + @{right}.startPoint.y", x, y, (left, right))
            previous = join
        rows.reverse()

    # Disjoint scalar/geometry controls move as a block only for C4.
    control_start = len(rows)
    scalar("ControlScalar", "19", 19)
    point("ControlPoint", "-23", "31", -23, 31)
    if permuted:
        rows = rows[control_start:] + rows[:control_start]
    source = "nui 1\n" + "\n".join(rows) + "\n"
    return source, dict(scalars=scalars, geometry=geometry, dependencies=dependencies,
                        semanticV=len(dependencies), semanticE=sum(len(set(v)) for v in dependencies.values()))


units = []
for family, sizes in [("A", [64, 256, 1024]), ("B", [64, 256, 1000]),
                      ("C", [21, 85, 333]), ("D", [21, 85, 333])]:
    for number in range(1, 5):
        size = sizes[min(number - 1, 2)]
        variants = [({}, "initial")]
        if number == 4:
            variants += [({"permuted": True} if family == "C" else {"edited": True}, "changed"), ({}, "restored")]
        checkpoints = []
        for revision, (options, transition) in enumerate(variants, 1):
            source, oracle = fixture(family, size, **options)
            name = f"{family}{number}-r{revision}"
            (ROOT / f"{name}.nui").write_text(source)
            (ROOT / f"{name}.oracle.json").write_text(json.dumps(oracle, sort_keys=True, separators=(",", ":")) + "\n")
            checkpoints.append(dict(file=f"{name}.nui", oracle=f"{name}.oracle.json", transition=transition,
                                    sourceRevisionBefore=revision - 1, sourceRevisionAfter=revision,
                                    sha256=hashlib.sha256(source.encode()).hexdigest(),
                                    oracleSha256=hashlib.sha256((ROOT / f"{name}.oracle.json").read_bytes()).hexdigest(),
                                    bytes=len(source.encode()), semanticV=oracle["semanticV"], semanticE=oracle["semanticE"]))
        units.append(dict(id=f"{family}{number}", size=size, checkpoints=checkpoints))

(ROOT / "manifest.json").write_text(json.dumps(dict(base=BASE, units=units), indent=2) + "\n")
