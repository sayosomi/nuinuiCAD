## Stage 4 adaptive selection — before any 02/03 evaluation

Checkpoint: `357bd93c26e5a424d5679668bec4f0d75874f498`; original comparable pilot product baseline: `bab8313ae08f5e354a6cfd9d7b2ffb8177a15bc2`. The independently reviewed repair proofs confirm F1/F2/F3 (R1 is a repair follow-on, not another discovery). Original `pilot.json`, `pilot-results.json`, and independent model/oracles are preserved. Repaired PASS counts are **not** discovery yield.

Applying the Issue's ordering (independently confirmed family yield, available measured probe/diagnosis cost, then activation/sensitivity):

| Stratum | Original independent family observations A/B/C | Original probe ms A/B/C, four sources each | Selected |
|---|---|---|---|
| E | 1 F1 / 1 F2 / 0 | 1024 / 330 / 300 | **B**: same yield as A, lower measured probe cost |
| C | 0 / 0 / 0 | 38 / 30 / 41 | **B**: tied zero yield, lowest measured probe cost |
| D | 1 F3 / 1 F3 / 1 F3 (correlated observations of one family) | 31 / 34 / 30 | **C**: tied yield, lowest recorded probe cost |

The six selected S/T pairs are **E-B-02, E-B-03, C-B-02, C-B-03, D-C-02, D-C-03**. Every other 02/03 cell will be NOT_SELECTED. There is no exact measured-cost tie, so the later activation and fixed lexical A→B→C tie breaks are not invoked. Per-method diagnosis time was not instrumented; it is unavailable, not zero. Probe timing includes compilation, both runtimes, assertions and cold/warm overhead; A's initial E probe paid startup costs. The 1 ms D difference is especially fragile. These are reproducible provisional choices under the recorded observations, not statistical evidence or a universal optimum.

Calibration/sensitivity completed before this selection:
- Existing X02/X05/X07: all three authentic negative/positive checks PASS, production persistent Rust and TS; seeded defects count as zero new families.
- F01: a cfg(test)-only resolver holdout calls the actual collection selector/member reader through the old document-only delegation. Losing visible outer-frame bindings breaks the independent length/member oracle; the frame-aware counterpart and literal control pass. Original C-A-01 and C-C-01 S/T activate the nested source boundary (two actual inner rows); C-B and the other pilot cells do not. This is boundary-level fault sensitivity, **not** a measured arm-wide mutation detection rate.
- F04: test-only input removes only the lazy flag from a Module value whose call site is independently established to be inside a statement-for. The ownership oracle detects the first loss and the intact counterpart passes. On the current repaired engine remaining dependency/owner gates mask an output difference in both runtimes; output sensitivity is NOT_DETECTED. No pilot arm has a Module-in-loop call, so all arms are **NOT_COVERED** for F04. No production fault switch or vulnerable production revision was used.

Existing accepted exploratory-source ledger remains **61/200**. Next: independently validate and freeze only the selected twelve sources/oracles, then execute all six selected pairs, minimizing and repairing any independently confirmed new in-scope defects. Issue stays OPEN; no PR/merge in this phase.
