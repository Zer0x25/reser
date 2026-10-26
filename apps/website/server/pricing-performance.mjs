const cancelledStatuses = new Set(["cancelled", "rejected"]);

function clp(value) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) ? Math.max(0, amount) : 0;
}

function quoteFromJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function emptyTotals() {
  return {
    reservationCount: 0,
    confirmedCount: 0,
    pendingCount: 0,
    cancelledCount: 0,
    dynamicAppliedCount: 0,
    dynamicDiscountCommittedClp: 0,
    dynamicQuoteTotalClp: 0,
    dynamicPotentialNotAppliedCount: 0,
    dynamicPotentialNotAppliedClp: 0,
  };
}

function emptyChannel(channel) {
  return { channel, ...emptyTotals() };
}

export function summarizePricingPerformance(rows) {
  const totals = emptyTotals();
  const channels = new Map();

  for (const row of rows) {
    const channel = String(row.channel ?? "unknown");
    const status = String(row.commercialStatus ?? "unknown");
    const quote = quoteFromJson(row.quoteJson);
    const dynamic = quote.dynamic ?? {};
    const isCancelled = cancelledStatuses.has(status);
    const bucket = channels.get(channel) ?? emptyChannel(channel);
    const count = (target, key) => {
      target[key] += 1;
      totals[key] += 1;
    };

    count(bucket, "reservationCount");
    if (status === "confirmed") count(bucket, "confirmedCount");
    else if (status.startsWith("pending")) count(bucket, "pendingCount");
    else if (isCancelled) count(bucket, "cancelledCount");

    if (!isCancelled) {
      if (dynamic.applied === true && clp(dynamic.discountClp) > 0) {
        const discount = clp(dynamic.discountClp);
        count(bucket, "dynamicAppliedCount");
        bucket.dynamicDiscountCommittedClp += discount;
        totals.dynamicDiscountCommittedClp += discount;
        bucket.dynamicQuoteTotalClp += clp(row.quoteClp);
        totals.dynamicQuoteTotalClp += clp(row.quoteClp);
      } else if (clp(dynamic.potentialDiscountClp) > 0) {
        const potential = clp(dynamic.potentialDiscountClp);
        count(bucket, "dynamicPotentialNotAppliedCount");
        bucket.dynamicPotentialNotAppliedClp += potential;
        totals.dynamicPotentialNotAppliedClp += potential;
      }
    }

    channels.set(channel, bucket);
  }

  return {
    totals,
    byChannel: [...channels.values()].sort((a, b) => a.channel.localeCompare(b.channel)),
  };
}

export function summarizeOperationalPerformance({
  verifiedRevenueClp,
  availableLaneHours,
  activeLaneCount,
}) {
  const revenue = Number(verifiedRevenueClp);
  const hours = Number(availableLaneHours);
  const lanes = Number(activeLaneCount);
  const safeRevenue = Number.isSafeInteger(revenue) ? revenue : 0;
  const safeHours = Number.isFinite(hours) ? Math.max(0, hours) : 0;
  const safeLaneCount = Number.isSafeInteger(lanes) ? Math.max(0, lanes) : 0;

  return {
    verifiedRevenueClp: safeRevenue,
    availableLaneHours: Number(safeHours.toFixed(2)),
    activeLaneCount: safeLaneCount,
    revenuePerAvailableLaneHourClp: safeHours > 0 ? Math.round(safeRevenue / safeHours) : null,
  };
}
