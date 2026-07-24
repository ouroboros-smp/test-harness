import assert from "node:assert/strict";
import test from "node:test";
import { errorMessage, HarnessError } from "./errors.js";

test("HarnessError messages retain structured bridge details", () => {
  const message = errorMessage(new HarnessError("BRIDGE_ERROR", "request failed", {
    error: "bad_request",
    message: "unknown Coffer lock type: combination",
  }));
  assert.match(message, /request failed/);
  assert.match(message, /unknown Coffer lock type: combination/);
});
