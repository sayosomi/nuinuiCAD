import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createMcpObservationBridge,
  mcpObservationEnabled,
  NUI_MCP_OBSERVATION_ENV
} from "./mcpObservationBridge";

describe("mcpObservationEnabled", () => {
  it("is disabled by default", () => {
    expect(mcpObservationEnabled(false, {})).toBe(false);
  });

  it("enables deterministically for the isolated-host environment flag", () => {
    expect(mcpObservationEnabled(false, { [NUI_MCP_OBSERVATION_ENV]: "1" })).toBe(true);
    expect(mcpObservationEnabled(false, { [NUI_MCP_OBSERVATION_ENV]: "true" })).toBe(false);
    expect(mcpObservationEnabled(false, { [NUI_MCP_OBSERVATION_ENV]: "0" })).toBe(false);
  });

  it("enables for the application-scoped developer setting", () => {
    expect(mcpObservationEnabled(true, {})).toBe(true);
  });
});

describe("createMcpObservationBridge", () => {
  it("does not allocate a bridge while disabled", () => {
    expect(createMcpObservationBridge({
      configured: false,
      environment: {},
      observationProvider: () => ({ documents: [] }),
      workspaceFolderPaths: []
    })).toBeNull();
  });

  it("starts a bridge when the isolated-host environment flag is enabled", async () => {
    const descriptorDirectory = mkdtempSync(join(tmpdir(), "nuinuicad-observation-activation-test-"));
    const bridge = createMcpObservationBridge({
      configured: false,
      environment: { [NUI_MCP_OBSERVATION_ENV]: "1" },
      descriptorDirectory,
      observationProvider: () => ({ documents: [] }),
      workspaceFolderPaths: ["/workspace"]
    });
    expect(bridge).not.toBeNull();
    if (!bridge) throw new Error("expected observation bridge");

    try {
      const descriptor = await bridge.ready;
      expect(descriptor.port).toBeGreaterThan(0);
      expect(descriptor.workspaceFolderPaths).toEqual(["/workspace"]);
    } finally {
      bridge.dispose();
      rmSync(descriptorDirectory, { recursive: true, force: true });
    }
  });
});
