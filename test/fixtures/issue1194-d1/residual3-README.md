# #1194 third D1 structured-value slice

Base: `4a43b27fe969c0e33350c973842966525fe8bc1f`.
Topic: `sayosomi/issue-1194-residual3-d1`. Intermediate checkpoint, `Refs #1194`.
Authority: current #1194 Issue and the Human's 2026-10-21 third-slice prompt;
`docs/nui1/spec.md` Records, Modules and immutable value control flow.
No normative syntax, host/UI, dependency or infrastructure changes.

## Reproduction and evidence

`test/issue1194Residual3D1Rust.integration.test.ts` reuses the preceding runner's
canonical compilation, independent authored numeric expectations, normal Rust
eligibility, one persistent production Rust stdio child, wire capture, payload
decode and TS comparison. The same timeout, error/close-listener and cleanup
procedures apply. Sources and expectations are frozen before evaluation in
`residual3-cases.json` and `residual3-freeze.json`. Compiler assertions also
check nominal declaration identity, producer/alias closure, qualified instance
ownership and the selected transformation stage. No parallel evaluator or
semantic model was introduced. The existing pure Module scalar field projector
was moved to `recordScalarLowering.ts` so analysis and lazy constructors share it.

Normal regression command:

```sh
npx vitest run test/issue1194Residual3D1Rust.integration.test.ts
```

Optional runner settings: `ISSUE1194_RESIDUAL3_IDS` selects comma-separated IDs;
`ISSUE1194_RESIDUAL3_MODE=discover` records observations instead of asserting a
passing disposition; `ISSUE1194_RESIDUAL3_EVIDENCE=/absolute/path` retains raw
compiler, wire and decoded traces; `ISSUE1194_RESIDUAL3_PHASE` labels a run.
Discovery never converts an observed failure to a conformance PASS.

`residual3-families.json` groups eight novel repaired first-loss families
F17–F24 and identifies reduced FAIL-before cases and genuine Base PASS controls.
`residual3-dispositions.json` retains every third-slice observation and authored
expectation. F01–F16, #1376 and Stage 1–7 remain old repaired controls.
`residual3-first-loss.json` retains compact exact boundary evidence; bulky raw
traces are outside Git at `/tmp/issue1194-residual3/` on the implementation host.
Base replays temporarily restored only this task's changed production owners
from `git show Base:path`, then restored the saved candidate bytes in `finally`;
no reset, stash, checkout allocation or branch/main integration occurred.

## Input accounting and bounded coverage

`residual3-input-registry.json` is the effective cumulative deduplicated ordered
bundle SHA-256 registry, with ceiling **144**. The historical initial and second
registries and their observations remain unchanged: 110 historical accepted
hashes plus **30 new = 140/144**. Replay and verification add no distinct inputs.
Hash convention remains SHA-256(JSON of `[["root.nui", source], ...sorted saved
path/source pairs]`). All third inputs are single-document sources.

- R: 8 new accepted hashes; scalar/nested/collection fields, whole-record binder
  forwarding, root and Module consumers, asymmetry and unselected errors.
- O: 9 new accepted hashes; omitted/explicit-none/supplied parameters, aliases,
  direct/nested forwarding, qualified exports, caller/definition namespaces and
  strict nominal/required-read validation. O6 was compiler-accepted on Base but
  is correctly rejected after repair; its accepted slot is permanently retained.
- G: 13 new accepted hashes; path lengths/endpoints, record/geometry collections,
  optional selected leaves, Module-local/qualified ownership, asymmetry and stage.
- R4, O4 and O7 were never accepted and consume no slot. R4 uses a nominal member
  property as a record leaf rather than the specified whole `@name`/static-index
  forms; R2 reconstructs nested fields and R7/O11 forward a legal whole binder.
  O4's `@n != none` lacks an underlying optional operand type; O8/O9 use a legal
  boolean-controlled optional record. O7 supplies a distinct nominal definition.

Four accepted adaptive cases **G9–G12 remain UNRESOLVED** and are explicitly
skipped in conformance verification, with their intended expected values still
retained. The scalar-only G10/G12 counterfactuals show a general root geometry
selector can execute before its scalar binding is available (Rust), while
reference-valued arms also expose root dependency release ordering (TS/Rust).
G11 isolates an optional record-member environment omission, but cannot provide
an independent Rust PASS until that shared root scheduling defect is resolved.
No new family is counted for these partially isolated symptoms. General root
control scheduling is excluded from this slice and belongs to the separately
admitted #1260 campaign; no selector deferral/scheduler implementation was added.
The necessary environment forwarding for selected geometry-valued record fields
is covered by repaired G3/G6/G7 with normally eligible TS/Rust results.

File-public record definitions and qualified imported record-type spellings
remain **CONTRACT_AMBIGUOUS/BLOCKED**, unchanged and untested here. Deeper
source/dependency permutations and all other DSL semantics remain NOT_COVERED.
This bounded sample is not an overall DSL correctness claim and does not close
#1194. No Human GUI E2E is required for this semantic-only contract.

## Handoff

`residual3-verification.json` records actual settled gates. All owned persistent
Rust children closed after disposal; no process hang/resource failure occurred.
Human weekly baseline is **74% remaining**; ending quota and attributable
consumption are **UNAVAILABLE**. No quota estimate is derived from requests.

Next: independent blocking review of the exact pushed topic HEAD against Base,
including the family grouping, explicit deferred cases and cumulative registry.
ChatGPT/Human own PR creation, protected CI/integration and clean-main return.
