import type { DslArgSpec } from "./dslConstructions";

export type DslSettingsSpec = {
  keyword: "color" | "role" | "view" | "layout" | "print" | "svg" | "place";
  args: DslArgSpec[];
  allowsDynamicArgs?: boolean;
};

const positional = (arg: string): DslArgSpec => ({ arg, positional: true });
const arg = (argName: string, required = false): DslArgSpec => ({
  arg: argName,
  ...(required ? { required: true } : {})
});

const settingsSpecs: DslSettingsSpec[] = [
  { keyword: "color", args: [positional("hex"), arg("name"), arg("default")] },
  { keyword: "role", args: [arg("name")] },
  { keyword: "view", args: [arg("default")], allowsDynamicArgs: true },
  { keyword: "layout", args: [arg("scale")] },
  { keyword: "print", args: [arg("layout", true), arg("profile"), arg("paper", true), arg("orientation"), arg("overlap", true)] },
  { keyword: "svg", args: [arg("layout", true), arg("profile"), arg("margin")] },
  { keyword: "place", args: [positional("group"), arg("origin"), arg("at", true), arg("scale"), arg("angle"), arg("mirror")] },
];

const specsByKeyword = new Map(settingsSpecs.map((spec) => [spec.keyword, spec]));

export const settingsSpecFor = (keyword: string): DslSettingsSpec | null =>
  specsByKeyword.get(keyword as DslSettingsSpec["keyword"]) ?? null;
