/** nui 1 is the sole supported document dialect. */
export type DslMajorVersion = 1;

export const SUPPORTED_DSL_MAJOR_VERSIONS: readonly DslMajorVersion[] = [1];

/**
 * New documents are always nui 1.
 */
export const NEW_DOCUMENT_DSL_MAJOR_VERSION: DslMajorVersion = 1;

export const isSupportedDslMajorVersion = (value: number): value is DslMajorVersion =>
  (SUPPORTED_DSL_MAJOR_VERSIONS as readonly number[]).includes(value);
