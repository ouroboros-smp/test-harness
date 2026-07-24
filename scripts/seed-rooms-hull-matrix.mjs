import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [databasePath] = process.argv.slice(2);
if (!databasePath) {
  throw new Error("usage: seed-rooms-hull-matrix.mjs DATABASE");
}

const world = "minecraft:overworld";
const structures = [
  {
    id: "00000060-0000-0000-0000-000000000001",
    name: "hull-straight",
    rooms: [{ id: 1, member: true, box: [0, 0, 0, 8, 2, 4] }],
  },
  {
    id: "00000060-0000-0000-0000-000000000002",
    name: "hull-l",
    rooms: [
      { id: 2, member: true, box: [100, 0, 0, 110, 2, 2] },
      { id: 3, member: true, box: [100, 0, 3, 102, 2, 10] },
    ],
  },
  {
    id: "00000060-0000-0000-0000-000000000003",
    name: "hull-attic",
    rooms: [
      { id: 4, member: true, box: [200, 0, 0, 204, 2, 4] },
      { id: 5, member: false, box: [200, 4, 0, 204, 6, 4] },
    ],
  },
  {
    id: "00000060-0000-0000-0000-000000000004",
    name: "hull-courtyard",
    rooms: [
      { id: 6, member: true, box: [300, 0, 0, 310, 2, 2] },
      { id: 7, member: true, box: [300, 0, 8, 310, 2, 10] },
      { id: 8, member: true, box: [300, 0, 3, 302, 2, 7] },
      { id: 9, member: true, box: [308, 0, 3, 310, 2, 7] },
    ],
  },
  {
    id: "00000060-0000-0000-0000-000000000005",
    name: "hull-attached",
    rooms: [
      { id: 10, member: true, box: [400, 0, 0, 404, 2, 4] },
      { id: 11, member: true, box: [410, 0, 0, 414, 2, 4] },
    ],
  },
  {
    id: "00000060-0000-0000-0000-000000000006",
    name: "hull-hallway",
    rooms: [
      { id: 12, member: true, box: [500, 0, 0, 504, 2, 4] },
      { id: 13, member: false, box: [505, 0, 1, 510, 2, 2] },
      { id: 14, member: true, box: [511, 0, 0, 515, 2, 4] },
      { id: 15, member: false, box: [516, 0, 1, 531, 2, 2] },
    ],
  },
];

function roomId(id) {
  return `00000060-0000-0001-0000-${id.toString(16).padStart(12, "0")}`;
}

function cells(box) {
  const [minX, minY, minZ, maxX, maxY, maxZ] = box;
  const values = [];
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        values.push(`${x},${y},${z}`);
      }
    }
  }
  return values.join(";");
}

const database = new DatabaseSync(resolve(databasePath));
try {
  database.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
  const insertStructure = database.prepare(
    "INSERT INTO structures(id,world,name) VALUES(?,?,?)",
  );
  const insertRevision = database.prepare(
    "INSERT INTO structure_hull_revisions(structure_id,revision) VALUES(?,1)",
  );
  const insertMarker = database.prepare(`
    INSERT INTO markers(
      id,world,min_x,min_y,min_z,max_x,max_y,max_z,
      origin_x,origin_y,origin_z,created_at_ms
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const insertRoom = database.prepare(
    "INSERT INTO rooms(room_id,status,last_presence_ms) VALUES(?,'UNDEFINED',?)",
  );
  const insertGeometry = database.prepare(`
    INSERT INTO room_lifecycle_geometry(
      room_id,min_x,min_y,min_z,max_x,max_y,max_z,shell_cells,volume_cells
    ) VALUES(?,?,?,?,?,?,?,?,?)
  `);
  const insertMember = database.prepare(
    "INSERT INTO structure_members(room_id,structure_id) VALUES(?,?)",
  );
  let createdAt = Date.now();
  for (const structure of structures) {
    insertStructure.run(structure.id, world, structure.name);
    insertRevision.run(structure.id);
    for (const room of structure.rooms) {
      const id = roomId(room.id);
      const [minX, minY, minZ, maxX, maxY, maxZ] = room.box;
      insertMarker.run(
        id, world, minX, minY, minZ, maxX, maxY, maxZ,
        minX, minY, minZ, createdAt,
      );
      insertRoom.run(id, createdAt);
      insertGeometry.run(
        id, minX, minY, minZ, maxX, maxY, maxZ, "", cells(room.box),
      );
      if (room.member) insertMember.run(id, structure.id);
      createdAt += 1;
    }
  }
  database.exec("COMMIT");
  process.stdout.write(`${JSON.stringify({
    structures: structures.map(({ id, name }) => ({ id, name })),
    rooms: structures.reduce((sum, structure) => sum + structure.rooms.length, 0),
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
