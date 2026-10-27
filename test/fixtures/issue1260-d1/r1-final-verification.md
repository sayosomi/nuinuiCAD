# #1260 final R1 verification — 2026-10-23 JST

Base: `d20f1c14a7da9000de4bc2a2e8fe59aed6c6c48e`

Branch: `sayosomi/issue-1260-final-r1-d1`

#1260 remains OPEN.

## Frozen cases and observed results

Frozen source SHA-256 identities and source/oracle contents are unchanged:

| Case | Frozen SHA-256 | Actual normally eligible persistent-Rust output |
| --- | --- | --- |
| `R1-04` | `00efeb602a12a277343653c2c938c514867607c44a2f4024b0ccbcb5b14d313d` | One: `OutA=(17,2)`, `OutB=(47,4)`, `OutC=(7,1)`, `Size=2`; Two: `OutA=(51,2)`, `OutB=(81,4)`, `OutC=(41,1)`, `Size=2`; no errors. |
| `C-carry-if` | `68cbeea1c8bd370366d75a682230a39026959e774f8d2d1aa1d992e2bf3d29cb` | `Observed=(3,4)`, no errors; the inactive divide-by-zero arm did not execute. |
| `C-carry-if-control` | `3198f44aae23c7bc33901fd38ee09a054394609e22cd98938096d7ba2c0056c2` | `Observed=(3,4)`, no errors. |

The existing runner compiled all three cases, evaluated all three with the TypeScript reference and made three normally eligible persistent-Rust requests. All three matched their frozen oracles and passed (`rustEligible=true`, no failures). The R1-04 sensitivity assertion changed `One::OutA.x` by `+1` and confirmed the existing oracle rejects it. Campaign accounting remained 49/96 accepted distinct inputs; `input-registry.json` is unchanged.

## Final dispositions

The 32 primary cells are `24 PASS`, `8 BUG→FIXED→REPASS`, and `0 UNRESOLVED`. Aggregate domains: R1/R2/R4/R6 are `BUG→FIXED→REPASS`; R3/R5/R7/R8 are `PASS`. `C-carry-if` is `BUG→FIXED→REPASS`; `C-carry-if-control` remains `PASS`. `C-coordinate` and `C-coordinate-control` remain explicitly `UNRESOLVED` non-primary controls and are not claimed as passing.

The R1-04 and C-carry-if repair provenance is the already protected-merged [#1442 / PR #1444](https://github.com/sayosomi/nuinuiCAD/pull/1444), present on this Base. These replays close the stale #1260 dispositions; they do not create a new #1260 defect family. No production source or exploration input changed.

## Verification

- `ISSUE1260_IDS=R1-04,C-carry-if,C-carry-if-control npx vitest run test/issue1260ResidualD1Rust.integration.test.ts --pool=forks --maxWorkers=1 --no-file-parallelism` — **3 passed, 0 skipped**.
- `npx vitest run test/issue1442GeometryCarryReference.integration.test.ts --pool=forks --maxWorkers=1 --no-file-parallelism` — **7 passed, 0 skipped**.
- `npm run build` — **passed**.
- `npm run lint` — **passed**.
- `npm run test:parity` — **203 passed, 0 skipped**.
- `npm test` — **681 files passed, 2 skipped; 10,908 tests passed, 185 skipped**.
- `git diff --check d20f1c14a7da9000de4bc2a2e8fe59aed6c6c48e` — **passed**.
