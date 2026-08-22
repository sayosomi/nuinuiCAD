import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalizeObservationDocumentPath,
  discoverVscodeObservationInstances,
  requestVscodeObservation,
  resolveVscodeObservationInstance,
  VscodeObservationBridge,
  vscodeObservationDescriptorPath,
  type VscodeObservationDescriptor
} from "./vscodeObservationBridge";

const temporaryDirectories: string[] = [];
const bridges: VscodeObservationBridge[] = [];

const temporaryDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "nuinuicad-observation-test-"));
  temporaryDirectories.push(directory);
  return directory;
};

const deterministicRandom = (value: number): typeof randomBytes =>
  ((size: number) => Buffer.alloc(size, value)) as typeof randomBytes;

const bridgeFor = (
  descriptorDirectory: string,
  value: number,
  documentPaths: readonly string[] = []
): VscodeObservationBridge => {
  const bridge = new VscodeObservationBridge({
    descriptorDirectory,
    randomBytesFn: deterministicRandom(value),
    pid: 1000 + value,
    now: () => new Date(`2026-08-22T00:00:${String(value).padStart(2, "0")}.000Z`),
    workspaceFolderPaths: [`/workspace/${value}`],
    observationProvider: () => ({
      activeDocumentUri: null,
      documents: documentPaths.map((documentPath) => ({ documentPath }))
    })
  });
  bridges.push(bridge);
  return bridge;
};

const rawRequest = async (port: number, request: unknown): Promise<Record<string, unknown>> =>
  new Promise((resolveResponse, rejectResponse) => {
    const socket = connect({ host: "127.0.0.1", port });
    let buffer = "";
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      socket.destroy();
      resolveResponse(JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>);
    });
    socket.once("error", rejectResponse);
  });

afterEach(() => {
  for (const bridge of bridges.splice(0)) bridge.dispose();
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("VscodeObservationBridge", () => {
  it("binds an ephemeral loopback server and creates a private descriptor", async () => {
    const descriptorDirectory = temporaryDirectory();
    const bridge = bridgeFor(descriptorDirectory, 1, ["/workspace/1/pattern.nui"]);
    const descriptor = await bridge.ready;

    expect(descriptor.port).toBeGreaterThan(0);
    expect(descriptor.instanceId).toHaveLength(32);
    expect(descriptor.authToken).toHaveLength(64);
    expect(descriptor.workspaceFolderPaths).toEqual(["/workspace/1"]);
    expect(existsSync(bridge.descriptorPath)).toBe(true);
    expect(JSON.parse(readFileSync(bridge.descriptorPath, "utf8"))).toEqual(descriptor);

    if (process.platform !== "win32") {
      expect(statSync(descriptorDirectory).mode & 0o777).toBe(0o700);
      expect(statSync(bridge.descriptorPath).mode & 0o777).toBe(0o600);
    }
  });

  it("returns observation only for the descriptor token", async () => {
    const bridge = bridgeFor(temporaryDirectory(), 2, ["/workspace/2/pattern.nui"]);
    const descriptor = await bridge.ready;

    await expect(requestVscodeObservation(descriptor)).resolves.toEqual({
      activeDocumentUri: null,
      documents: [{ documentPath: "/workspace/2/pattern.nui" }]
    });
    await expect(requestVscodeObservation({ ...descriptor, authToken: "wrong-token" })).resolves.toBeNull();
  });

  it("rejects non-observation request types instead of exposing a command endpoint", async () => {
    const bridge = bridgeFor(temporaryDirectory(), 3);
    const descriptor = await bridge.ready;
    const response = await rawRequest(descriptor.port, {
      type: "command",
      token: descriptor.authToken,
      command: "anything"
    });

    expect(response).toEqual({ type: "error", error: "unsupported-request" });
    expect(response).not.toHaveProperty("observation");
  });

  it("removes its descriptor on disposal and closes the server", async () => {
    const bridge = bridgeFor(temporaryDirectory(), 4);
    const descriptor = await bridge.ready;
    expect(existsSync(bridge.descriptorPath)).toBe(true);

    bridge.dispose();
    expect(existsSync(bridge.descriptorPath)).toBe(false);
    await expect(requestVscodeObservation(descriptor, { timeoutMs: 100 })).rejects.toThrow();
  });
});

describe("VS Code observation discovery", () => {
  it("returns deterministic ambiguity and exact instance selection for two live descriptors", async () => {
    const directory = temporaryDirectory();
    const second = bridgeFor(directory, 2, ["/workspace/shared.nui"]);
    const first = bridgeFor(directory, 1, ["/workspace/first.nui"]);
    const [secondDescriptor, firstDescriptor] = await Promise.all([second.ready, first.ready]);

    const ambiguous = await resolveVscodeObservationInstance({}, { descriptorDirectory: directory });
    expect(ambiguous.kind).toBe("ambiguous");
    if (ambiguous.kind !== "ambiguous") throw new Error("expected ambiguity");
    expect(ambiguous.candidates.map((candidate) => candidate.instanceId)).toEqual([
      firstDescriptor.instanceId,
      secondDescriptor.instanceId
    ]);
    expect(ambiguous.candidates[0]).not.toHaveProperty("authToken");

    const exact = await resolveVscodeObservationInstance(
      { instanceId: secondDescriptor.instanceId },
      { descriptorDirectory: directory }
    );
    expect(exact.kind).toBe("selected");
    if (exact.kind !== "selected") throw new Error("expected exact selection");
    expect(exact.instance.descriptor.instanceId).toBe(secondDescriptor.instanceId);
  });

  it("selects a document only when exactly one live instance reports the canonical path open", async () => {
    const directory = temporaryDirectory();
    const filePath = join(directory, "pattern.nui");
    writeFileSync(filePath, "nui 4\n", "utf8");
    const first = bridgeFor(directory, 5, [filePath]);
    const second = bridgeFor(directory, 6, [join(directory, "other.nui")]);
    await Promise.all([first.ready, second.ready]);

    const selected = await resolveVscodeObservationInstance(
      { documentPath: pathToFileURL(filePath).href },
      { descriptorDirectory: directory }
    );
    expect(selected.kind).toBe("selected");
    if (selected.kind !== "selected") throw new Error("expected document selection");
    expect(selected.instance.documentPaths).toContain(filePath);
    expect(canonicalizeObservationDocumentPath(pathToFileURL(filePath).href)).toBe(
      canonicalizeObservationDocumentPath(filePath)
    );
  });

  it("reports document ambiguity instead of guessing between two matching live instances", async () => {
    const directory = temporaryDirectory();
    const filePath = join(directory, "shared.nui");
    writeFileSync(filePath, "nui 4\n", "utf8");
    const first = bridgeFor(directory, 7, [filePath]);
    const second = bridgeFor(directory, 8, [filePath]);
    await Promise.all([first.ready, second.ready]);

    const resolution = await resolveVscodeObservationInstance(
      { documentPath: filePath },
      { descriptorDirectory: directory }
    );
    expect(resolution.kind).toBe("ambiguous");
    if (resolution.kind !== "ambiguous") throw new Error("expected document ambiguity");
    expect(resolution.reason).toBe("document-open-in-multiple-instances");
    expect(resolution.candidates).toHaveLength(2);
  });

  it("ignores and cleans a stale descriptor whose loopback server is no longer live", async () => {
    const directory = temporaryDirectory();
    const stalePath = vscodeObservationDescriptorPath("stale-instance", directory);
    const stale: VscodeObservationDescriptor = {
      version: 1,
      instanceId: "stale-instance",
      pid: 12345,
      port: 1,
      authToken: "stale-token",
      workspaceFolderPaths: [],
      startedAt: "2026-08-22T00:00:00.000Z"
    };
    writeFileSync(stalePath, JSON.stringify(stale), "utf8");

    await expect(discoverVscodeObservationInstances({ descriptorDirectory: directory, timeoutMs: 100 })).resolves.toEqual([]);
    expect(existsSync(stalePath)).toBe(false);
  });
});
