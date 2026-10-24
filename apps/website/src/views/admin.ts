type AdminRenderState = {
  settings: any;
  adminSection: string;
  audit: any[];
  outbox: any[];
};

export function renderAdminView(
  state: AdminRenderState,
  days: string[],
  esc: (value: string | number | boolean | null | undefined) => string,
  money: (amount: number) => string,
) {
  if (!state.settings) return `<div class="loading-card">Cargando administración…</div>`;
  const s = state.settings;
  const activeSection = ["general", "rates", "team", "activity"].includes(state.adminSection)
    ? state.adminSection
    : "general";
  const rateRuleCount =
    s.rateBands.length + Object.keys(s.rateExceptions).length + s.promotions.length;
  const activeUserCount = s.users.filter((user: any) => user.active).length;
  const sections = [
    { id: "general", label: "Operación", count: "" },
    { id: "rates", label: "Tarifas y promociones", count: rateRuleCount ? `${rateRuleCount}` : "" },
    {
      id: "team",
      label: "Equipo y correo",
      count: state.outbox.length ? `${state.outbox.length}` : "",
    },
    { id: "activity", label: "Auditoría", count: "" },
  ];
  const sectionNav = `<nav class="admin-section-nav" aria-label="Secciones de administración">${sections.map((section) => `<button type="button" data-action="admin-section" data-section="${section.id}" ${activeSection === section.id ? 'aria-current="page"' : ""}>${section.label}${section.count ? `<i>${section.count}</i>` : ""}</button>`).join("")}</nav>`;
  const summary = `<div class="admin-summary" aria-label="Resumen de configuración"><button class="admin-stat" type="button" data-action="admin-section" data-section="rates"><small>Reglas de precio</small><b>${rateRuleCount}</b><span>Ver tarifas →</span></button><button class="admin-stat" type="button" data-action="admin-section" data-section="team"><small>Cuentas activas</small><b>${activeUserCount}</b><span>Gestionar equipo →</span></button><button class="admin-stat" type="button" data-action="admin-section" data-section="team"><small>Correos pendientes</small><b>${state.outbox.length}</b><span>Revisar correos →</span></button></div>`;
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
  return `<section class="admin-view">${sectionNav}${summary}<div class="admin-panels">${generalPanel}${ratesPanel}${teamPanel}${activityPanel}</div></section>`;
}
