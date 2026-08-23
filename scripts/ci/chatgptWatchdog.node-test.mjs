import assert from "node:assert/strict";
import test from "node:test";

import {
  WATCHDOG_MARKER,
  WATCHDOG_TIMEOUT_MS,
  formatWatchdogComment,
  heartbeatWatchdogRecord,
  parseWatchdogComment,
  planWatchdogRun,
  startWatchdogRecord,
  timedOutWatchdogRecord
} from "./chatgptWatchdog.mjs";

const NOW = "2026-08-23T09:00:00.000Z";
const ISSUE_URL =
  "https://linear.app/sayosomi/issue/SAY-198/chatgpt-watchdog-github-heartbeat-5-minute-github-actions-stalled";

const makeRecord = (overrides = {}) => ({
  marker: WATCHDOG_MARKER,
  linear_issue: "SAY-198",
  title: "ChatGPT watchdog",
  url: ISSUE_URL,
  state: "active",
  started_at: "2026-08-23T08:30:00.000Z",
  heartbeat_at: "2026-08-23T08:55:00.000Z",
  ...overrides
});

const makeComment = (record, id = 100) => ({
  id,
  body: formatWatchdogComment(record)
});

test("parser/helper round-trips a valid watchdog record", () => {
  const started = startWatchdogRecord(
    { linearIssue: "SAY-198", title: "ChatGPT watchdog", url: ISSUE_URL },
    "2026-08-23T08:30:00Z"
  );
  const parsed = parseWatchdogComment(formatWatchdogComment(started));

  assert.deepEqual(parsed, started);
  assert.equal(parseWatchdogComment("ordinary GitHub comment"), null);
});

test("fresh active records do not produce an alert decision", () => {
  const result = planWatchdogRun([makeComment(makeRecord())], NOW);

  assert.equal(result.decisions.length, 0);
  assert.equal(result.malformed.length, 0);
});

test("expired active record produces exactly one timeout transition", () => {
  const expired = makeRecord({ heartbeat_at: "2026-08-23T08:40:00.000Z" });
  const first = planWatchdogRun([makeComment(expired)], NOW, WATCHDOG_TIMEOUT_MS);

  assert.equal(first.decisions.length, 1);
  assert.equal(first.decisions[0].record.state, "active");
  assert.equal(first.decisions[0].updatedRecord.state, "timed_out");
  assert.equal(first.decisions[0].updatedRecord.timed_out_at, NOW);

  const second = planWatchdogRun(
    [makeComment(first.decisions[0].updatedRecord)],
    "2026-08-23T09:30:00.000Z",
    WATCHDOG_TIMEOUT_MS
  );
  assert.equal(second.decisions.length, 0);
});

test("already timed_out and done records do not re-alert", () => {
  const timedOut = timedOutWatchdogRecord(
    makeRecord({ heartbeat_at: "2026-08-23T08:30:00.000Z" }),
    "2026-08-23T08:45:00.000Z"
  );
  const done = makeRecord({
    state: "done",
    heartbeat_at: "2026-08-23T08:30:00.000Z"
  });

  const result = planWatchdogRun(
    [makeComment(timedOut, 101), makeComment(done, 102)],
    NOW
  );

  assert.equal(result.decisions.length, 0);
  assert.equal(result.malformed.length, 0);
});

test("heartbeat after timed_out re-arms the record", () => {
  const timedOut = timedOutWatchdogRecord(
    makeRecord({ heartbeat_at: "2026-08-23T08:30:00.000Z" }),
    "2026-08-23T08:45:00.000Z"
  );
  const rearmed = heartbeatWatchdogRecord(timedOut, "2026-08-23T08:59:00.000Z");

  assert.equal(rearmed.state, "active");
  assert.equal(rearmed.heartbeat_at, "2026-08-23T08:59:00.000Z");
  assert.equal("timed_out_at" in rearmed, false);
  assert.equal(planWatchdogRun([makeComment(rearmed)], NOW).decisions.length, 0);
});

test("malformed watchdog records are isolated from valid records", () => {
  const malformedBody = `<!-- ${WATCHDOG_MARKER}\n{not-json}\n-->`;
  const expired = makeRecord({ heartbeat_at: "2026-08-23T08:40:00.000Z" });

  const result = planWatchdogRun(
    [
      { id: 201, body: malformedBody },
      makeComment(expired, 202),
      { id: 203, body: "ordinary comment" }
    ],
    NOW
  );

  assert.equal(result.malformed.length, 1);
  assert.equal(result.malformed[0].commentId, 201);
  assert.match(result.malformed[0].message, /invalid JSON/);
  assert.equal(result.decisions.length, 1);
  assert.equal(result.decisions[0].commentId, 202);
  assert.equal(result.decisions[0].updatedRecord.state, "timed_out");
});
