import { formatLocalTime } from "../server/domain.mjs";
import { simulateBookingDay } from "../server/engine-simulation.mjs";
import { blocks, date, demand, reservations, settings } from "../server/fixtures/engine-day.mjs";

const labels = {
  engine: "Motor: preservar capacidad futura",
  first_available: "Baseline: primera hora libre",
  nearest: "Baseline: hora más cercana",
  compact: "Baseline: compactación simple",
};
const currency = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});
const results = simulateBookingDay({ date, settings, reservations, blocks, demand });

console.log(
  `Simulación sintética · ${date} · 12 pistas · No son reservas ni datos comerciales reales`,
);
for (const result of results) {
  console.log(`\n${labels[result.policy]}`);
  console.log(
    `Con horario simulado: ${result.acceptedRequests}/${demand.length} · Sin horario: ${result.rejectedRequests.length} · Horas-pista: ${result.laneHoursSold} · Ingreso bruto ilustrativo: ${currency.format(result.revenueClp)} · Desvío medio: ${result.averageDeviationMinutes} min`,
  );
  console.log(
    "Capacidad residual: sesiones adicionales por perfil, medidas de forma independiente",
  );
  for (const [profile, sessions] of Object.entries(result.remainingCapacity))
    console.log(`  ${profile}: ${sessions}`);
  for (const booking of result.accepted)
    console.log(
      `  ${booking.id}: ${formatLocalTime(booking.startMs)} · ${booking.players} jugadores · ${booking.laneCount} pistas · ${currency.format(booking.quoteClp)}`,
    );
  if (result.rejectedRequests.length)
    console.log(
      `  Sin horario: ${result.rejectedRequests.map((request) => request.id).join(", ")}`,
    );
}
