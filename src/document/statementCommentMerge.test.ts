import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { SerializedStatement } from "../dsl/dslSerializeElement";
import { mergeStatementComments } from "./statementCommentMerge";

const callStatement = (header: string, args: Array<[string, string]>, close: ")" | null = ")"): SerializedStatement => ({
  header,
  args: args.map(([key, text]) => ({ key, text })),
  close,
});

const argLineMap = (entries: Array<[string, number]>): ReadonlyMap<string, number> => new Map(entries);

describe("mergeStatementComments: call -> call", () => {
  it("引数のEOLコメントを維持する", () => {
    const oldLines = [
      "point P = offset(",
      "  from: A  # start",
      "  dx: 0",
      ")",
    ];
    const next = callStatement("point P = offset(", [["from", "from: A"], ["dx", "dx: 0"]]);
    const result = mergeStatementComments({
      oldLines,
      oldArgLineByKey: argLineMap([["from", 1], ["dx", 2]]),
      next,
      indent: "",
    });
    expect(result).toEqual(oldLines);
  });

  it("引数間の全行コメントを直後のキーの前に維持する", () => {
    const oldLines = [
      "point P = offset(",
      "  from: A",
      "  # note about dx",
      "  dx: 0",
      ")",
    ];
    const next = callStatement("point P = offset(", [["from", "from: A"], ["dx", "dx: 0"]]);
    const result = mergeStatementComments({
      oldLines,
      oldArgLineByKey: argLineMap([["from", 1], ["dx", 3]]),
      next,
      indent: "",
    });
    expect(result).toEqual(oldLines);
  });

  it("ヘッダ行のEOLコメントを維持する", () => {
    const oldLines = [
      "point P = offset(  # header note",
      "  from: A",
      ")",
    ];
    const next = callStatement("point P = offset(", [["from", "from: A"]]);
    const result = mergeStatementComments({
      oldLines,
      oldArgLineByKey: argLineMap([["from", 1]]),
      next,
      indent: "",
    });
    expect(result).toEqual(oldLines);
  });

  it("閉じ行のEOLコメントを維持する", () => {
    const oldLines = [
      "point P = offset(",
      "  from: A",
      ")  # done",
    ];
    const next = callStatement("point P = offset(", [["from", "from: A"]]);
    const result = mergeStatementComments({
      oldLines,
      oldArgLineByKey: argLineMap([["from", 1]]),
      next,
      indent: "",
    });
    expect(result).toEqual(oldLines);
  });

  it("`)`直前の、どのキーにも属さない全行コメントを維持する(冪等性回帰)", () => {
    const oldLines = [
      "point P = offset(",
      "  from: A",
      "  # trailing note",
      ")",
    ];
    const next = callStatement("point P = offset(", [["from", "from: A"]]);
    const result = mergeStatementComments({
      oldLines,
      oldArgLineByKey: argLineMap([["from", 1]]),
      next,
      indent: "",
    });
    expect(result).toEqual(oldLines);
  });

  it("消えたキーの先頭全行コメント群を`)`の前へ退避する", () => {
    const oldLines = [
      "point P = offset(",
      "  from: A",
      "  # deprecated",
      "  dz: 1",
      "  dy: 2",
      ")",
    ];
    const next = callStatement("point P = offset(", [["from", "from: A"], ["dy", "dy: 2"]]);
    const result = mergeStatementComments({
      oldLines,
      oldArgLineByKey: argLineMap([["from", 1], ["dz", 3], ["dy", 4]]),
      next,
      indent: "",
    });
    expect(result).toEqual([
      "point P = offset(",
      "  from: A",
      "  dy: 2",
      "  # deprecated",
      ")",
    ]);
  });

  it("消えたキーのEOLコメントを全行コメント化して`)`の前へ退避する(捨てない)", () => {
    const oldLines = [
      "point P = offset(",
      "  from: A",
      "  dz: 1  # old eol",
      "  dy: 2",
      ")",
    ];
    const next = callStatement("point P = offset(", [["from", "from: A"], ["dy", "dy: 2"]]);
    const result = mergeStatementComments({
      oldLines,
      oldArgLineByKey: argLineMap([["from", 1], ["dz", 2], ["dy", 3]]),
      next,
      indent: "",
    });
    expect(result).toEqual([
      "point P = offset(",
      "  from: A",
      "  dy: 2",
      "  # old eol",
      ")",
    ]);
  });

  it("複数の削除キーの相対順序を保つ", () => {
    const oldLines = [
      "point P = offset(",
      "  a: 1  # a-eol",
      "  b: 2  # b-eol",
      "  from: A",
      ")",
    ];
    const next = callStatement("point P = offset(", [["from", "from: A"]]);
    const result = mergeStatementComments({
      oldLines,
      oldArgLineByKey: argLineMap([["a", 1], ["b", 2], ["from", 3]]),
      next,
      indent: "",
    });
    expect(result).toEqual([
      "point P = offset(",
      "  from: A",
      "  # a-eol",
      "  # b-eol",
      ")",
    ]);
  });

  it("引数の並び替えを跨いでキーごとに再付着する", () => {
    const oldLines = [
      "point P = offset(",
      "  # about dx",
      "  dx: 0  # dx-eol",
      "  dy: 1",
      ")",
    ];
    // next の並び順は dy, dx (旧と逆順)
    const next = callStatement("point P = offset(", [["dy", "dy: 1"], ["dx", "dx: 0"]]);
    const result = mergeStatementComments({
      oldLines,
      oldArgLineByKey: argLineMap([["dx", 2], ["dy", 3]]),
      next,
      indent: "",
    });
    expect(result).toEqual([
      "point P = offset(",
      "  dy: 1",
      "  # about dx",
      "  dx: 0  # dx-eol",
      ")",
    ]);
  });

  it("旧に存在しない新規キーにはコメントが付かない", () => {
    const oldLines = [
      "point P = offset(",
      "  from: A  # keep",
      ")",
    ];
    const next = callStatement("point P = offset(", [["from", "from: A"], ["dx", "dx: 5"]]);
    const result = mergeStatementComments({
      oldLines,
      oldArgLineByKey: argLineMap([["from", 1]]),
      next,
      indent: "",
    });
    expect(result).toEqual([
      "point P = offset(",
      "  from: A  # keep",
      "  dx: 5",
      ")",
    ]);
  });

  it("旧===新(無変更)なら完全に冪等", () => {
    const oldLines = [
      "point P = offset(",
      "  from: A  # a",
      "  # b",
      "  dx: 0",
      ")",
    ];
    const next = callStatement("point P = offset(", [["from", "from: A"], ["dx", "dx: 0"]]);
    const oldArgLineByKey = argLineMap([["from", 1], ["dx", 3]]);
    const first = mergeStatementComments({ oldLines, oldArgLineByKey, next, indent: "" });
    expect(first).toEqual(oldLines);
    const second = mergeStatementComments({ oldLines: first, oldArgLineByKey, next, indent: "" });
    expect(second).toEqual(first);
  });

  it("コメントが無い文書は新しい行群にインデントを付けただけの状態で素通りする", () => {
    const oldLines = [
      "point P = offset(",
      "  from: A",
      ")",
    ];
    const next = callStatement("point P = offset(", [["from", "from: A"], ["dx", "dx: 0"]]);
    const result = mergeStatementComments({
      oldLines,
      oldArgLineByKey: argLineMap([["from", 1]]),
      next,
      indent: "",
    });
    expect(result).toEqual([
      "point P = offset(",
      "  from: A",
      "  dx: 0",
      ")",
    ]);
  });

  it("引用文字列内の`#`をコメントとして誤認しない", () => {
    const oldLines = [
      "text T = label(",
      "  text: \"a # not a comment\"  # real comment",
      ")",
    ];
    const next = callStatement("text T = label(", [["text", "text: \"a # not a comment\""]]);
    const result = mergeStatementComments({
      oldLines,
      oldArgLineByKey: argLineMap([["text", 1]]),
      next,
      indent: "",
    });
    expect(result).toEqual(oldLines);
  });

  it("depth>0でインデントを正しく適用する", () => {
    const oldLines = [
      "    point P = offset(",
      "      from: A  # keep",
      "    )",
    ];
    const next = callStatement("point P = offset(", [["from", "from: A"]]);
    const result = mergeStatementComments({
      oldLines,
      oldArgLineByKey: argLineMap([["from", 1]]),
      next,
      indent: "    ",
    });
    expect(result).toEqual(oldLines);
  });
});

describe("mergeStatementComments: 旧が1行statement -> 新が縦型", () => {
  it("唯一のEOLコメントを新ヘッダ行にのみ付与する", () => {
    const oldLines = ["point P = offset(from: A, dx: 0)  # only comment"];
    const next = callStatement("point P = offset(", [["from", "from: A"], ["dx", "dx: 0"]]);
    const result = mergeStatementComments({
      oldLines,
      oldArgLineByKey: argLineMap([["from", 0], ["dx", 0]]),
      next,
      indent: "",
    });
    expect(result).toEqual([
      "point P = offset(  # only comment",
      "  from: A",
      "  dx: 0",
      ")",
    ]);
  });

  it("旧にコメントが無ければ引数・閉じ行もコメント無しで生成する", () => {
    const oldLines = ["point P = offset(from: A)"];
    const next = callStatement("point P = offset(", [["from", "from: A"]]);
    const result = mergeStatementComments({
      oldLines,
      oldArgLineByKey: argLineMap([["from", 0]]),
      next,
      indent: "",
    });
    expect(result).toEqual([
      "point P = offset(",
      "  from: A",
      ")",
    ]);
  });
});

describe("mergeStatementComments: 縦型 -> 短形式(next.close === null)", () => {
  it("旧の全行コメントを先頭行群として持ち上げる", () => {
    const oldLines = [
      "const x: number = expression(",
      "  # about value",
      "  value: 5",
      ")",
    ];
    const next: SerializedStatement = { header: "const x: number = 5", args: [], close: null };
    const result = mergeStatementComments({
      oldLines,
      oldArgLineByKey: argLineMap([["value", 2]]),
      next,
      indent: "",
    });
    expect(result).toEqual([
      "# about value",
      "const x: number = 5",
    ]);
  });

  it("旧の全EOLコメントを1本のEOLへ連結する(文書順)", () => {
    const oldLines = [
      "const x: number = expression(  # h",
      "  value: 5  # v",
      ")  # c",
    ];
    const next: SerializedStatement = { header: "const x: number = 5", args: [], close: null };
    const result = mergeStatementComments({
      oldLines,
      oldArgLineByKey: argLineMap([["value", 1]]),
      next,
      indent: "",
    });
    expect(result).toEqual(["const x: number = 5  # h  # v  # c"]);
  });

  it("旧が既に1行だった場合も二重カウントしない", () => {
    const oldLines = ["const x: number = 5  # only"];
    const next: SerializedStatement = { header: "const x: number = 6", args: [], close: null };
    const result = mergeStatementComments({
      oldLines,
      oldArgLineByKey: argLineMap([]),
      next,
      indent: "",
    });
    expect(result).toEqual(["const x: number = 6  # only"]);
  });

  it("depth>0でインデントを正しく適用する", () => {
    const oldLines = [
      "  const x: number = expression(",
      "    value: 5  # v",
      "  )",
    ];
    const next: SerializedStatement = { header: "const x: number = 6", args: [], close: null };
    const result = mergeStatementComments({
      oldLines,
      oldArgLineByKey: argLineMap([["value", 1]]),
      next,
      indent: "  ",
    });
    expect(result).toEqual(["  const x: number = 6  # v"]);
  });
});

describe("mergeStatementComments: 冪等性プロパティ", () => {
  it("next が oldLines を素直に再現する入力なら出力はoldLinesとバイト同一", () => {
    const keyArb = fc.constantFrom("a", "b", "c", "d");
    const rowArb = fc.record({
      key: keyArb,
      hasLeadingComment: fc.boolean(),
      hasEol: fc.boolean(),
    });

    fc.assert(
      fc.property(
        fc.uniqueArray(rowArb, { minLength: 1, maxLength: 4, selector: (row) => row.key }),
        fc.boolean(),
        (rows, closeHasEol) => {
          const oldLines: string[] = ["point P = offset("];
          const oldArgLineByKey = new Map<string, number>();
          for (const row of rows) {
            if (row.hasLeadingComment) oldLines.push(`  # note-${row.key}`);
            oldArgLineByKey.set(row.key, oldLines.length);
            oldLines.push(`  ${row.key}: 0${row.hasEol ? `  # eol-${row.key}` : ""}`);
          }
          oldLines.push(closeHasEol ? ")  # close-eol" : ")");

          const next = callStatement(
            "point P = offset(",
            rows.map((row) => [row.key, `${row.key}: 0`]),
          );

          const result = mergeStatementComments({ oldLines, oldArgLineByKey, next, indent: "" });
          expect(result).toEqual(oldLines);

          // 2回目の実行でも同じ結果(真の冪等性)。
          const second = mergeStatementComments({ oldLines: result, oldArgLineByKey, next, indent: "" });
          expect(second).toEqual(result);
        },
      ),
      { seed: 20260717, numRuns: 50 },
    );
  });
});
