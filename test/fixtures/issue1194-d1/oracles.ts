// Normative arithmetic only: no compiler, evaluator or runtime imports.
// Array order is authored order; optional absence yields the chosen fallback;
// mapped numeric members add 10; record tags add 10 only in the record map.
export const expectedFor = (stratum: string, [a, b, c]: readonly number[]): Record<string, number> => {
  if (stratum === "A") return { Size0: 3, Pick0: 19, Tag0: 101, ...(c ? { Size1: 2, Pick1: 43, Tag1: 307 } : {}) };
  if (stratum === "B") return { Size: 2, Pick: 23, NoneCheck: 73, OtherPick: 11, ...(a ? { Tag: 47 } : {}) };
  if (stratum === "C") return { Pick: a ? 29 : b ? 39 : 29, Tag: a && b ? 63 : 53 };
  if (stratum === "D") return { X: 9, Y: 12, ...(a ? { Length: 10 } : {}) };
  if (stratum === "E") return { Pick: b ? 61 : 31, Tag: 83, ...(b ? {} : { Size: 3 }) };
  throw new Error(`unknown stratum ${stratum}`);
};
