export const calendarRanges = [
  { value: "total", label: "Total", hours: null },
  { value: "8", label: "8 h", hours: 8 },
  { value: "6", label: "6 h", hours: 6 },
  { value: "4", label: "4 h", hours: 4 },
] as const;

export type CalendarRange = (typeof calendarRanges)[number];
export type CalendarRangeValue = CalendarRange["value"];
export type OperatingHours = { isOpen: boolean; startMs: number; endMs: number };

export function isWithinOperatingHours(startMs: number, hours: OperatingHours) {
  return hours.isOpen && startMs >= hours.startMs && startMs < hours.endMs;
}

export function addCalendarDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function shiftCalendarRange(value: CalendarRangeValue, step: number): CalendarRange {
  const currentIndex = calendarRanges.findIndex((range) => range.value === value);
  const index = (Math.max(0, currentIndex) + step + calendarRanges.length) % calendarRanges.length;
  return calendarRanges[index];
}

export function visibleCalendarRange(
  zoomPx: number,
  viewportWidth: number,
  customized: boolean,
): CalendarRange {
  if (!customized) return calendarRanges[0];
  const visibleHours = viewportWidth / zoomPx;
  return calendarRanges.slice(1).reduce((closest, range) => {
    if (
      Math.abs(visibleHours - Number(range.hours)) < Math.abs(visibleHours - Number(closest.hours))
    )
      return range;
    return closest;
  }, calendarRanges[1]);
}

export function zoomForCalendarRange(
  range: CalendarRange,
  viewportWidth: number,
  durationHours: number,
  defaultZoomPx: number,
) {
  if (range.value === "total")
    return Math.max(12, Math.min(defaultZoomPx, viewportWidth / durationHours));
  return Math.max(12, Math.min(300, viewportWidth / Number(range.hours)));
}

export function calendarStartAtFraction(
  axisStartMs: number,
  axisEndMs: number,
  intervalMs: number,
  fraction: number,
) {
  const normalizedFraction = Math.max(0, Math.min(1, fraction));
  const offset =
    Math.round(((axisEndMs - axisStartMs) * normalizedFraction) / intervalMs) * intervalMs;
  return Math.max(axisStartMs, Math.min(axisEndMs - intervalMs, axisStartMs + offset));
}
