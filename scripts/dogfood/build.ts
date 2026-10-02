import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildDogfood } from "./dogfood";

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
const isDirectInvocation = process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectInvocation) {
  try {
    const metadata = buildDogfood(process.argv.slice(2));
    console.log(`Dogfood snapshot selected: ${metadata.identity}`);
  } catch (error) {
    console.error(`dogfood:build failed: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}
