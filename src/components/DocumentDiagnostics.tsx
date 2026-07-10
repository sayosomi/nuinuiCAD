import { useCadDocumentStore } from "../state/cadDocumentStore";

export const DocumentDiagnostics = () => {
  const diagnostics = useCadDocumentStore((state) => state.diagnostics);
  if (diagnostics.length === 0) return null;

  return (
    <div className="document-diagnostics" aria-label="文書診断">
      {diagnostics.map((diagnostic, index) => (
        <p key={`${diagnostic.line}-${diagnostic.column}-${index}`} className={diagnostic.severity}>
          {diagnostic.line}:{diagnostic.column} {diagnostic.message}
        </p>
      ))}
    </div>
  );
};
