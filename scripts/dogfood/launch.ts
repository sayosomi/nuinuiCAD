import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { launchDogfood } from "./dogfood";

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
const isDirectInvocation = process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectInvocation) {
  try {
    process.exitCode = await launchDogfood(process.argv.slice(2));
  } catch (error) {
    console.error(`dogfood:launch failed: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}
