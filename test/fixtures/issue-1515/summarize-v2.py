"""Read retained evidence; never rerun or change production/oracle inputs."""
from pathlib import Path
import gzip
import hashlib
import json
import math

p = Path(__file__).parent
def compressed(file):
    return json.loads(gzip.decompress(file.read_bytes()))
def json_record(file):
    return json.loads(file.read_text()) if file.exists() else compressed(file.with_name(file.name + ".gz"))
def stats(s):
    a = sorted(s)
    return {"p50": a[math.ceil(len(a)*0.5)-1], "p95": a[math.ceil(len(a)*0.95)-1], "max": max(a)}
def metric(record, name):
    return {k: record["statistics"][name][k] for k in ["p50", "p95", "max"]} if name in record["statistics"] else None

manifest = compressed(p / "acceptance-v2.json.gz")
additional = compressed(p / "conditional-v2.json.gz")["units"] + compressed(p / "adjacent-v2.json.gz")["units"]
all_units = manifest["units"] + additional
observations = json_record(p / "verification-v2/final-all-observations.json")["observations"]
rows, work, overhead = [], [], []
for unit in all_units:
    for cp in unit["checkpoints"]:
        assert hashlib.sha256((p / cp["file"]).read_bytes()).hexdigest() == cp["sha256"]
    passed = [o for o in observations if o.get("unit") == unit["id"] and o.get("disposition") == "PASS"]
    assert len(passed) == 2 * sum(not cp["invalid"] for cp in unit["checkpoints"])
    entry = {"id": unit["id"], "semanticDisposition": "PASS", "freshIncrementalRustReferencePasses": len(passed), "runtimeDrawables": unit["count"], "instances": unit["instances"], "revisionSourceHashes": [cp["sha256"] for cp in unit["checkpoints"]]}
    if unit in manifest["units"]:
        normal, staged, timed = [compressed(p / f"measurements-v2/{label}-{unit['id']}.json.gz") for label in ["normal", "staged", "rust-timed"]]
        for r in [normal, staged, timed]:
            assert r["sourceHashes"] == entry["revisionSourceHashes"]
            assert r["spawns"] == 1 and r["requests"] == 27 and len(r["samples"]) == 26
            assert r["warmups"] == 5 and r["trials"] == 21
            for key, value in r["statistics"].items():
                assert stats(value["samples"]) == {k: value[k] for k in ["p50", "p95", "max"]}, key
        phases = []
        for index, cp in enumerate(unit["checkpoints"][1:], 1):
            prefix = f"revision{index}."
            phase = {"sourceRevision": cp["sourceRevision"], "file": cp["file"], "invalid": cp["invalid"], "normalEditToReadyMs": metric(normal, prefix + "totalMs"), "normalNodeCpuMs": metric(normal, prefix + "nodeCpuMs"), "normalRequestResponseMs": metric(normal, prefix + "requestMs"), "rustEvaluationMs": None if cp["invalid"] else metric(timed, prefix + "rustMs"), "stagesInclusive": {k.removeprefix(prefix): {n: v[n] for n in ["p50", "p95", "max"]} for k,v in staged["statistics"].items() if k.startswith(prefix) and k.endswith(("wallMs", "cpuMs"))}}
            sample = normal["samples"][-1]["phases"][index-1]
            phase["workSizes"] = {k: sample[k] for k in ["statements", "runtimeEntries", "graphEdges", "payloadBytes"]}
            phases.append(phase)
            overhead.append({"id": unit["id"], "sourceRevision": cp["sourceRevision"], "stagedOverNormalP50": metric(staged, prefix+"totalMs")["p50"] / metric(normal, prefix+"totalMs")["p50"], "rustProbeOverNormalP50": metric(timed, prefix+"totalMs")["p50"] / metric(normal, prefix+"totalMs")["p50"]})
        entry["measuredEditPhases"] = phases
    rows.append(entry)
    r = compressed(p / f"measurements-v2/work-{unit['id']}.json.gz")
    for phase in r["workRecords"]:
        filters = [f for f in phase["filters"] if f["method"] == "filter" and any(f"moduleExecutionCompiler.ts:{line}:" in f["stack"] for line in [145,177])]
        visits = sum(f["length"] for f in filters)
        necessary = 0 if phase["invalid"] else 2 * (unit["count"] + unit["instances"])
        predicted = 0 if phase["invalid"] else necessary * (unit["instances"]+1)
        assert visits == predicted, (unit["id"], visits, predicted)
        work.append({"id": unit["id"], "file": phase["file"], "invalid": phase["invalid"], "scopeFilterCalls": len(filters), "scopeFilterVisits": visits, "twoPartitionOutputVisits": necessary, "partitionWorkDisposition": "FAIL_AVOIDABLE_REPEATED_WORK" if visits > necessary else "PASS", "stageArrayVisits": {k:v["arrayVisits"] for k,v in phase["stages"].items()}})

checks = []
for f in sorted((p / "verification-v2").glob("*.result.json")):
    checks.append({"record": str(f.relative_to(p)), **json.loads(f.read_text())})
report = {"primarySemanticPass": 12, "primaryMeasurementBlocks": 36, "warmupsPerBlock": 5, "measuredTrialsPerBlock": 21, "additionalSemanticPass": ["R1", "X1"], "acceptedDistinctUnits": 14, "ceiling": 20, "unusedAdjacent": ["X2", "X3", "X4"], "unusedReducers": ["R2", "R3", "R4"], "rows": rows, "work": work, "overheadControls": overhead, "verification": checks, "productionRepairs": [], "pending": "Unlisted first-owner mutation authorization and correction of the experimental 4E whole-owner callback gate (it omitted the selected-ID output projection); the independent two-partition 2E producer baseline is unchanged.", "measurementNotes": ["Stages are nested/inclusive, not additive.", "CPU is Node process CPU; Rust timer is Rust wall duration inside evaluate_document.", "Frame serialization and response parsing are measured on the real production client; payloadBytes is the input JSON size excluding its small envelope.", "The cold setup field includes baseline compilation and is excluded from all warm edit statistics.", "Original first invalid warm-up could inherit the cold Rust duration annotation; all 21 measured-trial statistics are unaffected. Corrected R replays are supplementary.", "Work-probe times are diagnostic and never timing comparisons.", "Initial S-P smoke measured samples remain in its raw log; its warm-up records were superseded by the final 26-sample block. All 36 comparable blocks retain all 5 warm-up and 21 measured records."]}
(p / "summary-v2.json.gz").write_bytes(gzip.compress((json.dumps(report, indent=2)+"\n").encode(), mtime=0))
(p / "matrix-dispositions-v2.json").write_text(json.dumps({k:report[k] for k in ["primarySemanticPass", "primaryMeasurementBlocks", "additionalSemanticPass", "acceptedDistinctUnits", "ceiling", "unusedAdjacent", "unusedReducers", "productionRepairs", "pending"]},indent=2)+"\n")
for row in rows:
    if "measuredEditPhases" in row:
        phase = row["measuredEditPhases"][-1]
        print(row["id"], *(round(phase["normalEditToReadyMs"][k],3) for k in ["p50","p95","max"]), "Rust", round(phase["rustEvaluationMs"]["p50"],3))
print("14 units sealed and semantic PASS; 36 comparable timing blocks verified; known scope producer retained")
