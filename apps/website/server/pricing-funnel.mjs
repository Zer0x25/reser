const pricingGroups = new Set(["dynamic_applied", "dynamic_potential", "standard"]);

function emptyMetrics(pricingGroup = null) {
  return {
    ...(pricingGroup ? { pricingGroup } : {}),
    offeredCount: 0,
    selectedCount: 0,
    reservedCount: 0,
  };
}

export function summarizePricingFunnel(rows) {
  const totals = emptyMetrics();
  const groups = new Map();

  for (const row of rows) {
    const pricingGroup = pricingGroups.has(row.pricingGroup) ? row.pricingGroup : "standard";
    const group = groups.get(pricingGroup) ?? emptyMetrics(pricingGroup);
    const selected = row.selectedAt != null || row.reservedAt != null;
    const reserved = row.reservedAt != null;

    totals.offeredCount += 1;
    group.offeredCount += 1;
    if (selected) {
      totals.selectedCount += 1;
      group.selectedCount += 1;
    }
    if (reserved) {
      totals.reservedCount += 1;
      group.reservedCount += 1;
    }
    groups.set(pricingGroup, group);
  }

  return {
    totals,
    byPricingGroup: [...groups.values()].sort((a, b) =>
      a.pricingGroup.localeCompare(b.pricingGroup),
    ),
  };
}
