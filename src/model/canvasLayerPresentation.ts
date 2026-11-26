import type {
  CompiledDslDocument,
  DslDocumentData,
  DslStatement,
  CanvasModuleOrigin,
  ModuleMaterialization,
  SourceLexicalNamespaceIndex
} from "@nuinuicad/nui-language";
import { DEFAULT_SOURCE_LAYER_ID } from "@nuinuicad/nui-language";
import type { CadElement, ElementId, EvaluationResult } from "../types/geometry";
import { isContainerElement } from "@nuinuicad/nui-language";
import { runtimeOnlyElementTypes } from "../types/geometry";
import { projectEffectiveDrawableLayers, type SourceLayerAssignment } from "./effectiveDrawableLayer";

export type CanvasLayerDeclaration = {
  identity: string;
  name: string;
  ownerPath: readonly string[];
};

export type CanvasLayerRow = {
  /** Exact source layer name projected to one transient Canvas toggle. */
  id: string;
  name: string;
  label: string;
  isDefault: boolean;
};

export type CanvasLayerMembership = {
  layerIdentity: string;
  layerName: string;
  /** Present only when the author wrote an explicit `in Layer` clause. */
  explicit?: true;
};

/** Serializable compiler projection for one source document in a Module graph. */
export type CanvasLayerSourceDocument = {
  documentId: string;
  declarations: readonly CanvasLayerDeclaration[];
  membershipsBySourceStatementId: readonly (readonly [string, CanvasLayerMembership])[];
  membershipsByElementId: readonly (readonly [ElementId, CanvasLayerMembership])[];
};

export type CanvasLayerPresentation = {
  layers: readonly CanvasLayerRow[];
  hiddenLayerIds: ReadonlySet<string>;
  layerIdByElementId: ReadonlyMap<ElementId, string>;
  /** Module body drawables whose document-qualified source membership is unavailable. */
  unmappedModuleDrawableIds: ReadonlySet<ElementId>;
};

export type CanvasLayerMaterialization = Partial<Pick<ModuleMaterialization, "rootDocumentId">> & {
  originByRuntimeElementId: ReadonlyMap<ElementId, CanvasModuleOrigin>;
};

/** Stable Canvas view key. Lexical declaration identities remain source-qualified separately. */
export const canvasLayerVisibilityKeyForName = (name: string): string =>
  name === "default" ? DEFAULT_SOURCE_LAYER_ID : `canvas-layer-name:${JSON.stringify(name)}`;

const ownerPathFor = (
  declarationScopeId: string,
  namespace: SourceLexicalNamespaceIndex,
  statements: readonly DslStatement[]
): string[] => {
  const segments: string[] = [];
  let scopeId: string | null = declarationScopeId;
  while (scopeId) {
    const scope = namespace.scopeIndex.scopes.get(scopeId);
    if (!scope) break;
    if ((scope.kind === "module" || scope.kind === "group") && scope.openingStatementIndex !== null) {
      const statement = statements[scope.openingStatementIndex];
      const name = statement?.name?.trim();
      segments.unshift(`${scope.kind === "module" ? "Module" : "Group"} ${name || "(unnamed)"}`);
    }
    scopeId = scope.parentId;
  }
  return segments;
};

const membershipProjectionFor = (
  namespace: SourceLexicalNamespaceIndex
): readonly (readonly [string, CanvasLayerMembership])[] =>
  [...namespace.layerMembershipsByStatementIndex.values()].map((membership) => [
    membership.sourceStatementId,
    {
      layerIdentity: membership.layerIdentity,
      layerName: membership.layerName,
      ...(membership.explicit ? { explicit: true as const } : {})
    }
  ] as const);

/** Build the serializable layer source view from the existing compiler owners. */
export const canvasLayerSourceDocumentFor = ({
  documentId,
  sourceLexicalNamespace,
  statements,
  document
}: {
  documentId: string;
  sourceLexicalNamespace: SourceLexicalNamespaceIndex;
  statements: readonly DslStatement[];
  document?: DslDocumentData | null;
}): CanvasLayerSourceDocument => {
  const namespaceDeclarations = new Map(sourceLexicalNamespace.layerDeclarations.map((declaration) => [
    declaration.statementId,
    declaration
  ]));
  const declarations = (document?.sourceLayerDeclarations ?? sourceLexicalNamespace.layerDeclarations.map((declaration) => ({
    identity: declaration.statementId,
    name: declaration.name
  }))).map((declaration) => {
    const lexicalDeclaration = namespaceDeclarations.get(declaration.identity);
    return {
      identity: declaration.identity,
      name: declaration.name,
      ownerPath: lexicalDeclaration
        ? ownerPathFor(lexicalDeclaration.scopeId, sourceLexicalNamespace, statements)
        : []
    };
  });

  const lexicalMemberships = membershipProjectionFor(sourceLexicalNamespace);
  const membershipsBySourceStatementId = document?.sourceLayerMembershipsBySourceStatementId
    ? [...document.sourceLayerMembershipsBySourceStatementId.entries()].map(([statementId, membership]) => [
        statementId,
        {
          layerIdentity: membership.layerIdentity,
          layerName: membership.layerName,
          ...(membership.explicit ? { explicit: true as const } : {})
        }
      ] as const)
    : lexicalMemberships;
  const membershipsByElementId = document?.sourceLayerMembershipsByElementId
    ? [...document.sourceLayerMembershipsByElementId.entries()].map(([elementId, membership]) => [
        elementId,
        {
          layerIdentity: membership.layerIdentity,
          layerName: membership.layerName,
          ...(membership.explicit ? { explicit: true as const } : {})
        }
      ] as const)
    : [];

  return { documentId, declarations, membershipsBySourceStatementId, membershipsByElementId };
};

export const canvasLayerSourceDocumentForCompiled = (
  compiledDocument: CompiledDslDocument | undefined,
  fallbackDocumentId = "root"
): CanvasLayerSourceDocument | null => {
  if (!compiledDocument?.sourceLexicalNamespace) return null;
  return canvasLayerSourceDocumentFor({
    documentId: String(compiledDocument.moduleRuntimeContext?.rootDocumentId ?? fallbackDocumentId),
    sourceLexicalNamespace: compiledDocument.sourceLexicalNamespace,
    statements: compiledDocument.statements,
    document: compiledDocument.document
  });
};

/**
 * Projects compiler-owned layer identities onto concrete Canvas drawables.
 * Module bodies resolve through source provenance; generated occurrences
 * inherit through the evaluator's generated-to-template rows.
 */
export const projectCanvasLayerPresentation = ({
  rootDocumentId: explicitRootDocumentId,
  compiledDocument,
  sourceDocuments = [],
  moduleMaterialization,
  elements,
  evaluation,
  hiddenLayerIds = new Set<string>()
}: {
  rootDocumentId?: string;
  compiledDocument?: CompiledDslDocument;
  sourceDocuments?: readonly CanvasLayerSourceDocument[];
  moduleMaterialization?: CanvasLayerMaterialization;
  elements: readonly CadElement[];
  evaluation: EvaluationResult;
  hiddenLayerIds?: ReadonlySet<string>;
}): CanvasLayerPresentation => {
  const rootDocumentId = String(
    explicitRootDocumentId ?? moduleMaterialization?.rootDocumentId ?? compiledDocument?.moduleRuntimeContext?.rootDocumentId ?? "root"
  );
  const hasGraphRootSourceDocument = sourceDocuments.some((sourceDocument) =>
    sourceDocument.documentId === rootDocumentId
  );
  const rootSourceDocument = hasGraphRootSourceDocument
    ? null
    : canvasLayerSourceDocumentForCompiled(compiledDocument, rootDocumentId);
  const documents = new Map<string, CanvasLayerSourceDocument>();
  for (const sourceDocument of sourceDocuments) {
    documents.set(sourceDocument.documentId, sourceDocument);
  }
  if (rootSourceDocument) documents.set(rootSourceDocument.documentId, rootSourceDocument);
  const layerByName = new Map<string, CanvasLayerRow>([["default", {
    id: DEFAULT_SOURCE_LAYER_ID,
    name: "default",
    label: "default",
    isDefault: true
  }]]);
  const membershipBySourceIdentity = new Map<string, SourceLayerAssignment>();
  const assignmentByElementId = new Map<ElementId, SourceLayerAssignment>();
  for (const sourceDocument of documents.values()) {
    for (const declaration of sourceDocument.declarations) {
      if (!layerByName.has(declaration.name)) {
        layerByName.set(declaration.name, {
          id: canvasLayerVisibilityKeyForName(declaration.name),
          name: declaration.name,
          label: declaration.name,
          isDefault: false
        });
      }
    }
    for (const [sourceStatementId, membership] of sourceDocument.membershipsBySourceStatementId) {
      membershipBySourceIdentity.set(JSON.stringify([sourceDocument.documentId, sourceStatementId]), {
        layerIdentity: membership.layerIdentity,
        layerName: membership.layerName,
        explicit: membership.explicit === true
      });
    }
    for (const [elementId, membership] of sourceDocument.membershipsByElementId) {
      assignmentByElementId.set(elementId, {
        layerIdentity: membership.layerIdentity,
        layerName: membership.layerName,
        explicit: membership.explicit === true
      });
    }
  }
  const rows = [...layerByName.values()];

  const unmappedModuleDrawableIds = new Set<ElementId>();
  const drawableRuntimeIds = new Set(elements
    .filter((element) => !isContainerElement(element) && !runtimeOnlyElementTypes.has(element.type))
    .map((element) => element.id));
  for (const [elementId, origin] of moduleMaterialization?.originByRuntimeElementId ?? []) {
    if (origin.kind !== "moduleBody" && origin.kind !== "moduleInstance") continue;
    const sourceDocumentId = String(origin.sourceDocumentId ?? moduleMaterialization?.rootDocumentId ?? rootDocumentId);
    const assignment = membershipBySourceIdentity.get(JSON.stringify([sourceDocumentId, origin.sourceStatementId]));
    if (assignment) assignmentByElementId.set(elementId, assignment);
    else if (origin.kind === "moduleBody" && drawableRuntimeIds.has(elementId)) unmappedModuleDrawableIds.add(elementId);
  }

  const generatedTemplateById = new Map<ElementId, ElementId>(
    (evaluation.forGroupGeneratedRows ?? []).map((row) => [row.generatedElementId, row.templateElementId])
  );
  for (const generatedId of generatedTemplateById.keys()) {
    if (unmappedModuleDrawableIds.has(generatedTemplateById.get(generatedId)!)) unmappedModuleDrawableIds.add(generatedId);
  }
  const effectiveMembershipByElementId = projectEffectiveDrawableLayers({ elements, assignmentByElementId, generatedTemplateById });
  const layerIdByElementId = new Map<ElementId, string>([...effectiveMembershipByElementId]
    .map(([elementId, membership]) => [elementId, canvasLayerVisibilityKeyForName(membership.layerName)]));
  for (const [generatedId, templateId] of generatedTemplateById) {
    if (!layerIdByElementId.has(generatedId) && layerIdByElementId.has(templateId)) {
      layerIdByElementId.set(generatedId, layerIdByElementId.get(templateId)!);
    }
  }

  return { layers: rows, hiddenLayerIds: new Set(hiddenLayerIds), layerIdByElementId, unmappedModuleDrawableIds };
};

export const canvasLayerVisibleElementIds = (
  elementIds: ReadonlySet<ElementId>,
  presentation?: CanvasLayerPresentation
): Set<ElementId> => {
  if (!presentation) return new Set(elementIds);
  return new Set([...elementIds].filter((elementId) => {
    if (presentation.unmappedModuleDrawableIds.has(elementId)) return false;
    const layerId = presentation.layerIdByElementId.get(elementId);
    return layerId === undefined || !presentation.hiddenLayerIds.has(layerId);
  }));
};
