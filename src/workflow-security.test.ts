import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { repositoryRoot } from "./manifest.js";

test("persistent self-hosted workflows never execute pull request definitions", async () => {
  const workflowDirectory = join(repositoryRoot(), ".github", "workflows");
  const names = (await readdir(workflowDirectory))
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));

  for (const name of names) {
    const source = await readFile(join(workflowDirectory, name), "utf8");
    if (!/runs-on:\s*\[self-hosted,/u.test(source)) continue;

    const workflow = parse(source) as { on?: unknown };
    const events = workflow.on;
    if (!events || typeof events !== "object" || Array.isArray(events)) continue;
    assert.equal(
      Object.hasOwn(events, "pull_request"),
      false,
      `${name} must not run fork-controlled pull_request code on a persistent self-hosted runner`,
    );
    assert.equal(
      Object.hasOwn(events, "pull_request_target"),
      false,
      `${name} must not run pull_request_target code on a persistent self-hosted runner`,
    );
  }
});
