# Issue 1521 frozen exploration oracle

Base: 4303eddadbf36def7b89c6d937cbe0f1d995af7c. Sources, cursor markers,
revision transitions, candidate predicates and literal insertions in
`src/dsl/dslAuthoringConformance.test.ts` are frozen before first execution.
Markers are removed before compilation; offsets are JavaScript UTF-16 indices
in LF-normalized physical source. CRLF is preserved separately in R1.

Oracle: docs/nui1/spec.md lexical namespace/closed Module scope, named versus
positional builtins, scalar types, construction arguments and Module defaults.
Existing query contracts allow syntax-only recovery, not stale semantic names.
No expectation of all candidates being legal in unrelated positions is made.

Primary units (controls and revision variants are declared within each unit):

| Unit | Independent expectation / discriminating control |
| --- | --- |
| B1 | round overload 0/1 at arg 0/1, abs arg 0; excess arity has no active parameter; numeric excludes boolean |
| B2 | spreadAngle reordered spread/length has active 1/0 including whitespace before colon; missing/duplicate/positional forms reject; ordinary abs has no named call style |
| B3 | nearest nested max/round/abs; nested commas and string punctuation do not increment outer argument |
| B4 | partial builtin round candidate; opening call and trailing-comma recovery retain nearest call; no invented third round parameter |
| C1 | coordinate numeric x/y accepts scalar width, excludes string/boolean and sibling local |
| C2 | segment point slots exclude line/path; offset sources line/path excludes point; @ insertion exact |
| C3 | offset side left/right; closed boolean default false; distance default 10; unrelated literals excluded |
| C4 | closed Module local number shadows outer string; nested round owns argument; foreign outer scalar excluded |
| M1 | required width, optional note, default rise; reordered actual width insertion retains binding; (14,3) geometry |
| M2 | scoped same-name Module uses inner documentation/boolean parameter; nested instance retains outer-module local binding |
| M3 | direct and facade public Module use defining saved document identity/order/docs; private Module excluded |
| M4 | saved library width:number -> flag:boolean against changed current root; current identities/ranges only; stale root snapshot rejected |
| R1 | CRLF + supplementary Unicode + Unicode binding, exact normalized/raw replacement and call parameter |
| R2 | valid -> invalid changed Module -> recovered current source; old parameter never published |
| R3 | A -> B -> A has strictly increasing revisions, matching target names and rejects stale revision even if source bytes recur |
| R4 | exact numeric reference insertion compiles to point (12, -4), preserves all surrounding bytes/comments |

X1-X6 and reducer D1-D6 initially NOT_TRIGGERED. New units must be frozen and
linked to observed evidence before their first execution. Maximum 28 units;
verification replays and existing suite fixtures consume no additional unit.

## Harness corrections before product mutation

Initial matrix exited 1 (5/16 pass); corrected integration baseline supersedes
harness errors, not product expectations:
- Bare compile lacks stable declaration identities; use canonical session compile.
- Completion replaces prefix through cursor; full-token insertion controls put
  cursor at token end (C1/C2/R1/R4). Mid-token full-suffix replacement is not an
  existing promise and is NOT_SUPPORTED. Same accepted source bytes retained.
- Module argument lane replaces `@other` including sigil, unlike numeric fields;
  insertion oracle is literal `@width` and must compile without postprocessing.
- Offset's established enum order is right,left (parameterDefinitions owner).
- Module geometry-field reference completion before `@` is NOT_SUPPORTED;
  C4 retains null control and uses supported after-`@` neighbor, same source.
- Graph proof is artifact.source, facade syntax is `export @lib::Panel`;
  independent graph creations require shared artifact cache for same stable
  statement identity. Invalid missing-@ facade was CONTRACT_INVALID.

All original harness output is retained externally in /tmp/issue1521-base-matrix*.log;
only independently confirmed product failures count as defects.

## Activated before execution

X1: B2 span failure activates whitespace/tab-before-colon in builtin,
construction and Module. Exact label slice must equal declared name; active
parameter follows canonical order.
X2: B2 positional-style rejection activates `abs(arg1: 1)` query control;
synthetic positional display name cannot make an illegal named parameter active.
X3: C4 root scalar leak activates Module boolean initializer with nested
numeric isClose input: width/local numeric eligible; flag/outside references
forbidden. The inner builtin's parameter type owns the slot.
X4: C4 lexical leak activates Module point input, with Own/base eligible and
External forbidden. This is an existing geometry-reference query lane.
D1: reduce B2 to one spreadAngle call, inspect exact producer's label span.
D2: reduce C4 to one Module numeric point field; ordinary root numeric point
is the nearby passing control. X5/X6 and D3-D6 remain NOT_TRIGGERED.

X1 subcase disposition: construction/Module whitespace-before-colon sources
are rejected by their current parser. Unlike scalar builtin tokenization,
these surfaces do not establish support for this spelling; retain exact
rejection codes as NOT_SUPPORTED controls, do not extend parser semantics.
Builtin whitespace span and construction tolerant label span remain tested.

X5 activated by X3 returning literals/builtins at an explicit @ operand:
Module numeric abs input at @ permits binding candidates only; cursor after
abs's closing paren permits numeric operators, not references/literals/functions.
Freeze before execution. X6 remains NOT_TRIGGERED.

X5 operator disposition: operand candidates at an operator slot are invalid;
absence of numeric operator suggestions in a Module-only document is an
existing unsupported capability (no root BindingAnalysis), not a defect to
expand. The frozen negative shape predicate is retained; no '+' availability
promise is made. Before final verification, added range controls and imported
callee/argument-label probes use the same accepted source bytes. Added rejected
capture/type-mismatch variants are compiler-negative controls, not accepted
exploration programs. Total: 16 primary + 5 X + 2 reducers = 23 units.
