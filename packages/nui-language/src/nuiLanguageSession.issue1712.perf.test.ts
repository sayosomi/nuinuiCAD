import { afterEach, describe, expect, it, vi } from "vitest";
import * as typoSuggestionQuery from "./dsl/dslTypoSuggestionQuery";
import { createNuiLanguageSession } from "./nuiLanguageSession";

const syntheticSource = (): string => [
  "nui 1",
  ...Array.from({ length: 1496 }, (_, index) =>
    `const marker${String(index).padStart(4, "0")}: number = ${index}`
  ),
  "const width: number = 10",
  "const height: number = 20",
  "const result: number = widht"
].join("\n");

describe("Issue #1712 synthetic typo-cache measurements", () => {
  afterEach(() => vi.restoreAllMocks());

  it("measures canonical typo-query work across duplicate diagnostics and an edit", () => {
    const source = syntheticSource();
    const editedSource = source.replace("widht", "heigth");
    const session = createNuiLanguageSession(source);
    const querySpy = vi.spyOn(typoSuggestionQuery, "queryDslTypoSuggestions");
    const observations: Array<{ step: string; durationMs: number; queryCalls: number }> = [];

    const measure = (step: string, run: () => void): void => {
      const before = querySpy.mock.calls.length;
      const startedAt = performance.now();
      run();
      observations.push({
        step,
        durationMs: Number((performance.now() - startedAt).toFixed(3)),
        queryCalls: querySpy.mock.calls.length - before
      });
    };

    measure("initial diagnostics", () => {
      expect(session.diagnostics().some((diagnostic) => diagnostic.code === "undefined-binding")).toBe(true);
    });
    measure("same-source duplicate diagnostics", () => {
      session.replaceSource(source);
      session.diagnostics();
    });
    measure("genuine source edit followed by diagnostics", () => {
      session.replaceSource(editedSource);
      expect(session.diagnostics().some((diagnostic) => diagnostic.code === "undefined-binding")).toBe(true);
    });
    measure("duplicate diagnostics after the edit", () => {
      session.replaceSource(editedSource);
      session.diagnostics();
    });

    console.info("ISSUE_1712_PERF " + JSON.stringify({
      lineCount: source.split("\n").length,
      sourceBytes: source.length,
      observations
    }));
    expect(observations.map(({ queryCalls }) => queryCalls)).toEqual([1, 0, 1, 0]);
  });
});
