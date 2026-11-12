import { test } from "node:test";
import assert from "node:assert/strict";
import { planRoute, LOCAL_WORD_LIMIT } from "../src/route.js";

const base = { words: 200, device: "available", online: true, cloudConfigured: true, mask: true };

test("auto: short notes with a ready local model stay on the device", () => {
  const r = planRoute({ ...base, mode: "auto" });
  assert.equal(r.engine, "device");
  assert.equal(r.mask, false);
});

test("auto: long notes go to the cloud, masked, names found on the device", () => {
  const r = planRoute({ ...base, mode: "auto", words: LOCAL_WORD_LIMIT + 1 });
  assert.equal(r.engine, "cloud");
  assert.equal(r.mask, true);
  assert.equal(r.findNamesOnDevice, true);
});

test("auto: no local model means cloud with rule-based masking", () => {
  const r = planRoute({ ...base, mode: "auto", device: "unavailable" });
  assert.deepEqual([r.engine, r.mask, r.findNamesOnDevice], ["cloud", true, false]);
});

test("auto: offline uses the device, even for long notes", () => {
  const r = planRoute({ ...base, mode: "auto", online: false, words: 5000 });
  assert.equal(r.engine, "device-chunks");
});

test("auto: offline without a local model fails with a reason", () => {
  const r = planRoute({ ...base, mode: "auto", online: false, device: "unsupported" });
  assert.equal(r.engine, null);
  assert.match(r.reason, /offline/);
});

test("private never uses the cloud", () => {
  assert.equal(planRoute({ ...base, mode: "private", words: 5000 }).engine, "device-chunks");
  assert.equal(planRoute({ ...base, mode: "private", device: "downloadable" }).engine, null);
});

test("cloud mode respects the masking switch", () => {
  assert.equal(planRoute({ ...base, mode: "cloud", mask: false }).mask, false);
  assert.equal(planRoute({ ...base, mode: "cloud" }).mask, true);
  assert.equal(planRoute({ ...base, mode: "cloud", online: false }).engine, null);
});
