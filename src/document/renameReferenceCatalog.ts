import { getDirectParentIds } from "../model/dependencies";
import { isElementDslStatement } from "../dsl/dslParser";
import type { CompiledDslDocument } from "../dsl/dslDocument";
import type { CadElement, ElementId, NumericValue, PrintLayout } from "../types/geometry";
import {
  consumeReference,
  derivedReferenceIds,
  expressionReferences,
  nestedExpressionReferences,
  nestedVariableReferences
} from "./renameReferenceValues";

export type RenameReferenceForm = "direct" | "derived" | "expression" | "print-layout-place";

export type RenameReferenceState =
  | { status: "resolved"; elementId: ElementId }
  | { status: "dangling"; token: string };

export type RenameReferenceSlot = {
  key: string;
  line: number;
  owner: { kind: "element"; elementId: ElementId } | { kind: "print-layout"; layoutId: string };
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
  const localVariableIds = new Set((element.numericVariables ?? []).map((variable) => variable.id));
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
  // Numeric-expression @tokens are runtime IDs after compilation. The
  // dependency index intentionally omits variable-scope edges, so retain them
  // as separate slots to catch dangling @name capture on a variable rename.
  nestedVariableReferences(element, localVariableIds).forEach((id, index) => {
    slots.push({
      key: `element:${element.id}:variable:${index}`,
      line,
      owner,
      form: "expression",
      state: stateFor(id, elementIds)
    });
  });
  return slots;
};

const numericSlots = ({
  values,
  keyPrefix,
  line,
  owner,
  elementIds,
  localVariableIds
}: {
  values: NumericValue[];
  keyPrefix: string;
  line: number;
  owner: RenameReferenceSlot["owner"];
  elementIds: ReadonlySet<ElementId>;
  localVariableIds: ReadonlySet<string>;
}): RenameReferenceSlot[] => values.flatMap((value, valueIndex) =>
  expressionReferences(value).map((reference, referenceIndex) => ({
    key: `${keyPrefix}:numeric:${valueIndex}:${referenceIndex}`,
    line,
    owner,
    form: reference.form,
    state: stateFor(reference.id, elementIds)
  })).concat(
    nestedVariableReferences(value, localVariableIds).map((id, referenceIndex) => ({
      key: `${keyPrefix}:variable:${valueIndex}:${referenceIndex}`,
      line,
      owner,
      form: "expression" as const,
      state: stateFor(id, elementIds)
    }))
  )
);

const layoutSlots = (
  compiled: CompiledDslDocument,
  layout: PrintLayout,
  elementIds: ReadonlySet<ElementId>
): RenameReferenceCatalog => {
  const statementMap = compiled.statementMap!;
  const info = statementMap.byKey.get(`printLayout:${layout.id}`);
  if (!info) return { complete: false, message: `printLayout ${layout.id} の文位置を特定できません。` };
  const statement = compiled.statements[info.statementIndex];
  if (!statement || statement.kind !== "printLayout") {
    return { complete: false, message: `printLayout ${layout.id} の文を特定できません。` };
  }
  const owner = { kind: "print-layout" as const, layoutId: layout.id };
  // printLayoutにはlocal変数プールが無い(typed const/letのみ参照する) -
  // nestedVariableReferencesは常に空集合に対して呼ぶ。
  const localVariableIds = new Set<string>();
  const slots = numericSlots({
    values: [
      layout.columns,
      layout.rows,
      layout.overlapMm,
      layout.scale,
      layout.svgCanvasWidthMm,
      layout.svgCanvasHeightMm
    ],
    keyPrefix: `layout:${layout.id}:header`,
    line: info.line,
    owner,
    elementIds,
    localVariableIds
  });
  const members = compiled.statements.filter(
    (member) => member.enclosing?.statementIndex === info.statementIndex
  );
  const placeStatements = members.filter((member) => member.kind === "place");
  if (placeStatements.length !== layout.placements.length) {
    return { complete: false, message: `printLayout ${layout.id} のメンバー対応を証明できません。` };
  }

  layout.placements.forEach((placement, index) => {
    const member = placeStatements[index];
    slots.push({
      key: `layout:${layout.id}:place:${index}:group`,
      line: member.line,
      owner,
      form: "print-layout-place",
      state: stateFor(placement.groupId, elementIds)
    });
    slots.push(...numericSlots({
      values: [placement.x, placement.y, placement.angleDeg],
      keyPrefix: `layout:${layout.id}:place:${index}`,
      line: member.line,
      owner,
      elementIds,
      localVariableIds
    }));
  });
  return { complete: true, slots };
};

export const collectRenameReferenceCatalog = (compiled: CompiledDslDocument): RenameReferenceCatalog => {
  if (!compiled.document || !compiled.statementMap) {
    return { complete: false, message: "有効な compiled document / statementMap が必要です。" };
  }
  const { document, statementMap } = compiled;
  const elementIds = new Set(document.elements.map((element) => element.id));
  const slots: RenameReferenceSlot[] = [];
  for (const element of document.elements) {
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
  for (const layout of document.printLayouts) {
    const result = layoutSlots(compiled, layout, elementIds);
    if (!result.complete) return result;
    slots.push(...result.slots);
  }
  return { complete: true, slots };
};
