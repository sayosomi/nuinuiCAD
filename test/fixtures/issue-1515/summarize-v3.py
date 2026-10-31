"""Verify final repaired matrix, before/after samples and causal work proof."""
from pathlib import Path
import gzip
import hashlib
import json
import math

p = Path(__file__).parent
def read(file):
    return json.loads(gzip.decompress(file.read_bytes())) if file.suffix == ".gz" else json.loads(file.read_text())
def stat(record, key):
    value = record["statistics"][key]
    ordered = sorted(value["samples"])
    assert len(ordered) == 21
    assert value["p50"] == ordered[10] and value["p95"] == ordered[19] and value["max"] == ordered[-1]
    return {k: value[k] for k in ["p50", "p95", "max"]}
def validate(record, unit):
    assert record["sourceHashes"] == [cp["sha256"] for cp in unit["checkpoints"]]
    assert record["spawns"] == 1 and record["requests"] == 27
    assert len(record["samples"]) == 26 and record["warmups"] == 5 and record["trials"] == 21
    for key in record["statistics"]: stat(record, key)

primary = read(p / "acceptance-v2.json.gz")["units"]
units = primary + read(p / "conditional-v2.json.gz")["units"] + read(p / "adjacent-v2.json.gz")["units"]
observation_file = p / "verification-v3/restored-all-observations.json"
if not observation_file.exists(): observation_file = observation_file.with_name(observation_file.name + ".gz")
observations = read(observation_file)["observations"]
rows, work_rows = [], []
for unit in units:
    for cp in unit["checkpoints"]:
        assert hashlib.sha256((p / cp["file"]).read_bytes()).hexdigest() == cp["sha256"]
    passes = [o for o in observations if o.get("unit") == unit["id"] and o.get("disposition") == "PASS"]
    assert len(passes) == 2 * sum(not cp["invalid"] for cp in unit["checkpoints"])
    is_primary = unit in primary
    base = read(p / f"measurements-v2/{'aligned-base-normal' if is_primary else 'base-normal'}-{unit['id']}.json.gz")
    fixed = read(p / f"measurements-v3/fixed-normal-{unit['id']}.json.gz")
    validate(base, unit); validate(fixed, unit)
    assert base["binarySha256"] == fixed["binarySha256"], "Production Rust executable must remain unchanged"
    phases = []
    for index, cp in enumerate(unit["checkpoints"][1:], 1):
        key = f"revision{index}.totalMs"
        before, after = stat(base, key), stat(fixed, key)
        phases.append({"file": cp["file"], "sourceRevision": cp["sourceRevision"], "invalid": cp["invalid"], "normalBeforeMs": before, "normalAfterMs": after, "afterOverBeforeP50": after["p50"]/before["p50"]})
    row = {"id": unit["id"], "semanticDisposition": "PASS", "normalComparisons": phases}
    if unit["id"].endswith("-P") or not is_primary:
        staged_base = read(p / f"measurements-v2/{'aligned-base-staged' if is_primary else 'base-staged'}-{unit['id']}.json.gz")
        staged_fixed = read(p / f"measurements-v3/fixed-staged-{unit['id']}.json.gz")
        validate(staged_base, unit); validate(staged_fixed, unit)
        row["stageComparisons"] = {key: {"before":stat(staged_base,key), "after":stat(staged_fixed,key)} for key in staged_base["statistics"] if key.endswith(("wallMs","cpuMs"))}
    rows.append(row)
    records = read(p / f"measurements-v3/fixed-work-{unit['id']}.json.gz")["workRecords"]
    for phase in records:
        direct = []
        for call in phase["filters"]:
            caller = next((line for line in call["stack"].splitlines() if "/packages/nui-language/src/" in line), "")
            if "/dsl/moduleExecutionCompiler.ts" in caller: direct.append(call)
        e = unit["count"] + unit["instances"]
        partition = sum(c["length"] for c in direct if c["method"] == "forEach")
        filters = sum(c["length"] for c in direct if c["method"] == "filter")
        total = sum(c["length"] for c in direct if c["method"] in ["map","filter","forEach"])
        assert filters == 0
        assert partition == (0 if phase["invalid"] else 2*e)
        assert total == (0 if phase["invalid"] else 5*e)
        work_rows.append({"id":unit["id"], "file":phase["file"], "invalid":phase["invalid"], "entries":e, "partitionVisits":partition, "wholeOwnerDirectVisits":total, "disposition":"PASS"})

causal = read(p / "verification-v3/causal-proof.json")
assert causal["chain"]["base"] == causal["chain"]["removed"]
assert causal["chain"]["fixed"] == causal["chain"]["restored"]
checks = []
for f in sorted((p / "verification-v2").glob("*.result.json")):
    if not f.name.startswith(("v3-", "fixed-normal-", "fixed-staged-", "fixed-work-")): continue
    result = read(f)
    expected = 1 if f.name in ["v3-base-work.result.json", "v3-removed-work.result.json"] else 0
    assert result["exitCode"] == expected and not result["timedOut"], f
    checks.append({"record":str(f.relative_to(p)), "expectedExitCode":expected, **result})
owner = Path("packages/nui-language/src/dsl/moduleExecutionCompiler.ts")
assert hashlib.sha256(owner.read_bytes()).hexdigest() == causal["removal"]["fixedSha256"]
report = {"status":"BOUNDED_IMPLEMENTATION_AND_LOCAL_VERIFICATION_COMPLETE; independent exact-pushed-HEAD review pending", "primary":"12/12 PASS", "conditional":{"R1":"PASS", "X1":"PASS"}, "acceptedDistinctUnits":14, "ceiling":20, "unusedAdjacent":["X2","X3","X4"], "unusedReducers":["R2","R3","R4"], "confirmedProducer":"Repeated full-array scope partitioning in moduleExecutionCompiler.ts", "productionOwnersChanged":[str(owner)], "oracleAuthority":read(p / "verification-v3/human-authorization.json"), "counterOracleVersion":3, "rows":rows, "allMatrixWork":work_rows, "causalProof":causal, "verification":checks, "timingInterpretation":"No uniform whole-pipeline speedup claim. Deterministic work reduction is proved independently; original Rust/scalar-lowering costs and noisy/nonuniform timings remain visible.", "rustGateApplicability":"No lasting Rust source or algorithm change; actual persistent-Rust focused/parity and normal binary build ran. No unrelated full Rust/clippy gate was added.", "guiValidation":False}
(p / "summary-v3.json.gz").write_bytes(gzip.compress((json.dumps(report,indent=2)+"\n").encode(),mtime=0))
(p / "matrix-dispositions-v3.json").write_text(json.dumps({k:report[k] for k in ["status","primary","conditional","acceptedDistinctUnits","ceiling","unusedAdjacent","unusedReducers","confirmedProducer","productionOwnersChanged","counterOracleVersion","guiValidation"]},indent=2)+"\n")
for row in rows:
    last = row["normalComparisons"][-1]
    print(row["id"], "normal p50", round(last["normalBeforeMs"]["p50"],3), "->", round(last["normalAfterMs"]["p50"],3))
    if "stageComparisons" in row:
        s=row["stageComparisons"]["revision1.compileMaterializedExecution.wallMs"]
        print("  materialized compiler p50",round(s["before"]["p50"],3),"->",round(s["after"]["p50"],3))
print("All 14 semantic units and matrix work bounds PASS; causal chain and all recorded repair gates verified")
