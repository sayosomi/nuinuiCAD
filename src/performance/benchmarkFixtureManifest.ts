export const BENCHMARK_FIXTURE_MANIFEST_SCHEMA_VERSION = 1 as const;

export type BenchmarkFixtureManifestEntry = {
  id: string;
  file: string;
  hash: string;
  workload: {
    forGroupIterations: number;
    generatedGeometryPerIteration: number;
  };
  anchors: {
    sourceEdit: {
      bindingName: string;
      from: string;
      to: string;
    };
    pointDrag: {
      elementPath: string;
      pointerDeltaCssPx: { x: number; y: number };
    };
    bezierHandleDrag: {
      elementPath: string;
      handleRole: string;
      pointerDeltaCssPx: { x: number; y: number };
    };
    dependentElementPath: string;
  };
};

export type BenchmarkFixtureManifest = {
  schemaVersion: typeof BENCHMARK_FIXTURE_MANIFEST_SCHEMA_VERSION;
  fixtures: BenchmarkFixtureManifestEntry[];
};

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isSha256Hash = (value: unknown): value is string =>
  typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);

const errorsForEntry = (value: unknown, path: string): string[] => {
  const errors: string[] = [];
  if (!isRecord(value)) return [`${path}: must be an object`];
  if (!isNonEmptyString(value.id)) errors.push(`${path}.id: must be a non-empty string`);
  if (!isNonEmptyString(value.file)) errors.push(`${path}.file: must be a non-empty string`);
  if (!isSha256Hash(value.hash)) errors.push(`${path}.hash: must use sha256:<64 lowercase hex>`);

  if (!isRecord(value.workload)) {
    errors.push(`${path}.workload: must be an object`);
  } else {
    if (!isPositiveInteger(value.workload.forGroupIterations)) {
      errors.push(`${path}.workload.forGroupIterations: must be a positive integer`);
    }
    if (!isPositiveInteger(value.workload.generatedGeometryPerIteration)) {
      errors.push(`${path}.workload.generatedGeometryPerIteration: must be a positive integer`);
    }
  }

  if (!isRecord(value.anchors)) {
    errors.push(`${path}.anchors: must be an object`);
    return errors;
  }
  if (!isRecord(value.anchors.sourceEdit)) {
    errors.push(`${path}.anchors.sourceEdit: must be an object`);
  } else {
    for (const field of ["bindingName", "from", "to"] as const) {
      if (!isNonEmptyString(value.anchors.sourceEdit[field])) {
        errors.push(`${path}.anchors.sourceEdit.${field}: must be a non-empty string`);
      }
    }
  }
  for (const anchorName of ["pointDrag", "bezierHandleDrag"] as const) {
    const anchor = value.anchors[anchorName];
    if (!isRecord(anchor)) {
      errors.push(`${path}.anchors.${anchorName}: must be an object`);
      continue;
    }
    if (!isNonEmptyString(anchor.elementPath)) {
      errors.push(`${path}.anchors.${anchorName}.elementPath: must be a non-empty string`);
    }
    if (anchorName === "bezierHandleDrag" && !isNonEmptyString(anchor.handleRole)) {
      errors.push(`${path}.anchors.${anchorName}.handleRole: must be a non-empty string`);
    }
    if (!isRecord(anchor.pointerDeltaCssPx)) {
      errors.push(`${path}.anchors.${anchorName}.pointerDeltaCssPx: must be an object`);
    } else {
      for (const axis of ["x", "y"] as const) {
        if (!isFiniteNumber(anchor.pointerDeltaCssPx[axis])) {
          errors.push(`${path}.anchors.${anchorName}.pointerDeltaCssPx.${axis}: must be finite`);
        }
      }
    }
  }
  if (!isNonEmptyString(value.anchors.dependentElementPath)) {
    errors.push(`${path}.anchors.dependentElementPath: must be a non-empty string`);
  }
  return errors;
};

export const validateBenchmarkFixtureManifest = (value: unknown): string[] => {
  if (!isRecord(value)) return ["manifest: must be an object"];
  const errors: string[] = [];
  if (value.schemaVersion !== BENCHMARK_FIXTURE_MANIFEST_SCHEMA_VERSION) {
    errors.push(`schemaVersion: must equal ${BENCHMARK_FIXTURE_MANIFEST_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(value.fixtures) || value.fixtures.length === 0) {
    errors.push("fixtures: must be a non-empty array");
    return errors;
  }
  value.fixtures.forEach((fixture, index) => {
    errors.push(...errorsForEntry(fixture, `fixtures[${index}]`));
  });
  return errors;
};

export const assertBenchmarkFixtureManifest: (
  value: unknown
) => asserts value is BenchmarkFixtureManifest = (value) => {
  const errors = validateBenchmarkFixtureManifest(value);
  if (errors.length > 0) {
    throw new Error(`Invalid benchmark fixture manifest:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
};

export const parseBenchmarkFixtureManifest = (value: unknown): BenchmarkFixtureManifest => {
  assertBenchmarkFixtureManifest(value);
  return value;
};
