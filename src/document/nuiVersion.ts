import { unsupportedDslMajorVersion } from "../dsl/dslDocument";

/** Returns only the major version that must be rejected at the file-open boundary. */
export const unsupportedNuiMajorVersion = (source: string) =>
  unsupportedDslMajorVersion(source);
