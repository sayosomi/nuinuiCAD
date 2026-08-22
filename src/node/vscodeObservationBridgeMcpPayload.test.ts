import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  requestVscodeObservation,
  VscodeObservationBridge
} from "./vscodeObservationBridge";

const directories: string[] = [];
const bridges: VscodeObservationBridge[] = [];

const deterministicRandom = (value: number): typeof randomBytes =>
  ((size: number) => Buffer.alloc(size, value)) as typeof randomBytes;

afterEach(() => {
  for (const bridge of bridges.splice(0)) bridge.dispose();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("VS Code observation MCP payload", () => {
  it("keeps exact source text and observation state JSON-friendly over the read-only protocol", async () => {
    const descriptorDirectory = mkdtempSync(join(tmpdir(), "nuinuicad-observation-mcp-payload-"));
    directories.push(descriptorDirectory);
    const sourceText = "nui 4\nline AB = segment(start: (0, 0), end: (10, 0))\n";
    const observation = {
      activeDocumentUri: "file:///tmp/pattern.nui",
      documents: [{
        documentUri: "file:///tmp/pattern.nui",
        documentPath: "/tmp/pattern.nui",
        documentVersion: 4,
        sourceText,
        canvas: null
      }]
    };
    const bridge = new VscodeObservationBridge({
      descriptorDirectory,
      randomBytesFn: deterministicRandom(11),
      workspaceFolderPaths: ["/tmp"],
      observationProvider: () => observation
    });
    bridges.push(bridge);
    const descriptor = await bridge.ready;

    const received = await requestVscodeObservation(descriptor);

    expect(received).toEqual(observation);
    expect(JSON.parse(JSON.stringify(received))).toEqual(observation);
  });
});
