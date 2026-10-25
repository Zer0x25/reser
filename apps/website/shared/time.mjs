export const TIME_ZONE = "America/Santiago";

const dateParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function santiagoParts(epochMs) {
  const parts = Object.fromEntries(
    dateParts.formatToParts(new Date(epochMs)).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

export function formatLocalDate(epochMs) {
  const parts = santiagoParts(epochMs);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function formatLocalTime(epochMs) {
  const parts = santiagoParts(epochMs);
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function formatLocalDateTime(epochMs) {
  return `${formatLocalDate(epochMs)}T${formatLocalTime(epochMs)}`;
}

// Interpret venue-local time without relying on the browser timezone. Reject DST gaps and
// choose the earlier instant when the local clock repeats; callers can expose both instants.
export function localDateTimeToEpoch(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Fecha y hora inválidas.");
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const wanted = {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
    hour: Number(hourText),
    minute: Number(minuteText),
    second: 0,
  };
  const utcGuess = Date.UTC(wanted.year, wanted.month - 1, wanted.day, wanted.hour, wanted.minute);
  let candidate = utcGuess;
  for (let index = 0; index < 4; index += 1) {
    const got = santiagoParts(candidate);
    const represented = Date.UTC(
      got.year,
      got.month - 1,
      got.day,
      got.hour,
      got.minute,
      got.second,
    );
    const delta = utcGuess - represented;
    if (delta === 0) break;
    candidate += delta;
  }
  const got = santiagoParts(candidate);
  if (
    got.year !== wanted.year ||
    got.month !== wanted.month ||
    got.day !== wanted.day ||
    got.hour !== wanted.hour ||
    got.minute !== wanted.minute
  ) {
    throw new Error("Esa hora local no existe por el cambio de horario.");
  }
  const oneHourEarlier = candidate - 60 * 60_000;
  const earlier = santiagoParts(oneHourEarlier);
  if (
    earlier.year === wanted.year &&
    earlier.month === wanted.month &&
    earlier.day === wanted.day &&
    earlier.hour === wanted.hour &&
    earlier.minute === wanted.minute
  ) {
    return oneHourEarlier;
  }
  return candidate;
}

export function santiagoWeekday(epochMs) {
  const { year, month, day } = santiagoParts(epochMs);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function parseLocalDay(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Fecha inválida.");
  const [year, month, day] = date.split("-").map(Number);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  if (
    normalized.getUTCFullYear() !== year ||
    normalized.getUTCMonth() !== month - 1 ||
    normalized.getUTCDate() !== day
  ) {
    throw new Error("Fecha inválida.");
  }
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const nextDate = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  const dayStart = (localDate) => {
    for (let minute = 0; minute <= 180; minute += 1) {
      const clock = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
      try {
        return localDateTimeToEpoch(`${localDate}T${clock}`);
      } catch {
        // Skip local times removed by the spring DST jump.
      }
    }
    throw new Error("No se pudo resolver el inicio del día local.");
  };
  return { start: dayStart(date), end: dayStart(nextDate) };
}
