import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [databasePath, structureId] = process.argv.slice(2);
if (!databasePath || !structureId) {
  throw new Error("usage: corrupt-rooms-hull.mjs DATABASE STRUCTURE_ID");
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(structureId)) {
  throw new Error("structure id must be a canonical lowercase UUID");
}

const database = new DatabaseSync(resolve(databasePath));
try {
  const result = database.prepare(
    "UPDATE structure_hulls SET payload = ? WHERE structure_id = ?",
  ).run(Buffer.from([0, 1, 2]), structureId);
  if (result.changes !== 1) {
    throw new Error(`expected one hull row, changed ${result.changes}`);
  }
} finally {
  database.close();
}
