import { readFile } from "node:fs/promises";

const requiredWorkspaces = ["apps/*", "packages/*"];
const requiredScripts = ["test", "typecheck", "lint", "format:check", "build"];

async function main() {
  let manifest;

  try {
    manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
  } catch (error) {
    console.error("source/package.json is missing or invalid");
    process.exitCode = 1;
    return;
  }

  const missingWorkspaces = requiredWorkspaces.filter(
    (workspace) => !manifest.workspaces?.includes(workspace),
  );
  const missingScripts = requiredScripts.filter(
    (script) => !manifest.scripts?.[script],
  );

  if (missingWorkspaces.length || missingScripts.length) {
    console.error(JSON.stringify({ missingWorkspaces, missingScripts }, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log("workspace manifest is valid");
}

await main();
