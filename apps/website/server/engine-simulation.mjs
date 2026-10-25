import {
  chooseClosest,
  chooseFirstAvailable,
  findAlternatives,
  localDateTimeToEpoch,
} from "./domain.mjs";

const scenarioLimit = 1_000;
const capacityProfiles = [
  { key: "3 pistas · 1 h", players: 18, durationMinutes: 60 },
  { key: "2 pistas · 1 h", players: 12, durationMinutes: 60 },
  { key: "1 pista · 2 h", players: 6, durationMinutes: 120 },
  { key: "1 pista · 1 h", players: 4, durationMinutes: 60 },
];

function comparePreservation(a, b) {
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return b[index] - a[index];
  }
  return 0;
}

function chooseEngineOption(options) {
  return (
    [...options].sort(
      (a, b) =>
        comparePreservation(a.preservationScore, b.preservationScore) ||
        b.quote.totalClp - a.quote.totalClp ||
        a.distanceMinutes - b.distanceMinutes ||
        a.startMs - b.startMs,
    )[0] ?? null
  );
}

function dayWindow(date, settings) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const rule = settings.exceptions?.[date] ?? settings.weeklyHours[String(weekday)];
  if (!rule || rule.closed || !rule.open || !rule.close) return null;
  const openMs = localDateTimeToEpoch(`${date}T${rule.open}`);
  let closeMs = localDateTimeToEpoch(`${date}T${rule.close}`);
  if (closeMs <= openMs) {
    const [year, month, day] = date.split("-").map(Number);
    const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
    const nextDate = `${nextDay.getUTCFullYear()}-${String(nextDay.getUTCMonth() + 1).padStart(2, "0")}-${String(nextDay.getUTCDate()).padStart(2, "0")}`;
    closeMs = localDateTimeToEpoch(`${nextDate}T${rule.close}`);
  }
  return { openMs, closeMs };
}

function compactnessCost(option, reservations, blocks, settings, window) {
  const preparationMs = settings.preparationMinutes * 60_000;
  const occupiedEnd = option.endMs + preparationMs;
  let cost = 0;

  for (const lane of option.lanes) {
    const intervals = [
      ...reservations
        .filter((reservation) => reservation.lanes.includes(lane))
        .map((reservation) => ({
          startMs: reservation.startMs,
          endMs: reservation.endMs + reservation.preparationMinutes * 60_000,
        })),
      ...blocks
        .filter((block) => block.laneId === null || block.laneId === lane)
        .map((block) => ({ startMs: block.startMs, endMs: block.endMs })),
    ];
    const previous = intervals
      .filter((interval) => interval.endMs <= option.startMs)
      .sort((a, b) => b.endMs - a.endMs)[0];
    const next = intervals
      .filter((interval) => interval.startMs >= occupiedEnd)
      .sort((a, b) => a.startMs - b.startMs)[0];
    const leftGap = Math.max(0, option.startMs - (previous?.endMs ?? window.openMs));
    const rightGap = Math.max(0, (next?.startMs ?? window.closeMs) - occupiedEnd);
    cost += Math.min(leftGap, rightGap);
  }
  return cost;
}

function chooseCompactAlternative(options, reservations, blocks, settings, window) {
  return (
    [...options].sort(
      (a, b) =>
        compactnessCost(a, reservations, blocks, settings, window) -
          compactnessCost(b, reservations, blocks, settings, window) ||
        a.distanceMinutes - b.distanceMinutes ||
        comparePreservation(a.preservationScore, b.preservationScore) ||
        b.quote.totalClp - a.quote.totalClp ||
        a.startMs - b.startMs,
    )[0] ?? null
  );
}

function runPolicy({ policy, date, settings, reservations, blocks, demand }) {
  const scheduled = [...reservations];
  const accepted = [];
  const rejected = [];
  const window = dayWindow(date, settings);
  if (!window) throw new Error(`La jornada ${date} no tiene horario de atención configurado.`);

  for (const request of demand) {
    const options = findAlternatives({
      date,
      preferredTime: request.preferredTime,
      players: request.players,
      durationMinutes: request.durationMinutes,
      acceptSeparated: request.acceptSeparated ?? false,
      reservations: scheduled,
      blocks,
      settings,
      limit: scenarioLimit,
    });
    const preferredStartMs = localDateTimeToEpoch(`${date}T${request.preferredTime}`);
    const selection =
      policy === "engine"
        ? chooseEngineOption(options)
        : policy === "first_available"
          ? chooseFirstAvailable(options)
          : policy === "nearest"
            ? chooseClosest(options, preferredStartMs)
            : chooseCompactAlternative(options, scheduled, blocks, settings, window);

    if (!selection) {
      rejected.push({
        id: request.id,
        players: request.players,
        durationMinutes: request.durationMinutes,
      });
      continue;
    }

    accepted.push({
      id: request.id,
      players: request.players,
      durationMinutes: request.durationMinutes,
      preferredTime: request.preferredTime,
      startMs: selection.startMs,
      endMs: selection.endMs,
      lanes: [...selection.lanes],
      laneCount: selection.laneCount,
      quoteClp: selection.quote.totalClp,
      distanceMinutes: selection.distanceMinutes,
      preservationScore: [...selection.preservationScore],
    });
    scheduled.push({
      id: `simulation-${policy}-${request.id}`,
      lanes: [...selection.lanes],
      startMs: selection.startMs,
      endMs: selection.endMs,
      preparationMinutes: settings.preparationMinutes,
    });
  }

  const laneHoursSold = accepted.reduce(
    (sum, booking) => sum + ((booking.endMs - booking.startMs) / 3_600_000) * booking.laneCount,
    0,
  );
  const revenueClp = accepted.reduce((sum, booking) => sum + booking.quoteClp, 0);
  const averageDeviationMinutes = accepted.length
    ? Math.round(
        accepted.reduce((sum, booking) => sum + booking.distanceMinutes, 0) / accepted.length,
      )
    : 0;

  return {
    policy,
    acceptedRequests: accepted.length,
    rejectedRequests: rejected,
    laneHoursSold,
    revenueClp,
    averageDeviationMinutes,
    accepted,
    remainingCapacity: measureRemainingCapacity({
      date,
      settings,
      reservations: scheduled,
      blocks,
    }),
  };
}

function measureRemainingCapacity({ date, settings, reservations, blocks }) {
  return Object.fromEntries(
    capacityProfiles.map((profile) => {
      const booked = [...reservations];
      let sessions = 0;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const alternatives = findAlternatives({
          date,
          preferredTime: "00:00",
          players: profile.players,
          durationMinutes: profile.durationMinutes,
          reservations: booked,
          blocks,
          settings,
          limit: scenarioLimit,
        });
        const next = chooseFirstAvailable(alternatives);
        if (!next) break;
        sessions += 1;
        booked.push({
          id: `capacity-${sessions}-${profile.key}`,
          lanes: [...next.lanes],
          startMs: next.startMs,
          endMs: next.endMs,
          preparationMinutes: settings.preparationMinutes,
        });
      }
      return [profile.key, sessions];
    }),
  );
}

export function simulateBookingDay({ date, settings, reservations = [], blocks = [], demand }) {
  if (!Array.isArray(demand) || demand.length === 0)
    throw new Error("La simulación necesita una cola de demanda no vacía.");
  return ["engine", "first_available", "nearest", "compact"].map((policy) =>
    runPolicy({ policy, date, settings, reservations, blocks, demand }),
  );
}
