import assert from "node:assert/strict";
import test from "node:test";
import { connectionStateAfterEvent, retainClientStderr } from "./client.js";

test("client connection state follows spawn and server disconnect events", () => {
  assert.equal(connectionStateAfterEvent(false, "spawn"), true);
  assert.equal(connectionStateAfterEvent(true, "message"), true);
  assert.equal(connectionStateAfterEvent(true, "end"), false);
  assert.equal(connectionStateAfterEvent(false, "end"), false);
});

test("packet tracing suppresses only routine packet noise", () => {
  const prefix = "2026-08-02T04:06:08Z DEBUG azalea_client::plugins::packet::game: ";

  assert.equal(retainClientStderr(`${prefix}Got game event packet`, true), false);
  assert.equal(retainClientStderr(`${prefix}Got custom payload packet`, true), true);
  assert.equal(retainClientStderr(`${prefix}Got declare commands packet`, true), true);
  assert.equal(retainClientStderr("WARN connection is unstable", true), true);
  assert.equal(retainClientStderr("thread 'main' panicked at client.rs:1", true), true);
  assert.equal(retainClientStderr(`${prefix}Unexpected packet state`, true), true);
  assert.equal(retainClientStderr(`${prefix}Got game event packet`, false), true);
  assert.equal(retainClientStderr("   ", true), false);
});
