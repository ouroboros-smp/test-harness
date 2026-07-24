import assert from "node:assert/strict";
import test from "node:test";
import { connectionStateAfterEvent } from "./client.js";

test("client connection state follows spawn and server disconnect events", () => {
  assert.equal(connectionStateAfterEvent(false, "spawn"), true);
  assert.equal(connectionStateAfterEvent(true, "message"), true);
  assert.equal(connectionStateAfterEvent(true, "end"), false);
  assert.equal(connectionStateAfterEvent(false, "end"), false);
});
