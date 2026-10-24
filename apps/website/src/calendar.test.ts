import { expect, test } from "vite-plus/test";
import {
  addCalendarDays,
  calendarRanges,
  calendarStartAtFraction,
  isWithinOperatingHours,
  shiftCalendarRange,
  visibleCalendarRange,
  zoomForCalendarRange,
} from "./calendar";

test("calendar day navigation follows calendar dates across month and year boundaries", () => {
  expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
  expect(addCalendarDays("2026-03-01", -1)).toBe("2026-02-28");
});

test("calendar range controls cycle in both directions", () => {
  expect(shiftCalendarRange("total", 1).value).toBe("8");
  expect(shiftCalendarRange("total", -1).value).toBe("4");
  expect(shiftCalendarRange("6", 1).value).toBe("4");
  expect(shiftCalendarRange("6", -1).value).toBe("8");
});

test("calendar range label reflects the closest visible-hour preset", () => {
  expect(visibleCalendarRange(60, 720, false).value).toBe("total");
  expect(visibleCalendarRange(100, 800, true).value).toBe("8");
  expect(visibleCalendarRange(100, 610, true).value).toBe("6");
  expect(visibleCalendarRange(100, 390, true).value).toBe("4");
});

test("calendar zoom fits the full day and bounds manual magnification", () => {
  expect(zoomForCalendarRange(calendarRanges[0], 600, 12, 60)).toBe(50);
  expect(zoomForCalendarRange(calendarRanges[0], 600, 24, 60)).toBe(25);
  expect(zoomForCalendarRange(calendarRanges[1], 100, 12, 60)).toBe(12.5);
  expect(zoomForCalendarRange(calendarRanges[1], 4000, 12, 60)).toBe(300);
});

test("clicking the calendar selects the nearest valid interval within the operating range", () => {
  const minute = 60_000;
  expect(calendarStartAtFraction(0, 10 * minute, minute, 0.26)).toBe(3 * minute);
  expect(calendarStartAtFraction(0, 10 * minute, minute, -1)).toBe(0);
  expect(calendarStartAtFraction(0, 10 * minute, minute, 1)).toBe(9 * minute);
});

test("manual calendar starts use the operating interval supplied by the API", () => {
  const hours = { isOpen: true, startMs: 12_000, endMs: 24_000 };
  expect(isWithinOperatingHours(12_000, hours)).toBe(true);
  expect(isWithinOperatingHours(23_999, hours)).toBe(true);
  expect(isWithinOperatingHours(11_999, hours)).toBe(false);
  expect(isWithinOperatingHours(24_000, hours)).toBe(false);
  expect(isWithinOperatingHours(15_000, { ...hours, isOpen: false })).toBe(false);
});
