import type { DslArgSpec } from "./dslConstructions";

export type DslSettingsSpec = {
  keyword: "color" | "role" | "view" | "printLayout" | "place";
  args: DslArgSpec[];
  allowsDynamicArgs?: boolean;
};

const positional = (arg: string): DslArgSpec => ({ arg, positional: true });
const arg = (argName: string): DslArgSpec => ({ arg: argName });

const settingsSpecs: DslSettingsSpec[] = [
  { keyword: "color", args: [positional("hex"), arg("name"), arg("default")] },
  { keyword: "role", args: [arg("name")] },
  { keyword: "view", args: [arg("default")], allowsDynamicArgs: true },
  {
    keyword: "printLayout",
    args: [arg("output"), arg("view"), arg("paper"), arg("orientation"), arg("columns"), arg("rows"), arg("overlap"), arg("scale"), arg("canvas")],
  },
  { keyword: "place", args: [positional("group"), arg("at"), arg("angle"), arg("mirrorX")] },
];

const specsByKeyword = new Map(settingsSpecs.map((spec) => [spec.keyword, spec]));

export const settingsSpecFor = (keyword: string): DslSettingsSpec | null =>
  specsByKeyword.get(keyword as DslSettingsSpec["keyword"]) ?? null;
