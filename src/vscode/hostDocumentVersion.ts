export const isStaleHostDocumentVersion = (
  latestHostDocumentVersion: number | null,
  incomingDocumentVersion: number
): boolean => latestHostDocumentVersion !== null && incomingDocumentVersion < latestHostDocumentVersion;
