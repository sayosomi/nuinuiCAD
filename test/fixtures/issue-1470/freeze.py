"""Independent Bernstein arithmetic and source fixture seal; no product imports.

Run only to reproduce the original seal. Never derive expectations from an
observed compiler/evaluator result. Coordinates are millimeters, Y-up.
"""
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).parent
P = [(0, 0), (3, 36), (31, 12), (40, 0)]


def add(a, b):
    return tuple(x + y for x, y in zip(a, b))


def sub(a, b):
    return tuple(x - y for x, y in zip(a, b))


def mul(a, s):
    return tuple(x * s for x in a)


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def cross(a, b):
    return a[0] * b[1] - a[1] * b[0]


def point(p, t):
    return tuple(sum(p[i][k] * math.comb(3, i) * t**i * (1-t)**(3-i)
                     for i in range(4)) for k in range(2))


def frame(p, t, side="convex", distance=3):
    first = tuple(3 * sum((p[i+1][k]-p[i][k]) * math.comb(2, i)
                         * t**i * (1-t)**(2-i) for i in range(3)) for k in range(2))
    second = tuple(6 * sum((p[i+2][k]-2*p[i+1][k]+p[i][k])
                          * (t if i else 1-t) for i in range(2)) for k in range(2))
    speed = math.hypot(*first)
    curvature = cross(first, second) / speed**3 if speed else None
    tangent = mul(first, 1/speed) if speed else None
    normal = mul((-tangent[1], tangent[0]), math.copysign(1, curvature)
                 * (1 if side == "concave" else -1)) if curvature else None
    return dict(t=t, first=first, second=second, speed=speed, curvature=curvature,
                tangent=tangent, normal=normal,
                point=add(point(p, t), mul(normal, distance)) if normal else None)


def roots(a, b, c):
    if a == 0:
        return [-c/b] if b else []
    disc = b*b - 4*a*c
    if disc < 0:
        return []
    if disc == 0:
        return [-b/(2*a)]
    # Stable quadratic form, independent of product's sampled derivatives.
    q = -0.5 * (b + math.copysign(math.sqrt(disc), b))
    return sorted([q/a, c/q])


def feature(p, mode="extreme", direction=90):
    v = (math.cos(math.radians(direction % 360)), math.sin(math.radians(direction % 360)))
    # Cardinal directions are exact mathematical axes.
    if direction % 90 == 0:
        v = [(1, 0), (0, 1), (-1, 0), (0, -1)][int(direction % 360 / 90)]
    chord = sub(p[3], p[0])
    scalar = [dot(x, v) if mode == "extreme" else cross(chord, sub(x, p[0])) for x in p]
    a = 3*(-scalar[0]+3*scalar[1]-3*scalar[2]+scalar[3])
    b = 6*(scalar[0]-2*scalar[1]+scalar[2])
    c = 3*(scalar[1]-scalar[0])
    ts = [t for t in roots(a, b, c) if 0 < t < 1]
    if mode == "extreme":
        ts += [0, 1]
    if a == b == c == 0:
        ts += [0.5]
    def score(t):
        return dot(point(p, t), v) if mode == "extreme" else abs(cross(chord, sub(point(p, t), p[0]))) / math.hypot(*chord)
    candidates = [dict(t=t, score=score(t), point=point(p, t)) for t in sorted(set(ts))]
    high = max(x["score"] for x in candidates)
    # 1e-12 only identifies analytically equal floating representations in the
    # symmetric fixtures. All unequal-score cases have a much larger margin.
    best = min((x for x in candidates if abs(x["score"]-high) < 1e-12), key=lambda x: (round(abs(x["t"]-.5), 14), x["t"]))
    return dict(coefficients=[a, b, c], candidates=candidates, **best)


def split(p, t):
    lerp = lambda a, b: add(mul(a, 1-t), mul(b, t))
    a, b, c = [lerp(p[i], p[i+1]) for i in range(3)]
    d, e = lerp(a, b), lerp(b, c)
    f = lerp(d, e)
    return [p[0], a, d, f], [f, e, c, p[3]]


def shift(p, dx, dy):
    return [add(x, (dx, dy)) for x in p]


def n(x):
    return format(x, ".17g")


def xy(p):
    return "(" + ", ".join(n(x) for x in p) + ")"


def curve(p, name="Curve", prefix="curve"):
    s, e = sub(p[1], p[0]), sub(p[3], p[2])
    return f"{prefix} {name} = bezier(start: {xy(p[0])}, end: {xy(p[3])}, startAngle: {n(math.degrees(math.atan2(s[1],s[0])))}, startLength: {n(math.hypot(*s))}, endAngle: {n(math.degrees(math.atan2(e[1],e[0])))}, endLength: {n(math.hypot(*e))})"


def shape(p):
    return dict(kind="point", x=p[0], y=p[1])


def segments(ps):
    return dict(kind="bezierCurve", segments=[{k: dict(x=v[0], y=v[1]) for k, v in zip(["start", "control1", "control2", "end"], p)} for p in ps])


UNITS = []


def seal(unit, stages):
    cps = []
    for i, s in enumerate(stages):
        mode = unit[0]
        ctrl = feature(P, "bulge" if mode == "B" else "extreme") if mode != "C" else frame(P, .4)
        control = curve(P, "ControlCurve") + "\n"
        if mode == "C":
            control += f"point Control = tangentOffset(line: @ControlCurve, base: {xy(point(P,.4))}, curveSide: convex, distance: 3)"
        else:
            control += f"point Control = bezier{'Bulge' if mode == 'B' else 'Extreme'}Point(source: @ControlCurve" + (", direction: 90)" if mode == "E" else ")")
        source = "nui 1\n// Frozen #1470 " + unit + "\n" + s["body"] + "\n" + control + "\n"
        name = f"{unit}-{i}.nui"
        (ROOT/name).write_text(source)
        cps.append(dict(file=name, sha256=hashlib.sha256(source.encode()).hexdigest(), sourceRevisionBefore=1+i,
                        sourceRevisionAfter=2+i, tolerance=s.get("tolerance", 1e-7),
                        expected={**s.get("expected", {}), "Control": shape(ctrl["point"])},
                        errors=s.get("errors", {}), geometryValueErrorCount=0,
                        analytic=s.get("analytic", {}), wrongOracle=s.get("wrongOracle"), note=s.get("note", "")))
    UNITS.append(dict(id=unit, checkpoints=cps))


def fstage(p, mode="extreme", direction=90):
    oracle = feature(p, mode, direction)
    call = f"bezier{'Extreme' if mode == 'extreme' else 'Bulge'}Point(source: @Curve" + (f", direction: {direction})" if mode == "extreme" else ")")
    wrong = p[3] if mode == "extreme" else point(p, .5)
    return dict(body=curve(p)+f"\npoint Result = {call}", expected={"Curve": segments([p]), "Result": shape(oracle["point"])}, analytic=dict(controlPoints=p, **oracle), wrongOracle=shape(wrong))


seal("E1", [fstage(P), fstage([(0, 0), (3, 48), (31, 12), (40, 0)])])
S = [(0, 0), (8, -12), (27, 24), (40, 2)]
seal("E2", [fstage(S, direction=270), fstage(S)])
seal("E3", [fstage(P, direction=d) for d in [90, -270, 450]])
near = lambda r: [(0, -100*r*r), (10, -100*r*r+200*r/3), (20, -100*r*r+400*r/3-100/3), (30, -100*(1-r)**2)]
seal("E4", [fstage(near(r)) for r in [.01, .02]])
seal("E5", [fstage([(0, 5), (0, 5), (8, 5), (x, 5)]) for x in [40, 48]])

M0 = [(0, 0), (0, 12), (15, 0), (20, 0)]
M1 = [(20, 0), (29, 0), (60, 26), (60, 10)]
multi = "curve Curve = bezier(start: (0, 0), end: (60, 10), startAngle: 90, startLength: 12, endAngle: -90, endLength: 16, intermediates: [(20, 0): 0: 5: 9: mid])"
tail0 = split(M0, .5)[1]
e6 = []
for stage, index in [("split", 0), ("split", 1), ("trim", 1), ("extend", 1)]:
    last = M1
    extra = ""
    if stage == "trim":
        extra = f"\nextend Tail.end (to: {xy(point(M1,.8))})"
        last = split(M1, .8)[0]
    if stage == "extend":
        extra = "\nextend Tail.end (to: (60, 2))"
        last = [M1[0], M1[1], (60, 18), (60, 2)]
    ps = [shift(tail0, 7, 9), shift(last, 7, 9)]
    o = feature(ps[index])
    e6.append(dict(body=multi+f"\nline Tail = split(source: @Curve, at: {xy(point(M0,.5))})"+extra+"\nmove Tail as shifted(from: (0, 0), to: (7, 9))"+f"\npoint Result = bezierExtremePoint(source: @Tail.shifted, segmentIndex: {index}, direction: 90)", expected={"Tail": segments(ps), "Result": shape(o["point"])}, analytic=dict(stage=stage, segmentIndex=index, controlPoints=ps, **o)))
seal("E6", e6)
seal("B1", [fstage(P, "bulge"), fstage(shift(P, 13, -7), "bulge")])
SB = [(0, 0), (7, 12), (29, -30), (40, 0)]
seal("B2", [fstage(SB, "bulge"), fstage(list(reversed(SB)), "bulge")])
SYM = [(0, 0), (4, 24), (26, -24), (30, 0)]
seal("B3", [fstage(SYM, "bulge"), fstage(list(reversed(SYM)), "bulge")])
seal("B4", [fstage([(0, 0), (0, 0), (8, 0), (x, 0)], "bulge") for x in [40, 48]])
b5 = []
for index in [1, 2, .5, 1]:
    valid = index == 1
    b5.append(dict(body=multi+f"\npoint Result = bezierBulgePoint(source: @Curve, segmentIndex: {index})", expected={"Curve": segments([M0, M1]), **({"Result": shape(feature(M1,"bulge")["point"])} if valid else {})}, errors={} if valid else {"Result": "区間"}, analytic=dict(segmentIndex=index, controlPoints=[M0,M1], diagnosticClass=None if valid else "geometry")))
seal("B5", b5)
b6 = []
for dy in [5, 17]:
    body = "module M(dy: number) {\n  " + curve(P,"Local","const").replace("const Local =", "const Local: path =") + "\n  export const Path: path = @Local\n  const LocalPoint: point = bezierBulgePoint(source: @Local)\n  export const Out: point = offset(from: @LocalPoint, dx: 0, dy: @dy)\n}\n" + f"instance Left = M(dy: {dy})\ninstance Right = M(dy: 80)\npath Material = from(source: @Left::Path)\npoint Drawable = bezierBulgePoint(source: @Material)\npoint LeftResult = offset(from: @Left::Out, dx: 0, dy: 0)\npoint RightResult = offset(from: @Right::Out, dx: 0, dy: 0)"
    o = feature(P,"bulge")
    b6.append(dict(body=body, expected={"Material": segments([P]), "Drawable": shape(o["point"]), "LeftResult":shape(add(o["point"],(0,dy))), "RightResult":shape(add(o["point"],(0,80)))}, analytic=dict(controlPoints=P, instanceArguments=dict(Left=dy,Right=80),**o)))
seal("B6", b6)


def cstage(p, t=.37, side="convex", reverse=False, distance=3, off=0):
    base = add(point(p,t),(0,off))
    f = frame(p,t,side,distance)
    body = curve(p) + ("\nreverse Curve as flipped()" if reverse else "") + f"\npoint Result = tangentOffset(line: @Curve, base: {xy(base)}, curveSide: {side}, distance: {distance})"
    error = off != 0 or distance < 0 or f["point"] is None
    msg = "曲線上にありません" if off else "0以上" if distance < 0 else "不定義"
    return dict(body=body, expected={"Curve": segments([list(reversed(p)) if reverse else p]), **({} if error else {"Result":shape(f["point"])})}, errors={"Result":msg} if error else {}, analytic=dict(controlPoints=p, base=base, reversed=reverse, side=side, distance=distance, **f), wrongOracle=shape(frame(p,t,"concave" if side=="convex" else "convex",distance)["point"]) if f["point"] else None)


seal("C1", [cstage(P,side=s) for s in ["convex","concave"]])
seal("C2", [cstage(P,side=s,reverse=r) for r,s in [(False,"convex"),(True,"convex"),(True,"concave")]])
c3 = []
for mode in ["extreme","bulge"]:
    o=feature(P,mode); f=frame(P,o["t"])
    c3.append(dict(body=curve(P)+f"\npoint Base = bezier{'Extreme' if mode=='extreme' else 'Bulge'}Point(source: @Curve"+(", direction: 65)" if mode=="extreme" else ")")+"\npoint Result = tangentOffset(line: @Curve, base: @Base, curveSide: convex, distance: 3)", expected={}, analytic={}))
    if mode == "extreme":
        o=feature(P,mode,65); f=frame(P,o["t"])
    c3[-1].update(expected={"Curve":segments([P]),"Base":shape(o["point"]),"Result":shape(f["point"])},analytic=dict(feature=o,frame=f,controlPoints=P))
seal("C3",c3)
seal("C4",[cstage(P,off=o) for o in [0,.1,0]])
INF=[(0,0),(10,20),(20,-20),(30,0)]
ZERO=[(0,0),(0,0),(25,20),(40,0)]
join = "curve Curve = bezier(start: (0, 0), end: (40, 0), startAngle: 90, startLength: 12, endAngle: 90, endLength: 12, intermediates: [(20, 0): 0: 5: 5: mid])\npoint Result = tangentOffset(line: @Curve, base: (20, 0), curveSide: convex, distance: 3)"
seal("C5",[cstage(INF,.4), cstage(INF,.5), cstage(ZERO,0), dict(body=join,errors={"Result":"内部 join"},analytic=dict(controlPoints=[M0,[(20,0),(25,0),(40,-12),(40,0)]],diagnosticClass="geometry",reason="opposite nonzero curvature sides at common tangent")), cstage(P,distance=-3), cstage(P,distance=0), cstage(P)])
c6=[]
for dx in [2,11]:
    body="module M(dx: number) {\n  "+curve(P,"Raw")+"\n  move Raw as shifted(from: (0, 0), to: (@dx, 7))\n  line Tail = split(source: @Raw, at: "+f"({n(point(P,.25)[0])} + @dx, {n(point(P,.25)[1]+7)}))\n  reverse Tail as flipped()\n  export const Path: path = @Tail.flipped\n  export const Out: point = tangentOffset(line: @Path, base: ({n(point(P,.7)[0])} + @dx, {n(point(P,.7)[1]+7)}), curveSide: convex, distance: 3)\n}}\ninstance Left = M(dx: {dx})\ninstance Right = M(dx: 80)\npath LeftPath = from(source: @Left::Path)\npoint LeftResult = offset(from: @Left::Out, dx: 0, dy: 0)\npoint RightResult = offset(from: @Right::Out, dx: 0, dy: 0)"
    tail=split(P,.25)[1]; f=frame(P,.7)
    c6.append(dict(body=body,expected={"LeftPath":segments([list(reversed(shift(tail,dx,7)))]),"LeftResult":shape(add(f["point"],(dx,7))),"RightResult":shape(add(f["point"],(80,7)))},analytic=dict(originalControlPoints=P,selectedControlPoints=list(reversed(shift(tail,dx,7))),selectedLocalT=(1-.7)/.75,originalFrame=f,instanceArguments=dict(Left=dx,Right=80),stage="Tail.flipped after Raw.shifted split at original t=.25")))
seal("C6",c6)

manifest=dict(base="b1f9a32c1b18890729895c1157884e3a72f70cb3", frozenBeforeProductExecution=True,
              units=UNITS, X={f"X{i}":"NOT_TRIGGERED" for i in range(1,9)}, R={f"R{i}":"NOT_TRIGGERED" for i in range(1,9)})
(ROOT/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n")
print(f"Sealed {len(UNITS)} primary traces / {sum(len(u['checkpoints']) for u in UNITS)} source revisions")
