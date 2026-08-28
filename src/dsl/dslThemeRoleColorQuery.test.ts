import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { queryDslThemeRoleColors } from "./dslThemeRoleColorQuery";
import { parseDslSnapshot } from "./dslParser";

const compiledFor = (source: string, sourceRevision = 1) => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `theme-role:${index}`]))
  });
};

const queryFor = (source: string, sourceRevision = 1) => {
  const normalizedSource = source.replace(/\r\n/g, "\n");
  return queryDslThemeRoleColors({
    source: { normalizedSource, sourceRevision },
    semantic: { sourceRevision, compiled: compiledFor(normalizedSource, sourceRevision) }
  });
};

describe("DSL theme-role color query", () => {
  it("returns all six parser-owned modifier theme roles with normalized token ranges", () => {
    const roles = ["foreground", "muted", "accent", "info", "warning", "error"] as const;
    const source = [
      "nui 4",
      ...roles.flatMap((role) => [
        `modifier ${role}Modifier {`,
        `  color: ${role},`,
        "}"
      ])
    ].join("\r\n");
    const normalizedSource = source.replace(/\r\n/g, "\n");

    expect(queryFor(source)).toEqual(roles.map((role) => {
      const colorValue = `color: ${role}`;
      const from = normalizedSource.indexOf(colorValue, normalizedSource.indexOf(`modifier ${role}Modifier`)) + "color: ".length;
      return { role, range: { from, to: from + role.length } };
    }));
  });

  it("excludes fixed colors, comments, strings, lookalikes, and malformed values", () => {
    const source = [
      "nui 4",
      "// color: accent",
      'modifier "accent" {',
      "  color: \"accent\",",
      "}",
      "modifier Fixed {",
      "  color: #112233,",
      "}",
      "modifier ShortHex {",
      "  color: #123,",
      "}",
      "modifier Lookalike {",
      "  color: primary,",
      "}",
      "modifier Actual {",
      "  color: accent,",
      "}"
    ].join("\n");
    const from = source.lastIndexOf("accent");

    expect(queryFor(source)).toEqual([{
      role: "accent",
      range: { from, to: from + "accent".length }
    }]);
  });

  it("fails closed for stale source revisions and source text", () => {
    const source = "nui 4\nmodifier Guide {\n  color: accent,\n}";
    const compiled = compiledFor(source);

    expect(queryDslThemeRoleColors({
      source: { normalizedSource: source, sourceRevision: 2 },
      semantic: { sourceRevision: 1, compiled }
    })).toEqual([]);
    expect(queryDslThemeRoleColors({
      source: { normalizedSource: source.replace("accent", "warning"), sourceRevision: 1 },
      semantic: { sourceRevision: 1, compiled }
    })).toEqual([]);
  });
});
