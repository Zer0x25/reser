export const TIME_ZONE: "America/Santiago";

export type SantiagoParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function santiagoParts(epochMs: number): SantiagoParts;
export function formatLocalDate(epochMs: number): string;
export function formatLocalTime(epochMs: number): string;
export function formatLocalDateTime(epochMs: number): string;
export function localDateTimeToEpoch(value: string): number;
export function santiagoWeekday(epochMs: number): number;
export function parseLocalDay(date: string): { start: number; end: number };
