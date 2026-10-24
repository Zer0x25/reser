import { localDateTimeToEpoch } from "../domain.mjs";

export const date = "2027-01-08";

export const settings = {
  preparationMinutes: 10,
  closingMarginMinutes: 30,
  startIntervalMinutes: 10,
  minimumAdvanceMinutes: 0,
  allowImmediateWeb: true,
  generalRateClpPerLaneHour: 12_000,
  rateBands: [],
  rateExceptions: {},
  promotions: [],
  weeklyHours: Object.fromEntries(
    Array.from({ length: 7 }, (_, weekday) => [String(weekday), { open: "16:00", close: "23:00" }]),
  ),
  exceptions: {},
};

export const reservations = [
  {
    id: "fixture-confirmed-pair",
    lanes: [1, 2],
    startMs: localDateTimeToEpoch(`${date}T18:00`),
    endMs: localDateTimeToEpoch(`${date}T20:00`),
    preparationMinutes: settings.preparationMinutes,
  },
  {
    id: "fixture-confirmed-late-pair",
    lanes: [5, 6],
    startMs: localDateTimeToEpoch(`${date}T20:00`),
    endMs: localDateTimeToEpoch(`${date}T21:00`),
    preparationMinutes: settings.preparationMinutes,
  },
  {
    id: "fixture-confirmed-single",
    lanes: [9],
    startMs: localDateTimeToEpoch(`${date}T16:00`),
    endMs: localDateTimeToEpoch(`${date}T19:00`),
    preparationMinutes: settings.preparationMinutes,
  },
];

export const blocks = [
  {
    laneId: 12,
    startMs: localDateTimeToEpoch(`${date}T19:00`),
    endMs: localDateTimeToEpoch(`${date}T21:00`),
  },
];

export const demand = [
  { id: "large-36-a", players: 36, durationMinutes: 180, preferredTime: "18:00" },
  { id: "large-36-b", players: 36, durationMinutes: 180, preferredTime: "18:00" },
  { id: "large-30", players: 30, durationMinutes: 180, preferredTime: "18:00" },
  { id: "large-24", players: 24, durationMinutes: 180, preferredTime: "18:00" },
  { id: "group-18", players: 18, durationMinutes: 120, preferredTime: "18:00" },
  { id: "group-13-a", players: 13, durationMinutes: 120, preferredTime: "19:00" },
  { id: "group-13-b", players: 13, durationMinutes: 120, preferredTime: "19:00" },
  { id: "group-12", players: 12, durationMinutes: 120, preferredTime: "20:00" },
  { id: "group-7", players: 7, durationMinutes: 120, preferredTime: "20:00" },
  { id: "solo-6-a", players: 6, durationMinutes: 120, preferredTime: "21:00" },
  { id: "solo-6-b", players: 6, durationMinutes: 120, preferredTime: "21:00" },
  { id: "solo-4", players: 4, durationMinutes: 60, preferredTime: "21:00" },
];
