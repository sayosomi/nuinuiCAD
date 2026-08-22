import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { legacyBindingIdMap, retiredCommandIds } from "../src/keyboard/shortcutSettingsStorage";

const commandIdMapDocument = readFileSync(resolve(process.cwd(), "docs/command-id-map.md"), "utf8");

const section = (start: string, end: string) => {
  const startIndex = commandIdMapDocument.indexOf(start);
  const endIndex = commandIdMapDocument.indexOf(end, startIndex);
  if (startIndex < 0 || endIndex < 0) throw new Error(`Missing command ID map section: ${start}`);
  return commandIdMapDocument.slice(startIndex, endIndex);
};

describe("command ID map documentation", () => {
  it("matches the implementation migration map and retired ID set", () => {
    const migrationRows = [...section("## 1. 移行", "## 2. 廃止").matchAll(
      /^\| `([^`]+)` \| `([^`]+)` \|$/gm
    )];
    const documentedMigrations = Object.fromEntries(
      migrationRows.map(([, legacyBindingId, bindingId]) => [legacyBindingId, bindingId])
    );
    const retiredRows = [...section("## 2. 廃止", "## 3. ID不変").matchAll(/^\| `([^`]+)` \|$/gm)];

    expect(documentedMigrations).toEqual(legacyBindingIdMap);
    expect(retiredRows.map(([, commandId]) => commandId)).toEqual(retiredCommandIds);
    expect(commandIdMapDocument).not.toContain("予定(5c)");
  });
});
