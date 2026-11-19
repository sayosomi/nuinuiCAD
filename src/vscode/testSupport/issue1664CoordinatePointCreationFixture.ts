export type Issue1664CoordinatePointCreationCase = {
  rootUri: string;
  documentVersion: number;
  source: string;
  sourceAnchor: { line: number; character: number };
};

const rootUri = "file:///workspace/module_test.nui";

export const issue1664CoordinatePointCreationCases = {
  A: {
    rootUri,
    documentVersion: 1,
    source: "nui 1\npoint A = coordinate(x: 0, y: 0)\n",
    sourceAnchor: { line: 2, character: 0 }
  },
  C: {
    rootUri,
    documentVersion: 1,
    source: "nui 1\n\nmodule Sample() {\n}\n\ninstance S = Sample()\n\npoint A = coordinate(x: 0, y: 0)\n",
    sourceAnchor: { line: 8, character: 0 }
  }
} satisfies Record<"A" | "C", Issue1664CoordinatePointCreationCase>;
