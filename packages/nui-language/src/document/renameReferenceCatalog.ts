import { getDirectParentIds } from "../model/dependencies";
import { isElementDslStatement } from "../dsl/dslParser";
import type { CompiledDslDocument } from "../dsl/dslDocument";
import { sourceOwnerForRuntimeElementId } from "../dsl/sourceOwnership";
import type { CadElement, ElementId } from "../types/geometry";
import {
  consumeReference,
  derivedReferenceIds,
  nestedExpressionReferences
} from "./renameReferenceValues";

export type RenameReferenceForm = "direct" | "derived" | "expression";

export type RenameReferenceState =
  | { status: "resolved"; elementId: ElementId }
  | { status: "dangling"; token: string };

export type RenameReferenceSlot = {
  key: string;
  line: number;
  owner: { kind: "element"; elementId: ElementId };
  form: RenameReferenceForm;
  state: RenameReferenceState;
};

export type RenameReferenceCatalog =
  | { complete: true; slots: RenameReferenceSlot[] }
  | { complete: false; message: string };

const stateFor = (id: ElementId, elementIds: ReadonlySet<ElementId>): RenameReferenceState =>
  elementIds.has(id) ? { status: "resolved", elementId: id } : { status: "dangling", token: id };

const elementSlots = ({
  element,
  line,
  elementIds,
  hasExplicitParent
}: {
  element: CadElement;
  line: number;
  elementIds: ReadonlySet<ElementId>;
  hasExplicitParent: boolean;
}): RenameReferenceSlot[] => {
  const expressionIds = new Map<string, number>();
  for (const reference of nestedExpressionReferences(element)) {
    expressionIds.set(reference.id, (expressionIds.get(reference.id) ?? 0) + 1);
  }
  const derivedIds = new Map<string, number>();
  for (const id of derivedReferenceIds(element)) {
    derivedIds.set(id, (derivedIds.get(id) ?? 0) + 1);
  }

  const owner = { kind: "element" as const, elementId: element.id };
  const slots: RenameReferenceSlot[] = getDirectParentIds(element).map((id, index) => {
    const form: RenameReferenceForm = consumeReference(expressionIds, id)
      ? "expression"
      : consumeReference(derivedIds, id)
        ? "derived"
        : "direct";
    return {
      key: `element:${element.id}:dependency:${index}`,
      line,
      owner,
      form,
      state: stateFor(id, elementIds)
    };
  });

  // `getDirectParentIds` intentionally omits structural ownership. Explicit
  // parent= is a textual element reference, whereas a brace-derived parent is not.
  if (hasExplicitParent && element.parentGroupId) {
    slots.push({
      key: `element:${element.id}:parent`,
      line,
      owner,
      form: "direct",
      state: stateFor(element.parentGroupId, elementIds)
    });
  }
  return slots;
};

export const collectRenameReferenceCatalog = (compiled: CompiledDslDocument): RenameReferenceCatalog => {
  if (!compiled.document || !compiled.statementMap) {
    return { complete: false, message: "有効な compiled document / statementMap が必要です。" };
  }
  const { document, statementMap } = compiled;
  const ownershipDocument = { ...compiled, statementMap };
  const elementIds = new Set(document.elements.map((element) => element.id));
  const slots: RenameReferenceSlot[] = [];
  for (const element of document.elements) {
    const owner = sourceOwnerForRuntimeElementId(ownershipDocument, element.id);
    if (!owner) {
      return { complete: false, message: "要素の source ownership を完全に解決できません。" };
    }
    if (owner.kind !== "ordinary") continue;
    const info = statementMap.byElementId.get(element.id);
    if (!info) return { complete: false, message: `要素 ${element.id} の文位置を特定できません。` };
    const statement = compiled.statements[info.statementIndex];
    if (!statement || !isElementDslStatement(statement)) {
      return { complete: false, message: `要素 ${element.id} の文を特定できません。` };
    }
    slots.push(...elementSlots({
      element,
      line: info.line,
      elementIds,
      hasExplicitParent: statement.attrs.some((attribute) => attribute.key === "parent")
    }));
  }
  return { complete: true, slots };
};
