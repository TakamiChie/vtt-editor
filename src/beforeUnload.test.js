import test from "node:test";
import assert from "node:assert/strict";
import { shouldBlockPageLeave } from "./beforeUnload.js";

test("キューが0件のときはページ離脱警告を出さない", () => {
  assert.equal(shouldBlockPageLeave(0), false);
});

test("キューが1件以上のときはページ離脱警告を出す", () => {
  assert.equal(shouldBlockPageLeave(1), true);
  assert.equal(shouldBlockPageLeave(10), true);
});
