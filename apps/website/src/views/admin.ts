type AdminRenderState = {
  settings: any;
  adminSection: string;
  audit: any[];
  outbox: any[];
  pricingPreview?: any;
  pricingPerformance?: any;
  pricingPerformanceDays?: number;
};

const dynamicModeLabels: Record<string, string> = {
  off: "Apagado",
  shadow: "Sombra",
  pilot: "Piloto",
  active: "Activo",
};
const dynamicModeDescriptions: Record<string, string> = {
  off: "No se calcula ni se aplica ningún descuento dinámico.",
  shadow:
    "Calcula y registra el descuento potencial, pero el cliente sigue pagando el precio de catálogo.",
  pilot: "Aplica el descuento solo en los días o franjas del piloto.",
  active: "Aplica el descuento en todos los horarios habilitados, salvo protecciones.",
};
const dynamicChannelLabels: Record<string, string> = {
  web: "Web",
  phone: "Teléfono",
  walk_in: "Presencial inmediata",
  counter_future: "Presencial futura",
};
const pricingFunnelGroupLabels: Record<string, string> = {
  dynamic_applied: "Dinámico aplicado",
  dynamic_potential: "Dinámico potencial",
  standard: "Sin descuento dinámico",
};

function funnelPercent(part: number, total: number) {
  return total > 0
    ? ((part / total) * 100).toLocaleString("es-CL", { maximumFractionDigits: 1 }) + "%"
    : "—";
}

function renderPricingFunnel(
  funnel: any,
  esc: (value: string | number | boolean | null | undefined) => string,
  money: (amount: number) => string,
) {
  const totals = funnel?.totals;
  if (!totals) return "";
  const offeredCount = Number(totals.offeredCount ?? 0);
  const selectedCount = Number(totals.selectedCount ?? 0);
  const reservedCount = Number(totals.reservedCount ?? 0);
  const confirmedCount = Number(totals.confirmedCount ?? 0);
  const paidCount = Number(totals.paidCount ?? 0);
  const verifiedRevenueClp = Number(totals.verifiedRevenueClp ?? 0);
  const contractedLaneHours = Number(totals.contractedLaneHours ?? 0);
  const revenuePerLaneHourClp = totals.revenuePerLaneHourClp;
  const groups = Array.isArray(funnel?.byPricingGroup) ? funnel.byPricingGroup : [];
  const groupRows = groups
    .map(
      (item: any) =>
        '<tr><th scope="row">' +
        esc(pricingFunnelGroupLabels[item.pricingGroup] ?? item.pricingGroup) +
        "</th><td>" +
        item.offeredCount +
        "</td><td>" +
        item.selectedCount +
        "</td><td>" +
        item.reservedCount +
        "</td><td>" +
        item.confirmedCount +
        "</td><td>" +
        item.paidCount +
        "</td><td>" +
        money(item.verifiedRevenueClp ?? 0) +
        "</td><td>" +
        Number(item.contractedLaneHours ?? 0).toLocaleString("es-CL", {
          maximumFractionDigits: 2,
        }) +
        "</td><td>" +
        (item.revenuePerLaneHourClp == null ? "—" : money(item.revenuePerLaneHourClp)) +
        "</td><td>" +
        funnelPercent(item.selectedCount, item.offeredCount) +
        "</td><td>" +
        funnelPercent(item.reservedCount, item.offeredCount) +
        "</td></tr>",
    )
    .join("");
  return (
    '<section class="pricing-funnel" aria-labelledby="pricing-funnel-title"><div class="panel-title"><div><h3 id="pricing-funnel-title">Cotización a pago</h3><p>Seguimiento de alternativas web hasta confirmación y pagos verificados.</p></div></div>' +
    '<div class="pricing-funnel-metrics" aria-live="polite"><article><small>Cotizaciones mostradas</small><b>' +
    offeredCount +
    "</b><span>Alternativas renderizadas en resultados</span></article><article><small>Seleccionadas</small><b>" +
    selectedCount +
    "</b><span>" +
    funnelPercent(selectedCount, offeredCount) +
    " de las cotizaciones</span></article><article><small>Solicitudes creadas</small><b>" +
    reservedCount +
    "</b><span>" +
    funnelPercent(reservedCount, offeredCount) +
    " de las cotizaciones · " +
    funnelPercent(reservedCount, selectedCount) +
    " de las seleccionadas</span></article><article><small>Confirmadas</small><b>" +
    confirmedCount +
    "</b><span>" +
    funnelPercent(confirmedCount, reservedCount) +
    " de las solicitudes</span></article><article><small>Pagadas completas</small><b>" +
    paidCount +
    "</b><span>" +
    funnelPercent(paidCount, confirmedCount) +
    " de las solicitudes que alguna vez se confirmaron</span></article><article><small>Ingreso neto verificado</small><b>" +
    money(verifiedRevenueClp) +
    "</b><span>Pagos acreditados menos devoluciones</span></article><article><small>Ingreso por pista-hora</small><b>" +
    (revenuePerLaneHourClp == null ? "—" : money(revenuePerLaneHourClp)) +
    "</b><span>" +
    contractedLaneHours.toLocaleString("es-CL", { maximumFractionDigits: 2 }) +
    " pista-horas confirmadas</span></article></div>" +
    (groups.length
      ? '<div class="pricing-performance-table-wrap"><table class="pricing-performance-table"><caption>Resultados por tipo de precio</caption><thead><tr><th scope="col">Tipo</th><th scope="col">Mostradas</th><th scope="col">Seleccionadas</th><th scope="col">Solicitudes</th><th scope="col">Confirmadas</th><th scope="col">Pagadas</th><th scope="col">Ingreso neto</th><th scope="col">Pista-horas</th><th scope="col">Ingreso / pista-hora</th><th scope="col">Selección</th><th scope="col">Solicitud / oferta</th></tr></thead><tbody>' +
        groupRows +
        "</tbody></table></div>"
      : '<p class="muted">Aún no hay cotizaciones mostradas en este período.</p>') +
    '<p class="pricing-performance-note">Cada alternativa renderizada cuenta una vez. Confirmada significa que llegó a confirmarse; pagada requiere saldo completo verificado actualmente. El ingreso neto suma pagos verificados y resta devoluciones registradas en reservas confirmadas que no estén canceladas ni rechazadas. El ingreso por pista-hora divide ese importe por las horas y pistas contratadas en esas reservas; no representa ingreso por hora disponible. Las cotizaciones recientes aún pueden convertir y las devoluciones pueden cambiar los resultados. Se conserva el hash del token y un vínculo interno a la reserva durante un máximo de 90 días, sin nombre ni correo. La comparación no atribuye causalidad ni ingresos incrementales.</p></section>'
  );
}

function renderPricingPerformance(
  performance: any,
  selectedDays: number,
  esc: (value: string | number | boolean | null | undefined) => string,
  money: (amount: number) => string,
) {
  const windowDays = [7, 30, 90].includes(Number(selectedDays)) ? Number(selectedDays) : 30;
  const totals = performance?.totals;
  const channels = Array.isArray(performance?.byChannel) ? performance.byChannel : [];
  const operational = performance?.operational;
  const operationalRate = operational?.revenuePerAvailableLaneHourClp;
  const availableLaneHours = Number(operational?.availableLaneHours ?? 0);
  const activeLaneCount = Number(operational?.activeLaneCount ?? 0);
  return `<div class="plain-card pricing-performance" aria-labelledby="pricing-performance-title"><div class="panel-title"><div><h2 id="pricing-performance-title">Resultados del piloto</h2><p>Descuentos por fecha de reserva; embudo por fecha de cotización.</p></div><label class="pricing-period">Período<select name="pricingPerformanceDays"><option value="7" ${windowDays === 7 ? "selected" : ""}>7 días</option><option value="30" ${windowDays === 30 ? "selected" : ""}>30 días</option><option value="90" ${windowDays === 90 ? "selected" : ""}>90 días</option></select></label></div>${
    totals
      ? `<div class="pricing-performance-metrics" aria-live="polite"><article><small>Reservas registradas</small><b>${totals.reservationCount}</b><span>${totals.pendingCount} pendientes · ${totals.cancelledCount} canceladas o rechazadas</span></article><article><small>Con descuento dinámico</small><b>${totals.dynamicAppliedCount}</b><span>Reservas no canceladas</span></article><article><small>Importe cotizado con dinámico</small><b>${money(totals.dynamicQuoteTotalClp)}</b><span>Precio final de esas reservas</span></article><article><small>Descuento dinámico registrado</small><b>${money(totals.dynamicDiscountCommittedClp)}</b><span>Incluye pendientes; excluye cancelaciones y rechazos</span></article><article><small>Potencial dinámico no aplicado</small><b>${money(totals.dynamicPotentialNotAppliedClp)}</b><span>Por sombra o por una promoción mayor</span></article></div>${channels.length ? `<div class="pricing-performance-table-wrap"><table class="pricing-performance-table"><caption>Resultados por canal</caption><thead><tr><th scope="col">Canal</th><th scope="col">Reservas</th><th scope="col">Con dinámico</th><th scope="col">Descuento</th></tr></thead><tbody>${channels.map((item: any) => `<tr><th scope="row">${esc(dynamicChannelLabels[item.channel] ?? item.channel)}</th><td>${item.reservationCount}</td><td>${item.dynamicAppliedCount}</td><td>${money(item.dynamicDiscountCommittedClp)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">No hay reservas creadas en este período.</p>`}<p class="pricing-performance-note">Incluye cotizaciones que ya generaron una solicitud o reserva. No cuenta búsquedas sin reserva ni estima ingresos incrementales. Las reservas pendientes se incluyen; los importes excluyen canceladas y rechazadas.</p>`
      : `<p class="muted" role="status">Cargando resultados…</p>`
  }${
    operational
      ? `<section class="pricing-available-capacity" aria-labelledby="pricing-capacity-title"><h3 id="pricing-capacity-title">Ingreso por pista-hora disponible</h3><p>Operación del local por fecha de inicio de reserva.</p><div class="pricing-performance-metrics" aria-live="polite"><article><small>Ingreso neto verificado</small><b>${money(operational.verifiedRevenueClp ?? 0)}</b><span>Pagos acreditados menos devoluciones · todos los canales</span></article><article><small>Pista-horas disponibles</small><b>${availableLaneHours.toLocaleString("es-CL", { maximumFractionDigits: 2 })}</b><span>${activeLaneCount} pistas activas en la configuración actual</span></article><article><small>Ingreso por pista-hora</small><b>${operationalRate == null ? "—" : money(operationalRate)}</b><span>CLP por pista-hora disponible</span></article></div><p class="pricing-performance-note">La capacidad resta las mantenciones registradas y usa el horario y las pistas activas configuradas ahora; si el horario cambió durante el período, el resultado es estimado. El ingreso se asigna por fecha de inicio de la reserva y no atribuye causalidad al precio dinámico.</p></section>`
      : ""
  }${renderPricingFunnel(performance?.funnel, esc, money)}</div>`;
}

export function renderAdminView(
  state: AdminRenderState,
  days: string[],
  esc: (value: string | number | boolean | null | undefined) => string,
  money: (amount: number) => string,
) {
  if (!state.settings) return `<div class="loading-card">Cargando administración…</div>`;
  const s = state.settings;
  const dp = s.dynamicPricing ?? {};
  const activeSection = ["general", "rates", "pricing", "team", "activity"].includes(
    state.adminSection,
  )
    ? state.adminSection
    : "general";
  const rateRuleCount =
    s.rateBands.length + Object.keys(s.rateExceptions).length + s.promotions.length;
  const activeUserCount = s.users.filter((user: any) => user.active).length;
  const dynamicModeLabel = dynamicModeLabels[dp.mode] ?? "Apagado";
  const sections = [
    { id: "general", label: "Operación", count: "" },
    { id: "rates", label: "Tarifas y promociones", count: rateRuleCount ? `${rateRuleCount}` : "" },
    { id: "pricing", label: "Precio dinámico", count: dynamicModeLabel },
    {
      id: "team",
      label: "Equipo y correo",
      count: state.outbox.length ? `${state.outbox.length}` : "",
    },
    { id: "activity", label: "Auditoría", count: "" },
  ];
  const sectionNav = `<nav class="admin-section-nav" aria-label="Secciones de administración">${sections.map((section) => `<button type="button" data-action="admin-section" data-section="${section.id}" ${activeSection === section.id ? 'aria-current="page"' : ""}>${section.label}${section.count ? `<i>${section.count}</i>` : ""}</button>`).join("")}</nav>`;
  const summary = `<div class="admin-summary" aria-label="Resumen de configuración"><button class="admin-stat" type="button" data-action="admin-section" data-section="rates"><small>Reglas de precio</small><b>${rateRuleCount}</b><span>Ver tarifas →</span></button><button class="admin-stat" type="button" data-action="admin-section" data-section="pricing"><small>Precio dinámico</small><b>${dynamicModeLabel}</b><span>Revisar configuración →</span></button><button class="admin-stat" type="button" data-action="admin-section" data-section="team"><small>Cuentas activas</small><b>${activeUserCount}</b><span>Gestionar equipo →</span></button><button class="admin-stat" type="button" data-action="admin-section" data-section="team"><small>Correos pendientes</small><b>${state.outbox.length}</b><span>Revisar correos →</span></button></div>`;
  const generalPanel = `<section class="admin-section" data-admin-panel="general" ${activeSection === "general" ? "" : "hidden"}><div class="admin-section-heading"><span class="eyebrow">CONFIGURACIÓN DEL LOCAL</span><h2>Operación y horarios</h2><p>Define cuándo se puede reservar y cómo se organiza el día.</p></div><div class="admin-layout"><div class="plain-card"><div class="panel-title"><div><h2>Reglas de operación</h2><p>Hora local de Santiago · cambios auditados.</p></div><span class="pill">Admin</span></div><form id="settings"><div class="two-fields"><label>Establecimiento<input name="venue" value="${esc(s.venueName)}" required></label><label>Tarifa base por pista/hora<input name="rate" type="number" min="0" value="${s.generalRateClpPerLaneHour}" required><small>0 desactiva reservas mientras no haya tarifa.</small></label><label>Preparación entre clientes<input name="prep" type="number" min="0" max="60" value="${s.preparationMinutes}" required></label><label>Margen antes del cierre<input name="closing" type="number" min="0" max="180" value="${s.closingMarginMinutes}" required></label><label>Bloque de agenda · minutos<select name="step">${[5, 10, 12, 15, 20, 30, 60].map((minutes) => `<option value="${minutes}" ${s.startIntervalMinutes === minutes ? "selected" : ""}>${minutes} minutos</option>`).join("")}</select><small>Define los inicios, la duración y las extensiones. Con 10 minutos, una hora son 6 bloques.</small></label><label>Anticipación mínima web<input name="minimum" type="number" min="0" value="${s.minimumAdvanceMinutes}"></label><label>Máximo de días para reservar<input name="maximum" type="number" min="1" max="365" value="${s.maximumAdvanceDays}"></label><label>Aprobación desde pistas<input name="approval" type="number" min="1" max="12" value="${s.requireManualApprovalFromLanes}"></label><label>Tolerancia de llegada<input name="late" type="number" min="0" max="60" value="${s.lateArrivalToleranceMinutes}"></label></div><h3>Horario semanal</h3><p class="field-help">Marca “Cerrado” en los días que no abres. Un cierre antes de la apertura continúa al día siguiente; por ejemplo, 15:00–01:00.</p><div class="hours-settings">${days
    .map((d, n) => {
      const rule = s.weeklyHours[String(n)] ?? { closed: true };
      const closed = Boolean(rule.closed);
      return `<div class="hours-day" data-hours-day="${n}"><b>${d}</b><label class="hours-closed"><input type="checkbox" name="closed-${n}" ${closed ? "checked" : ""}>Cerrado</label><label class="hours-time"><span class="visually-hidden">Apertura · ${d}</span><input type="time" name="open-${n}" value="${esc(rule.open ?? "")}" ${closed ? "disabled" : "required"}></label><span class="hours-until">hasta</span><label class="hours-time"><span class="visually-hidden">Cierre · ${d}</span><input type="time" name="close-${n}" value="${esc(rule.close ?? "")}" ${closed ? "disabled" : "required"}></label></div>`;
    })
    .join(
      "",
    )}</div><button class="button primary">Guardar configuración</button></form><form id="calendar-settings" class="calendar-settings"><h3>Zoom visual</h3><label>Ancho base por hora<select name="calendarWidth">${[36, 48, 60, 72, 84, 96, 108, 120].map((width) => `<option value="${width}" ${Number(s.calendarHourWidthPx ?? 60) === width ? "selected" : ""}>${width} px por hora</option>`).join("")}</select><small>Solo controla el ancho visual de cada hora; no cambia la duración de los bloques. En recepción también puedes acercar, alejar y desplazarte.</small></label><button class="button outline">Guardar escala</button></form></div><div class="plain-card"><div class="panel-title"><div><h2>Excepciones de horario</h2><p>Ajusta la apertura o cierre para una fecha especial.</p></div></div>${
    Object.entries(s.exceptions)
      .map(
        ([date, rule]: [string, any]) =>
          `<div class="rate-row"><span><b>${esc(date)}</b><small>${rule.closed ? "Cerrado" : `${esc(rule.open)}–${esc(rule.close)}`}</small></span><button type="button" data-action="remove-exception" data-date="${esc(date)}" aria-label="Quitar excepción de ${esc(date)}">×</button></div>`,
      )
      .join("") || `<p class="muted">No hay excepciones de horario.</p>`
  }<form id="exception" class="inline-form"><label>Fecha<input name="date" type="date" required></label><label>Apertura<input name="open" type="time" value="16:00"></label><label>Cierre<input name="close" type="time" value="22:00"></label><label class="check-row"><input name="closed" type="checkbox"> Cerrar todo el día</label><button class="button outline">＋ Guardar excepción</button></form></div></div></section>`;
  const ratesPanel = `<section class="admin-section" data-admin-panel="rates" ${activeSection === "rates" ? "" : "hidden"}><div class="admin-section-heading"><span class="eyebrow">PRECIOS Y BENEFICIOS</span><h2>Tarifas y promociones</h2><p>Organiza tus precios por horario y fecha; revisa el cambio antes de guardarlo.</p></div><div class="admin-layout admin-rates"><div class="plain-card"><div class="panel-title"><div><h2>Franjas tarifarias</h2><p>Se suman proporcionalmente y preceden a la tarifa general.</p></div></div>${s.rateBands.length ? s.rateBands.map((r: any, i: number) => `<div class="rate-row"><span><b>${days[r.weekday]} · ${r.start}–${r.end}</b></span><b>${money(r.rateClpPerLaneHour)} / pista·h</b><button type="button" data-action="remove-band" data-index="${i}" aria-label="Quitar franja tarifaria">×</button></div>`).join("") : `<p class="muted">Sin franjas especiales.</p>`}<form id="band" class="inline-form"><label>Día<select name="weekday">${days.map((d, i) => `<option value="${i}">${d}</option>`).join("")}</select></label><label>Desde<input name="start" type="time" value="18:00"></label><label>Hasta<input name="end" type="time" value="21:00"></label><label>CLP por pista/h<input name="rate" type="number" min="0" required></label><button class="button outline">＋ Agregar franja</button></form></div><div class="plain-card"><div class="panel-title"><div><h2>Tarifas por fecha</h2><p>Una tarifa especial para una fecha concreta.</p></div></div>${
    Object.entries(s.rateExceptions)
      .map(
        ([date, rate]: [string, any]) =>
          `<div class="rate-row"><span><b>${esc(date)}</b></span><b>${money(rate.rateClpPerLaneHour)} / pista·h</b><button type="button" data-action="remove-rate-exception" data-date="${esc(date)}" aria-label="Quitar tarifa especial de ${esc(date)}">×</button></div>`,
      )
      .join("") || `<p class="muted">Sin tarifas por fecha.</p>`
  }<form id="rate-exception" class="inline-form"><label>Fecha<input name="date" type="date" required></label><label>CLP por pista/h<input name="rate" type="number" min="0" required></label><button class="button outline">＋ Agregar excepción</button></form></div><div class="plain-card"><div class="panel-title"><div><h2>Promociones</h2><p>No se acumulan: se elige el mayor beneficio válido.</p></div></div>${s.promotions.length ? s.promotions.map((p: any, i: number) => `<div class="rate-row"><span><b>${esc(p.name)}</b><small>${p.kind === "percent" ? `${p.value}%` : money(p.value)} · ${new Date(p.startsAt).toLocaleDateString("es-CL")}</small></span><button type="button" data-action="remove-promo" data-index="${i}" aria-label="Quitar promoción ${esc(p.name)}">×</button></div>`).join("") : `<p class="muted">No hay promociones.</p>`}<form id="promo" class="two-fields"><label>Nombre<input name="name" required></label><label>Tipo<select name="kind"><option value="percent">Porcentaje</option><option value="fixed">Importe CLP</option></select></label><label>Valor<input name="value" type="number" min="1" required></label><label>Desde<input name="start" type="datetime-local" required></label><label>Hasta<input name="end" type="datetime-local" required></label><button class="button outline">＋ Crear promoción</button></form></div></div></section>`;
  const riskTiers = Array.isArray(dp.riskTiers) ? dp.riskTiers : [];
  const protectedBands = Array.isArray(dp.protectedBands) ? dp.protectedBands : [];
  const protectedDates = Array.isArray(dp.protectedDates) ? dp.protectedDates : [];
  const pilotBands = Array.isArray(dp.pilot?.bands) ? dp.pilot.bands : [];
  const selectedChannels = Array.isArray(dp.channels) ? dp.channels : [];
  const selectedPilotWeekdays = Array.isArray(dp.pilot?.weekdays) ? dp.pilot.weekdays : [];
  const selectedProtectedWeekdays = Array.isArray(dp.protectedWeekdays) ? dp.protectedWeekdays : [];
  const modeBadgeClass = dp.mode === "active" ? "green" : dp.mode === "pilot" ? "amber" : "";
  const preview = state.pricingPreview;
  const previewPotentialDiscount = preview?.preview?.potentialDiscountClp ?? 0;
  const appliedDiscountLabel =
    preview?.quote?.discountClp > 0
      ? `${preview.quote.pricingSource === "dynamic" ? "Precio dinámico" : (preview.quote.promotionName ?? "Promoción")} · ${money(preview.quote.discountClp)}`
      : "Ninguno";
  const performanceHtml = renderPricingPerformance(
    state.pricingPerformance,
    Number(state.pricingPerformanceDays ?? 30),
    esc,
    money,
  );
  const previewHtml = preview
    ? preview.available === false
      ? `<div class="pricing-preview"><b>Sin disponibilidad</b><p>${esc(preview.message ?? "No hay una agrupación libre para ese horario y grupo.")}</p></div>`
      : `<div class="pricing-preview"><b>${esc(preview.startAt)} · ${preview.laneCount} ${preview.laneCount === 1 ? "pista" : "pistas"}</b><div class="pricing-preview-grid"><span>Precio de catálogo<b>${money(preview.quote.baseClp)}</b></span><span>Descuento dinámico potencial<b>${money(previewPotentialDiscount)}</b></span><span>Beneficio aplicado<b>${esc(appliedDiscountLabel)}</b></span><span>Total al cliente<b>${money(preview.quote.totalClp)}</b></span>${previewPotentialDiscount > 0 && !preview.preview?.applied ? `<span>Precio dinámico potencial (no aplicado)<b>${money(preview.preview.totalAfterDiscountClp)}</b></span>` : ""}</div><small>${esc(preview.preview?.reason ?? "Sin evaluación dinámica")} · ${preview.preview?.riskPoints ?? 0} puntos · ocupación ${preview.preview?.signals?.occupancyPercent ?? "—"}% · ${preview.preview?.signals?.leadTimeHours ?? "—"} h de anticipación</small><small>Usa los valores actuales del formulario, incluidos cambios sin guardar. No guarda cambios ni compromete pistas.</small></div>`
    : `<p class="muted">Elige un horario futuro para comprobar el puntaje, el descuento y el total. La simulación usa la misma regla del servidor y no compromete inventario.</p>`;
  const dynamicPanel = `<section class="admin-section" data-admin-panel="pricing" ${activeSection === "pricing" ? "" : "hidden"}><div class="admin-section-heading"><span class="eyebrow">DESCUENTO ACOTADO POR RIESGO</span><h2>Precio dinámico</h2><p>Descuenta solo horarios con riesgo de quedar vacíos. Nunca sube la tarifa de lista, nunca se acumula con promociones y cada cotización conserva la versión con la que se emitió.</p></div><div class="admin-layout admin-rates"><div class="plain-card"><div class="panel-title"><div><h2>Regla y límites</h2><p>Versión ${dp.configVersion ?? 0} · ${esc(dynamicModeDescriptions[dp.mode] ?? dynamicModeDescriptions.off)}</p></div><span class="pill ${modeBadgeClass}">${esc(dynamicModeLabel)}</span></div><form id="dynamic-settings"><div class="two-fields"><label>Estado<select name="mode"><option value="off" ${dp.mode === "off" ? "selected" : ""}>Apagado</option><option value="shadow" ${dp.mode === "shadow" ? "selected" : ""}>Sombra · calcular sin mostrar</option><option value="pilot" ${dp.mode === "pilot" ? "selected" : ""}>Piloto · días o franjas</option><option value="active" ${dp.mode === "active" ? "selected" : ""}>Activo · horarios habilitados</option></select><small>Para activar necesitas piso, al menos un nivel, un canal y presupuesto.</small></label><label>Piso por pista/hora<input name="floor" type="number" min="1" value="${dp.floorClpPerLaneHour ?? ""}" placeholder="CLP mínimo"><small>Obligatorio en sombra, piloto y activo. No puede superar la tarifa de lista.</small></label><label>Descuento máximo %<input name="maxPercent" type="number" min="1" max="100" value="${dp.maxDiscountPercent ?? 30}" required><small>Tope técnico de toda la regla.</small></label><label>Tope absoluto por pista/hora<input name="maxAbsolute" type="number" min="1" value="${dp.maxDiscountClpPerLaneHour ?? ""}" placeholder="Opcional"><small>Se aplica junto con el porcentaje y el piso.</small></label><label>Ventana de anticipación · horas<input name="advanceWindow" type="number" min="1" max="720" value="${dp.advanceWindowHours ?? 48}" required></label><label>Ocupación baja · %<input name="lowOccupancy" type="number" min="0" max="99" value="${dp.lowOccupancyThresholdPercent ?? 50}" required></label><label>Ocupación media · %<input name="mediumOccupancy" type="number" min="1" max="100" value="${dp.mediumOccupancyThresholdPercent ?? 70}" required></label><label>Presupuesto diario · CLP<input name="dailyBudget" type="number" min="1" value="${dp.dailyDiscountBudgetClp ?? ""}" placeholder="Obligatorio en piloto/activo"><small>Se descuenta al confirmar reservas, no al buscar.</small></label><label>Vigencia de cotización · minutos<input name="quoteTtl" type="number" min="5" max="60" value="${dp.quoteTtlMinutes ?? 20}" required></label></div><h3>Canales habilitados</h3><div class="checkbox-grid">${Object.entries(
    dynamicChannelLabels,
  )
    .map(
      ([id, label]) =>
        `<label class="check-row"><input type="checkbox" name="channels" value="${id}" ${selectedChannels.includes(id) ? "checked" : ""}> ${esc(label)}</label>`,
    )
    .join(
      "",
    )}</div><h3>Alcance del piloto</h3><div class="checkbox-grid">${days.map((day, index) => `<label class="check-row"><input type="checkbox" name="pilotWeekdays" value="${index}" ${selectedPilotWeekdays.includes(index) ? "checked" : ""}> ${esc(day)}</label>`).join("")}</div><h3>Días protegidos</h3><p class="muted">Estos días nunca reciben descuento dinámico. Las franjas y fechas protegidas se agregan a la derecha.</p><div class="checkbox-grid">${days.map((day, index) => `<label class="check-row"><input type="checkbox" name="protectedWeekdays" value="${index}" ${selectedProtectedWeekdays.includes(index) ? "checked" : ""}> ${esc(day)}</label>`).join("")}</div><button class="button primary">Guardar precio dinámico</button><small class="privacy">Guardar crea una versión nueva. Las reservas confirmadas y las cotizaciones ya emitidas no se recalculan.</small></form><div class="callout"><b>Regla de aplicación</b><span>Solo se descuenta hacia abajo, sobre la tarifa de catálogo. Se aplica el mayor beneficio entre promoción y descuento dinámico, nunca la suma. El piso, el porcentaje, el tope absoluto y el presupuesto limitan cada oferta.</span></div></div><div class="admin-stack"><div class="plain-card"><div class="panel-title"><div><h2>Niveles de riesgo</h2><p>El puntaje se calcula con ocupación, anticipación y huecos. Los niveles se ordenan por puntaje mínimo.</p></div></div>${riskTiers.length ? riskTiers.map((tier: any, index: number) => `<div class="rate-row"><span><b>${tier.minPoints} puntos o más</b><small>${tier.discountPercent}% de descuento</small></span><button type="button" data-action="remove-dynamic-tier" data-index="${index}" aria-label="Quitar nivel de ${tier.minPoints} puntos">×</button></div>`).join("") : `<p class="muted">Sin niveles configurados. La regla no puede activarse.</p>`}<form id="dynamic-tier" class="inline-form"><label>Puntos mínimos<input name="minPoints" type="number" min="1" max="100" placeholder="Ej. 3" required></label><label>Descuento %<input name="discountPercent" type="number" min="1" max="${dp.maxDiscountPercent ?? 30}" placeholder="Ej. 10" required></label><button class="button outline">＋ Agregar nivel</button></form></div><div class="plain-card"><div class="panel-title"><div><h2>Franjas protegidas</h2><p>Nunca reciben descuento dinámico, aunque la ocupación sea baja.</p></div></div>${protectedBands.length ? protectedBands.map((band: any, index: number) => `<div class="rate-row"><span><b>${days[band.weekday]} · ${esc(band.start)}–${esc(band.end)}</b><small>Protegida</small></span><button type="button" data-action="remove-dynamic-protected-band" data-index="${index}" aria-label="Quitar franja protegida">×</button></div>`).join("") : `<p class="muted">Sin franjas protegidas.</p>`}<form id="dynamic-protected-band" class="inline-form"><label>Día<select name="weekday">${days.map((day, index) => `<option value="${index}">${esc(day)}</option>`).join("")}</select></label><label>Desde<input name="start" type="time" required></label><label>Hasta<input name="end" type="time" required></label><button class="button outline">＋ Proteger franja</button></form></div><div class="plain-card"><div class="panel-title"><div><h2>Fechas protegidas</h2><p>Fechas especiales que no deben recibir descuento dinámico.</p></div></div>${protectedDates.length ? protectedDates.map((date: string) => `<div class="rate-row"><span><b>${esc(date)}</b><small>Protegida</small></span><button type="button" data-action="remove-dynamic-protected-date" data-date="${esc(date)}" aria-label="Quitar fecha protegida ${esc(date)}">×</button></div>`).join("") : `<p class="muted">Sin fechas protegidas.</p>`}<form id="dynamic-protected-date" class="inline-form"><label>Fecha<input name="date" type="date" required></label><button class="button outline">＋ Proteger fecha</button></form></div><div class="plain-card"><div class="panel-title"><div><h2>Franjas del piloto</h2><p>Si el estado es piloto, solo estos días o franjas reciben ofertas.</p></div></div>${pilotBands.length ? pilotBands.map((band: any, index: number) => `<div class="rate-row"><span><b>${days[band.weekday]} · ${esc(band.start)}–${esc(band.end)}</b><small>Piloto</small></span><button type="button" data-action="remove-dynamic-pilot-band" data-index="${index}" aria-label="Quitar franja del piloto">×</button></div>`).join("") : `<p class="muted">Sin franjas de piloto.</p>`}<form id="dynamic-pilot-band" class="inline-form"><label>Día<select name="weekday">${days.map((day, index) => `<option value="${index}">${esc(day)}</option>`).join("")}</select></label><label>Desde<input name="start" type="time" required></label><label>Hasta<input name="end" type="time" required></label><button class="button outline">＋ Agregar al piloto</button></form></div></div></div><div class="plain-card dynamic-simulator"><div class="panel-title"><div><h2>Simulador</h2><p>Comprueba la oferta con el inventario actual. Si el estado está apagado, evalúa el potencial en modo sombra; usa los valores del formulario, incluso los cambios sin guardar.</p></div><span class="pill">Sin compromiso</span></div><form id="dynamic-preview" class="inline-form"><label>Inicio · hora de Santiago<input name="startAt" type="datetime-local" step="${Number(s.startIntervalMinutes ?? 10) * 60}" required></label><label>Jugadores<input name="players" type="number" min="1" max="72" value="4" required></label><label>Duración<select name="durationMinutes"><option value="60">1 hora</option><option value="120">2 horas</option><option value="180">3 horas</option><option value="240">4 horas</option></select></label><label>Pistas<input name="laneCount" type="number" min="1" max="12" placeholder="Mínimo según grupo"></label><label>Canal<select name="channel">${Object.entries(
    dynamicChannelLabels,
  )
    .map(([id, label]) => `<option value="${id}">${esc(label)}</option>`)
    .join(
      "",
    )}</select></label><button class="button outline">Simular oferta</button></form>${previewHtml}</div></section>`;
  const teamPanel = `<section class="admin-section" data-admin-panel="team" ${activeSection === "team" ? "" : "hidden"}><div class="admin-section-heading"><span class="eyebrow">PERSONAS Y NOTIFICACIONES</span><h2>Equipo y correo</h2><p>Administra cuentas individuales y revisa entregas que necesitan atención.</p></div><div class="admin-layout"><div class="plain-card"><div class="panel-title"><div><h2>Equipo y permisos</h2><p>Las cuentas y permisos se validan en el servidor.</p></div></div>${s.users.map((u: any) => `<div class="rate-row"><span><b>${esc(u.name)}</b><small>${esc(u.email)} · ${u.active ? "Activa" : "Inactiva"}</small></span><span class="tag">${u.role === "admin" ? "Admin" : "Recepción"}</span><button type="button" class="button ${u.active ? "ghost" : "outline"} small" data-action="user-status" data-id="${esc(u.id)}" data-active="${u.active ? "false" : "true"}">${u.active ? "Desactivar" : "Reactivar"}</button></div>`).join("")}<form id="user" class="two-fields"><label>Nombre<input name="name" required></label><label>Correo<input name="email" type="email" required></label><label>Contraseña temporal<input name="password" type="password" minlength="12" required></label><label>Rol<select name="role"><option value="reception">Recepción</option><option value="admin">Admin</option></select></label><button class="button outline">＋ Crear usuario</button></form></div><div class="plain-card"><div class="panel-title"><div><h2>Correos pendientes</h2><p>Los fallidos se reintentan automáticamente; el contenido permanece cifrado.</p></div><span class="pill">${state.outbox.length}</span></div>${state.outbox.length ? state.outbox.map((mail: any) => `<div class="rate-row"><span><b>${esc(mail.recipient)}</b><small>${mail.attempts} intentos · ${new Date(mail.createdAt).toLocaleString("es-CL")}</small></span><button class="button outline small" data-action="retry-email" data-id="${esc(mail.id)}">Reintentar ahora</button></div>`).join("") : `<div class="empty compact-empty"><b>✓</b><p>No hay correos pendientes.</p></div>`}</div></div></section>`;
  const activityPanel = `<section class="admin-section" data-admin-panel="activity" ${activeSection === "activity" ? "" : "hidden"}><div class="admin-section-heading"><span class="eyebrow">TRAZABILIDAD</span><h2>Actividad del sistema</h2><p>Consulta los cambios recientes y conserva visibilidad sobre la operación.</p></div><div class="plain-card"><div class="panel-title"><div><h2>Auditoría reciente</h2><p>Eventos registrados · hasta 15 de los últimos 200.</p></div></div>${
    state.audit.length
      ? state.audit
          .slice(0, 15)
          .map(
            (e: any) =>
              `<div class="audit-row"><b>${esc(e.action.replaceAll("_", " "))}</b><small>${esc(e.actor)} · ${esc(new Date(e.at).toLocaleString("es-CL"))}</small></div>`,
          )
          .join("")
      : `<div class="empty compact-empty"><b>✓</b><p>Aún no hay eventos.</p></div>`
  }</div><div class="callout"><b>Reglas financieras pendientes</b><span>No se inventan importes de penalización, ausencias, anticipos o compensaciones. Requieren definición del establecimiento.</span></div></section>`;
  const dynamicPanelWithPerformance = dynamicPanel.replace(
    "</section>",
    `${performanceHtml}</section>`,
  );
  return `<section class="admin-view">${sectionNav}${summary}<div class="admin-panels">${generalPanel}${ratesPanel}${dynamicPanelWithPerformance}${teamPanel}${activityPanel}</div></section>`;
}
