# Issue 1454 frozen lifecycle traces

Frozen before the first discovery execution, against Base
`edd7ce153630ca1aa0d0ab64e8db367a579cf11c`. Stable seed: `1454`.
The executable traces are in `src/node/rustEvaluationProcess.test.ts`.

Every fresh child is G1, with IDs starting at 1. Owner replacement is G2,
starting again at 1. E1/E3 input bytes are `{"kind":"E1"}` /
`{"kind":"E3"}`; X2 export bytes are `{"kind":"X2"}`. Exact request lines
are `{"id":1,"input":{"kind":"E1"}}\n`,
`{"id":2,"exportOutput":{"kind":"X2"}}\n`, and
`{"id":3,"input":{"kind":"E3"}}\n`. G2 E3 uses id 1.
Responses are literal JSON lines: `{"id":N,"payload":"EN"}\n` for
an evaluation, `{"id":2,"payload":"X2"}\n` for export, and
`{"id":2,"error":"X2 failed"}\n` for the isolated error. No payload
schema interpretation is performed by this transport. Each checkpoint checks
all observed Promise states; handlers are attached immediately at submission.

| ID | Frozen ordered events and expected observations |
| --- | --- |
| P1 | G1 E1/X2 pending; reverse replies X2/E1 (and normal-order control). Only matching request fulfills at each checkpoint; 0 terminations/kills. |
| P2 | G1 E1/X2/E3 pending; X2 error, E3 success, E1 success. Only X2 rejects; 0 terminations/kills. |
| P3 | G1 E1/X2; unknown id 99 success ignored; E1 success; duplicate E1 ignored; X2 success. Malformed JSON `{broken\n` and invalid IDs (string, fractional, negative, unsafe, null/missing) with both pending instead reject both, terminally invalidate G1, callback 1, kill 1, owner replacement safe. |
| P4 | G1 E1/X2; E1 success; child exit(1,null); X2 rejects; late error/frame/exit do nothing; later request rejects without write; callback 1. |
| P5 | Owner G1 E1/X2; child error then exit (opposite order control); both reject; callback 1; G2 E3 id 1 succeeds; old frames cannot affect G2. |
| P6 | G1 E1/X2; dispose twice; both reject; kill 1; late frame/error/exit; later request rejects; callback 0. |
| P7 | G1 E1 accepted then synchronous write throw for X2: reject both, callback 1, kill 1 (chosen fail-closed option). Separately G1 E1/X2 with deferred real Writable callbacks; callback(error) or destroy(error) rejects both, callback 1, kill 1. Nearby writable E1/X2 success. |
| P8 | G1 deferred Writable highWaterMark=1; E1/X2 writes return false; release actual callbacks, await real drain; reverse valid responses fulfill both; E3 pending; destroy without error or end stdin; reject E3, callback 1, kill 1; later request rejected without write. |
| P9 | Owner G1 E1/X2; exit; both reject; G2 E3 pending; invoke captured stale G1 callback and late G1 frame/error; owner still exact G2; E3 id 1 success; repeated get exact G2. |
| P10 | Owner G1 E1/X2; owner.dispose; reject both, G1 kill 1, callback 0; G2 E3 id 1; old callback/frame/error/exit cannot evict G2; E3 success; G2 X2 pending then final owner.dispose rejects, G2 kill 1. |

Additional evidence-triggered units reserved (never more than six):

| ID | Frozen reducer / counterfactual |
| --- | --- |
| A1 | No pending work; child exit then E1. Reject without a write; callback 1. Nearby live child E1 succeeds. |
| A2 | No pending work; malformed response then E1. Reject without write; callback 1, kill 1. Nearby valid response succeeds. |
| A3 | G1 E1 pending; X2 serialization throws (cyclic object and BigInt controls). Both reject, callback 1, kill 1; late E1 frame cannot revive. Nearby serializable X2 succeeds. |
| A4 | G1 E1/X2; id 1 response has neither payload nor string error, or both payload and error. Both reject, callback 1, kill 1; normal string-error P2 remains nonterminal. |
| A5 | G1 E1/X2; stdout destroy(error) or EOF; both reject, callback 1, kill 1; no new write. Nearby ordinary stdout replies succeed. |
| A6 | G1 E1/X2; stderr destroy(error); both reject, callback 1, kill 1; ordinary stderr diagnostics do not settle work. |

Node contract validation: child is an EventEmitter with actual PassThrough stdout
and stderr, and actual Writable stdin. Deferred `_write` callbacks implement
backpressure; drain/end/error/close listeners are installed before transitions.
A synchronous `_write` throw propagates through real write(). Stream destruction
uses Node's actual asynchronous error/close delivery. setImmediate is an event-loop
checkpoint, not a timing delay. Finite Vitest timeout is a last-resort guard;
Promise leaks are detected by state assertions without waiting for a timeout.
Every fixture is disposed and its streams destroyed in afterEach. Expected stream
errors are observed by the harness, independently of production error handlers.

Sensitivity controls deliberately perturb observations from genuine production
traces and require the same checkpoint assertion to reject wrong routing,
unknown/duplicate acceptance, pending leaks, post-terminal acceptance, double
notification, stale-owner eviction, write failure success, and false-write rejection.
They are controls, never novel defect counts.
