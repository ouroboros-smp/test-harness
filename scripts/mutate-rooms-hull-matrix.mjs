import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [databasePath] = process.argv.slice(2);
if (!databasePath) {
  throw new Error("usage: mutate-rooms-hull-matrix.mjs DATABASE");
}

const structureId = "00000060-0000-0000-0000-000000000006";
const roomId = "00000060-0000-0001-0000-00000000000d";
const box = [505, 0, 1, 506, 2, 2];
const cells = [];
for (let x = box[0]; x <= box[3]; x += 1) {
  for (let y = box[1]; y <= box[4]; y += 1) {
    for (let z = box[2]; z <= box[5]; z += 1) cells.push(`${x},${y},${z}`);
  }
}

const database = new DatabaseSync(resolve(databasePath));
try {
  database.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
  const dependency = database.prepare(`
    SELECT COUNT(*) AS count
    FROM structure_hull_dependency_rooms
    WHERE structure_id=? AND room_id=?
  `).get(structureId, roomId);
  const persistedHull = database.prepare(`
    SELECT source_revision AS revision
    FROM structure_hulls WHERE structure_id=?
  `).get(structureId);
  if (dependency?.count !== 1 || persistedHull?.revision !== 1) {
    throw new Error(
      `durable dependency precondition failed: dependency=${dependency?.count}`
      + ` hullRevision=${persistedHull?.revision}`,
    );
  }
  const marker = database.prepare(`
    UPDATE markers SET min_x=?,min_y=?,min_z=?,max_x=?,max_y=?,max_z=?
    WHERE id=?
  `).run(...box, roomId);
  const geometry = database.prepare(`
    UPDATE room_lifecycle_geometry
    SET min_x=?,min_y=?,min_z=?,max_x=?,max_y=?,max_z=?,volume_cells=?
    WHERE room_id=?
  `).run(...box, cells.join(";"), roomId);
  const revision = database.prepare(`
    UPDATE structure_hull_revisions SET revision=revision+1 WHERE structure_id=?
  `).run(structureId);
  if (marker.changes !== 1 || geometry.changes !== 1
      || revision.changes !== 1) {
    throw new Error(
      `mutation precondition failed: marker=${marker.changes} geometry=${geometry.changes}`
      + ` revision=${revision.changes}`,
    );
  }
  database.exec("COMMIT");
  process.stdout.write(`${JSON.stringify({
    structureId,
    roomId,
    durableDependencyVerified: true,
    staleHullRetainedForRevisionFence: true,
    revisionIncremented: true,
  })}\n`);
} catch (error) {
  try {
    database.exec("ROLLBACK");
  } catch {
    // Preserve the primary failure.
  }
  throw error;
} finally {
  database.close();
}
