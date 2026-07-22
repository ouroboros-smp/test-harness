import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseNamedArtifacts } from "./action-inputs.js";

test("named artifacts parse newline-delimited confined files", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "ouro-harness-artifacts-"));
  try {
    await writeFile(join(workspace, "adapter.jar"), "adapter");
    await writeFile(join(workspace, "rooms.jar"), "rooms");
    assert.deepEqual(
      await parseNamedArtifacts("adapter=adapter.jar\nrooms=rooms.jar\n", workspace),
      [
        { name: "adapter", path: join(workspace, "adapter.jar") },
        { name: "rooms", path: join(workspace, "rooms.jar") },
      ],
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("named artifacts reject invalid names, missing files, escapes, symlink escapes, and duplicates", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "ouro-harness-artifacts-"));
  const outsideDirectory = await mkdtemp(join(tmpdir(), "ouro-harness-artifacts-outside-"));
  const outside = join(outsideDirectory, "outside.jar");
  try {
    await writeFile(join(workspace, "valid.jar"), "valid");
    await writeFile(outside, "outside");
    await mkdir(join(workspace, "links"));
    await symlink(outsideDirectory, join(workspace, "links", "outside"), "junction");
    await assert.rejects(parseNamedArtifacts("Bad=valid.jar", workspace), /Invalid artifact name/);
    await assert.rejects(parseNamedArtifacts("missing=missing.jar", workspace), /must be an existing file/);
    await assert.rejects(parseNamedArtifacts(`escape=${outside}`, workspace), /escapes the workspace/);
    await assert.rejects(parseNamedArtifacts("symlink=links/outside/outside.jar", workspace), /escapes the workspace/);
    await assert.rejects(parseNamedArtifacts("same=valid.jar\nsame=valid.jar", workspace), /Duplicate artifact name/);
  } finally {
    await rm(outsideDirectory, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
});
