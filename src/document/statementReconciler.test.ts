import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import { isElementDslStatement, parseDsl } from "../dsl/dslParser";
import type { CadElementType } from "../types/geometry";
import { reconcileStatements, type ReconcileResult } from "./statementReconciler";

// 決定論的ID生成器(テスト再現性のため createCadElementId は使わない)。
const testIdFactory = () => {
  let counter = 0;
  return (type: CadElementType) => `new-${type}-${(counter += 1)}`;
};

const reconcileSources = (
  oldSource: string,
  newSource: string
): { old: CompiledDslDocument; next: CompiledDslDocument; result: ReconcileResult } => {
  const old = compileDslDocument(oldSource);
  expect(old.statementMap, "old document must compile").not.toBeNull();
  const normalized = newSource.replace(/\r\n/g, "\n");
  const parsedNew = parseDsl(normalized);
  const result = reconcileStatements(
    {
      oldStatements: old.statements,
      oldLines: old.sourceLines,
      oldElementIds: old.statementMap!.elementIdByStatementIndex,
      newStatements: parsedNew.statements,
      newLines: normalized.split("\n")
    },
    { createId: testIdFactory() }
  );
  const next = compileDslDocument(normalized, { assignedElementIds: result.assignedIds });
  expect(next.statementMap, "reconciled document must compile").not.toBeNull();
  return { old, next, result };
};

const idByName = (compiled: CompiledDslDocument, name: string) => {
  const element = compiled.document!.elements.find((item) => item.name === name);
  expect(element, `element ${name}`).toBeDefined();
  return element!.id;
};

const stageOfName = (compiled: CompiledDslDocument, result: ReconcileResult, name: string) => {
  const statementIndex = compiled.statements.findIndex(
    (statement) => isElementDslStatement(statement) && statement.name === name
  );
  expect(statementIndex, `statement ${name}`).toBeGreaterThanOrEqual(0);
  return result.stageByNewStatementIndex.get(statementIndex);
};

describe("statementReconciler 仕様表", () => {
  it("属性編集(名前・型・位置不変)は段階2でID変化0", () => {
    const oldSource = ["nui 1", "point A = (0, 0)", "point B = (1, 1)"].join("\n");
    const newSource = ["nui 1", "point A = (0, 0)", "point B = (2, 2)"].join("\n");
    const { old, next, result } = reconcileSources(oldSource, newSource);
    expect(idByName(next, "A")).toBe(idByName(old, "A"));
    expect(idByName(next, "B")).toBe(idByName(old, "B"));
    expect(result.createdIds.size).toBe(0);
    expect(result.vanishedIds).toEqual([]);
    expect(stageOfName(next, result, "A")).toBe(1);
    expect(stageOfName(next, result, "B")).toBe(2);
  });

  it("リネーム(位置・型不変)は段階3でID維持", () => {
    const oldSource = ["nui 1", "point A = (0, 0)", "point B = (1, 1)"].join("\n");
    const newSource = ["nui 1", "point A = (0, 0)", "point C = (1, 1)"].join("\n");
    const { old, next, result } = reconcileSources(oldSource, newSource);
    expect(idByName(next, "C")).toBe(idByName(old, "B"));
    expect(result.createdIds.size).toBe(0);
    expect(result.vanishedIds).toEqual([]);
    expect(stageOfName(next, result, "C")).toBe(3);
  });

  it("同一スコープ内の行移動(内容不変)は段階2でID変化0", () => {
    const oldSource = ["nui 1", "point A = (0, 0)", "point B = (1, 1)", "point C = (2, 2)"].join("\n");
    const newSource = ["nui 1", "point A = (0, 0)", "point C = (2, 2)", "point B = (1, 1)"].join("\n");
    const { old, next, result } = reconcileSources(oldSource, newSource);
    expect(idByName(next, "B")).toBe(idByName(old, "B"));
    expect(idByName(next, "C")).toBe(idByName(old, "C"));
    expect(result.createdIds.size).toBe(0);
    expect(stageOfName(next, result, "B")).toBe(2);
  });

  it("無名要素の属性編集(位置不変)は段階3でID維持", () => {
    const oldSource = ["nui 1", "point A = (0, 0)", "point = (5, 5)", "point B = (1, 1)"].join("\n");
    const newSource = ["nui 1", "point A = (0, 0)", "point = (6, 6)", "point B = (1, 1)"].join("\n");
    const { old, next, result } = reconcileSources(oldSource, newSource);
    const oldUnnamed = old.document!.elements.find((item) => item.name === "")!;
    const newUnnamed = next.document!.elements.find((item) => item.name === "")!;
    expect(newUnnamed.id).toBe(oldUnnamed.id);
    expect(result.createdIds.size).toBe(0);
    expect(result.vanishedIds).toEqual([]);
  });

  it("無名要素の挿入は既存ID全継承+新規ID1件のみ", () => {
    const oldSource = ["nui 1", "point A = (0, 0)", "point B = (1, 1)"].join("\n");
    const newSource = ["nui 1", "point A = (0, 0)", "point = (9, 9)", "point B = (1, 1)"].join("\n");
    const { old, next, result } = reconcileSources(oldSource, newSource);
    expect(idByName(next, "A")).toBe(idByName(old, "A"));
    expect(idByName(next, "B")).toBe(idByName(old, "B"));
    expect(result.createdIds.size).toBe(1);
    expect(result.inheritedCount).toBe(2);
    const unnamed = next.document!.elements.find((item) => item.name === "")!;
    expect(unnamed.id).toBe("new-freePoint-1");
    expect(result.vanishedIds).toEqual([]);
  });

  it("無名要素の命名(昇格)は段階3でID維持", () => {
    const oldSource = ["nui 1", "point A = (0, 0)", "point = (5, 5)"].join("\n");
    const newSource = ["nui 1", "point A = (0, 0)", "point named5 = (5, 5)"].join("\n");
    const { old, next, result } = reconcileSources(oldSource, newSource);
    const oldUnnamed = old.document!.elements.find((item) => item.name === "")!;
    expect(idByName(next, "named5")).toBe(oldUnnamed.id);
    expect(result.createdIds.size).toBe(0);
    expect(stageOfName(next, result, "named5")).toBe(3);
  });

  it("グループ跨ぎの移動(名前・型不変)は段階5でID維持", () => {
    const oldSource = [
      "nui 1",
      "group G1 {",
      "  point P = (0, 0)",
      "}",
      "group G2 {",
      "}"
    ].join("\n");
    const newSource = [
      "nui 1",
      "group G1 {",
      "}",
      "group G2 {",
      "  point P = (0, 0)",
      "}"
    ].join("\n");
    const { old, next, result } = reconcileSources(oldSource, newSource);
    expect(idByName(next, "P")).toBe(idByName(old, "P"));
    expect(idByName(next, "G1")).toBe(idByName(old, "G1"));
    expect(idByName(next, "G2")).toBe(idByName(old, "G2"));
    expect(result.createdIds.size).toBe(0);
    expect(stageOfName(next, result, "P")).toBe(5);
    // 親付け替えが実際にモデルへ反映されている。
    const p = next.document!.elements.find((item) => item.name === "P")!;
    expect(p.parentGroupId).toBe(idByName(next, "G2"));
  });

  it("branch切替(then⇄else)は段階5でID維持", () => {
    const oldSource = [
      "nui 1",
      "if 分岐 condition=1 {",
      "  point C = (10, 10)",
      "} else {",
      "  point D = (20, 20)",
      "}"
    ].join("\n");
    const newSource = [
      "nui 1",
      "if 分岐 condition=1 {",
      "} else {",
      "  point D = (20, 20)",
      "  point C = (10, 10)",
      "}"
    ].join("\n");
    const { old, next, result } = reconcileSources(oldSource, newSource);
    expect(idByName(next, "C")).toBe(idByName(old, "C"));
    expect(idByName(next, "D")).toBe(idByName(old, "D"));
    expect(result.createdIds.size).toBe(0);
    expect(stageOfName(next, result, "C")).toBe(5);
    const c = next.document!.elements.find((item) => item.name === "C")!;
    expect(c.conditionalBranch).toBe("else");
  });

  it("グループのリネームは本体が段階3・子は段階1でID変化0", () => {
    const oldSource = ["nui 1", "group G {", "  point P = (0, 0)", "  point Q = (1, 1)", "}"].join("\n");
    const newSource = ["nui 1", "group H {", "  point P = (0, 0)", "  point Q = (1, 1)", "}"].join("\n");
    const { old, next, result } = reconcileSources(oldSource, newSource);
    expect(idByName(next, "H")).toBe(idByName(old, "G"));
    expect(idByName(next, "P")).toBe(idByName(old, "P"));
    expect(idByName(next, "Q")).toBe(idByName(old, "Q"));
    expect(result.createdIds.size).toBe(0);
    expect(stageOfName(next, result, "H")).toBe(3);
    expect(stageOfName(next, result, "P")).toBe(1);
  });

  it("リネーム+行移動の同時実行は新規ID(許容制約)", () => {
    const oldSource = ["nui 1", "point A = (0, 0)", "point B = (1, 1)", "point C = (2, 2)"].join("\n");
    const newSource = ["nui 1", "point A = (0, 0)", "point C = (2, 2)", "point D = (1, 1)"].join("\n");
    const { old, next, result } = reconcileSources(oldSource, newSource);
    expect(idByName(next, "A")).toBe(idByName(old, "A"));
    expect(idByName(next, "C")).toBe(idByName(old, "C"));
    expect(idByName(next, "D")).not.toBe(idByName(old, "B"));
    expect(result.createdIds.size).toBe(1);
    expect(result.vanishedIds).toEqual([idByName(old, "B")]);
    expect(stageOfName(next, result, "D")).toBe(6);
  });

  it("型の変更は新規ID", () => {
    const oldSource = ["nui 1", "point A = (0, 0)", "point B = (1, 1)"].join("\n");
    const newSource = ["nui 1", "point A = (0, 0)", "var B = 42"].join("\n");
    const { old, next, result } = reconcileSources(oldSource, newSource);
    expect(idByName(next, "B")).not.toBe(idByName(old, "B"));
    expect(result.createdIds.size).toBe(1);
    expect(result.vanishedIds).toEqual([idByName(old, "B")]);
  });

  it("コメントのみの行内編集はID変化0", () => {
    const oldSource = ["nui 1", "point A = (0, 0) # 旧コメント", "point B = (1, 1)"].join("\n");
    const newSource = ["nui 1", "point A = (0, 0) # 新コメント", "point B = (1, 1)"].join("\n");
    const { old, next, result } = reconcileSources(oldSource, newSource);
    expect(idByName(next, "A")).toBe(idByName(old, "A"));
    expect(result.createdIds.size).toBe(0);
  });

  it("ネスト無名グループ内の属性編集は blk: キー経由でID維持", () => {
    const oldSource = ["nui 1", "group {", "  point A = (0, 0)", "  point B = (1, 1)", "}"].join("\n");
    const newSource = ["nui 1", "group {", "  point A = (0, 0)", "  point B = (3, 3)", "}"].join("\n");
    const { old, next, result } = reconcileSources(oldSource, newSource);
    expect(idByName(next, "B")).toBe(idByName(old, "B"));
    expect(result.createdIds.size).toBe(0);
    expect(stageOfName(next, result, "B")).toBe(2);
  });

  it("全文置換でも名前+型+スコープが一致する要素はID継承する", () => {
    const oldSource = ["nui 1", "point A = (0, 0)", "point B = (1, 1)", "point C = (2, 2)"].join("\n");
    const newSource = ["nui 1", "point A = (10, 10)", "point B = (11, 11)", "point C = (12, 12)", "point D = (13, 13)"].join("\n");
    const { old, next, result } = reconcileSources(oldSource, newSource);
    expect(idByName(next, "A")).toBe(idByName(old, "A"));
    expect(idByName(next, "B")).toBe(idByName(old, "B"));
    expect(idByName(next, "C")).toBe(idByName(old, "C"));
    expect(result.createdIds.size).toBe(1);
    expect(stageOfName(next, result, "D")).toBe(6);
  });

  it("削除された要素は vanishedIds に旧文書順で載る", () => {
    const oldSource = ["nui 1", "point A = (0, 0)", "point B = (1, 1)", "point C = (2, 2)"].join("\n");
    const newSource = ["nui 1", "point B = (1, 1)"].join("\n");
    const { old, result } = reconcileSources(oldSource, newSource);
    expect(result.vanishedIds).toEqual([idByName(old, "A"), idByName(old, "C")]);
  });

  it("旧文書が空なら全て新規ID", () => {
    const oldSource = "nui 1";
    const newSource = ["nui 1", "point A = (0, 0)", "point B = (1, 1)"].join("\n");
    const { result } = reconcileSources(oldSource, newSource);
    expect(result.inheritedCount).toBe(0);
    expect(result.createdIds.size).toBe(2);
  });
});

describe("statementReconciler 複数行statement(バックスラッシュ継続)", () => {
  it("継続行だけの編集は段階1の無変更扱いにならず、IDは継承される", () => {
    const oldSource = [
      "nui 1",
      "point A = (0, 0) \\",
      "  color=main",
      "point B = (1, 1)"
    ].join("\n");
    const newSource = [
      "nui 1",
      "point A = (0, 0) \\",
      "  color=accent",
      "point B = (1, 1)"
    ].join("\n");
    const { old, next, result } = reconcileSources(oldSource, newSource);
    expect(idByName(next, "A")).toBe(idByName(old, "A"));
    expect(idByName(next, "B")).toBe(idByName(old, "B"));
    expect(result.createdIds.size).toBe(0);
    expect(result.vanishedIds).toEqual([]);
    // 先頭物理行だけを見ていた旧実装では継続行の変更が検知されず「段階1で無変更」に
    // なってしまっていた。全行結合により段階1では一致しなくなり、別段階(完全キー
    // マッチ)でID継承されることを確認する。
    expect(stageOfName(next, result, "A")).not.toBe(1);
    expect(stageOfName(next, result, "A")).toBe(2);
  });

  it("複数行statementが完全不変なら段階1でID継承・変化なし", () => {
    const oldSource = [
      "nui 1",
      "point A = (0, 0) \\",
      "  color=main",
      "point B = (1, 1)"
    ].join("\n");
    const newSource = [
      "nui 1",
      "point A = (0, 0) \\",
      "  color=main",
      "point B = (2, 2)"
    ].join("\n");
    const { old, next, result } = reconcileSources(oldSource, newSource);
    expect(idByName(next, "A")).toBe(idByName(old, "A"));
    expect(idByName(next, "B")).toBe(idByName(old, "B"));
    expect(result.createdIds.size).toBe(0);
    expect(result.vanishedIds).toEqual([]);
    expect(stageOfName(next, result, "A")).toBe(1);
  });

  it("複数行statementと単一行statementの順序入れ替えでもID対応にずれや重複がない", () => {
    const oldSource = [
      "nui 1",
      "point A = (0, 0) \\",
      "  color=main",
      "point B = (1, 1)",
      "point C = (2, 2)"
    ].join("\n");
    const newSource = [
      "nui 1",
      "point C = (2, 2)",
      "point B = (1, 1)",
      "point A = (0, 0) \\",
      "  color=main"
    ].join("\n");
    const { old, next, result } = reconcileSources(oldSource, newSource);
    // LCSの有効な選択次第でどのstatementが段階1に残るかは変わり得るため、段階は
    // 断定せず、名前→ID対応が旧新で一貫していること・新規/消滅がないこと・ID重複が
    // ないことのみを検証する。
    expect(idByName(next, "A")).toBe(idByName(old, "A"));
    expect(idByName(next, "B")).toBe(idByName(old, "B"));
    expect(idByName(next, "C")).toBe(idByName(old, "C"));
    expect(result.createdIds.size).toBe(0);
    expect(result.vanishedIds).toEqual([]);
    const assignedIdValues = [...result.assignedIds.values()];
    expect(new Set(assignedIdValues).size).toBe(assignedIdValues.length);
  });

  it("複数行statementのリネームは単一行と同じID継承規則の回帰(段階は断定しない)", () => {
    const oldSource = [
      "nui 1",
      "point A = (0, 0) \\",
      "  color=main",
      "point B = (1, 1)"
    ].join("\n");
    const newSource = [
      "nui 1",
      "point Arenamed = (0, 0) \\",
      "  color=main",
      "point B = (1, 1)"
    ].join("\n");
    const { old, next, result } = reconcileSources(oldSource, newSource);
    expect(idByName(next, "Arenamed")).toBe(idByName(old, "A"));
    expect(idByName(next, "B")).toBe(idByName(old, "B"));
    expect(result.createdIds.size).toBe(0);
    expect(result.vanishedIds).toEqual([]);
  });
});

describe("statementReconciler ストレス", () => {
  const buildLargeSource = (count: number) => {
    const lines = ["nui 1"];
    for (let index = 0; index < count; index += 1) {
      lines.push(`point P${index} = (${index}, ${index % 97})`);
    }
    return lines.join("\n");
  };

  const timedReconcile = (oldSource: string, newSource: string) => {
    const normalizedOld = oldSource.replace(/\r\n/g, "\n");
    const normalizedNew = newSource.replace(/\r\n/g, "\n");
    const parsedOld = parseDsl(normalizedOld);
    const parsedNew = parseDsl(normalizedNew);
    // 照合器の計測にコンパイルコストを混ぜないため、旧IDマップは直接組み立てる。
    const oldElementIds = new Map<number, string>();
    parsedOld.statements.forEach((statement, index) => {
      if (isElementDslStatement(statement)) oldElementIds.set(index, `old-${index}`);
    });
    const input = {
      oldStatements: parsedOld.statements,
      oldLines: normalizedOld.split("\n"),
      oldElementIds,
      newStatements: parsedNew.statements,
      newLines: normalizedNew.split("\n")
    };
    const durations: number[] = [];
    let result = reconcileStatements(input, { createId: testIdFactory() });
    for (let run = 0; run < 3; run += 1) {
      const startedAt = performance.now();
      result = reconcileStatements(input, { createId: testIdFactory() });
      durations.push(performance.now() - startedAt);
    }
    durations.sort((a, b) => a - b);
    return { result, medianMs: durations[1], elementCount: oldElementIds.size };
  };

  it("1000文の属性編集1行はID変化0で5ms未満", () => {
    const oldSource = buildLargeSource(1000);
    const newSource = oldSource.replace("point P500 = (500, 15)", "point P500 = (500, 42)");
    expect(newSource).not.toBe(oldSource);
    const { result, medianMs, elementCount } = timedReconcile(oldSource, newSource);
    expect(result.inheritedCount).toBe(elementCount);
    expect(result.createdIds.size).toBe(0);
    expect(result.vanishedIds).toEqual([]);
    expect(medianMs).toBeLessThan(5);
  });

  it("1000文のリネーム1件はID変化0で5ms未満", () => {
    const oldSource = buildLargeSource(1000);
    const newSource = oldSource.replace("point P500 = ", "point Q500renamed = ");
    expect(newSource).not.toBe(oldSource);
    const { result, medianMs, elementCount } = timedReconcile(oldSource, newSource);
    expect(result.inheritedCount).toBe(elementCount);
    expect(result.createdIds.size).toBe(0);
    expect(result.vanishedIds).toEqual([]);
    expect(medianMs).toBeLessThan(5);
  });
});
