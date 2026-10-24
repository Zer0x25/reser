import "./style.css";
import { renderAdminView } from "./views/admin";
import {
  addCalendarDays,
  calendarRanges,
  calendarStartAtFraction,
  isWithinOperatingHours,
  shiftCalendarRange,
  visibleCalendarRange,
  zoomForCalendarRange,
} from "./calendar";
import {
  formatLocalDate as localDate,
  formatLocalDateTime as localDateTime,
  formatLocalTime as time,
  localDateTimeToEpoch as localEpoch,
} from "../shared/time.mjs";

type Option = {
  startAt: string;
  startMs: number;
  startTime: string;
  endTime: string;
  utcOffset?: string;
  durationMinutes: number;
  laneCount: number;
  minimumLanes: number;
  grouped: boolean;
  quote: { totalClp: number; baseClp: number; discountClp: number; promotionName?: string };
  distanceMinutes: number;
  rank: number;
  recommended: boolean;
};
type User = { id: string; email: string; name: string; role: "reception" | "admin" };
const app = document.querySelector<HTMLDivElement>("#app")!;
const routeMatch = (location.pathname.replace(/\/+$/, "") || "/").match(
  /^(.*)\/(recepcion|admin|administracion)$/,
);
const appBasePath = routeMatch ? routeMatch[1] : location.pathname.replace(/\/+$/, "");
const appPaths = {
  public: appBasePath ? `${appBasePath}/` : "/",
  reception: `${appBasePath}/recepcion`,
  admin: `${appBasePath}/admin`,
};
const staffEntry = routeMatch ? (routeMatch[2] === "recepcion" ? "reception" : "admin") : null;
const days = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
function randomIdempotencyKey() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues === "function") {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index++)
      bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const state: any = {
  config: null,
  view: staffEntry ? "staff" : "book",
  staffEntry,
  page: staffEntry === "admin" ? "settings" : "board",
  user: null,
  date: localDate(Date.now()),
  dateWindowStart: localDate(Date.now()),
  time: "18:00",
  players: 4,
  duration: 60,
  separated: false,
  options: [] as Option[],
  loading: false,
  availabilitySearched: false,
  selected: null as Option | null,
  requestName: "",
  requestEmail: "",
  verificationCode: "",
  requestTermsAccepted: false,
  verifiedEmail: "",
  proof: "",
  requestKey: randomIdempotencyKey(),
  result: null,
  manageToken: new URLSearchParams(location.search).get("token"),
  managed: null,
  manageLoadFailed: false,
  manageEmail: "",
  manageBookingCode: "",
  manageProof: "",
  board: null,
  requests: [],
  settings: null,
  calendarZoomPx: null as number | null,
  calendarZoomCustomized: false,
  calendarRange: "total",
  boardSearch: "",
  boardBookingStatus: "all",
  adminSection: "general",
  audit: [],
  outbox: [],
  message: "",
  kind: "",
  modal: null,
  manualKey: null,
  manualStartAt: null as string | null,
  manualStartMs: null as number | null,
};
function esc(x: string | number | boolean | null | undefined) {
  return String(x ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
function fieldValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : "";
}
function money(n: number) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(n);
}
function dateText(date: string) {
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "full", timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`),
  );
}
function shortWeekday(date: string) {
  return new Intl.DateTimeFormat("es-CL", { weekday: "short", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00Z`))
    .replace(".", "")
    .toLocaleUpperCase("es-CL");
}
function monthYear(date: string) {
  return new Intl.DateTimeFormat("es-CL", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00Z`))
    .toLocaleUpperCase("es-CL");
}
function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : "No pudimos completar la acción.";
}
async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      ...init,
      headers,
    });
  } catch {
    throw new Error(
      "No pudimos conectar con el servicio. Revisa tu conexión e inténtalo otra vez.",
    );
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "Ocurrió un error.");
  return body as T;
}
function say(text: string, kind = "info") {
  state.message = text;
  state.kind = kind;
}
function notice() {
  return state.message
    ? `<div class="notice ${state.kind}" role="status" tabindex="-1">${esc(state.message)}<button data-action="clear" aria-label="Cerrar aviso">×</button></div>`
    : "";
}
function demo() {
  return state.config?.demoMode
    ? `<aside class="demo-banner"><b><i></i> Entorno de demostración</b><span>Los horarios y reservas son ejemplos. La tarifa no está autorizada para cobros reales.</span></aside>`
    : "";
}
function shell(content: string) {
  const venueName = esc(state.config?.venueName ?? "Bowling Espacio OX");
  const brand = `<span class="brand-mark" aria-hidden="true">OX</span><span><b>${venueName}</b><small>Bowling · Santiago</small></span>`;
  const brandElement =
    state.view === "staff"
      ? `<div class="brand">${brand}</div>`
      : `<a class="brand" href="${appPaths.public}" data-action="nav" data-view="book">${brand}</a>`;
  const portalLabel =
    state.view === "staff"
      ? `<span class="portal-label">${state.staffEntry === "admin" ? "Administración" : "Portal del equipo"}</span>`
      : "";
  const userActions =
    state.view === "staff" && state.user
      ? `<div class="top-end"><span class="user-chip">${esc(state.user.name)} <button data-action="logout">Salir</button></span></div>`
      : "";
  app.innerHTML = `<div class="shell"><header class="topbar ${state.view === "staff" ? "staff-topbar" : ""}">${brandElement}${portalLabel}${userActions}</header>${demo()}${notice()}<main>${content}</main><footer><span><b>${venueName}</b> · Santiago</span><span>Hora local de Chile · America/Santiago</span><span>© 2026</span></footer></div>${state.modal ? modalHtml() : ""}`;
}
function renderBook() {
  if (state.manageToken) return renderManage();
  const today = localDate(Date.now());
  const maxDate = addCalendarDays(today, state.config?.maximumAdvanceDays ?? 60);
  const lastDateWindowStart = addCalendarDays(maxDate, -6);
  const windowStart = state.dateWindowStart < today ? today : state.dateWindowStart;
  const dates = Array.from({ length: 7 }, (_, index) => addCalendarDays(windowStart, index));
  const dateButtons = dates
    .map(
      (date) =>
        `<button type="button" class="date-chip ${date === state.date ? "selected" : ""}" data-action="date-select" data-date="${date}" aria-pressed="${date === state.date}" ${date > maxDate ? "disabled" : ""}><span aria-hidden="true">${date === today ? "HOY" : shortWeekday(date)}</span><b aria-hidden="true">${date.slice(-2)}</b><span class="visually-hidden">${esc(dateText(date))}</span></button>`,
    )
    .join("");
  const content = `<section class="booking-layout"><div class="booking-intro"><div class="booking-intro-copy"><span class="eyebrow">✳ RESERVAS EN ESPACIO OX</span><h1>Arma el plan.<br><em>La pista te espera.</em></h1><p>Encuentra el horario perfecto para tu grupo. Nosotros preparamos las pistas.</p><div class="hero-facts"><span><b>12</b> pistas</span><span><b>6</b> jugadores por pista</span><span><b>${state.config?.preparationMinutes ?? 10} min</b> entre grupos</span></div></div><div class="hero-visual" aria-hidden="true"><span class="glow"></span><div class="pin pin-a"></div><div class="pin pin-b"></div><div class="pin pin-c"></div><div class="ball"><i></i><i></i><i></i></div><div class="art-caption"><span>● ESPACIO OX</span><b>El plan perfecto<br>para compartir</b></div></div></div>
  <section class="booking-card"><div class="booking-heading"><div><span class="eyebrow">01 · PLANIFICA TU VISITA</span><h2>¿Cuándo jugamos?</h2><p>Elige el día y cuéntanos cómo viene tu grupo.</p></div><div class="steps" aria-label="Pasos de la reserva"><b>1</b> Busca <i></i><b>2</b> Elige <i></i><b>3</b> Confirma</div></div>
  <form id="search" class="search-grid"><div class="date-picker-block"><div class="date-picker-heading"><span>Elige un día <small>${monthYear(state.date)}</small></span><label class="date-picker">＋ Otra fecha<input name="date" type="date" min="${today}" max="${maxDate}" value="${esc(state.date)}" required aria-label="Otra fecha"></label></div><div class="date-strip" role="group" aria-label="Próximos días"><button type="button" class="date-week-nav" data-action="date-week" data-direction="previous" aria-label="Ver semana anterior" ${windowStart <= today ? "disabled" : ""}>‹</button>${dateButtons}<button type="button" class="date-week-nav" data-action="date-week" data-direction="next" aria-label="Ver semana siguiente" ${windowStart >= lastDateWindowStart ? "disabled" : ""}>›</button></div></div><label>Hora preferida<input name="time" type="time" step="${(state.config?.startIntervalMinutes ?? 10) * 60}" value="${esc(state.time)}" required></label><label>Jugadores<div class="player-stepper"><button type="button" data-action="players-adjust" data-step="-1" aria-label="Quitar un jugador" ${state.players <= 1 ? "disabled" : ""}>−</button><input name="players" type="number" min="1" max="72" value="${state.players}" required aria-label="Cantidad de jugadores"><button type="button" data-action="players-adjust" data-step="1" aria-label="Agregar un jugador" ${state.players >= 72 ? "disabled" : ""}>＋</button></div></label><label>Tiempo de juego<select name="duration">${[60, 120, 180, 240].map((n) => `<option value="${n}" ${state.duration === n ? "selected" : ""}>${n / 60} ${n === 60 ? "hora" : "horas"}</option>`).join("")}</select></label><button class="button primary search-button" ${state.loading ? "disabled" : ""}>${state.loading ? "Buscando horarios…" : "Buscar horarios →"}</button>${state.players > 12 ? `<label class="check-row"><input name="separated" type="checkbox" ${state.separated ? "checked" : ""}> Acepto pistas separadas si no hay un grupo contiguo.</label>` : ""}</form>
  ${state.options.length ? renderOptions() : ""}${state.availabilitySearched && !state.options.length && !state.selected && !state.result ? renderEmptyAvailability() : ""}${state.selected ? renderRequestForm() : ""}${state.result ? renderResult() : ""}</section></section>
  <section class="how"><div><span class="eyebrow">ASÍ DE FÁCIL</span><h2>Menos coordinar.<br><em>Más jugar.</em></h2></div><div class="how-cards"><article><b>01</b><span>⌕</span><h3>Busca</h3><p>Indica el día, hora ideal y tamaño del grupo.</p></article><article><b>02</b><span>◷</span><h3>Compara</h3><p>Revisa horarios y precios antes de decidir.</p></article><article><b>03</b><span>↗</span><h3>Confirma</h3><p>Verifica tu correo y sigue tu reserva con un enlace privado.</p></article></div></section><section class="venue-strip"><span>⌖</span><b>Nos encontramos en Santiago</b><small>La disponibilidad se muestra en hora local de Chile.</small><span class="venue-help">¿Dudas? Nuestro equipo puede ayudarte en el local.</span></section>`;
  shell(content);
}
function renderOptions() {
  const nearest = [...state.options].sort(
    (a: Option, b: Option) => a.distanceMinutes - b.distanceMinutes || a.rank - b.rank,
  );
  const counts = new Map<string, number>();
  for (const option of nearest)
    counts.set(option.startTime, (counts.get(option.startTime) ?? 0) + 1);
  const repeatedTimes = new Set(
    [...counts].filter(([, count]) => count > 1).map(([startTime]) => startTime),
  );
  return `<section class="options"><div class="panel-title"><div><span class="eyebrow">${state.options.length} ${state.options.length === 1 ? "OPCIÓN ENCONTRADA" : "OPCIONES ENCONTRADAS"}</span><h3>${esc(dateText(state.date))}</h3><p>Cerca de las ${esc(state.time)}. Recomendado conserva más horarios disponibles para otros grupos.</p></div><span class="pill">${state.players} personas · ${state.duration / 60} h</span></div>${nearest
    .map((o: Option) => {
      const chosen = state.selected?.startMs === o.startMs;
      const tag =
        o.distanceMinutes === 0
          ? "Hora elegida"
          : `${o.startMs < localEpoch(`${state.date}T${state.time}`) ? "Antes" : "Después"} · ${Math.floor(o.distanceMinutes / 60) ? `${Math.floor(o.distanceMinutes / 60)} h ` : ""}${Math.round(o.distanceMinutes % 60)} min`;
      return `<article class="option-card ${chosen ? "chosen" : ""}"><div class="option-time"><b>${esc(o.startTime)}</b><small>${esc(o.endTime)} término</small>${repeatedTimes.has(o.startTime) && o.utcOffset ? `<small>${esc(o.utcOffset)}</small>` : ""}</div><div class="option-info"><div><span class="tag ${o.recommended ? "green" : ""}">${o.recommended ? "Recomendado" : tag}</span><span class="tag">${o.laneCount} ${o.laneCount === 1 ? "pista" : "pistas"} ${o.grouped ? "juntas" : "separadas"}</span></div><p>${o.minimumLanes === 1 ? "Una pista para tu grupo" : `${o.laneCount} contratadas · ${o.minimumLanes} necesarias por capacidad`}${o.grouped ? "" : " · cada parte juega por separado"}</p>${o.quote.promotionName ? `<small class="promo">${esc(o.quote.promotionName)} aplicado</small>` : ""}</div><div class="option-price"><b>${state.config?.rateConfigured || state.config?.demoMode ? money(o.quote.totalClp) : "Tarifa por configurar"}</b><small>total · ${o.laneCount} ${o.laneCount === 1 ? "pista" : "pistas"}</small></div><button class="button ${chosen ? "chosen-button" : "outline"}" data-action="select" data-start="${o.startMs}">${chosen ? "Elegido ✓" : "Elegir"}</button></article>`;
    })
    .join("")}</section>`;
}
function renderEmptyAvailability() {
  return `<section class="empty availability-empty" tabindex="-1"><b aria-hidden="true">◷</b><h3>No encontramos horarios</h3><p>Prueba con otra hora, fecha o duración. Si son un grupo grande, aceptar pistas separadas puede mostrar más alternativas.</p></section>`;
}
function renderRequestForm() {
  const o: Option = state.selected;
  const priceConfigured = state.config?.rateConfigured || state.config?.demoMode;
  const offset =
    state.options.filter((option: Option) => option.startAt === o.startAt).length > 1
      ? ` · ${o.utcOffset}`
      : "";
  return `<section class="request-card"><button class="close" data-action="clear-selection" aria-label="Cerrar">×</button><div class="panel-title"><div><span class="eyebrow">TU OPCIÓN ELEGIDA</span><h3>${esc(o.startTime)}${esc(offset)} — ${esc(o.endTime)}</h3><p>${o.laneCount} ${o.laneCount === 1 ? "pista" : "pistas"} · ${state.duration / 60} h · ${state.players} jugadores</p></div><div class="total"><small>Total</small><b>${priceConfigured ? money(o.quote.totalClp) : "Por configurar"}</b><small>${state.config?.demoMode ? "precio ilustrativo" : "CLP"}</small></div></div><form id="request"><div class="two-fields"><label>Nombre del responsable<input name="name" autocomplete="name" required maxlength="120" value="${esc(state.requestName)}" placeholder="Tu nombre"></label><label>Correo electrónico<input name="email" type="email" autocomplete="email" required value="${esc(state.requestEmail || state.verifiedEmail)}" placeholder="nombre@correo.cl"></label></div><div class="verify-row"><span>✉ <b>Verifica tu correo</b><small>Enviamos un código de seis dígitos. Todavía no retenemos pistas.</small></span><button type="button" class="button outline" data-action="send-code">Enviar código</button></div><div class="code-row"><label>Código de verificación<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" value="${esc(state.verificationCode)}" placeholder="000000" ${state.proof ? "disabled" : ""}></label><button type="button" class="button outline" data-action="verify" ${state.proof ? "disabled" : ""}>${state.proof ? "Correo verificado ✓" : "Verificar correo"}</button></div>${state.proof ? `<p class="verified">✓ Correo verificado para ${esc(state.verifiedEmail)}. Comprobaremos disponibilidad al enviar.</p>` : ""}${!priceConfigured ? `<p class="verified">Recepción debe configurar una tarifa antes de aceptar reservas.</p>` : ""}<label class="accept"><input name="terms" type="checkbox" ${state.requestTermsAccepted ? "checked" : ""} required><span>Acepto la tarifa, el horario y las condiciones. Un grupo grande puede requerir aprobación de recepción.</span></label><button class="button primary submit" ${state.proof && priceConfigured ? "" : "disabled"}>${o.laneCount >= 3 ? "Solicitar aprobación" : "Reservar este horario"} →</button><small class="privacy">🔒 Sin cuenta. El enlace de seguimiento solo da acceso a esta reserva.</small></form></section>`;
}
function renderResult() {
  const r = state.result;
  return `<section class="result-card ${r.status === "confirmed" ? "confirmed" : "pending"}" tabindex="-1"><span>${r.status === "confirmed" ? "✓" : "◷"}</span><div><small class="eyebrow">SOLICITUD ${esc(r.code)}</small><h3>${esc(r.statusLabel)}</h3><p>${r.status === "confirmed" ? "Tu espacio quedó confirmado. Guarda el enlace seguro para consultar los detalles." : "El horario quedó retenido mientras recepción revisa la solicitud. Te avisaremos por correo."}</p>${r.notificationPending ? `<p>La solicitud sí quedó guardada; estamos reintentando enviar el correo con el enlace seguro.</p>` : ""}${r.manageLink ? `<a class="button outline" href="${esc(r.manageLink)}">Ver seguimiento seguro →</a>` : ""}</div></section>`;
}
function renderManage() {
  const b = state.managed;
  const renewal = `<article class="manage-card"><span class="eyebrow">SEGUIMIENTO PRIVADO</span><h1>Renueva tu enlace</h1><p>El enlace pudo vencer. La reserva y sus pistas siguen igual. Verifica el correo asociado y escribe el código de reserva para recibir un enlace nuevo.</p><form id="manage-renew"><label>Correo de la reserva<input name="email" type="email" autocomplete="email" value="${esc(state.manageEmail)}" required></label><label>Código de reserva<input name="bookingCode" autocomplete="off" maxlength="20" value="${esc(state.manageBookingCode)}" placeholder="B-12AB34CD" required></label><div class="verify-row"><span>✉ <b>Verifica tu correo</b><small>Enviaremos un código de seis dígitos.</small></span><button type="button" class="button outline" data-action="manage-send-code">Enviar código</button></div><div class="code-row"><label>Código de verificación<input name="verificationCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" ${state.manageProof ? "disabled" : ""}></label><button type="button" class="button outline" data-action="manage-verify" ${state.manageProof ? "disabled" : ""}>${state.manageProof ? "Correo verificado ✓" : "Verificar correo"}</button></div>${state.manageProof ? `<p class="verified">Correo verificado. Al continuar enviaremos un enlace válido por 24 horas.</p>` : ""}<button class="button primary" ${state.manageProof ? "" : "disabled"}>Enviar enlace nuevo →</button></form></article>`;
  shell(
    `<section class="manage-page"><button class="back" data-action="leave-manage">← Volver a reservas</button>${b ? `<article class="manage-card"><div class="panel-title"><div><span class="eyebrow">SEGUIMIENTO PRIVADO</span><h1>Tu reserva</h1><p>Código ${esc(b.code)}</p></div><span class="pill ${b.status === "confirmed" ? "green" : "amber"}">${esc(b.statusLabel)}</span></div><div class="manage-grid"><span>Fecha<b>${esc(dateText(b.localDate))}</b></span><span>Horario<b>${esc(b.startTime)}${b.ambiguousLocalTime ? ` · ${esc(b.utcOffset)}` : ""} — ${esc(b.endTime)}</b></span><span>Grupo<b>${b.players} personas · ${b.laneCount} pistas</b></span><span>Condición<b>${b.grouped ? "Pistas juntas" : "Pistas separadas, aceptado"}</b></span><span>Total<b>${money(b.quoteClp)}</b></span><span>Pagos acreditados<b>${money(b.paymentsVerifiedClp)} · saldo ${money(b.balanceClp)}</b></span></div>${b.requestStatus === "pending_price_acceptance" ? `<div class="price-accept"><b>Recepción actualizó el precio a ${money(state.managed.updatedQuoteClp)}.</b><button class="button primary" data-action="accept-price">Aceptar precio actualizado</button></div>` : ""}${b.status === "confirmed" && b.start - Date.now() >= 86400000 ? `<button class="button outline" data-action="customer-cancel">Cancelar reserva</button>` : ""}<p class="privacy">Este enlace vence en 24 horas. Su expiración no afecta la reserva.</p></article>` : state.manageLoadFailed ? renewal : `<div class="loading-card">Abriendo tu enlace seguro…</div>`}</section>`,
  );
}
function renderLogin() {
  const admin = state.staffEntry === "admin";
  return `<section class="login-page"><div class="login-side"><span class="eyebrow">ESPACIO OX · ${admin ? "ADMINISTRACIÓN" : "RECEPCIÓN"}</span><h1>${admin ? "Control total.<br>" : "Todo listo<br>"}para que <em>ruede.</em></h1><p>${admin ? "Configura horarios, tarifas y permisos del sistema." : "Accede al tablero de pistas, solicitudes y operación del día."}</p><div class="login-pins">●　●　●<br>　●　●　●</div></div><div class="login-form"><span class="eyebrow">${admin ? "PORTAL ADMINISTRADOR" : "PORTAL DE RECEPCIÓN"}</span><h2>Hola de nuevo</h2><p>Ingresa con tu cuenta individual.</p><form id="login"><label>Correo de trabajo<input name="email" type="email" autocomplete="username" required></label><label>Contraseña<input name="password" type="password" autocomplete="current-password" required></label><button class="button primary">Ingresar →</button></form><small>Acceso protegido por cuenta y permisos.</small></div></section>`;
}
function renderAdminDenied() {
  return `<section class="admin-denied"><span class="eyebrow">ACCESO RESTRINGIDO</span><h1>Solo administración</h1><p>Esta cuenta no tiene permisos para entrar al portal de administración.</p><button class="button outline" data-action="logout">Cerrar sesión</button></section>`;
}
function renderStaff() {
  if (!state.user) {
    shell(renderLogin());
    return;
  }
  if (state.staffEntry === "admin" && state.user.role !== "admin") {
    shell(renderAdminDenied());
    return;
  }
  if (state.page === "settings" && state.user.role !== "admin") state.page = "board";
  const title =
    state.page === "board"
      ? "Tablero de pistas"
      : state.page === "requests"
        ? "Bandeja de recepción"
        : state.page === "new"
          ? "Nueva reserva"
          : "Administración";
  const tabs = `<nav class="staff-tabs" aria-label="Secciones de recepción"><button data-action="page" data-page="board" class="${state.page === "board" ? "current" : ""}">▦ Tablero</button><button data-action="page" data-page="requests" class="${state.page === "requests" ? "current" : ""}">◷ Solicitudes ${state.requests.length ? `<i>${state.requests.length}</i>` : ""}</button><button data-action="page" data-page="new" class="${state.page === "new" ? "current" : ""}">＋ Nueva reserva</button>${state.user.role === "admin" ? `<button data-action="page" data-page="settings" class="${state.page === "settings" ? "current" : ""}">⚙ Administración</button>` : ""}</nav>`;
  const dateControl =
    state.page === "new"
      ? `<label>Fecha<input type="date" name="board-date" value="${esc(state.board?.date ?? localDate(Date.now()))}"></label>`
      : "";
  const content =
    state.page === "board"
      ? renderBoard()
      : state.page === "requests"
        ? renderRequests()
        : state.page === "new"
          ? renderNewBooking()
          : renderAdmin();
  shell(
    `<section class="staff-work"><div class="staff-heading"><div><span class="eyebrow">OPERACIÓN DIARIA</span><h1>${title}</h1><p>${state.page === "board" ? "Inventario y compromisos del día, en hora de Santiago." : state.page === "requests" ? "Las solicitudes retenidas esperan una decisión humana." : state.page === "new" ? "Todos los canales comparten el mismo inventario." : "Precios, horarios, preparación y permisos."}</p></div>${dateControl}</div>${tabs}${content}</section>`,
  );
}
function applyBoardFilters() {
  const query = state.boardSearch.trim().toLocaleLowerCase("es-CL");
  const selectedStatus = state.boardBookingStatus;
  const events = [...document.querySelectorAll<HTMLButtonElement>(".booking-event")];
  const allBookings = new Set(events.map((event) => event.dataset.id));
  const visibleBookings = new Set<string>();

  for (const event of events) {
    const matches =
      (!query || event.dataset.search?.includes(query)) &&
      (selectedStatus === "all" || event.dataset.status === selectedStatus);
    event.hidden = !matches;
    event.setAttribute("aria-hidden", String(!matches));
    event.tabIndex = matches ? 0 : -1;
    if (matches && event.dataset.id) visibleBookings.add(event.dataset.id);
  }

  const count = document.querySelector<HTMLElement>("#board-filter-count");
  if (count) {
    count.textContent = visibleBookings.size
      ? `${visibleBookings.size} ${visibleBookings.size === 1 ? "reserva coincide" : "reservas coinciden"}`
      : allBookings.size
        ? "No encontramos reservas con esos filtros."
        : "Sin reservas agendadas para esta fecha.";
  }
  const clear = document.querySelector<HTMLButtonElement>('[data-action="board-clear-filters"]');
  if (clear) clear.disabled = !query && selectedStatus === "all";
}

function renderBoard() {
  if (!state.board) return `<div class="loading-card">Cargando las pistas…</div>`;
  const bookings = state.board.reservations;
  const metrics = `<div class="metrics"><article><small>Reservas del día</small><b>${bookings.length}</b></article><article><small>Pistas comprometidas</small><b>${bookings.reduce((a: number, b: any) => a + b.laneCount, 0)} <small>/ 12</small></b></article><button class="metric-action" data-action="board-open-requests"><small>Solicitudes pendientes</small><b>${state.requests.length}</b><span>${state.requests.length ? "Revisar solicitudes →" : "Todo al día"}</span></button><article><small>Bloqueos activos</small><b>${state.board.blocks.length}</b></article></div>`;
  const spanMinutes = (state.board.axisEndMs - state.board.axisStartMs) / 60_000;
  const zoomPx = Math.max(
    12,
    Math.min(300, state.calendarZoomPx ?? state.board.calendarHourWidthPx ?? 60),
  );
  const tickMinutes = zoomPx >= 84 ? 60 : zoomPx >= 48 ? 120 : zoomPx >= 24 ? 180 : 360;
  const currentRangeLabel =
    calendarRanges.find((range) => range.value === state.calendarRange)?.label ?? "Total";
  const dateNavigation = `<div class="calendar-day-actions" role="group" aria-label="Navegación por fecha"><button class="button outline small" type="button" data-action="board-shift" data-days="-1" aria-label="Día anterior">←</button><button class="button outline small" type="button" data-action="board-today">Hoy</button><button class="button outline small" type="button" data-action="board-shift" data-days="1" aria-label="Día siguiente">→</button></div><label class="calendar-date-picker">Fecha<input type="date" name="board-date" value="${esc(state.board.date)}"></label>`;
  const tickOffsets = [0];
  for (let offset = tickMinutes; offset < spanMinutes; offset += tickMinutes)
    tickOffsets.push(offset);
  if (tickOffsets.at(-1) !== spanMinutes) tickOffsets.push(spanMinutes);
  const timelineWidth = Math.max(1, Math.ceil((spanMinutes / 60) * zoomPx));
  const dateSuffix = localDate(state.board.axisEndMs) !== state.board.date ? " +1 d" : "";
  const startCounts = new Map<string, number>();
  for (const booking of bookings) {
    const label = time(booking.start);
    startCounts.set(label, (startCounts.get(label) ?? 0) + 1);
  }
  const repeatedStarts = new Set(
    [...startCounts].filter(([, count]) => count > 1).map(([label]) => label),
  );
  const axisMinute = (ms: number) => (ms - state.board.axisStartMs) / 60_000;
  const laneLabels = state.board.lanes
    .map(
      (lane: any) =>
        `<div class="lane-label"><b>${lane.id}</b><span>Pista ${lane.id}</span><small>pareja ${lane.pair_id}</small></div>`,
    )
    .join("");
  const rows = state.board.lanes
    .map((lane: any) => {
      const events = bookings
        .filter((booking: any) => booking.lanes.includes(lane.id))
        .map((booking: any) => {
          const start = Math.max(0, axisMinute(booking.start));
          const end = Math.min(spanMinutes, axisMinute(booking.end));
          const left = (start / spanMinutes) * 100;
          const width = Math.max(0, ((end - start) / spanMinutes) * 100);
          const localStart = time(booking.start);
          const offset = repeatedStarts.has(localStart) ? ` ${booking.utcOffset}` : "";
          return `<button class="event booking-event ${booking.status === "confirmed" ? "booked" : "held"}" style="left:${left}%;width:${width}%" data-action="booking" data-id="${esc(booking.id)}" data-status="${booking.status === "confirmed" ? "confirmed" : "held"}" data-search="${esc(`${booking.customerName} ${booking.code} ${booking.customerPhone ?? ""}`.toLocaleLowerCase("es-CL"))}" title="${esc(booking.customerName)} · ${localStart}${offset}"><b>${esc(booking.customerName)}</b><small>${localStart}${offset} · ${booking.players} pers.</small></button>`;
        })
        .join("");
      const blocks = state.board.blocks
        .filter((block: any) => block.laneId == null || block.laneId === lane.id)
        .map((block: any) => {
          const start = Math.max(0, axisMinute(block.start));
          const end = Math.min(spanMinutes, axisMinute(block.end));
          return `<span class="event blocked" data-action="blocked-slot" style="left:${(start / spanMinutes) * 100}%;width:${Math.max(0, ((end - start) / spanMinutes) * 100)}%" title="${esc(block.reason)}">Bloqueo</span>`;
        })
        .join("");
      return `<div class="track" data-action="calendar-slot" data-date="${esc(state.board.date)}" data-axis-start="${state.board.axisStartMs}" data-axis-end="${state.board.axisEndMs}" style="--tick:${(zoomPx * tickMinutes) / 60}px" role="group" tabindex="0" aria-label="Pista ${lane.id}: selecciona un horario libre para iniciar una reserva">${blocks}${events}</div>`;
    })
    .join("");
  const ticks = tickOffsets
    .map(
      (offset) =>
        `<span style="left:${(offset / spanMinutes) * 100}%">${time(state.board.axisStartMs + offset * 60_000)}${offset === spanMinutes ? dateSuffix : ""}</span>`,
    )
    .join("");
  const boardFilters = `<section class="board-filterbar" aria-label="Buscar reservas del día"><label class="board-search"><span>Encontrar reserva</span><input id="board-booking-search" type="search" value="${esc(state.boardSearch)}" placeholder="Nombre, código o teléfono" autocomplete="off"></label><label class="board-status-filter"><span>Estado</span><select id="board-booking-status"><option value="all" ${state.boardBookingStatus === "all" ? "selected" : ""}>Todos</option><option value="confirmed" ${state.boardBookingStatus === "confirmed" ? "selected" : ""}>Confirmadas</option><option value="held" ${state.boardBookingStatus === "held" ? "selected" : ""}>Retenidas</option></select></label><p id="board-filter-count" aria-live="polite"></p><button class="button ghost small" data-action="board-clear-filters" ${!state.boardSearch && state.boardBookingStatus === "all" ? "disabled" : ""}>Limpiar filtros</button></section>`;
  return `<div class="metrics-wrap">${metrics}</div>${boardFilters}<section class="board-card"><div class="panel-title"><div><h2>Ocupación de pistas</h2><p>${esc(dateText(state.board.date))} · intervalos reales en hora de Santiago</p></div><div class="board-tools"><div class="legend"><span>● Confirmada</span><span>● Retenida</span><span>● Bloqueada</span></div><button class="button outline small" data-action="reoptimize">Reorganizar asignaciones flexibles</button></div></div><div class="calendar-hint"><b>＋ Reserva desde el calendario</b><span>Haz clic en una franja de atención libre para iniciar una reserva con día y hora precargados. Confirmaremos disponibilidad al guardarla.</span></div><div class="calendar-table" style="--calendar-width:${timelineWidth}px"><div class="calendar-sticky-header"><div class="calendar-controls">${dateNavigation}<div class="calendar-zoom" role="group" aria-label="Navegación y zoom horizontal del calendario"><button class="button outline small" type="button" data-action="calendar-scroll" data-direction="left" aria-label="Mostrar horas anteriores">‹</button><button class="button outline small" type="button" data-action="calendar-range-step" data-direction="previous" aria-label="Rango visible anterior">−</button><button type="button" class="calendar-range-button" data-action="calendar-range-cycle" aria-pressed="true" aria-label="Rango visible: ${esc(currentRangeLabel)}. Clic para cambiar" title="Clic para cambiar el rango"><span class="calendar-range-label">${currentRangeLabel}</span><span aria-hidden="true">↻</span></button><button class="button outline small" type="button" data-action="calendar-range-step" data-direction="next" aria-label="Rango visible siguiente">＋</button><button class="button outline small" type="button" data-action="calendar-scroll" data-direction="right" aria-label="Mostrar horas siguientes">›</button></div></div><div class="calendar-axis-spacer" aria-hidden="true"></div><div class="calendar-axis-viewport"><div class="hours"><div class="hour-track">${ticks}</div></div></div></div><div class="calendar-grid"><div class="lane-label-column">${laneLabels}</div><div class="board-scroll">${rows}</div></div></div><small class="board-note">La reorganización fija fecha, hora, duración y pistas contratadas; excluye reservas en preparación, check-in, curso o bloqueo operacional.</small></section><section class="plain-card maintenance-panel"><div class="panel-title"><div><h2>Mantenimiento y bloqueos</h2><p>Un bloqueo nuevo no puede desplazar una reserva ya comprometida.</p></div></div><form id="block-form" class="block-form"><label>Pista<select name="laneId"><option value="">Todas las pistas</option>${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">Pista ${i + 1}</option>`).join("")}</select></label><label>Desde · hora de Santiago<input name="start" type="datetime-local" step="600" value="${esc(state.board.date)}T18:00" required></label><label>Hasta · hora de Santiago<input name="end" type="datetime-local" step="600" value="${esc(state.board.date)}T19:00" required></label><label>Motivo<input name="reason" maxlength="250" required placeholder="Inspección de pista"></label><button class="button outline">＋ Crear bloqueo</button></form>${state.board.blocks.length ? `<div class="block-list">${state.board.blocks.map((block: any) => `<div class="rate-row"><span><b>${block.laneId ? `Pista ${block.laneId}` : "Todas las pistas"} · ${time(block.start)}–${time(block.end)}</b><small>${esc(block.reason)}</small></span><button data-action="release-block" data-id="${esc(block.id)}">Liberar</button></div>`).join("")}</div>` : ""}</section>`;
}
function renderRequests() {
  return `<section class="plain-card"><div class="panel-title"><div><h2>En espera de decisión</h2><p>La solicitud de aprobación conserva las pistas hasta que se resuelva.</p></div><span class="pill">${state.requests.length} pendientes</span></div>${state.requests.length ? state.requests.map((r: any) => `<article class="staff-request"><span class="avatar">${esc(r.name.slice(0, 1))}</span><div><b>${esc(r.name)} <small>${esc(r.code)}</small></b><p>${esc(r.email)} · ${r.players} jugadores · ${r.laneCount} pistas ${r.grouped ? "juntas" : "separadas"}</p><small>${esc(dateText(localDate(r.start)))} · ${time(r.start)}–${time(r.end)}</small><p class="request-status">${r.status === "pending_price_acceptance" ? `Precio por aceptar: ${money(r.updatedQuoteClp)}` : `Retenida · ${money(r.quoteClp)}`}</p></div><div class="actions">${r.status === "pending_approval" ? `<button class="button primary small" data-action="approve" data-id="${esc(r.id)}">Aprobar</button>` : `<span class="tag amber">Precio pendiente</span>`}<button class="button ghost small" data-action="reject" data-id="${esc(r.id)}">Rechazar</button></div></article>`).join("") : `<div class="empty"><b>✓</b><h3>Todo al día</h3><p>No hay solicitudes pendientes de revisión.</p></div>`}</section>`;
}
function renderNewBooking() {
  state.manualKey ??= randomIdempotencyKey();
  const startAt = state.manualStartAt ?? `${state.board?.date ?? state.date}T18:00`;
  return `<section class="new-grid"><div class="plain-card"><span class="eyebrow">RESERVA INTERNA</span><h2>Atención rápida,<br><em>espacio asegurado.</em></h2><p>Teléfono requiere nombre y teléfono. Una reserva presencial futura requiere nombre y un medio de contacto. Inmediata: solo responsable.</p><div class="callout"><b>${state.config?.demoMode ? "Precio de demostración" : state.config?.rateConfigured ? "Tarifa vigente" : "Tarifa pendiente"}</b><span>${state.config?.demoMode ? "No usar para cobro real." : state.config?.rateConfigured ? "El precio se calculará en el momento de guardar." : "Configura una tarifa antes de crear reservas."}</span></div></div><div class="plain-card"><h3>Datos de la reserva</h3><form id="manual"><input type="hidden" name="startMs" value="${state.manualStartMs ?? ""}"><label>Canal<select name="channel"><option value="walk_in">Presencial inmediata</option><option value="phone">Teléfono</option><option value="counter_future">Presencial futura</option></select></label><div class="two-fields"><label>Nombre responsable<input name="name" required maxlength="120"></label><label>Teléfono<input name="phone" type="tel" maxlength="30"></label><label>Correo<input name="email" type="email" maxlength="254"></label><label>Jugadores<input name="players" type="number" min="1" max="72" value="4" required></label><label>Inicio · hora de Santiago<input name="startAt" type="datetime-local" step="600" value="${esc(startAt)}" required></label><label>Duración<select name="duration">${[60, 120, 180, 240].map((n) => `<option value="${n}">${n / 60} ${n === 60 ? "hora" : "horas"}</option>`).join("")}</select></label><label>Pistas contratadas<select name="laneCount"><option value="">Mínimas necesarias</option>${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("")}</select></label><label class="check-row"><input name="separate" type="checkbox"> Cliente acepta pistas separadas</label></div><button class="button primary">Crear y retener pistas →</button></form></div></section>`;
}
function renderAdmin() {
  return renderAdminView(state, days, esc, money);
}
function modalHtml() {
  const b = state.modal.booking;
  const payment = `<form id="payment"><input type="hidden" name="idempotencyKey" value="${esc(state.modal.idempotencyKey)}"><h2 id="modal-title">Registrar movimiento</h2><p>${esc(b.code)} · saldo ${money(b.balanceClp ?? b.quoteClp)}</p><label>Importe CLP<input name="amount" type="number" min="1" required></label><label>Medio<select name="method"><option value="cash">Efectivo</option><option value="transfer">Transferencia</option><option value="external_terminal">Terminal externo</option>${state.user?.role === "admin" ? `<option value="refund">Devolución externa</option>` : ""}</select></label><label>Estado<select name="status"><option value="reported">Informado · verificar después</option><option value="verified">Acreditado externamente</option>${state.user?.role === "admin" ? `<option value="refund_recorded">Devolución externa completada</option>` : ""}</select></label><label>Referencia<input name="reference"></label>${state.user?.role === "admin" ? `<small class="privacy">Una devolución registra una operación ya realizada fuera del sistema; no mueve dinero.</small>` : ""}<button class="button primary">Guardar movimiento</button></form>`;
  const extend = `<form id="extend"><input type="hidden" name="idempotencyKey" value="${esc(state.modal.idempotencyKey)}"><h2 id="modal-title">Extender reserva</h2><p>${esc(b.code)} · ${time(b.end)} término previsto</p><label>Tiempo extra<select name="minutes"><option value="15">15 minutos</option><option value="30">30 minutos</option><option value="60">60 minutos</option></select></label><label class="check-row"><input name="accepted" type="checkbox" required> Cliente acepta el importe y la extensión</label><button class="button primary">Autorizar extensión</button></form>`;
  const absent = `<div><span class="eyebrow">RESOLUCIÓN OPERATIVA</span><h2 id="modal-title">¿Cómo resolver la llegada?</h2><p>Ya pasó la tolerancia inicial. Elige si mantienes el compromiso o liberas las pistas.</p><button class="button outline" data-action="absence" data-id="${esc(b.id)}" data-resolution="keep">Mantener reserva</button><button class="button primary" data-action="absence" data-id="${esc(b.id)}" data-resolution="release">Declarar ausencia y liberar</button></div>`;
  const actions = `${!b.checkedInAt && b.status === "confirmed" ? `<button class="button outline" data-action="checkin" data-id="${esc(b.id)}">Registrar check-in</button>` : ""}${b.checkedInAt && b.status === "confirmed" ? `<button class="button outline" data-action="finish" data-id="${esc(b.id)}">Registrar término</button><button class="button outline" data-action="extend-modal" data-id="${esc(b.id)}">Extender</button>` : ""}${!b.checkedInAt && b.status === "confirmed" && Date.now() >= b.start + (state.config?.lateArrivalToleranceMinutes ?? 10) * 60000 ? `<button class="button outline" data-action="absence-modal" data-id="${esc(b.id)}">Resolver ausencia</button>` : ""}${b.status === "confirmed" ? `<button class="button ghost" data-action="cancel-booking" data-id="${esc(b.id)}">Cancelar reserva</button>` : ""}<button class="button outline" data-action="payment-modal" data-id="${esc(b.id)}">Registrar pago</button>`;
  const paymentHistory = `<div class="payment-history"><h3>Pagos y movimientos</h3>${(b.payments ?? []).length ? b.payments.map((payment: any) => `<div class="rate-row"><span><b>${money(payment.amount_clp)} · ${esc(payment.method)}</b><small>${esc(payment.status)}${payment.reference ? ` · ${esc(payment.reference)}` : ""} · ${new Date(payment.created_at).toLocaleString("es-CL")}</small></span>${payment.status === "reported" ? `<button class="button outline small" data-action="verify-payment" data-id="${esc(payment.id)}">Verificar</button>${state.user?.role === "admin" ? `<button class="button ghost small" data-action="void-payment" data-id="${esc(payment.id)}">Corregir</button>` : ""}` : ""}</div>`).join("") : `<p class="muted">No hay movimientos registrados.</p>`}</div>`;
  const detail = `<div><button data-action="close" class="close" aria-label="Cerrar ficha de reserva">×</button><span class="eyebrow">FICHA DE RESERVA</span><h2 id="modal-title">${esc(b.code)}</h2><b>${esc(b.customerName)}</b><div class="detail-grid"><span>Horario<b>${time(b.start)}${b.ambiguousLocalTime ? ` · ${esc(b.utcOffset)}` : ""}–${time(b.end)}</b></span><span>Estado<b>${esc(b.status)} · ${esc(b.inventoryStatus)}</b></span><span>Grupo<b>${b.players} jugadores</b></span><span>Pistas<b>${(b.lanes ?? []).join(", ")}</b></span><span>Total<b>${money(b.quoteClp)}</b></span><span>Contacto<b>${esc(b.customerPhone || b.customerEmail || "No informado")}</b></span></div>${paymentHistory}${actions}</div>`;
  return `<div class="modal-shade" data-action="outside"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">${state.modal.kind === "payment" ? payment : state.modal.kind === "extend" ? extend : state.modal.kind === "absence" ? absent : detail}<button class="text-button" data-action="close">Volver</button></div></div>`;
}
function render() {
  if (state.view === "book") renderBook();
  else renderStaff();
  if (document.querySelector(".board-filterbar")) applyBoardFilters();
  const scroller = document.querySelector<HTMLElement>(".board-scroll");
  if (scroller) {
    const axisHours = (state.board.axisEndMs - state.board.axisStartMs) / 3_600_000;
    if (!state.calendarZoomCustomized && axisHours > 0) {
      const baseZoom = state.board.calendarHourWidthPx ?? 60;
      const totalZoom = Math.max(12, Math.min(baseZoom, scroller.clientWidth / axisHours));
      if (Math.abs((state.calendarZoomPx ?? baseZoom) - totalZoom) > 0.2) {
        state.calendarZoomPx = totalZoom;
        render();
        return;
      }
    }
    scroller.addEventListener("scroll", updateCalendarControls, { passive: true });
    updateCalendarControls();
  }
}
function updateCalendarControls() {
  const scroller = document.querySelector<HTMLElement>(".board-scroll");
  if (!scroller || !state.board) return;
  const scrollable = scroller.scrollWidth > scroller.clientWidth + 1;
  const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
  const axisTrack = document.querySelector<HTMLElement>(".calendar-axis-viewport .hour-track");
  if (axisTrack) axisTrack.style.transform = `translateX(${-scroller.scrollLeft}px)`;
  const zoom = state.calendarZoomPx ?? state.board.calendarHourWidthPx ?? 60;
  const selectedRange = visibleCalendarRange(
    zoom,
    scroller.clientWidth,
    state.calendarZoomCustomized,
  );
  state.calendarRange = selectedRange.value;
  const rangeButton = document.querySelector<HTMLButtonElement>(".calendar-range-button");
  if (rangeButton) {
    const label = rangeButton.querySelector<HTMLElement>(".calendar-range-label");
    if (label) label.textContent = selectedRange.label;
    rangeButton.setAttribute("aria-pressed", "true");
    rangeButton.setAttribute(
      "aria-label",
      `Rango visible: ${selectedRange.label}. Clic para cambiar`,
    );
  }
  const left = document.querySelector<HTMLButtonElement>(
    '[data-action="calendar-scroll"][data-direction="left"]',
  );
  const right = document.querySelector<HTMLButtonElement>(
    '[data-action="calendar-scroll"][data-direction="right"]',
  );
  if (left) left.disabled = !scrollable || scroller.scrollLeft <= 1;
  if (right) right.disabled = !scrollable || scroller.scrollLeft >= maxScroll - 1;
}
async function loadStaff(date = state.board?.date ?? localDate(Date.now())) {
  if (!state.user) return;
  const [board, requests] = await Promise.all([
    api(`/api/staff/board?date=${encodeURIComponent(date)}`),
    api("/api/staff/requests"),
  ]);
  state.board = board;
  if (!state.calendarZoomCustomized) state.calendarZoomPx = board.calendarHourWidthPx ?? 60;
  state.requests = requests.requests;
  if (state.view === "staff") render();
}
async function loadAdmin() {
  const [settings, audit, outbox] = await Promise.all([
    api("/api/staff/settings"),
    api("/api/staff/audit"),
    api<any>("/api/staff/emails"),
  ]);
  state.settings = settings;
  state.audit = audit.events;
  state.outbox = outbox.emails;
  render();
}
async function loadManage() {
  try {
    const d = await api("/api/manage", {
      headers: { authorization: `Bearer ${state.manageToken}` },
    });
    state.managed = {
      ...d.booking,
      statusLabel:
        d.booking.status === "confirmed"
          ? "Reserva confirmada"
          : d.booking.status.replaceAll("_", " "),
      requestStatus: d.requestStatus,
      updatedQuoteClp: d.updatedQuoteClp,
    };
    state.manageLoadFailed = false;
  } catch (e) {
    state.managed = null;
    state.manageLoadFailed = true;
    say(errorMessage(e), "error");
  }
  render();
}
async function init() {
  try {
    state.config = await api("/api/public-config");
  } catch {
    /* API may start after Vite */
  }
  try {
    state.user = (await api("/api/auth/me")).user as User | null;
  } catch {
    state.user = null;
  }
  render();
  if (state.manageToken) void loadManage();
  if (state.user && state.view === "staff") {
    if (state.staffEntry === "admin") {
      if (state.user.role === "admin") void loadAdmin();
    } else {
      void loadStaff();
    }
  }
}

app.addEventListener("submit", async (event) => {
  const form = (event.target as HTMLElement).closest("form");
  if (!form) return;
  event.preventDefault();
  state.message = "";
  const d = new FormData(form);
  const v = (n: string) => fieldValue(d.get(n));
  try {
    if (form.id === "search") {
      state.date = v("date");
      state.time = v("time");
      state.players = Number(v("players"));
      state.duration = Number(v("duration"));
      state.separated = d.has("separated");
      state.selected = null;
      state.result = null;
      state.proof = "";
      state.options = [];
      state.loading = true;
      state.availabilitySearched = false;
      render();
      const q = new URLSearchParams({
        date: state.date,
        time: state.time,
        players: `${state.players}`,
        duration: `${state.duration}`,
        acceptSeparated: `${state.separated}`,
      });
      const result = await api<any>(`/api/availability?${q}`);
      state.options = result.alternatives;
      state.loading = false;
      state.availabilitySearched = true;
      if (state.options.length)
        say(`${state.options.length} alternativas disponibles. Elige la que prefieres.`, "success");
      render();
      const results = document.querySelector<HTMLElement>(".options, .availability-empty");
      results?.scrollIntoView({ behavior: "smooth" });
      if (state.options.length)
        document.querySelector<HTMLButtonElement>('.option-card [data-action="select"]')?.focus({
          preventScroll: true,
        });
      else results?.focus({ preventScroll: true });
      return;
    }
    if (form.id === "request") {
      const email = v("email").toLowerCase();
      state.requestName = v("name");
      state.requestEmail = v("email");
      state.verificationCode = v("code");
      state.requestTermsAccepted = d.has("terms");
      if (!state.proof || state.verifiedEmail !== email)
        throw new Error("Verifica el correo que aparece en el formulario.");
      const result = await api<any>("/api/requests", {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: state.requestKey,
          emailProof: state.proof,
          customerName: v("name"),
          email,
          startAt: state.selected.startAt,
          startMs: state.selected.startMs,
          players: state.players,
          durationMinutes: state.duration,
          laneCount: state.selected.laneCount,
          acceptSeparated: !state.selected.grouped,
          acceptTerms: d.has("terms"),
        }),
      });
      state.result = result;
      state.requestKey = randomIdempotencyKey();
      state.selected = null;
      state.proof = "";
      state.requestName = "";
      state.requestEmail = "";
      state.verificationCode = "";
      state.requestTermsAccepted = false;
      state.options = [];
      say(
        result.status === "confirmed"
          ? "Tu reserva quedó confirmada."
          : "Solicitud retenida y enviada a recepción.",
        "success",
      );
      render();
      const resultCard = document.querySelector<HTMLElement>(".result-card");
      resultCard?.scrollIntoView({ behavior: "smooth", block: "center" });
      resultCard?.focus({ preventScroll: true });
      return;
    }
    if (form.id === "manage-renew") {
      if (!state.manageProof || state.manageEmail !== v("email").toLowerCase())
        throw new Error("Verifica el correo de la reserva antes de continuar.");
      const result = await api<any>("/api/manage/renew", {
        method: "POST",
        body: JSON.stringify({
          email: state.manageEmail,
          code: v("bookingCode"),
          emailProof: state.manageProof,
        }),
      });
      state.manageProof = "";
      if (result.manageLink) {
        const renewed = new URL(result.manageLink);
        state.manageToken = renewed.searchParams.get("token");
        history.replaceState({}, "", renewed.pathname + renewed.search);
        await loadManage();
        say(
          result.notificationPending
            ? "Enviamos el enlace; el correo está pendiente de reintento."
            : "Enlace renovado y correo enviado.",
          "success",
        );
      } else {
        state.manageToken = null;
        state.managed = null;
        state.manageLoadFailed = true;
        say(
          "Si el código coincide con el correo verificado, recibirás un enlace válido por 24 horas.",
          "success",
        );
        render();
      }
      return;
    }
    if (form.id === "login") {
      const r = await api<any>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: v("email"), password: v("password") }),
      });
      if (state.staffEntry === "admin" && r.user.role !== "admin") {
        await api("/api/auth/logout", { method: "POST" });
        throw new Error("Esta dirección está disponible solo para cuentas administradoras.");
      }
      state.user = r.user;
      state.view = "staff";
      state.page = state.staffEntry === "admin" ? "settings" : "board";
      if (state.page === "settings") await loadAdmin();
      else await loadStaff();
      say("Sesión iniciada.", "success");
      render();
      return;
    }
    if (form.id === "manual") {
      const startAt = v("startAt");
      const r = await api<any>("/api/staff/bookings", {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: state.manualKey,
          channel: v("channel"),
          customerName: v("name"),
          phone: v("phone"),
          email: v("email"),
          players: +v("players"),
          startAt,
          startMs: v("startMs") ? +v("startMs") : undefined,
          durationMinutes: +v("duration"),
          laneCount: v("laneCount") ? +v("laneCount") : undefined,
          acceptSeparated: d.has("separate"),
        }),
      });
      state.manualKey = randomIdempotencyKey();
      state.manualStartAt = null;
      state.manualStartMs = null;
      state.page = "board";
      await loadStaff(localDate(localEpoch(startAt)));
      say(`Reserva ${r.booking.code} creada · ${money(r.booking.quoteClp)}.`, "success");
      render();
      return;
    }
    if (form.id === "block-form") {
      const startMs = localEpoch(v("start")),
        endMs = localEpoch(v("end"));
      if (endMs <= startMs) throw new Error("El término debe ser posterior al inicio.");
      await api("/api/staff/blocks", {
        method: "POST",
        body: JSON.stringify({
          laneId: v("laneId") ? +v("laneId") : null,
          startMs,
          endMs,
          reason: v("reason"),
        }),
      });
      await loadStaff(state.board.date);
      say("Bloqueo de mantenimiento creado y auditado.", "success");
      render();
      return;
    }
    if (form.id === "calendar-settings") {
      const calendarHourWidthPx = +v("calendarWidth");
      await api("/api/staff/settings", {
        method: "PUT",
        body: JSON.stringify({ calendarHourWidthPx }),
      });
      state.calendarZoomPx = calendarHourWidthPx;
      state.calendarZoomCustomized = false;
      if (state.board) state.board.calendarHourWidthPx = calendarHourWidthPx;
      await loadAdmin();
      say("Escala del calendario guardada.", "success");
      render();
      return;
    }
    if (form.id === "settings") {
      const weeklyHours: Record<string, any> = {};
      for (let n = 0; n < 7; n++) {
        if (d.has(`closed-${n}`)) {
          weeklyHours[n] = { closed: true };
          continue;
        }
        const open = v(`open-${n}`);
        const close = v(`close-${n}`);
        if (!open || !close)
          throw new Error(`${days[n]} necesita apertura y cierre, o marca “Cerrado”.`);
        weeklyHours[n] = { open, close };
      }
      await api("/api/staff/settings", {
        method: "PUT",
        body: JSON.stringify({
          venueName: v("venue"),
          generalRateClpPerLaneHour: +v("rate"),
          preparationMinutes: +v("prep"),
          closingMarginMinutes: +v("closing"),
          startIntervalMinutes: +v("step"),
          minimumAdvanceMinutes: +v("minimum"),
          maximumAdvanceDays: +v("maximum"),
          requireManualApprovalFromLanes: +v("approval"),
          lateArrivalToleranceMinutes: +v("late"),
          weeklyHours,
        }),
      });
      state.config = await api("/api/public-config");
      await loadAdmin();
      say("Configuración guardada y auditada.", "success");
      render();
      return;
    }
    if (form.id === "band") {
      const rateBands = [
        ...state.settings.rateBands,
        {
          weekday: +v("weekday"),
          start: v("start"),
          end: v("end"),
          rateClpPerLaneHour: +v("rate"),
        },
      ];
      await api("/api/staff/settings", { method: "PUT", body: JSON.stringify({ rateBands }) });
      await loadAdmin();
      say("Franja tarifaria agregada.", "success");
      render();
      return;
    }
    if (form.id === "rate-exception") {
      const rateExceptions = {
        ...state.settings.rateExceptions,
        [v("date")]: { rateClpPerLaneHour: +v("rate") },
      };
      await api("/api/staff/settings", { method: "PUT", body: JSON.stringify({ rateExceptions }) });
      await loadAdmin();
      say("Tarifa por fecha guardada.", "success");
      render();
      return;
    }
    if (form.id === "exception") {
      const exceptions = {
        ...state.settings.exceptions,
        [v("date")]: d.has("closed") ? { closed: true } : { open: v("open"), close: v("close") },
      };
      await api("/api/staff/settings", { method: "PUT", body: JSON.stringify({ exceptions }) });
      await loadAdmin();
      say("Excepción de fecha guardada.", "success");
      render();
      return;
    }
    if (form.id === "promo") {
      const startsAt = localEpoch(v("start")),
        endsAt = localEpoch(v("end"));
      if (endsAt <= startsAt) throw new Error("El término debe ser posterior al inicio.");
      const promotions = [
        ...state.settings.promotions,
        { name: v("name"), enabled: true, kind: v("kind"), value: +v("value"), startsAt, endsAt },
      ];
      await api("/api/staff/settings", { method: "PUT", body: JSON.stringify({ promotions }) });
      await loadAdmin();
      say("Promoción creada.", "success");
      render();
      return;
    }
    if (form.id === "user") {
      await api("/api/staff/users", {
        method: "POST",
        body: JSON.stringify({
          name: v("name"),
          email: v("email"),
          password: v("password"),
          role: v("role"),
        }),
      });
      await loadAdmin();
      say("Usuario creado.", "success");
      render();
      return;
    }
    if (form.id === "payment") {
      await api(`/api/staff/bookings/${state.modal.booking.id}/payments`, {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: v("idempotencyKey"),
          amountClp: +v("amount"),
          method: v("method"),
          status: v("status"),
          reference: v("reference"),
        }),
      });
      state.modal = null;
      await loadStaff();
      say("Movimiento de pago registrado.", "success");
      render();
      return;
    }
    if (form.id === "extend") {
      await api(`/api/staff/bookings/${state.modal.booking.id}/extend`, {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: v("idempotencyKey"),
          minutes: +v("minutes"),
          customerAccepted: d.has("accepted"),
        }),
      });
      state.modal = null;
      await loadStaff();
      say("Extensión autorizada y registrada.", "success");
      render();
      return;
    }
  } catch (e) {
    state.loading = false;
    say(errorMessage(e), "error");
    render();
    document.querySelector<HTMLElement>(".notice")?.focus({ preventScroll: true });
  }
});
app.addEventListener("input", (event) => {
  const input = event.target as HTMLInputElement;
  if (input.id === "board-booking-search") {
    state.boardSearch = input.value;
    applyBoardFilters();
    return;
  }
  if (input.form?.id === "search") {
    if (input.name === "date") {
      state.date = input.value;
      if (
        state.date < state.dateWindowStart ||
        state.date > addCalendarDays(state.dateWindowStart, 6)
      )
        state.dateWindowStart = state.date;
    }
    if (input.name === "time") state.time = input.value;
    if (input.name === "players") state.players = Number(input.value);
    if (input.name === "duration") state.duration = Number(input.value);
    return;
  }
  if (input.form?.id !== "request") return;
  if (input.name === "name") state.requestName = input.value;
  if (input.name === "email") state.requestEmail = input.value;
  if (input.name === "code") state.verificationCode = input.value;
});
app.addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  const closedDay = /^closed-(\d)$/.exec(input.name);
  if (closedDay) {
    const row = input.closest<HTMLElement>(".hours-day");
    row
      ?.querySelectorAll<HTMLInputElement>('.hours-time input[type="time"]')
      .forEach((timeInput) => {
        timeInput.disabled = input.checked;
        timeInput.required = !input.checked;
      });
  }
  if (input.id === "board-booking-status") {
    state.boardBookingStatus = input.value;
    applyBoardFilters();
  }
  if (input.form?.id === "request" && input.name === "terms")
    state.requestTermsAccepted = input.checked;
  if (input.name === "board-date") void loadStaff(input.value);
  if (input.name === "startAt") {
    const exactStart = document.querySelector<HTMLInputElement>('#manual [name="startMs"]');
    state.manualStartAt = input.value;
    if (exactStart) {
      try {
        state.manualStartMs = localEpoch(input.value);
        exactStart.value = `${state.manualStartMs}`;
      } catch {
        state.manualStartMs = null;
        exactStart.value = "";
      }
    }
  }
});
app.addEventListener("click", async (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!target) return;
  const action = target.dataset.action!,
    id = target.dataset.id;
  try {
    if (action === "admin-section") {
      state.adminSection = target.dataset.section ?? "general";
      render();
      return;
    }
    if (action === "board-open-requests") {
      state.page = "requests";
      render();
      await loadStaff();
      return;
    }
    if (action === "board-clear-filters") {
      state.boardSearch = "";
      state.boardBookingStatus = "all";
      render();
      document.querySelector<HTMLButtonElement>('[data-action="board-clear-filters"]')?.focus();
      return;
    }
    if (action === "date-select") {
      state.date = target.dataset.date!;
      state.options = [];
      state.availabilitySearched = false;
      state.selected = null;
      state.result = null;
      state.proof = "";
      render();
      document
        .querySelector<HTMLButtonElement>(`[data-action="date-select"][data-date="${state.date}"]`)
        ?.focus();
      return;
    }
    if (action === "date-week") {
      const direction = target.dataset.direction === "next" ? 7 : -7;
      const today = localDate(Date.now());
      const maxDate = addCalendarDays(today, state.config?.maximumAdvanceDays ?? 60);
      const lastWindowStart = addCalendarDays(maxDate, -6);
      const nextDate = addCalendarDays(state.date, direction);
      const nextWindowStart = addCalendarDays(state.dateWindowStart, direction);
      state.date = nextDate < today ? today : nextDate > maxDate ? maxDate : nextDate;
      state.dateWindowStart =
        nextWindowStart < today
          ? today
          : nextWindowStart > lastWindowStart
            ? lastWindowStart
            : nextWindowStart;
      state.options = [];
      state.availabilitySearched = false;
      state.selected = null;
      state.result = null;
      state.proof = "";
      render();
      document
        .querySelector<HTMLButtonElement>(
          `[data-action="date-week"][data-direction="${target.dataset.direction}"]`,
        )
        ?.focus();
      return;
    }
    if (action === "players-adjust") {
      state.players = Math.max(1, Math.min(72, state.players + Number(target.dataset.step)));
      state.options = [];
      state.availabilitySearched = false;
      state.selected = null;
      state.result = null;
      state.proof = "";
      render();
      document
        .querySelector<HTMLButtonElement>(
          `[data-action="players-adjust"][data-step="${target.dataset.step}"]`,
        )
        ?.focus();
      return;
    }
    if (action === "calendar-slot") {
      const start = Number(target.dataset.axisStart);
      const end = Number(target.dataset.axisEnd);
      const intervalMs = (state.config?.startIntervalMinutes ?? 10) * 60_000;
      const bounds = target.getBoundingClientRect();
      const fraction =
        event.detail === 0
          ? 0.5
          : Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
      const startMs = calendarStartAtFraction(start, end, intervalMs, fraction);
      const date = target.dataset.date!;
      if (!isWithinOperatingHours(startMs, state.board.operatingHours)) {
        say("Ese intervalo está fuera del horario de atención.", "info");
        render();
        return;
      }
      state.manualStartAt = localDateTime(startMs);
      state.manualStartMs = startMs;
      state.date = date;
      state.page = "new";
      say(
        `Inicio precargado: ${dateText(state.date)} a las ${time(startMs)}. La disponibilidad se validará al guardar.`,
        "info",
      );
      render();
      document.querySelector<HTMLInputElement>('#manual [name="name"]')?.focus();
      return;
    }
    if (action === "blocked-slot") {
      say("Ese intervalo está reservado para mantenimiento.", "info");
      render();
      return;
    }
    if (action === "board-shift" || action === "board-today") {
      const date =
        action === "board-today"
          ? localDate(Date.now())
          : addCalendarDays(state.board.date, Number(target.dataset.days));
      await loadStaff(date);
      return;
    }
    if (action === "calendar-range-cycle" || action === "calendar-range-step") {
      const scroller = document.querySelector<HTMLElement>(".board-scroll");
      if (!scroller) return;
      const step =
        action === "calendar-range-cycle" || target.dataset.direction === "next" ? 1 : -1;
      const range = shiftCalendarRange(state.calendarRange, step);
      const oldZoom = state.calendarZoomPx ?? state.board.calendarHourWidthPx ?? 60;
      const viewportWidth = scroller.clientWidth;
      const durationHours = (state.board.axisEndMs - state.board.axisStartMs) / 3_600_000;
      const newZoom = zoomForCalendarRange(
        range,
        viewportWidth,
        durationHours,
        state.board.calendarHourWidthPx ?? 60,
      );
      const centerScrollLeft = scroller.scrollLeft;
      state.calendarZoomPx = newZoom;
      state.calendarZoomCustomized = range.value !== "total";
      state.calendarRange = range.value;
      render();
      const updatedScroller = document.querySelector<HTMLElement>(".board-scroll");
      if (updatedScroller) {
        updatedScroller.scrollLeft =
          range.value === "total"
            ? 0
            : Math.max(
                0,
                (centerScrollLeft + viewportWidth / 2) * (newZoom / oldZoom) - viewportWidth / 2,
              );
      }
      updateCalendarControls();
      return;
    }
    if (action === "calendar-scroll") {
      const scroller = document.querySelector<HTMLElement>(".board-scroll");
      if (scroller) {
        scroller.scrollBy({
          left: scroller.clientWidth * 0.8 * (target.dataset.direction === "left" ? -1 : 1),
          behavior: "smooth",
        });
      }
      return;
    }
    if (action === "clear") {
      state.message = "";
      render();
    }
    if (action === "nav") {
      if (target.dataset.view === "staff") {
        location.assign(appPaths.reception);
        return;
      }
      state.view = "book";
      state.staffEntry = null;
      state.manageToken = null;
      history.replaceState({}, "", appPaths.public);
      render();
    }
    if (action === "select") {
      state.selected = state.options.find(
        (x: Option) => x.startMs === Number(target.dataset.start),
      );
      state.proof = "";
      state.verifiedEmail = "";
      state.requestName = "";
      state.requestEmail = "";
      state.verificationCode = "";
      state.requestTermsAccepted = false;
      state.result = null;
      state.requestKey = randomIdempotencyKey();
      render();
      document.querySelector(".request-card")?.scrollIntoView({ behavior: "smooth" });
      document.querySelector<HTMLInputElement>('#request [name="name"]')?.focus({
        preventScroll: true,
      });
    }
    if (action === "clear-selection") {
      state.selected = null;
      state.proof = "";
      state.requestName = "";
      state.requestEmail = "";
      state.verificationCode = "";
      state.requestTermsAccepted = false;
      render();
    }
    if (action === "send-code") {
      const d = new FormData(document.querySelector<HTMLFormElement>("#request")!);
      const email = fieldValue(d.get("email"));
      if (!email) throw new Error("Ingresa un correo primero.");
      state.requestName = fieldValue(d.get("name"));
      state.requestEmail = email;
      state.verificationCode = fieldValue(d.get("code"));
      state.requestTermsAccepted = d.has("terms");
      await api("/api/email/start", { method: "POST", body: JSON.stringify({ email }) });
      say(
        state.config?.demoMode
          ? "Código enviado al registro de correo de desarrollo del servidor."
          : "Enviamos un código de seis dígitos.",
        "success",
      );
      render();
    }
    if (action === "manage-send-code") {
      const form = document.querySelector<HTMLFormElement>("#manage-renew")!;
      const d = new FormData(form);
      const email = fieldValue(d.get("email")).toLowerCase();
      if (!email) throw new Error("Ingresa el correo de la reserva.");
      await api("/api/email/start", { method: "POST", body: JSON.stringify({ email }) });
      state.manageEmail = email;
      state.manageBookingCode = fieldValue(d.get("bookingCode"));
      say(
        state.config?.demoMode
          ? "Código enviado al registro de correo de desarrollo del servidor."
          : "Enviamos un código de seis dígitos.",
        "success",
      );
      render();
    }
    if (action === "manage-verify") {
      const d = new FormData(document.querySelector<HTMLFormElement>("#manage-renew")!);
      const email = fieldValue(d.get("email")).toLowerCase();
      const code = fieldValue(d.get("verificationCode"));
      const r = await api<any>("/api/email/complete", {
        method: "POST",
        body: JSON.stringify({ email, code }),
      });
      state.manageEmail = email;
      state.manageBookingCode = fieldValue(d.get("bookingCode"));
      state.manageProof = r.emailProof;
      say("Correo verificado. Ya puedes solicitar un nuevo enlace.", "success");
      render();
    }
    if (action === "verify") {
      const d = new FormData(document.querySelector<HTMLFormElement>("#request")!);
      const email = fieldValue(d.get("email")).toLowerCase();
      state.requestName = fieldValue(d.get("name"));
      state.requestEmail = fieldValue(d.get("email"));
      state.verificationCode = fieldValue(d.get("code"));
      state.requestTermsAccepted = d.has("terms");
      const r = await api<any>("/api/email/complete", {
        method: "POST",
        body: JSON.stringify({ email, code: fieldValue(d.get("code")) }),
      });
      state.proof = r.emailProof;
      state.verifiedEmail = email;
      say("Correo verificado. Revalidaremos disponibilidad al enviar.", "success");
      render();
    }
    if (action === "logout") {
      await api("/api/auth/logout", { method: "POST" });
      state.user = null;
      state.view = "staff";
      render();
    }
    if (action === "page") {
      state.page = target.dataset.page;
      render();
      if (state.page === "settings") await loadAdmin();
      else await loadStaff();
    }
    if (action === "approve" || action === "reject") {
      await api(`/api/staff/requests/${id}/${action === "approve" ? "approve" : "reject"}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await loadStaff();
      say(
        action === "approve"
          ? "Solicitud actualizada; el precio puede requerir aceptación."
          : "Solicitud rechazada y pistas liberadas.",
        "success",
      );
      render();
    }
    if (action === "booking") {
      state.modal = {
        kind: "detail",
        booking: state.board.reservations.find((b: any) => b.id === id),
      };
      render();
    }
    if (action === "reoptimize") {
      if (
        !confirm(
          "¿Reorganizar las pistas de reservas futuras flexibles para esta fecha? Se conservan horarios y condiciones confirmadas.",
        )
      )
        return;
      const result = await api<any>("/api/staff/reoptimize", {
        method: "POST",
        body: JSON.stringify({ date: state.board.date }),
      });
      await loadStaff(state.board.date);
      say(`${result.message} ${result.changed.length} asignaciones cambiadas.`, "success");
      render();
    }
    if (action === "payment-modal" || action === "extend-modal") {
      const booking =
        state.board?.reservations.find((b: any) => b.id === id) ?? state.modal?.booking;
      state.modal = {
        kind: action === "payment-modal" ? "payment" : "extend",
        idempotencyKey: randomIdempotencyKey(),
        booking,
      };
      render();
    }
    if (action === "absence-modal") {
      state.modal = {
        kind: "absence",
        booking: state.board.reservations.find((b: any) => b.id === id),
      };
      render();
    }
    if (action === "close" || (action === "outside" && event.target === target)) {
      state.modal = null;
      render();
    }
    if (action === "checkin") {
      await api(`/api/staff/bookings/${id}/checkin`, { method: "POST", body: JSON.stringify({}) });
      state.modal = null;
      await loadStaff();
      say("Check-in registrado. La pista quedó fijada.", "success");
      render();
    }
    if (action === "finish") {
      if (
        !confirm(
          "¿Registrar el término real? La pista vuelve al inventario después del tiempo de preparación.",
        )
      )
        return;
      await api(`/api/staff/bookings/${id}/finish`, { method: "POST", body: JSON.stringify({}) });
      state.modal = null;
      await loadStaff();
      say("Término real registrado.", "success");
      render();
    }
    if (action === "absence") {
      const resolution = target.dataset.resolution;
      await api(`/api/staff/bookings/${id}/resolve-absence`, {
        method: "POST",
        body: JSON.stringify({ resolution }),
      });
      state.modal = null;
      await loadStaff();
      say(
        resolution === "release"
          ? "Ausencia declarada manualmente; las pistas quedaron liberadas."
          : "Reserva mantenida por decisión de recepción.",
        "success",
      );
      render();
    }
    if (action === "cancel-booking") {
      if (
        !confirm("¿Cancelar esta reserva? Una cancelación tardía requiere decisión administrativa.")
      )
        return;
      await api(`/api/staff/bookings/${id}/cancel`, { method: "POST", body: JSON.stringify({}) });
      state.modal = null;
      await loadStaff();
      say("Reserva cancelada y capacidad liberada.", "success");
      render();
    }
    if (action === "verify-payment") {
      await api(`/api/staff/payments/${id}/verify`, { method: "POST", body: JSON.stringify({}) });
      state.modal = null;
      await loadStaff();
      say("Pago acreditado externamente y auditoría actualizada.", "success");
      render();
    }
    if (action === "void-payment") {
      const reason = prompt("Motivo para corregir el pago informado:");
      if (!reason) return;
      await api(`/api/staff/payments/${id}/void`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      state.modal = null;
      await loadStaff();
      say("Pago informado anulado mediante operación auditable.", "success");
      render();
    }
    if (action === "customer-cancel") {
      if (
        !confirm(
          "¿Cancelar y liberar las pistas? Los pagos y devoluciones se gestionan por separado.",
        )
      )
        return;
      await api("/api/manage/cancel", {
        method: "POST",
        headers: { authorization: `Bearer ${state.manageToken}` },
        body: JSON.stringify({}),
      });
      state.managed.status = "cancelled";
      state.managed.statusLabel = "Cancelada";
      say("Reserva cancelada.", "success");
      render();
    }
    if (action === "accept-price") {
      await api("/api/manage/accept-price", {
        method: "POST",
        headers: { authorization: `Bearer ${state.manageToken}` },
        body: JSON.stringify({ accept: true }),
      });
      await loadManage();
      say("Precio aceptado. Reserva confirmada.", "success");
      render();
    }
    if (action === "leave-manage") {
      state.manageToken = null;
      state.managed = null;
      history.replaceState({}, "", appPaths.public);
      state.view = "book";
      render();
    }
    if (action === "remove-band") {
      const rateBands = state.settings.rateBands.filter(
        (_: any, i: number) => i !== Number(target.dataset.index ?? "-1"),
      );
      await api("/api/staff/settings", { method: "PUT", body: JSON.stringify({ rateBands }) });
      await loadAdmin();
      say("Franja eliminada.", "success");
      render();
    }
    if (action === "remove-rate-exception") {
      const rateExceptions = { ...state.settings.rateExceptions };
      delete rateExceptions[target.dataset.date!];
      await api("/api/staff/settings", { method: "PUT", body: JSON.stringify({ rateExceptions }) });
      await loadAdmin();
      say("Tarifa por fecha eliminada.", "success");
      render();
    }
    if (action === "remove-promo") {
      const promotions = state.settings.promotions.filter(
        (_: any, i: number) => i !== Number(target.dataset.index ?? "-1"),
      );
      await api("/api/staff/settings", { method: "PUT", body: JSON.stringify({ promotions }) });
      await loadAdmin();
      say("Promoción eliminada.", "success");
      render();
    }
    if (action === "remove-exception") {
      const exceptions = { ...state.settings.exceptions };
      delete exceptions[target.dataset.date!];
      await api("/api/staff/settings", { method: "PUT", body: JSON.stringify({ exceptions }) });
      await loadAdmin();
      say("Excepción eliminada.", "success");
      render();
    }
    if (action === "user-status") {
      const active = target.dataset.active === "true";
      await api(`/api/staff/users/${id}/status`, {
        method: "POST",
        body: JSON.stringify({ active }),
      });
      await loadAdmin();
      say(active ? "Cuenta reactivada." : "Cuenta desactivada y sesiones revocadas.", "success");
      render();
    }
    if (action === "retry-email") {
      const result = await api<any>(`/api/staff/emails/${id}/retry`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await loadAdmin();
      say(
        result.sent
          ? "Correo enviado."
          : "El envío sigue pendiente; volverá a intentarse automáticamente.",
        result.sent ? "success" : "info",
      );
      render();
    }
    if (action === "release-block") {
      await api(`/api/staff/blocks/${id}`, { method: "DELETE" });
      await loadStaff(state.board.date);
      say("Bloqueo liberado.", "success");
      render();
    }
  } catch (e) {
    say(errorMessage(e), "error");
    render();
  }
});
app.addEventListener("keydown", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>(
    '[data-action="calendar-slot"]',
  );
  if (target && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    target.click();
  }
});
void init();
