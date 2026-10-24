import test from "node:test";
import assert from "node:assert/strict";
import {
  formatLocalDate,
  formatLocalDateTime,
  formatLocalTime,
  localDateTimeToEpoch,
  parseLocalDay,
  santiagoWeekday,
} from "./time.mjs";

test("local date and time formatting round-trip in the venue timezone", () => {
  const epoch = localDateTimeToEpoch("2026-06-15T18:10");
  assert.equal(formatLocalDate(epoch), "2026-06-15");
  assert.equal(formatLocalTime(epoch), "18:10");
  assert.equal(formatLocalDateTime(epoch), "2026-06-15T18:10");
  assert.equal(santiagoWeekday(epoch), 1);
});

test("local timestamp parsing rejects invalid dates, formats, and daylight-saving gaps", () => {
  assert.throws(() => localDateTimeToEpoch("2026-02-30T18:10"), /hora local no existe|inválidas/);
  assert.throws(() => localDateTimeToEpoch("2026-06-15 18:10"), /Fecha y hora inválidas/);
  assert.throws(() => localDateTimeToEpoch("2026-09-06T00:30"), /hora local no existe/);
  assert.throws(() => parseLocalDay("2026-02-30"), /Fecha inválida/);
});

test("a repeated daylight-saving hour maps consistently to the earlier instant", () => {
  const first = localDateTimeToEpoch("2026-04-04T23:30");
  const second = first + 60 * 60_000;
  assert.equal(formatLocalDateTime(first), "2026-04-04T23:30");
  assert.equal(formatLocalDateTime(second), "2026-04-04T23:30");
  assert.equal(localDateTimeToEpoch("2026-04-04T23:30"), first);
});

test("venue-day boundaries account for 23-hour and 25-hour DST days", () => {
  const shortDay = parseLocalDay("2026-09-06");
  const longDay = parseLocalDay("2026-04-04");
  assert.equal(shortDay.end - shortDay.start, 23 * 60 * 60_000);
  assert.equal(longDay.end - longDay.start, 25 * 60 * 60_000);
});
