import { calculateQuote, evaluateOrphanRisk } from "./domain.mjs";

const MINUTE_MS = 60_000;

/**
 * Runs one synthetic price scenario through the same domain rules used by availability and quotes.
 * It does not read or write the database and never reserves inventory.
 */
export function simulatePricingScenario({
  label,
  settings,
  startMs,
  durationMinutes = 60,
  laneCount = 1,
  lanes = [12],
  reservations = [],
  blocks = [],
  channel = "web",
  now = Date.now(),
  budgetRemainingClp = Number.MAX_SAFE_INTEGER,
  impact = null,
}) {
  if (!settings || typeof settings !== "object")
    throw new TypeError("La simulación necesita una configuración de tarifas.");
  if (!Number.isSafeInteger(startMs) || startMs <= 0)
    throw new RangeError("La simulación necesita un inicio válido.");
  if (!Number.isSafeInteger(durationMinutes) || durationMinutes <= 0)
    throw new RangeError("La duración simulada debe ser un entero positivo.");
  if (!Number.isSafeInteger(laneCount) || laneCount < 1 || laneCount > 12)
    throw new RangeError("La cantidad de pistas simulada debe estar entre 1 y 12.");
  if (!Array.isArray(lanes) || lanes.length !== laneCount)
    throw new RangeError("Las pistas simuladas deben coincidir con la cantidad indicada.");

  const endMs = startMs + durationMinutes * MINUTE_MS;
  const risk = evaluateOrphanRisk({
    startMs,
    endMs,
    lanes,
    reservations,
    blocks,
    settings,
    channel,
    now,
    budgetRemainingClp,
    impact,
  });
  const quote = calculateQuote({
    startMs,
    durationMinutes,
    laneCount,
    settings,
    channel,
    risk,
  });

  return { label, startMs, endMs, channel, risk, quote };
}
