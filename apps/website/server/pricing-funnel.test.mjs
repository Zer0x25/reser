import assert from "node:assert/strict";
import test from "node:test";
import { summarizePricingFunnel } from "./pricing-funnel.mjs";

test("pricing funnel counts offers, unique selections, and reservation conversions by quote type", () => {
  const funnel = summarizePricingFunnel([
    { pricingGroup: "dynamic_applied", selectedAt: 200, reservedAt: 300 },
    { pricingGroup: "dynamic_applied", selectedAt: 200, reservedAt: null },
    { pricingGroup: "dynamic_potential", selectedAt: null, reservedAt: null },
    { pricingGroup: "standard", selectedAt: 250, reservedAt: null },
  ]);

  assert.deepEqual(funnel.totals, {
    offeredCount: 4,
    selectedCount: 3,
    reservedCount: 1,
  });
  assert.deepEqual(funnel.byPricingGroup, [
    { pricingGroup: "dynamic_applied", offeredCount: 2, selectedCount: 2, reservedCount: 1 },
    { pricingGroup: "dynamic_potential", offeredCount: 1, selectedCount: 0, reservedCount: 0 },
    { pricingGroup: "standard", offeredCount: 1, selectedCount: 1, reservedCount: 0 },
  ]);
});

test("a reservation implies a selected quote and unknown quote types remain countable", () => {
  const funnel = summarizePricingFunnel([
    { pricingGroup: "legacy", selectedAt: null, reservedAt: 500 },
  ]);

  assert.deepEqual(funnel.totals, {
    offeredCount: 1,
    selectedCount: 1,
    reservedCount: 1,
  });
  assert.deepEqual(funnel.byPricingGroup, [
    { pricingGroup: "standard", offeredCount: 1, selectedCount: 1, reservedCount: 1 },
  ]);
});
