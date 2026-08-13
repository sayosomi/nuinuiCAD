import { describe, expect, it } from "vitest";
import {
  mergeSetTargetCandidates,
  recoverLiveSetTargetCandidates,
  type SetTargetCompletionCandidate
} from "./setTargetRecoveryCandidates";

const cursorAfter = (source: string, text: string) => {
  const start = source.lastIndexOf(text);
  if (start < 0) throw new Error(`missing ${text}`);
  return start + text.length;
};

const candidatesAt = (source: string, needle = "set b") => {
  const recovery = recoverLiveSetTargetCandidates({ source, cursorPosition: cursorAfter(source, needle) });
  return { recovery, candidates: recovery.candidates };
};

describe("recoverLiveSetTargetCandidates", () => {
  it("recovers a poisoned let from the tolerant parse", () => {
    const { candidates } = candidatesAt(["nui 4", "let broken: number = @broken", "set b"].join("\n"));
    expect(candidates.map(({ name, type }) => ({ name, type }))).toEqual([{ name: "broken", type: { kind: "number" } }]);
  });

  it("excludes const and declarations with an unknown type", () => {
    const source = [
      "nui 4",
      "const constant: number = @constant",
      "let unknown: notAType = @unknown",
      "set b"
    ].join("\n");
    expect(candidatesAt(source).candidates).toEqual([]);
  });

  it("excludes forward declarations", () => {
    const source = ["nui 4", "set b", "let later: number = @later"].join("\n");
    expect(candidatesAt(source).candidates).toEqual([]);
  });

  it("does not leak declarations from sibling or child scopes", () => {
    const source = [
      "nui 4",
      "if (true) {",
      "  let branchOnly: number = @branchOnly",
      "}",
      "set b"
    ].join("\n");
    expect(candidatesAt(source).candidates.map(({ name }) => name)).not.toContain("branchOnly");

    const nested = [
      "nui 4",
      "if (true) {",
      "  let branchOnly: number = @branchOnly",
      "  set b",
      "}"
    ].join("\n");
    expect(candidatesAt(nested).candidates.map(({ name }) => name)).toContain("branchOnly");
  });

  it("resolves live-vs-live shadowing by lexical scope and declaration order", () => {
    const source = [
      "nui 4",
      "let value: number = 1",
      "if (true) {",
      "  let value: boolean = @value",
      "  set b",
      "}",
      "set b"
    ].join("\n");
    const inner = candidatesAt(source, "  set b");
    expect(mergeSetTargetCandidates([], inner.recovery).filter(({ name }) => name === "value")).toEqual([
      expect.objectContaining({ type: { kind: "boolean" } })
    ]);
    const outer = candidatesAt(source);
    expect(mergeSetTargetCandidates([], outer.recovery).filter(({ name }) => name === "value")).toEqual([
      expect.objectContaining({ type: { kind: "number" } })
    ]);
  });

  it("merges a live inner declaration over a committed outer declaration without source priority", () => {
    const source = [
      "nui 4",
      "let value: number = 1",
      "if (true) {",
      "  let value: boolean = @value",
      "  set value ="
    ].join("\n");
    const recovery = recoverLiveSetTargetCandidates({ source, cursorPosition: cursorAfter(source, "set value =") });
    const committed: SetTargetCompletionCandidate = {
      name: "value",
      type: { kind: "number" },
      declarationPosition: source.indexOf("let value"),
      scopeKey: "root",
      source: "committed"
    };
    const merged = mergeSetTargetCandidates([committed], recovery);
    expect(merged).toEqual([
      expect.objectContaining({ name: "value", type: { kind: "boolean" }, source: "live" })
    ]);
  });

  it.each([
    ["number", "string"],
    ["string", "number"]
  ] as const)("reconciles same declaration identity from %s to %s", (committedType, liveType) => {
    const source = [
      "nui 4",
      `let total: ${liveType} = ${liveType === "string" ? '"x"' : "0"}`,
      "set total ="
    ].join("\n");
    const recovery = recoverLiveSetTargetCandidates({ source, cursorPosition: cursorAfter(source, "set total =") });
    const live = recovery.declarations.find((declaration) => declaration.name === "total")!;
    const merged = mergeSetTargetCandidates([{
      name: "total",
      type: { kind: committedType },
      declarationPosition: live.declarationPosition,
      scopeKey: live.scopeKey,
      source: "committed"
    }], recovery);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(expect.objectContaining({ name: "total", type: { kind: liveType }, source: "live" }));
  });

  it.each([
    "const total: number = 0",
    "let total: unknownType = 0"
  ])("suppresses stale committed metadata when live declaration is not set-target eligible: %s", (liveDeclaration) => {
    const source = ["nui 4", liveDeclaration, "set total ="].join("\n");
    const recovery = recoverLiveSetTargetCandidates({ source, cursorPosition: cursorAfter(source, "set total =") });
    const live = recovery.declarations.find((declaration) => declaration.name === "total")!;
    const merged = mergeSetTargetCandidates([{
      name: "total",
      type: { kind: "number" },
      declarationPosition: live.declarationPosition,
      scopeKey: live.scopeKey,
      source: "committed"
    }], recovery);
    expect(merged).toEqual([]);
  });

  it("does not let an out-of-scope live declaration replace a visible committed candidate", () => {
    const source = [
      "nui 4",
      "if (true) {",
      "  let value: boolean = @value",
      "}",
      "set b"
    ].join("\n");
    const recovery = recoverLiveSetTargetCandidates({ source, cursorPosition: cursorAfter(source, "set b") });
    const merged = mergeSetTargetCandidates([{
      name: "value",
      type: { kind: "number" },
      declarationPosition: 0,
      scopeKey: "root",
      source: "committed"
    }], recovery);
    expect(merged).toEqual([expect.objectContaining({ name: "value", type: { kind: "number" } })]);
  });

  it("derives a newly typed scope without a committed scope snapshot", () => {
    const source = [
      "nui 4",
      "if (true) {",
      "  let broken: number = @broken",
      "  set b",
      "}"
    ].join("\n");
    expect(candidatesAt(source, "  set b").candidates.map(({ name }) => name)).toContain("broken");
    expect(candidatesAt(source, "nui 4").candidates.map(({ name }) => name)).not.toContain("broken");
  });
});
