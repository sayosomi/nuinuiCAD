type ElementStatusIconKind = "visible" | "hidden" | "enabled" | "disabled";

export const ElementStatusIcon = ({ kind }: { kind: ElementStatusIconKind }) => {
  return (
    <svg
      className={`element-status-icon element-status-icon-${kind}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {kind === "visible" ? (
        <>
          <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
          <circle cx="12" cy="12" r="2.7" />
        </>
      ) : kind === "hidden" ? (
        <>
          <path d="M3.5 3.5l17 17" />
          <path d="M10.7 6.2A10.1 10.1 0 0 1 12 6c6 0 9.5 6 9.5 6a15.1 15.1 0 0 1-2.3 2.9" />
          <path d="M14.1 14.1A2.7 2.7 0 0 1 9.9 9.9" />
          <path d="M6.4 6.9C3.9 8.6 2.5 12 2.5 12s3.5 6 9.5 6a9.9 9.9 0 0 0 4.1-.9" />
        </>
      ) : kind === "enabled" ? (
        <path d="M5 12.5l4.2 4.2L19 6.8" />
      ) : (
        <>
          <path d="M9 6v12" />
          <path d="M15 6v12" />
        </>
      )}
    </svg>
  );
};
