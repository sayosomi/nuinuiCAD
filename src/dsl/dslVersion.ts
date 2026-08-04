/** nui 3 is the sole supported document dialect. */
export type DslMajorVersion = 3;

export const SUPPORTED_DSL_MAJOR_VERSIONS: readonly DslMajorVersion[] = [3];

/**
 * New documents are always nui 3.
 */
export const NEW_DOCUMENT_DSL_MAJOR_VERSION: DslMajorVersion = 3;

export const isSupportedDslMajorVersion = (value: number): value is DslMajorVersion =>
  (SUPPORTED_DSL_MAJOR_VERSIONS as readonly number[]).includes(value);
