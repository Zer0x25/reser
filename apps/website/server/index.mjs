import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import {
  calculateQuote,
  findAlternatives,
  formatLocalDate,
  formatLocalTime,
  isWholeHourBookingDuration,
  isPhysicallyGrouped,
  localDateTimeToEpoch,
  matchesHours,
  minimumLanes,
  parseLocalDay,
  selectLaneSetAtTime,
} from "./domain.mjs";
import {
  audit,
  blocksForRange,
  db,
  demoMode,
  getSettings,
  reservationsForRange,
  saveSettings,
  transaction,
} from "./db.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT ?? 3001);
const tokenSecret =
  process.env.TOKEN_SECRET ??
  (demoMode ? "local-development-token-secret-change-in-production" : null);
if (!tokenSecret || Buffer.byteLength(tokenSecret) < 32)
  throw new Error("Production startup requires a stable TOKEN_SECRET of at least 32 bytes.");
const sessionHours = 12;
const manageHours = 24;
const rateLimits = new Map();
const requestedPlaywrightLoginLimit = Number(process.env.PLAYWRIGHT_LOGIN_ATTEMPT_LIMIT);
const loginAttemptLimit =
  process.env.NODE_ENV === "development" &&
  process.env.MVP_MODE === "demo" &&
  Number.isInteger(requestedPlaywrightLoginLimit)
    ? Math.max(8, Math.min(100, requestedPlaywrightLoginLimit))
    : 8;
const supportedScheduleIntervals = [5, 10, 12, 15, 20, 30, 60];
const extensionDurationsFor = (intervalMinutes) =>
  Array.from(
    { length: Math.floor(60 / intervalMinutes) },
    (_, index) => (index + 1) * intervalMinutes,
  );
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
function digest(value) {
  return createHmac("sha256", tokenSecret).update(value).digest("hex");
}
function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}
function json(res, status, data) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(data));
}
function requireText(value, field, max = 120) {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > max)
    throw new HttpError(400, `${field} es obligatorio.`);
  return value.trim();
}
function alignedToScheduleStep(instant, intervalMinutes) {
  const [hour, minute] = formatLocalTime(instant).split(":").map(Number);
  return (hour * 60 + minute) % intervalMinutes === 0;
}
function requireEmail(value) {
  const email = requireText(value, "Correo", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new HttpError(400, "Ingresa un correo válido.");
  return email;
}
function optionalPhone(value) {
  if (value == null || value === "") return null;
  const phone = requireText(value, "Teléfono", 30);
  if (!/^[+()\d\s.-]{7,30}$/.test(phone)) throw new HttpError(400, "Ingresa un teléfono válido.");
  return phone;
}
function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim().split(/=(.*)/s, 2))
      .filter(([key, value]) => key && value !== undefined)
      .map(([key, value]) => [key, decodeURIComponent(value)]),
  );
}
async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new HttpError(413, "La solicitud es demasiado grande.");
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new HttpError(400, "El cuerpo de la solicitud no es JSON válido.");
  }
}
function setSessionCookie(res, token, maxAge) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "set-cookie",
    `bowling_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`,
  );
}
function clearSessionCookie(res) {
  res.setHeader("set-cookie", "bowling_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
}
function originCheck(req) {
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`)
    throw new HttpError(403, "Origen no autorizado.");
}
function rateLimit(key, limit, periodMs) {
  const now = Date.now();
  let item = rateLimits.get(key);
  if (!item || now - item.start >= periodMs) {
    item = { start: now, count: 0 };
    rateLimits.set(key, item);
  }
  item.count += 1;
  if (item.count > limit)
    throw new HttpError(429, "Demasiados intentos. Espera un momento y vuelve a probar.");
}
function getActor(req) {
  const token = parseCookies(req.headers.cookie).bowling_session;
  if (!token) return null;
  const session = db
    .prepare(`SELECT u.id,u.email,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`)
    .get(digest(token), Date.now());
  return session ?? null;
}
function requireActor(req, roles = ["reception", "admin"]) {
  const actor = getActor(req);
  if (!actor) throw new HttpError(401, "Inicia sesión para continuar.");
  if (!roles.includes(actor.role))
    throw new HttpError(403, "Tu perfil no puede realizar esta acción.");
  return actor;
}
function addAudit(actor, action, type, id, details) {
  audit(actor, action, type, id, details);
}
function getReservation(id) {
  const row = db.prepare("SELECT * FROM reservations WHERE id=?").get(id);
  if (!row) throw new HttpError(404, "No encontramos esa reserva.");
  const allocations = db
    .prepare("SELECT lane_id FROM allocations WHERE reservation_id=? AND active=1 ORDER BY lane_id")
    .all(id);
  return {
    ...row,
    lanes: allocations.map((entry) => entry.lane_id),
    quote: JSON.parse(row.quote_json),
  };
}
function reservationPublic(row) {
  const paid = db
    .prepare(
      "SELECT COALESCE(SUM(CASE WHEN status='verified' THEN amount_clp WHEN status='refund_recorded' THEN -amount_clp ELSE 0 END),0) AS amount FROM payments WHERE reservation_id=?",
    )
    .get(row.id).amount;
  return {
    id: row.id,
    code: row.code,
    customerName: row.customer_name,
    start: row.start_ms,
    end: row.end_ms,
    localDate: formatLocalDate(row.start_ms),
    startTime: formatLocalTime(row.start_ms),
    endTime: formatLocalTime(row.end_ms),
    utcOffset: localUtcOffset(row.start_ms),
    ambiguousLocalTime: localTimeIsAmbiguous(row.start_ms),
    players: row.players,
    laneCount: row.lane_count,
    grouped: row.group_mode === "together",
    status: row.commercial_status,
    inventoryStatus: row.inventory_status,
    financialStatus: row.financial_status,
    quoteClp: row.quote_clp,
    paymentsVerifiedClp: paid,
    balanceClp: Math.max(0, row.quote_clp - paid),
    channel: row.channel,
    checkedInAt: row.checked_in_at,
    effectiveStart: row.effective_start_ms,
    effectiveEnd: row.effective_end_ms,
    manualLaneLock: Boolean(row.manual_lane_lock),
  };
}
function dateLimitOk(date) {
  const today = formatLocalDate(Date.now());
  const [year, month, day] = today.split("-").map(Number);
  const maxDate = new Date(Date.UTC(year, month - 1, day + getSettings().maximumAdvanceDays))
    .toISOString()
    .slice(0, 10);
  return date >= today && date <= maxDate;
}
function getCandidate(startAt, data, channel = "web") {
  let startMs;
  try {
    const localInput = requireText(startAt, "Fecha y hora", 16);
    startMs = data.startMs == null ? localDateTimeToEpoch(localInput) : Number(data.startMs);
    if (
      !Number.isSafeInteger(startMs) ||
      `${formatLocalDate(startMs)}T${formatLocalTime(startMs)}` !== localInput
    )
      throw new Error("La hora elegida no coincide con la hora de Santiago.");
  } catch (error) {
    throw new HttpError(400, error.message);
  }
  const date = formatLocalDate(startMs);
  if (!dateLimitOk(date))
    throw new HttpError(400, "Elige una fecha dentro de los próximos 60 días.");
  const settings = getSettings();
  if (
    !Number.isSafeInteger(Number(data.players)) ||
    Number(data.players) < 1 ||
    Number(data.players) > 72
  )
    throw new HttpError(400, "Indica entre 1 y 72 jugadores.");
  if (!isWholeHourBookingDuration(Number(data.durationMinutes)))
    throw new HttpError(400, "Las reservas iniciales deben solicitarse en horas completas.");
  if (!Number.isInteger(Number(data.laneCount ?? minimumLanes(Number(data.players)))))
    throw new HttpError(400, "Cantidad de pistas inválida.");
  if (
    Number(data.laneCount ?? minimumLanes(Number(data.players))) <
      minimumLanes(Number(data.players)) ||
    Number(data.laneCount ?? minimumLanes(Number(data.players))) > 12
  )
    throw new HttpError(400, "La cantidad contratada de pistas no cubre el grupo.");
  if (startMs < Date.now())
    throw new HttpError(400, "No se pueden crear reservas con hora de inicio pasada.");
  if (!alignedToScheduleStep(startMs, settings.startIntervalMinutes))
    throw new HttpError(
      400,
      `El inicio debe respetar bloques de ${settings.startIntervalMinutes} minutos.`,
    );
  if (channel === "web" && startMs < Date.now() + settings.minimumAdvanceMinutes * 60_000)
    throw new HttpError(400, "Las reservas web requieren al menos una hora de anticipación.");
  if (channel === "walk_in" && startMs > Date.now() + 30 * 60_000)
    throw new HttpError(
      400,
      "Una atención presencial inmediata debe comenzar ahora o dentro de los próximos 30 minutos.",
    );
  const { start, end } = parseLocalDay(date);
  const reservations = reservationsForRange(start, end + 2 * 3_600_000);
  const blocks = blocksForRange(start, end + 2 * 3_600_000);
  const durationMinutes = Number(data.durationMinutes);
  const players = Number(data.players);
  const lanes = data.laneCount == null ? minimumLanes(players) : Number(data.laneCount);
  const selected = selectLaneSetAtTime({
    startMs,
    players,
    durationMinutes,
    lanes,
    acceptSeparated: data.acceptSeparated === true,
    reservations,
    blocks,
    settings,
    channel: channel === "staff" ? data.channel : "web",
  });
  if (!selected)
    throw new HttpError(
      409,
      "Ese horario ya no está disponible con las condiciones elegidas. Busca alternativas actualizadas.",
    );
  if (!settings.demoMode && selected.quote.totalClp <= 0)
    throw new HttpError(503, "Recepción debe configurar una tarifa antes de aceptar reservas.");
  return selected;
}
function baseUrl() {
  const fixed = process.env.PUBLIC_APP_URL;
  if (fixed) {
    let parsed;
    try {
      parsed = new URL(fixed);
    } catch {
      throw new HttpError(503, "PUBLIC_APP_URL debe ser una URL válida.");
    }
    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:")
      throw new HttpError(503, "PUBLIC_APP_URL debe usar HTTPS en producción.");
    return fixed.replace(/\/$/, "");
  }
  if (process.env.NODE_ENV === "production")
    throw new HttpError(503, "Falta configurar PUBLIC_APP_URL para el correo de reservas.");
  return "http://localhost:5173";
}
async function sendMail({ to, subject, text }) {
  const endpoint = process.env.MAIL_DELIVERY_URL;
  if (!endpoint) {
    if (!demoMode) throw new HttpError(503, "El envío de correo no está configurado.");
    process.stdout.write(`\n[correo de desarrollo] Para: ${to}\nAsunto: ${subject}\n${text}\n\n`);
    return;
  }
  if (process.env.NODE_ENV === "production") {
    let parsed;
    try {
      parsed = new URL(endpoint);
    } catch {
      throw new HttpError(503, "MAIL_DELIVERY_URL debe ser una URL válida.");
    }
    if (parsed.protocol !== "https:")
      throw new HttpError(503, "MAIL_DELIVERY_URL debe usar HTTPS en producción.");
  }
  if (process.env.NODE_ENV === "production" && !process.env.MAIL_DELIVERY_TOKEN)
    throw new HttpError(503, "MAIL_DELIVERY_TOKEN debe configurarse para el envío productivo.");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.MAIL_DELIVERY_TOKEN ?? ""}`,
    },
    body: JSON.stringify({
      from: process.env.MAIL_FROM ?? "reservas@example.invalid",
      to,
      subject,
      text,
    }),
  });
  if (!response.ok) throw new HttpError(502, "No pudimos enviar el correo. Inténtalo más tarde.");
}
const mailKey = createHash("sha256").update(tokenSecret).digest();
function encryptMail(payload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", mailKey, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}
function decryptMail(ciphertext) {
  const bytes = Buffer.from(ciphertext, "base64");
  const iv = bytes.subarray(0, 12);
  const tag = bytes.subarray(12, 28);
  const encrypted = bytes.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", mailKey, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8"));
}
function queueMail(conn, payload) {
  const id = randomUUID();
  conn
    .prepare("INSERT INTO email_outbox(id,recipient,payload_encrypted,created_at) VALUES(?,?,?,?)")
    .run(id, payload.to, encryptMail(payload), Date.now());
  return id;
}
async function deliverQueuedMail(id) {
  const item = transaction((conn) => {
    const row = conn.prepare("SELECT * FROM email_outbox WHERE id=? AND status='queued'").get(id);
    if (!row) return null;
    conn
      .prepare(
        "UPDATE email_outbox SET status='sending',last_error=NULL WHERE id=? AND status='queued'",
      )
      .run(id);
    return { payload: decryptMail(row.payload_encrypted) };
  });
  if (!item)
    return db.prepare("SELECT status FROM email_outbox WHERE id=?").get(id)?.status === "sent";
  try {
    await sendMail(item.payload);
    db.prepare("UPDATE email_outbox SET status='sent',sent_at=?,last_error=NULL WHERE id=?").run(
      Date.now(),
      id,
    );
    return true;
  } catch {
    db.prepare(
      "UPDATE email_outbox SET status='queued',attempts=attempts+1,last_error='delivery failed' WHERE id=?",
    ).run(id);
    return false;
  }
}
async function drainMailOutbox() {
  const queued = db
    .prepare("SELECT id FROM email_outbox WHERE status='queued' ORDER BY created_at LIMIT 10")
    .all();
  for (const item of queued) await deliverQueuedMail(item.id);
}
function statusView(status) {
  const labels = {
    pending_approval: "Pendiente de aprobación de recepción",
    pending_price_acceptance: "Pendiente de aceptar el precio actualizado",
    confirmed: "Reserva confirmada",
    cancelled: "Cancelada",
    rejected: "Rechazada",
    finished: "Finalizada",
    no_show_review: "Llegada pendiente de resolución de recepción",
  };
  return labels[status] ?? status;
}
function localUtcOffset(epochMs) {
  return (
    new Intl.DateTimeFormat("en", { timeZone: "America/Santiago", timeZoneName: "shortOffset" })
      .formatToParts(new Date(epochMs))
      .find((part) => part.type === "timeZoneName")?.value ?? ""
  );
}
function localTimeIsAmbiguous(epochMs) {
  const date = formatLocalDate(epochMs);
  const clock = formatLocalTime(epochMs);
  return [-60 * 60_000, 60 * 60_000].some(
    (offset) =>
      formatLocalDate(epochMs + offset) === date && formatLocalTime(epochMs + offset) === clock,
  );
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function validClock(value) {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}
function validateHours(weekly, exceptions) {
  if (!isRecord(weekly) || !isRecord(exceptions))
    throw new HttpError(400, "Horarios y excepciones deben tener formato de objeto.");
  for (const [day, rule] of Object.entries(weekly)) {
    if (!/^[0-6]$/.test(day) || !isRecord(rule))
      throw new HttpError(400, "Horario semanal inválido.");
    if (rule.closed === true) continue;
    if (!validClock(rule.open) || !validClock(rule.close))
      throw new HttpError(
        400,
        "Cada horario abierto necesita una hora válida de apertura y cierre.",
      );
  }
  for (const [date, rule] of Object.entries(exceptions)) {
    try {
      parseLocalDay(date);
    } catch {
      throw new HttpError(400, `Fecha de excepción inválida: ${date}.`);
    }
    if (!isRecord(rule)) throw new HttpError(400, `Excepción inválida para ${date}.`);
    if (rule.closed === true) continue;
    if (!validClock(rule.open) || !validClock(rule.close))
      throw new HttpError(400, `La excepción de ${date} necesita apertura y cierre válidos.`);
  }
}
function validateRates(settings) {
  if (!Array.isArray(settings.rateBands) || settings.rateBands.length > 200)
    throw new HttpError(400, "Lista de franjas tarifarias inválida.");
  const bands = settings.rateBands;
  for (const band of bands) {
    if (
      !isRecord(band) ||
      !Number.isInteger(band.weekday) ||
      band.weekday < 0 ||
      band.weekday > 6 ||
      !validClock(band.start) ||
      !validClock(band.end) ||
      band.start >= band.end ||
      !Number.isSafeInteger(band.rateClpPerLaneHour) ||
      band.rateClpPerLaneHour < 0
    )
      throw new HttpError(400, "Una franja tarifaria tiene día, horas o importe inválidos.");
  }
  for (let i = 0; i < bands.length; i += 1)
    for (let j = i + 1; j < bands.length; j += 1) {
      if (
        bands[i].weekday === bands[j].weekday &&
        bands[i].start < bands[j].end &&
        bands[j].start < bands[i].end
      )
        throw new HttpError(400, "Las franjas tarifarias de un mismo día no pueden superponerse.");
    }
  if (!isRecord(settings.rateExceptions))
    throw new HttpError(400, "Las tarifas por fecha deben tener formato de objeto.");
  for (const [date, exception] of Object.entries(settings.rateExceptions)) {
    try {
      parseLocalDay(date);
    } catch {
      throw new HttpError(400, `Fecha de tarifa inválida: ${date}.`);
    }
    if (
      !isRecord(exception) ||
      !Number.isSafeInteger(exception.rateClpPerLaneHour) ||
      exception.rateClpPerLaneHour < 0
    )
      throw new HttpError(400, `La tarifa de ${date} debe ser CLP entero igual o mayor que cero.`);
  }
}
function validatePromotions(promotions) {
  if (!Array.isArray(promotions) || promotions.length > 200)
    throw new HttpError(400, "Lista de promociones inválida.");
  for (const p of promotions) {
    if (
      !isRecord(p) ||
      typeof p.name !== "string" ||
      !p.name.trim() ||
      p.name.length > 80 ||
      typeof p.enabled !== "boolean" ||
      !["percent", "fixed"].includes(p.kind)
    )
      throw new HttpError(400, "Una promoción tiene nombre o tipo inválido.");
    if (!Number.isSafeInteger(p.value) || p.value <= 0 || (p.kind === "percent" && p.value > 100))
      throw new HttpError(
        400,
        "El descuento debe ser un CLP positivo o un porcentaje entero de hasta 100%.",
      );
    if (
      !Number.isSafeInteger(p.startsAt) ||
      !Number.isSafeInteger(p.endsAt) ||
      p.endsAt <= p.startsAt
    )
      throw new HttpError(400, "La vigencia de una promoción es inválida.");
    if (p.channel && !["web", "phone", "walk_in", "counter_future"].includes(p.channel))
      throw new HttpError(400, "Canal de promoción inválido.");
    for (const key of ["minimumDurationMinutes", "maximumDurationMinutes"])
      if (p[key] != null && (!Number.isInteger(p[key]) || p[key] < 1 || p[key] > 1440))
        throw new HttpError(400, "Condición de duración de promoción inválida.");
    if (
      p.minimumDurationMinutes &&
      p.maximumDurationMinutes &&
      p.maximumDurationMinutes < p.minimumDurationMinutes
    )
      throw new HttpError(400, "La duración máxima de la promoción debe ser mayor a la mínima.");
  }
}
function preservationScoreGreater(a, b) {
  if (!b) return true;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function calculateFinancialStatus(reservationId) {
  const reservation = db
    .prepare("SELECT quote_clp FROM reservations WHERE id=?")
    .get(reservationId);
  const totals = db
    .prepare(`SELECT COALESCE(SUM(CASE WHEN status='verified' THEN amount_clp WHEN status='refund_recorded' THEN -amount_clp ELSE 0 END),0) AS paid,
    COALESCE(SUM(CASE WHEN status='reported' THEN amount_clp ELSE 0 END),0) AS reported FROM payments WHERE reservation_id=?`)
    .get(reservationId);
  const status =
    totals.paid >= reservation.quote_clp
      ? "paid"
      : totals.paid > 0
        ? "partially_paid"
        : totals.reported > 0
          ? "pending_verification"
          : "unpaid";
  db.prepare("UPDATE reservations SET financial_status=?,updated_at=? WHERE id=?").run(
    status,
    Date.now(),
    reservationId,
  );
  return status;
}
function allocateReservation(dbConn, reservationId, candidate) {
  const insert = dbConn.prepare(
    "INSERT INTO allocations(id,reservation_id,lane_id,start_ms,end_ms,active,created_at) VALUES(?,?,?,?,?,1,?)",
  );
  const settings = getSettings();
  for (const lane of candidate.lanes)
    insert.run(
      randomUUID(),
      reservationId,
      lane,
      candidate.startMs,
      candidate.endMs + settings.preparationMinutes * 60_000,
      Date.now(),
    );
}
function checkExistingRequest(idempotencyKey) {
  if (!idempotencyKey || typeof idempotencyKey !== "string" || idempotencyKey.length > 100)
    throw new HttpError(400, "Falta la clave de idempotencia.");
  return db
    .prepare(
      "SELECT q.*,r.code FROM booking_requests q LEFT JOIN reservations r ON r.id=q.reservation_id WHERE q.idempotency_key=?",
    )
    .get(idempotencyKey);
}
function getManageToken(req) {
  const url = new URL(req.url, "http://localhost");
  const authorization = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : null;
  const token = authorization ?? url.searchParams.get("token");
  if (!token || token.length < 32)
    throw new HttpError(401, "El enlace de seguimiento no es válido.");
  const reservation = db
    .prepare(
      "SELECT * FROM reservations WHERE manage_token_hash=? AND manage_expires_at>? AND commercial_status NOT IN ('rejected')",
    )
    .get(digest(token), Date.now());
  if (!reservation)
    throw new HttpError(
      401,
      "El enlace venció o fue revocado. Pide uno nuevo mediante correo verificado.",
    );
  return { token, reservation };
}
function publicReservationDetail(row) {
  const booking = reservationPublic(row);
  const quote = JSON.parse(row.quote_json);
  return {
    ...booking,
    quote: {
      baseClp: quote.baseClp,
      discountClp: quote.discountClp,
      totalClp: row.quote_clp,
      promotionName: quote.promotionName,
    },
    terms:
      "La tarifa corresponde a las pistas y al tiempo contratados. Los pagos se verifican presencialmente.",
  };
}

async function handleApi(req, res, url) {
  const path = url.pathname;
  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") originCheck(req);
  if (method === "GET" && path === "/api/health")
    return json(res, 200, { ok: true, storage: "sqlite", demoMode });
  if (method === "GET" && path === "/api/public-config") {
    const settings = getSettings();
    return json(res, 200, {
      venueName: settings.venueName,
      timeZone: settings.timeZone,
      demoMode: settings.demoMode,
      preparationMinutes: settings.preparationMinutes,
      closingMarginMinutes: settings.closingMarginMinutes,
      weeklyHours: settings.weeklyHours,
      lateArrivalToleranceMinutes: settings.lateArrivalToleranceMinutes,
      maximumAdvanceDays: settings.maximumAdvanceDays,
      startIntervalMinutes: settings.startIntervalMinutes,
      extensionDurations: extensionDurationsFor(settings.startIntervalMinutes),
      rateConfigured: settings.generalRateClpPerLaneHour > 0,
      demoPrice: settings.demoMode,
      emailDeliveryConfigured: Boolean(
        process.env.MAIL_DELIVERY_URL && process.env.MAIL_DELIVERY_TOKEN,
      ),
    });
  }
  if (method === "GET" && path === "/api/availability") {
    const date = url.searchParams.get("date") ?? "";
    const time = url.searchParams.get("time") ?? "16:00";
    const players = Number(url.searchParams.get("players"));
    const durationMinutes = Number(url.searchParams.get("duration"));
    const acceptSeparated = url.searchParams.get("acceptSeparated") === "true";
    if (!dateLimitOk(date))
      throw new HttpError(400, "Elige una fecha dentro de los próximos 60 días.");
    if (!isWholeHourBookingDuration(durationMinutes))
      throw new HttpError(400, "Las reservas iniciales deben solicitarse en horas completas.");
    try {
      minimumLanes(players);
    } catch (error) {
      throw new HttpError(400, error.message);
    }
    const { start, end } = parseLocalDay(date);
    const found = findAlternatives({
      date,
      preferredTime: time,
      players,
      durationMinutes,
      acceptSeparated,
      reservations: reservationsForRange(start, end + 2 * 3_600_000),
      blocks: blocksForRange(start, end + 2 * 3_600_000),
      settings: getSettings(),
      limit: 10,
    });
    const bestScore = found.reduce(
      (best, option) =>
        preservationScoreGreater(option.preservationScore, best) ? option.preservationScore : best,
      null,
    );
    const alternatives = found.map((option) => ({
      startAt: `${date}T${formatLocalTime(option.startMs)}`,
      startMs: option.startMs,
      endMs: option.endMs,
      startTime: formatLocalTime(option.startMs),
      endTime: formatLocalTime(option.endMs),
      utcOffset: localUtcOffset(option.startMs),
      durationMinutes,
      laneCount: option.laneCount,
      minimumLanes: option.minimumLanes,
      grouped: option.grouped,
      quote: option.quote,
      distanceMinutes: option.distanceMinutes,
      rank: option.rank,
      recommended: option.preservationScore.join(",") === bestScore?.join(","),
    }));
    return json(res, 200, {
      alternatives,
      date,
      preparationMinutes: getSettings().preparationMinutes,
      timezone: "America/Santiago",
    });
  }
  if (method === "POST" && path === "/api/email/start") {
    const body = await readBody(req);
    const email = requireEmail(body.email);
    const address = String(req.socket.remoteAddress ?? "unknown");
    rateLimit(`verify:${email}:${address}`, 3, 15 * 60_000);
    const prior = db
      .prepare(
        "SELECT created_at FROM email_verifications WHERE email=? ORDER BY created_at DESC LIMIT 1",
      )
      .get(email);
    if (prior && Date.now() - prior.created_at < 60_000)
      throw new HttpError(429, "Espera un minuto antes de pedir otro código.");
    const code = String(randomInt(100000, 1_000_000));
    const id = randomUUID();
    const createdAt = Date.now();
    db.prepare(
      "INSERT INTO email_verifications(id,email,code_hash,expires_at,created_at) VALUES(?,?,?,?,?)",
    ).run(id, email, digest(`${email}:${code}`), createdAt + 10 * 60_000, createdAt);
    try {
      await sendMail({
        to: email,
        subject: `Verifica tu correo · ${getSettings().venueName}`,
        text: `Tu código de verificación es ${code}. Vence en 10 minutos.`,
      });
    } catch (error) {
      db.prepare("DELETE FROM email_verifications WHERE id=?").run(id);
      throw error;
    }
    return json(res, 200, {
      sent: true,
      expiresInMinutes: 10,
      development: demoMode && !process.env.MAIL_DELIVERY_URL,
    });
  }
  if (method === "POST" && path === "/api/email/complete") {
    const body = await readBody(req);
    const email = requireEmail(body.email);
    const code = requireText(body.code, "Código", 6);
    const address = String(req.socket.remoteAddress ?? "unknown");
    rateLimit(`verify-complete:${email}:${address}`, 6, 15 * 60_000);
    const proofToken = randomToken();
    const now = Date.now();
    const proof = transaction((conn) => {
      const verification = conn
        .prepare(
          "SELECT * FROM email_verifications WHERE email=? AND consumed_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1",
        )
        .get(email, now);
      if (!verification || verification.attempts >= 5) return null;
      const candidate = Buffer.from(digest(`${email}:${code}`), "hex");
      const expected = Buffer.from(verification.code_hash, "hex");
      const matches = candidate.length === expected.length && timingSafeEqual(candidate, expected);
      if (!matches) {
        conn
          .prepare("UPDATE email_verifications SET attempts=attempts+1 WHERE id=?")
          .run(verification.id);
        return false;
      }
      conn
        .prepare("UPDATE email_verifications SET consumed_at=? WHERE id=?")
        .run(now, verification.id);
      conn
        .prepare("INSERT INTO email_proofs(token_hash,email,expires_at,created_at) VALUES(?,?,?,?)")
        .run(digest(proofToken), email, now + 15 * 60_000, now);
      return true;
    });
    if (proof === false) throw new HttpError(400, "El código no es correcto.");
    if (!proof) throw new HttpError(400, "El código venció o se agotaron los intentos.");
    return json(res, 200, { verified: true, emailProof: proofToken, expiresInMinutes: 15 });
  }
  if (method === "POST" && path === "/api/requests") {
    const body = await readBody(req);
    const existing = checkExistingRequest(body.idempotencyKey);
    if (existing)
      return json(res, 200, {
        id: existing.id,
        code: existing.code,
        status: existing.status,
        reused: true,
      });
    const address = String(req.socket.remoteAddress ?? "unknown");
    rateLimit(`request:${address}:${String(body.email ?? "").toLowerCase()}`, 6, 60 * 60_000);
    const customerName = requireText(body.customerName, "Nombre", 120);
    const email = requireEmail(body.email);
    const proofToken = requireText(body.emailProof, "Verificación de correo", 200);
    const idem = body.idempotencyKey;
    const now = Date.now();
    const candidate = getCandidate(body.startAt, body, "web");
    if (body.acceptTerms !== true)
      throw new HttpError(400, "Acepta las condiciones de la solicitud para continuar.");
    const request = transaction((conn) => {
      const duplicate = conn
        .prepare(
          "SELECT q.*,r.code FROM booking_requests q LEFT JOIN reservations r ON r.id=q.reservation_id WHERE q.idempotency_key=?",
        )
        .get(idem);
      if (duplicate)
        return { id: duplicate.id, code: duplicate.code, status: duplicate.status, reused: true };
      const proof = conn
        .prepare(
          "SELECT * FROM email_proofs WHERE token_hash=? AND email=? AND consumed_at IS NULL AND expires_at>?",
        )
        .get(digest(proofToken), email, now);
      if (!proof)
        throw new HttpError(403, "Verifica nuevamente el correo antes de enviar la solicitud.");
      const pendingCount = conn
        .prepare(
          "SELECT COUNT(*) AS amount FROM booking_requests WHERE email=? AND status IN ('pending_approval','pending_price_acceptance')",
        )
        .get(email).amount;
      if (pendingCount >= 2) {
        addAudit({ id: null, role: "client" }, "request_limit_reached", "booking_request", null, {
          email,
          address,
        });
        throw new HttpError(
          409,
          "Ya tienes dos solicitudes pendientes. Contacta a recepción para gestionar otra.",
        );
      }
      const currentSettings = getSettings();
      const reservationId = randomUUID();
      const requestId = randomUUID();
      const manageToken = randomToken();
      const manageExpiresAt = now + manageHours * 3_600_000;
      const approvalNeeded = candidate.laneCount >= currentSettings.requireManualApprovalFromLanes;
      const status = approvalNeeded ? "pending_approval" : "confirmed";
      const quoteJson = { ...candidate.quote, demo: currentSettings.demoMode };
      const code = `B-${randomBytes(4).toString("hex").toUpperCase()}`;
      conn
        .prepare(`INSERT INTO booking_requests(id,idempotency_key,email,customer_name,channel,status,reservation_id,original_quote_clp,current_quote_clp,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
        .run(
          requestId,
          idem,
          email,
          customerName,
          "web",
          status,
          reservationId,
          candidate.quote.totalClp,
          candidate.quote.totalClp,
          now,
          now,
        );
      conn
        .prepare(`INSERT INTO reservations(id,code,request_id,customer_name,email,channel,start_ms,end_ms,players,lane_count,group_mode,commercial_status,inventory_status,financial_status,quote_clp,quote_json,terms_accepted_at,manage_token_hash,manage_expires_at,created_at,updated_at,created_by)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(
          reservationId,
          code,
          requestId,
          customerName,
          email,
          "web",
          candidate.startMs,
          candidate.endMs,
          Number(body.players),
          candidate.laneCount,
          candidate.grouped ? "together" : "separated_accepted",
          status,
          approvalNeeded ? "held" : "assigned",
          "unpaid",
          candidate.quote.totalClp,
          JSON.stringify(quoteJson),
          now,
          digest(manageToken),
          manageExpiresAt,
          now,
          now,
          "client-web",
        );
      allocateReservation(conn, reservationId, candidate);
      conn
        .prepare("UPDATE email_proofs SET consumed_at=? WHERE token_hash=?")
        .run(now, digest(proofToken));
      addAudit({ id: null, role: "client" }, "request_created", "booking_request", requestId, {
        reservationId,
        laneCount: candidate.laneCount,
        status,
        channel: "web",
        address,
      });
      const manageLink = `${baseUrl()}/seguimiento?token=${encodeURIComponent(manageToken)}`;
      const mailId = queueMail(conn, {
        to: email,
        subject:
          status === "confirmed"
            ? `Reserva confirmada · ${getSettings().venueName}`
            : `Solicitud recibida · ${getSettings().venueName}`,
        text: `${statusView(status)}. Código ${code}. Seguimiento seguro (vigente 24 horas): ${manageLink}`,
      });
      return {
        id: requestId,
        reservationId,
        code,
        status,
        manageToken,
        mailId,
        booking: reservationPublic(getReservation(reservationId)),
        quote: quoteJson,
      };
    });
    if (request.reused) return json(res, 200, request);
    const manageLink = `${baseUrl()}/seguimiento?token=${encodeURIComponent(request.manageToken)}`;
    const emailDelivered = await deliverQueuedMail(request.mailId);
    return json(res, 201, {
      id: request.id,
      code: request.code,
      status: request.status,
      statusLabel: statusView(request.status),
      booking: request.booking,
      quote: request.quote,
      notificationPending: !emailDelivered,
      manageLink: demoMode ? manageLink : undefined,
    });
  }
  if (method === "GET" && path === "/api/manage") {
    const { reservation } = getManageToken(req);
    const detail = publicReservationDetail(reservation);
    const quote = db
      .prepare("SELECT status,current_quote_clp FROM booking_requests WHERE reservation_id=?")
      .get(reservation.id);
    return json(res, 200, {
      booking: detail,
      requestStatus: quote?.status ?? null,
      updatedQuoteClp: quote?.current_quote_clp ?? null,
    });
  }
  if (method === "POST" && path === "/api/manage/renew") {
    const body = await readBody(req);
    const email = requireEmail(body.email);
    const code = requireText(body.code, "Código de reserva", 20).toUpperCase();
    const proofToken = requireText(body.emailProof, "Verificación de correo", 200);
    const address = String(req.socket.remoteAddress ?? "unknown");
    rateLimit(`manage-renew:${email}:${address}`, 4, 60 * 60_000);
    const now = Date.now();
    const rawToken = randomToken();
    const result = transaction((conn) => {
      const proof = conn
        .prepare(
          "SELECT * FROM email_proofs WHERE token_hash=? AND email=? AND consumed_at IS NULL AND expires_at>?",
        )
        .get(digest(proofToken), email, now);
      if (!proof)
        throw new HttpError(403, "Verifica nuevamente el correo antes de renovar el enlace.");
      const reservation = conn
        .prepare(
          "SELECT * FROM reservations WHERE code=? AND email=? AND commercial_status NOT IN ('cancelled','rejected')",
        )
        .get(code, email);
      if (!reservation)
        throw new HttpError(404, "El código de reserva no coincide con ese correo.");
      conn
        .prepare("UPDATE email_proofs SET consumed_at=? WHERE token_hash=?")
        .run(now, digest(proofToken));
      conn
        .prepare(
          "UPDATE reservations SET manage_token_hash=?,manage_expires_at=?,updated_at=? WHERE id=?",
        )
        .run(digest(rawToken), now + manageHours * 3_600_000, now, reservation.id);
      addAudit({ id: null, role: "client" }, "manage_link_renewed", "reservation", reservation.id, {
        address,
      });
      const manageLink = `${baseUrl()}/seguimiento?token=${encodeURIComponent(rawToken)}`;
      const mailId = queueMail(conn, {
        to: email,
        subject: `Nuevo enlace de seguimiento · ${getSettings().venueName}`,
        text: `Tu nuevo enlace de seguimiento para la reserva ${reservation.code} (vigente 24 horas): ${manageLink}`,
      });
      return { reservationId: reservation.id, mailId, manageLink };
    });
    const emailDelivered = await deliverQueuedMail(result.mailId);
    return json(res, 200, {
      renewed: true,
      notificationPending: !emailDelivered,
      manageLink: demoMode ? result.manageLink : undefined,
    });
  }
  if (method === "POST" && path === "/api/manage/accept-price") {
    const body = await readBody(req);
    const { reservation } = getManageToken(req);
    const now = Date.now();
    const result = transaction((conn) => {
      const request = conn
        .prepare("SELECT * FROM booking_requests WHERE reservation_id=?")
        .get(reservation.id);
      if (!request || request.status !== "pending_price_acceptance")
        throw new HttpError(409, "No hay un precio pendiente de aceptación.");
      if (body.accept !== true)
        throw new HttpError(400, "Confirma expresamente el precio actualizado.");
      conn
        .prepare(
          "UPDATE reservations SET quote_clp=?,commercial_status='confirmed',updated_at=? WHERE id=?",
        )
        .run(request.current_quote_clp, now, reservation.id);
      conn
        .prepare("UPDATE booking_requests SET status='confirmed',updated_at=? WHERE id=?")
        .run(now, request.id);
      addAudit({ id: null, role: "client" }, "price_accepted", "booking_request", request.id, {
        amountClp: request.current_quote_clp,
      });
      return getReservation(reservation.id);
    });
    return json(res, 200, { booking: reservationPublic(result) });
  }
  if (method === "POST" && path === "/api/manage/cancel") {
    const { reservation } = getManageToken(req);
    const now = Date.now();
    if (reservation.start_ms - now < getSettings().cancellationFreeHours * 3_600_000)
      throw new HttpError(
        409,
        "La cancelación dentro de las 24 horas previas requiere que recepción revise las condiciones.",
      );
    transaction((conn) => {
      conn.prepare("UPDATE allocations SET active=0 WHERE reservation_id=?").run(reservation.id);
      conn
        .prepare(
          "UPDATE reservations SET commercial_status='cancelled',inventory_status='released',manage_token_hash=NULL,updated_at=? WHERE id=?",
        )
        .run(now, reservation.id);
      conn
        .prepare(
          "UPDATE booking_requests SET status='cancelled',updated_at=? WHERE reservation_id=?",
        )
        .run(now, reservation.id);
      addAudit({ id: null, role: "client" }, "booking_cancelled", "reservation", reservation.id, {
        released: true,
      });
    });
    return json(res, 200, {
      status: "cancelled",
      message:
        "Reserva cancelada y capacidad liberada. Cualquier devolución se gestiona por separado.",
    });
  }
  if (method === "POST" && path === "/api/auth/login") {
    const body = await readBody(req);
    const email = requireEmail(body.email);
    const password = requireText(body.password, "Contraseña", 200);
    const address = String(req.socket.remoteAddress ?? "unknown");
    rateLimit(`login:${email}:${address}`, loginAttemptLimit, 15 * 60_000);
    const user = db.prepare("SELECT * FROM users WHERE email=? AND active=1").get(email);
    const salt = user?.password_salt ?? "00000000000000000000000000000000";
    const expected = Buffer.from(user?.password_hash ?? "0".repeat(128), "hex");
    const actual = scryptSync(password, salt, 64);
    if (!user || actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new HttpError(401, "Correo o contraseña incorrectos.");
    const rawToken = randomToken();
    const now = Date.now();
    db.prepare(
      "INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
    ).run(digest(rawToken), user.id, now + sessionHours * 3_600_000, now);
    setSessionCookie(res, rawToken, sessionHours * 3600);
    addAudit(user, "employee_login", "user", user.id, {});
    return json(res, 200, {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  }
  if (method === "POST" && path === "/api/auth/logout") {
    const token = parseCookies(req.headers.cookie).bowling_session;
    if (token) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(digest(token));
    clearSessionCookie(res);
    return json(res, 200, { ok: true });
  }
  if (method === "GET" && path === "/api/auth/me") {
    const actor = getActor(req);
    return json(res, 200, {
      user: actor ? { id: actor.id, email: actor.email, name: actor.name, role: actor.role } : null,
    });
  }
  if (method === "GET" && path === "/api/staff/board") {
    const actor = requireActor(req);
    const date = url.searchParams.get("date") ?? formatLocalDate(Date.now());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "Fecha inválida.");
    const { start, end } = parseLocalDay(date);
    const settings = getSettings();
    const [year, month, day] = date.split("-").map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const hours = settings.exceptions?.[date] ?? settings.weeklyHours?.[String(weekday)];
    let axisStartMs = start;
    let axisEndMs = end;
    let operatingHours = { isOpen: false, startMs: start, endMs: end };
    if (hours && !hours.closed && hours.open && hours.close) {
      try {
        const openMs = localDateTimeToEpoch(`${date}T${hours.open}`);
        let closeMs = localDateTimeToEpoch(`${date}T${hours.close}`);
        if (closeMs <= openMs)
          closeMs = localDateTimeToEpoch(`${formatLocalDate(end)}T${hours.close}`);
        operatingHours = { isOpen: true, startMs: openMs, endMs: closeMs };
        axisStartMs = openMs;
        axisEndMs = closeMs;
      } catch {
        axisStartMs = start;
        axisEndMs = end;
      }
    }
    const queryEnd = Math.max(end, axisEndMs);
    const rows = db
      .prepare(`SELECT r.*,GROUP_CONCAT(a.lane_id) AS lane_ids FROM reservations r LEFT JOIN allocations a ON a.reservation_id=r.id AND a.active=1
      WHERE r.start_ms < ? AND r.end_ms > ? AND r.commercial_status NOT IN ('cancelled','rejected','finished') GROUP BY r.id ORDER BY r.start_ms`)
      .all(queryEnd, start);
    const blocks = db
      .prepare(
        "SELECT * FROM maintenance_blocks WHERE status='active' AND start_ms < ? AND end_ms > ?",
      )
      .all(queryEnd, start);
    const reservations = rows.map((row) => ({
      ...reservationPublic(row),
      id: row.id,
      lanes: row.lane_ids ? row.lane_ids.split(",").map(Number) : [],
      start: row.start_ms,
      end: row.effective_end_ms ?? row.end_ms,
      customerPhone: row.phone,
      customerEmail: row.email,
      payments: db
        .prepare(
          "SELECT id,amount_clp,method,status,reference,created_at FROM payments WHERE reservation_id=? ORDER BY created_at DESC",
        )
        .all(row.id),
    }));
    axisStartMs = Math.min(
      axisStartMs,
      ...reservations.map((reservation) => reservation.start),
      ...blocks.map((block) => block.start_ms),
    );
    axisEndMs = Math.max(
      axisEndMs,
      ...reservations.map((reservation) => reservation.end),
      ...blocks.map((block) => block.end_ms),
    );
    return json(res, 200, {
      date,
      axisStartMs,
      axisEndMs,
      operatingHours,
      calendarHourWidthPx: settings.calendarHourWidthPx ?? 60,
      lanes: db.prepare("SELECT id,pair_id,x,y,active FROM lanes ORDER BY id").all(),
      reservations,
      blocks: blocks.map((block) => ({
        id: block.id,
        laneId: block.lane_id,
        start: block.start_ms,
        end: block.end_ms,
        reason: block.reason,
      })),
      user: actor,
      demoMode,
    });
  }
  if (method === "GET" && path === "/api/staff/requests") {
    requireActor(req);
    const rows = db
      .prepare(`SELECT q.*,r.code,r.start_ms,r.end_ms,r.players,r.lane_count,r.group_mode,r.quote_clp,r.commercial_status
      FROM booking_requests q JOIN reservations r ON r.id=q.reservation_id WHERE q.status IN ('pending_approval','pending_price_acceptance') ORDER BY q.created_at`)
      .all();
    return json(res, 200, {
      requests: rows.map((row) => ({
        id: row.id,
        name: row.customer_name,
        email: row.email,
        channel: row.channel,
        status: row.status,
        code: row.code,
        start: row.start_ms,
        end: row.end_ms,
        players: row.players,
        laneCount: row.lane_count,
        quoteClp: row.quote_clp,
        updatedQuoteClp: row.current_quote_clp,
        grouped: row.group_mode === "together",
      })),
    });
  }
  if (method === "POST" && path === "/api/staff/reoptimize") {
    const actor = requireActor(req);
    const body = await readBody(req);
    const date = requireText(body.date, "Fecha", 10);
    let day;
    try {
      day = parseLocalDay(date);
    } catch (error) {
      throw new HttpError(400, error.message);
    }
    const settings = getSettings();
    const now = Date.now();
    const changed = transaction((conn) => {
      const rows = conn
        .prepare(`SELECT r.*,GROUP_CONCAT(a.lane_id) AS lane_ids FROM reservations r
        LEFT JOIN allocations a ON a.reservation_id=r.id AND a.active=1
        WHERE r.start_ms>=? AND r.start_ms<? AND r.commercial_status NOT IN ('cancelled','rejected','finished') GROUP BY r.id ORDER BY r.start_ms`)
        .all(day.start, day.end);
      const movable = rows.filter(
        (row) =>
          row.commercial_status === "confirmed" &&
          !row.checked_in_at &&
          !row.effective_start_ms &&
          !row.manual_lane_lock &&
          row.start_ms - now > settings.operationalLockMinutes * 60_000,
      );
      if (movable.length > 80)
        throw new HttpError(
          409,
          "Hay demasiadas reservas flexibles para una reorganización localizada en un solo paso.",
        );
      const original = new Map(
        movable.map((row) => [row.id, row.lane_ids ? row.lane_ids.split(",").map(Number) : []]),
      );
      for (const row of movable)
        conn
          .prepare("UPDATE allocations SET active=0 WHERE reservation_id=? AND active=1")
          .run(row.id);
      const ordered = [...movable].sort(
        (a, b) =>
          b.lane_count - a.lane_count || a.start_ms - b.start_ms || a.code.localeCompare(b.code),
      );
      for (const row of ordered) {
        const currentReservations = reservationsForRange(
          row.start_ms,
          row.end_ms + settings.preparationMinutes * 60_000,
        );
        const blocks = blocksForRange(
          row.start_ms,
          row.end_ms + settings.preparationMinutes * 60_000,
        );
        const candidate = selectLaneSetAtTime({
          startMs: row.start_ms,
          players: row.players,
          durationMinutes: (row.end_ms - row.start_ms) / 60_000,
          lanes: row.lane_count,
          acceptSeparated: row.group_mode === "separated_accepted",
          reservations: currentReservations,
          blocks,
          settings,
          channel: row.channel,
        });
        if (!candidate)
          throw new HttpError(
            409,
            `No se pudo reubicar de forma segura la reserva ${row.code}; la reorganización se revirtió.`,
          );
        allocateReservation(conn, row.id, candidate);
      }
      const result = [];
      for (const row of movable) {
        const assigned = conn
          .prepare(
            "SELECT lane_id FROM allocations WHERE reservation_id=? AND active=1 ORDER BY lane_id",
          )
          .all(row.id)
          .map((entry) => entry.lane_id);
        const before = original.get(row.id) ?? [];
        if (before.join(",") !== assigned.join(",")) {
          conn.prepare("UPDATE reservations SET updated_at=? WHERE id=?").run(now, row.id);
          addAudit(actor, "lane_assignment_reorganized", "reservation", row.id, {
            from: before,
            to: assigned,
            startMs: row.start_ms,
          });
          result.push({ code: row.code, from: before, to: assigned });
        }
      }
      addAudit(actor, "localized_reoptimization_completed", "schedule", date, {
        examined: movable.length,
        changed: result.length,
        fixed: rows.length - movable.length,
      });
      return { result, examined: movable.length };
    });
    return json(res, 200, {
      date,
      examined: changed.examined,
      changed: changed.result,
      message: changed.result.length
        ? "Asignaciones flexibles reorganizadas sin cambiar horarios ni compromisos."
        : "No se requirieron cambios de asignación.",
    });
  }
  if (method === "POST" && path === "/api/staff/bookings") {
    const actor = requireActor(req);
    const body = await readBody(req);
    const channel = body.channel;
    if (!["phone", "walk_in", "counter_future"].includes(channel))
      throw new HttpError(400, "Canal manual inválido.");
    const idempotencyKey = requireText(body.idempotencyKey, "Clave de idempotencia", 100);
    const previous = db
      .prepare("SELECT id FROM reservations WHERE idempotency_key=?")
      .get(idempotencyKey);
    if (previous)
      return json(res, 200, {
        booking: reservationPublic(getReservation(previous.id)),
        reused: true,
      });
    const customerName = requireText(body.customerName, "Nombre", 120);
    const phone = optionalPhone(body.phone);
    const email = body.email ? requireEmail(body.email) : null;
    if (channel === "phone" && !phone)
      throw new HttpError(400, "Las reservas telefónicas requieren teléfono.");
    if (channel === "counter_future" && !phone && !email)
      throw new HttpError(400, "Las reservas presenciales futuras requieren teléfono o correo.");
    const candidate = getCandidate(body.startAt, body, "staff");
    const now = Date.now();
    const id = randomUUID();
    const code = `R-${randomBytes(4).toString("hex").toUpperCase()}`;
    const created = transaction((conn) => {
      const duplicate = conn
        .prepare("SELECT id FROM reservations WHERE idempotency_key=?")
        .get(idempotencyKey);
      if (duplicate) return { reservation: getReservation(duplicate.id), reused: true };
      conn
        .prepare(`INSERT INTO reservations(id,code,idempotency_key,customer_name,email,phone,channel,start_ms,end_ms,players,lane_count,group_mode,commercial_status,inventory_status,financial_status,quote_clp,quote_json,terms_accepted_at,created_at,updated_at,created_by)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(
          id,
          code,
          idempotencyKey,
          customerName,
          email,
          phone,
          channel,
          candidate.startMs,
          candidate.endMs,
          Number(body.players),
          candidate.laneCount,
          candidate.grouped ? "together" : "separated_accepted",
          "confirmed",
          "assigned",
          "unpaid",
          candidate.quote.totalClp,
          JSON.stringify({ ...candidate.quote, demo: getSettings().demoMode }),
          now,
          now,
          now,
          actor.id,
        );
      allocateReservation(conn, id, candidate);
      addAudit(actor, "manual_booking_created", "reservation", id, {
        channel,
        laneCount: candidate.laneCount,
      });
      return { reservation: getReservation(id), reused: false };
    });
    return json(res, created.reused ? 200 : 201, {
      booking: reservationPublic(created.reservation),
      reused: created.reused,
    });
  }
  const actionMatch =
    /^\/api\/staff\/bookings\/([\w-]+)\/(checkin|finish|resolve-absence|payments|extend|reschedule|lock|cancel)$/.exec(
      path,
    );
  if (actionMatch && method === "POST") {
    const actor = requireActor(req);
    const [, id, action] = actionMatch;
    const body = await readBody(req);
    const reservation = getReservation(id);
    const now = Date.now();
    if (action === "lock") {
      if (typeof body.locked !== "boolean")
        throw new HttpError(400, "Indica si las pistas deben quedar fijadas o flexibles.");
      if (reservation.commercial_status !== "confirmed")
        throw new HttpError(409, "Solo se pueden fijar reservas confirmadas.");
      if (reservation.checked_in_at && !body.locked)
        throw new HttpError(409, "Una reserva con check-in conserva sus pistas fijadas.");
      if (Boolean(reservation.manual_lane_lock) === body.locked)
        return json(res, 200, { booking: reservationPublic(reservation), reused: true });
      transaction((conn) => {
        conn
          .prepare("UPDATE reservations SET manual_lane_lock=?,updated_at=? WHERE id=?")
          .run(body.locked ? 1 : 0, now, id);
        addAudit(
          actor,
          body.locked ? "reservation_manually_locked" : "reservation_manually_unlocked",
          "reservation",
          id,
          { startMs: reservation.start_ms, lanes: reservation.lanes },
        );
      });
      return json(res, 200, { booking: reservationPublic(getReservation(id)) });
    }
    if (action === "reschedule") {
      const idempotencyKey = requireText(body.idempotencyKey, "Clave de idempotencia", 100);
      const previous = db
        .prepare(
          "SELECT reservation_id,action,result_json FROM reservation_actions WHERE idempotency_key=?",
        )
        .get(idempotencyKey);
      if (previous) {
        if (previous.reservation_id !== id || previous.action !== "reschedule")
          throw new HttpError(409, "La clave de cambio ya se usó en otra operación.");
        return json(res, 200, { ...JSON.parse(previous.result_json), reused: true });
      }
      const startMs = Number(body.startMs);
      if (!Number.isSafeInteger(startMs) || startMs < now)
        throw new HttpError(400, "El nuevo horario debe ser futuro y válido.");
      const targetDate = formatLocalDate(startMs);
      if (!dateLimitOk(targetDate))
        throw new HttpError(400, "Elige una fecha dentro del rango de operación.");
      if (
        reservation.commercial_status !== "confirmed" ||
        reservation.checked_in_at ||
        reservation.effective_start_ms
      )
        throw new HttpError(409, "Solo se puede mover una reserva futura que aún no inicia.");
      if (body.expectedStartMs != null && Number(body.expectedStartMs) !== reservation.start_ms)
        throw new HttpError(409, "La reserva cambió mientras la movías. Recarga el calendario.");
      const outcome = transaction((conn) => {
        const duplicate = conn
          .prepare(
            "SELECT reservation_id,action,result_json FROM reservation_actions WHERE idempotency_key=?",
          )
          .get(idempotencyKey);
        if (duplicate) {
          if (duplicate.reservation_id !== id || duplicate.action !== "reschedule")
            throw new HttpError(409, "La clave de cambio ya se usó en otra operación.");
          return { result: { ...JSON.parse(duplicate.result_json), reused: true } };
        }
        const current = conn.prepare("SELECT * FROM reservations WHERE id=?").get(id);
        if (
          !current ||
          current.start_ms !== reservation.start_ms ||
          current.end_ms !== reservation.end_ms ||
          current.commercial_status !== "confirmed" ||
          current.checked_in_at
        )
          throw new HttpError(409, "La reserva cambió mientras la movías. Recarga el calendario.");
        const settings = getSettings();
        if (startMs < Date.now())
          throw new HttpError(400, "El nuevo horario debe ser futuro y válido.");
        if (!alignedToScheduleStep(startMs, settings.startIntervalMinutes))
          throw new HttpError(
            400,
            `El nuevo horario debe respetar bloques de ${settings.startIntervalMinutes} minutos.`,
          );
        const durationMinutes = (current.end_ms - current.start_ms) / 60_000;
        const endMs = startMs + durationMinutes * 60_000;
        const day = parseLocalDay(targetDate);
        const reservations = reservationsForRange(
          day.start,
          endMs + settings.preparationMinutes * 60_000,
        ).filter((other) => other.id !== id);
        const blocks = blocksForRange(day.start, endMs + settings.preparationMinutes * 60_000);
        const candidate = selectLaneSetAtTime({
          startMs,
          players: current.players,
          durationMinutes,
          lanes: current.lane_count,
          acceptSeparated: current.group_mode === "separated_accepted",
          preferredLaneId: body.preferredLaneId,
          reservations,
          blocks,
          settings,
          channel: current.channel,
        });
        if (!candidate)
          throw new HttpError(409, "Ese bloque no está disponible para mover esta reserva.");
        if (
          body.acceptedQuoteClp != null &&
          Number(body.acceptedQuoteClp) !== candidate.quote.totalClp
        )
          throw new HttpError(409, "El precio cambió de nuevo; revisa el nuevo importe.");
        if (candidate.quote.totalClp !== current.quote_clp && body.acceptedQuoteClp == null)
          return {
            priceConfirmation: {
              error:
                "El horario cambia el importe. Confirma la aceptación del cliente para continuar.",
              requiresPriceConfirmation: true,
              oldQuoteClp: current.quote_clp,
              quoteClp: candidate.quote.totalClp,
            },
          };
        conn.prepare("UPDATE allocations SET active=0 WHERE reservation_id=? AND active=1").run(id);
        allocateReservation(conn, id, candidate);
        const quoteJson = { ...candidate.quote, demo: settings.demoMode };
        conn
          .prepare(
            "UPDATE reservations SET start_ms=?,end_ms=?,quote_clp=?,quote_json=?,manual_lane_lock=1,updated_at=? WHERE id=?",
          )
          .run(startMs, endMs, candidate.quote.totalClp, JSON.stringify(quoteJson), now, id);
        if (reservation.request_id)
          conn
            .prepare(
              "UPDATE booking_requests SET current_quote_clp=?,updated_at=? WHERE reservation_id=?",
            )
            .run(candidate.quote.totalClp, now, id);
        addAudit(actor, "booking_rescheduled", "reservation", id, {
          from: { startMs: current.start_ms, lanes: reservation.lanes },
          to: { startMs, lanes: candidate.lanes },
          quoteClp: candidate.quote.totalClp,
          customerAcceptedNewPrice: body.acceptedQuoteClp != null,
          manualLaneLock: true,
        });
        const saved = reservationPublic(getReservation(id));
        const actionResult = { booking: saved };
        conn
          .prepare(
            "INSERT INTO reservation_actions(id,idempotency_key,reservation_id,action,result_json,created_at,created_by) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            randomUUID(),
            idempotencyKey,
            id,
            "reschedule",
            JSON.stringify(actionResult),
            now,
            actor.id,
          );
        return { result: actionResult };
      });
      if (outcome.priceConfirmation) return json(res, 409, outcome.priceConfirmation);
      return json(res, 200, outcome.result);
    }
    if (action === "checkin") {
      if (reservation.checked_in_at)
        return json(res, 200, { booking: reservationPublic(reservation), reused: true });
      if (reservation.commercial_status !== "confirmed")
        throw new HttpError(409, "Solo se puede registrar llegada para una reserva confirmada.");
      if (now < reservation.start_ms - 60 * 60_000)
        throw new HttpError(
          409,
          "El check-in se puede registrar dentro de la hora previa al inicio.",
        );
      transaction(() => {
        db.prepare(
          "UPDATE reservations SET checked_in_at=?,effective_start_ms=?,inventory_status='occupied',manual_lane_lock=1,updated_at=? WHERE id=?",
        ).run(now, now, now, id);
        addAudit(actor, "checkin_recorded", "reservation", id, {
          scheduledStart: reservation.start_ms,
          actualStart: now,
        });
      });
      return json(res, 200, { booking: reservationPublic(getReservation(id)) });
    }
    if (action === "finish") {
      if (reservation.commercial_status === "finished")
        return json(res, 200, { booking: reservationPublic(reservation), reused: true });
      if (!reservation.checked_in_at || reservation.commercial_status !== "confirmed")
        throw new HttpError(409, "Solo se puede registrar el término de una reserva con check-in.");
      if (now < reservation.effective_start_ms)
        throw new HttpError(409, "La reserva todavía no ha comenzado.");
      const effectiveEnd = Math.min(now, reservation.end_ms);
      const releaseAt = effectiveEnd + getSettings().preparationMinutes * 60_000;
      transaction((conn) => {
        conn
          .prepare(
            "UPDATE allocations SET end_ms=MIN(end_ms,?) WHERE reservation_id=? AND active=1",
          )
          .run(releaseAt, id);
        conn
          .prepare(
            "UPDATE reservations SET effective_end_ms=?,commercial_status='finished',inventory_status='released',updated_at=? WHERE id=?",
          )
          .run(effectiveEnd, now, id);
        addAudit(actor, "booking_finished", "reservation", id, {
          scheduledEnd: reservation.end_ms,
          effectiveEnd,
          early: effectiveEnd < reservation.end_ms,
        });
      });
      return json(res, 200, {
        booking: reservationPublic(getReservation(id)),
        releasedAt: releaseAt,
      });
    }
    if (action === "resolve-absence") {
      if (["cancelled", "no_show_review"].includes(reservation.commercial_status))
        return json(res, 200, { booking: reservationPublic(reservation), reused: true });
      if (reservation.checked_in_at)
        throw new HttpError(409, "Esta reserva ya registró su llegada.");
      if (now < reservation.start_ms + getSettings().lateArrivalToleranceMinutes * 60_000)
        throw new HttpError(409, "Aún no se cumple la tolerancia de llegada.");
      if (!["keep", "release"].includes(body.resolution))
        throw new HttpError(400, "Elige mantener la reserva o liberar sus pistas.");
      transaction(() => {
        const release = body.resolution === "release";
        if (release) db.prepare("UPDATE allocations SET active=0 WHERE reservation_id=?").run(id);
        db.prepare(
          "UPDATE reservations SET commercial_status=?,inventory_status=?,updated_at=? WHERE id=?",
        ).run(release ? "cancelled" : "no_show_review", release ? "released" : "assigned", now, id);
        addAudit(actor, "absence_resolved", "reservation", id, {
          resolution: body.resolution,
          note: String(body.note ?? "").slice(0, 300),
        });
      });
      return json(res, 200, { booking: reservationPublic(getReservation(id)) });
    }
    if (action === "payments") {
      const amount = Number(body.amountClp);
      if (!Number.isSafeInteger(amount) || amount <= 0)
        throw new HttpError(400, "El importe debe ser un número entero de CLP mayor que cero.");
      const idempotencyKey = requireText(body.idempotencyKey, "Clave de idempotencia", 100);
      if (!["cash", "transfer", "external_terminal", "refund"].includes(body.method))
        throw new HttpError(400, "Medio de pago inválido.");
      if (!["reported", "verified", "refund_recorded"].includes(body.status))
        throw new HttpError(400, "Estado de pago inválido.");
      if (body.method === "refund" && actor.role !== "admin")
        throw new HttpError(403, "Solo administración puede registrar una devolución externa.");
      if (body.method !== "refund" && body.status === "refund_recorded")
        throw new HttpError(400, "El estado de devolución requiere el medio devolución.");
      if (body.method === "refund" && body.status !== "refund_recorded")
        throw new HttpError(
          400,
          "Una devolución debe quedar registrada como movimiento externo completado.",
        );
      const previous = db
        .prepare("SELECT id,reservation_id FROM payments WHERE idempotency_key=?")
        .get(idempotencyKey);
      if (previous) {
        if (previous.reservation_id !== id)
          throw new HttpError(409, "La clave de pago ya se utilizó en otra reserva.");
        return json(res, 200, {
          paymentId: previous.id,
          booking: reservationPublic(getReservation(id)),
          financialStatus: getReservation(id).financial_status,
          reused: true,
        });
      }
      const paymentId = randomUUID();
      const inserted = transaction(() => {
        const duplicate = db
          .prepare("SELECT id,reservation_id FROM payments WHERE idempotency_key=?")
          .get(idempotencyKey);
        if (duplicate) {
          if (duplicate.reservation_id !== id)
            throw new HttpError(409, "La clave de pago ya se utilizó en otra reserva.");
          return { saved: false, id: duplicate.id };
        }
        if (body.method === "refund") {
          const prior = db
            .prepare(
              "SELECT COALESCE(SUM(CASE WHEN status='verified' THEN amount_clp WHEN status='refund_recorded' THEN -amount_clp ELSE 0 END),0) AS balance FROM payments WHERE reservation_id=?",
            )
            .get(id).balance;
          if (amount > prior)
            throw new HttpError(409, "La devolución supera el total de pagos acreditados.");
        }
        db.prepare(
          "INSERT INTO payments(id,idempotency_key,reservation_id,amount_clp,method,status,reference,note,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)",
        ).run(
          paymentId,
          idempotencyKey,
          id,
          amount,
          body.method,
          body.status,
          String(body.reference ?? "").slice(0, 100),
          String(body.note ?? "").slice(0, 300),
          now,
          actor.id,
        );
        calculateFinancialStatus(id);
        addAudit(actor, "payment_recorded", "payment", paymentId, {
          reservationId: id,
          amountClp: amount,
          method: body.method,
          status: body.status,
        });
        return { saved: true, id: paymentId };
      });
      return json(res, inserted.saved ? 201 : 200, {
        paymentId: inserted.id,
        booking: reservationPublic(getReservation(id)),
        financialStatus: getReservation(id).financial_status,
        reused: !inserted.saved,
      });
    }
    if (action === "extend") {
      const idempotencyKey = requireText(body.idempotencyKey, "Clave de idempotencia", 100);
      const previous = db
        .prepare(
          "SELECT reservation_id,action,result_json FROM reservation_actions WHERE idempotency_key=?",
        )
        .get(idempotencyKey);
      if (previous) {
        if (previous.reservation_id !== id || previous.action !== "extend")
          throw new HttpError(409, "La clave de extensión ya se usó en otra operación.");
        return json(res, 200, { ...JSON.parse(previous.result_json), reused: true });
      }
      const settings = getSettings();
      const extensionDurations = extensionDurationsFor(settings.startIntervalMinutes);
      const minutes = Number(body.minutes);
      if (!extensionDurations.includes(minutes))
        throw new HttpError(
          400,
          `Elige una extensión de ${settings.startIntervalMinutes} a 60 minutos en ese intervalo.`,
        );
      if (
        !body.customerAccepted ||
        !reservation.checked_in_at ||
        reservation.commercial_status !== "confirmed"
      )
        throw new HttpError(
          409,
          "Recepción requiere la aceptación del cliente y una reserva en curso.",
        );
      if (now >= reservation.end_ms) throw new HttpError(409, "La reserva ya terminó.");
      const quote = calculateQuote({
        startMs: reservation.end_ms,
        durationMinutes: minutes,
        laneCount: reservation.lane_count,
        settings,
        channel: reservation.channel,
      });
      const candidate = {
        startMs: reservation.end_ms,
        endMs: reservation.end_ms + minutes * 60_000,
        lanes: reservation.lanes,
      };
      const conflicts = reservationsForRange(
        candidate.startMs,
        candidate.endMs + settings.preparationMinutes * 60_000,
      ).filter((other) => other.id !== reservation.id);
      const blocks = blocksForRange(
        candidate.startMs,
        candidate.endMs + settings.preparationMinutes * 60_000,
      );
      if (
        !matchesHours(
          candidate.startMs,
          candidate.endMs + settings.closingMarginMinutes * 60_000,
          settings.weeklyHours,
          settings.exceptions,
        ) ||
        (!isPhysicallyGrouped(candidate.lanes) && reservation.group_mode === "together") ||
        !candidate.lanes.every(
          (lane) =>
            !blocks.some(
              (block) =>
                (block.laneId === null || block.laneId === lane) &&
                block.startMs < candidate.endMs + settings.preparationMinutes * 60_000 &&
                block.endMs > candidate.startMs,
            ),
        ) ||
        conflicts.some((other) =>
          other.lanes.some(
            (lane) =>
              candidate.lanes.includes(lane) &&
              other.startMs < candidate.endMs + settings.preparationMinutes * 60_000 &&
              other.endMs + other.preparationMinutes * 60_000 > candidate.startMs,
          ),
        )
      ) {
        throw new HttpError(
          409,
          "No hay disponibilidad para extender sin afectar un compromiso futuro.",
        );
      }
      const previousQuote = reservation.quote;
      const combinedQuote = {
        ...previousQuote,
        baseClp:
          (previousQuote.baseClp ?? previousQuote.totalClp ?? reservation.quote_clp) +
          quote.baseClp,
        discountClp: (previousQuote.discountClp ?? 0) + quote.discountClp,
        totalClp: reservation.quote_clp + quote.totalClp,
        promotionName: quote.promotionName ?? previousQuote.promotionName ?? null,
        segments: [...(previousQuote.segments ?? []), ...quote.segments],
      };
      const outcome = transaction((conn) => {
        const duplicate = conn
          .prepare(
            "SELECT reservation_id,action,result_json FROM reservation_actions WHERE idempotency_key=?",
          )
          .get(idempotencyKey);
        if (duplicate) {
          if (duplicate.reservation_id !== id || duplicate.action !== "extend")
            throw new HttpError(409, "La clave de extensión ya se usó en otra operación.");
          return JSON.parse(duplicate.result_json);
        }
        conn
          .prepare(
            "UPDATE reservations SET end_ms=?,quote_clp=quote_clp+?,quote_json=?,updated_at=? WHERE id=?",
          )
          .run(candidate.endMs, quote.totalClp, JSON.stringify(combinedQuote), now, id);
        conn
          .prepare("UPDATE allocations SET end_ms=? WHERE reservation_id=? AND active=1")
          .run(candidate.endMs + settings.preparationMinutes * 60_000, id);
        addAudit(actor, "booking_extended", "reservation", id, {
          minutes,
          addedClp: quote.totalClp,
          customerAccepted: true,
        });
        const result = { booking: reservationPublic(getReservation(id)), addedClp: quote.totalClp };
        conn
          .prepare(
            "INSERT INTO reservation_actions(id,idempotency_key,reservation_id,action,result_json,created_at,created_by) VALUES(?,?,?,?,?,?,?)",
          )
          .run(randomUUID(), idempotencyKey, id, "extend", JSON.stringify(result), now, actor.id);
        return result;
      });
      return json(res, 200, outcome);
    }
    if (action === "cancel") {
      if (reservation.commercial_status === "cancelled")
        return json(res, 200, { booking: reservationPublic(reservation), reused: true });
      if (reservation.start_ms - now >= getSettings().cancellationFreeHours * 3_600_000) {
        transaction(() => {
          db.prepare("UPDATE allocations SET active=0 WHERE reservation_id=?").run(id);
          db.prepare(
            "UPDATE reservations SET commercial_status='cancelled',inventory_status='released',updated_at=? WHERE id=?",
          ).run(now, id);
          addAudit(actor, "booking_cancelled", "reservation", id, { late: false });
        });
        return json(res, 200, {
          booking: reservationPublic(getReservation(id)),
          message: "Reserva cancelada y pistas liberadas. La devolución se gestiona por separado.",
        });
      }
      throw new HttpError(
        409,
        "La cancelación tardía requiere una decisión administrativa; no se aplicó una penalización automática.",
      );
    }
  }
  const paymentAction = /^\/api\/staff\/payments\/([\w-]+)\/(verify|void)$/.exec(path);
  if (paymentAction && method === "POST") {
    const actor = requireActor(req);
    const [, paymentId, action] = paymentAction;
    const body = await readBody(req);
    const payment = db.prepare("SELECT * FROM payments WHERE id=?").get(paymentId);
    if (!payment) throw new HttpError(404, "No encontramos ese movimiento de pago.");
    if (action === "void" && actor.role !== "admin")
      throw new HttpError(403, "Solo administración puede corregir un pago informado.");
    const updated = transaction((conn) => {
      const current = conn.prepare("SELECT * FROM payments WHERE id=?").get(paymentId);
      if (action === "verify") {
        if (current.status === "verified") return { reused: true };
        if (current.status !== "reported")
          throw new HttpError(409, "Solo un pago informado puede acreditarse.");
        conn.prepare("UPDATE payments SET status='verified' WHERE id=?").run(paymentId);
        addAudit(actor, "payment_verified", "payment", paymentId, {
          reservationId: current.reservation_id,
          amountClp: current.amount_clp,
          reference: String(body.reference ?? "").slice(0, 100),
        });
      } else {
        if (current.status === "voided") return { reused: true };
        if (current.status !== "reported")
          throw new HttpError(
            409,
            "Solo un pago pendiente de verificación se puede anular. Los acreditados requieren una devolución externa.",
          );
        const reason = requireText(body.reason, "Motivo de corrección", 300);
        conn
          .prepare("UPDATE payments SET status='voided',note=COALESCE(note,'') || ? WHERE id=?")
          .run(` · Anulado: ${reason}`, paymentId);
        addAudit(actor, "reported_payment_voided", "payment", paymentId, {
          reservationId: current.reservation_id,
          amountClp: current.amount_clp,
          reason,
        });
      }
      calculateFinancialStatus(current.reservation_id);
      return { reused: false };
    });
    const reservation = getReservation(payment.reservation_id);
    return json(res, 200, {
      booking: reservationPublic(reservation),
      financialStatus: reservation.financial_status,
      reused: updated.reused,
    });
  }
  const requestAction = /^\/api\/staff\/requests\/([\w-]+)\/(approve|reject)$/.exec(path);
  if (requestAction && method === "POST") {
    const actor = requireActor(req);
    const [, requestId, action] = requestAction;
    const body = await readBody(req);
    const now = Date.now();
    const result = transaction((conn) => {
      const request = conn.prepare("SELECT * FROM booking_requests WHERE id=?").get(requestId);
      if (!request || !["pending_approval", "pending_price_acceptance"].includes(request.status))
        throw new HttpError(404, "No hay una solicitud pendiente con ese identificador.");
      if (action === "reject") {
        conn
          .prepare("UPDATE booking_requests SET status='rejected',updated_at=? WHERE id=?")
          .run(now, requestId);
        conn
          .prepare(
            "UPDATE reservations SET commercial_status='rejected',inventory_status='released',updated_at=? WHERE id=?",
          )
          .run(now, request.reservation_id);
        conn
          .prepare("UPDATE allocations SET active=0 WHERE reservation_id=?")
          .run(request.reservation_id);
        addAudit(actor, "request_rejected", "booking_request", requestId, {
          reason: String(body.reason ?? "").slice(0, 300),
        });
        return {
          rejected: true,
          email: request.email,
          code: getReservation(request.reservation_id).code,
        };
      }
      const reservation = getReservation(request.reservation_id);
      const settings = getSettings();
      const candidate = selectLaneSetAtTime({
        startMs: reservation.start_ms,
        players: reservation.players,
        durationMinutes: (reservation.end_ms - reservation.start_ms) / 60_000,
        lanes: reservation.lane_count,
        acceptSeparated: reservation.group_mode === "separated_accepted",
        reservations: reservationsForRange(
          reservation.start_ms,
          reservation.end_ms + 2 * 3_600_000,
        ).filter((other) => other.id !== reservation.id),
        blocks: blocksForRange(reservation.start_ms, reservation.end_ms + 2 * 3_600_000),
        settings,
        channel: request.channel,
      });
      if (!candidate)
        throw new HttpError(
          409,
          "La solicitud ya no tiene una asignación válida. Revisa la incidencia antes de aprobar.",
        );
      const quoteJson = { ...candidate.quote, demo: settings.demoMode };
      if (candidate.quote.totalClp !== reservation.quote_clp) {
        conn
          .prepare(
            "UPDATE booking_requests SET status='pending_price_acceptance',current_quote_clp=?,updated_at=? WHERE id=?",
          )
          .run(candidate.quote.totalClp, now, requestId);
        conn
          .prepare("UPDATE reservations SET quote_json=?,updated_at=? WHERE id=?")
          .run(JSON.stringify(quoteJson), now, reservation.id);
        addAudit(actor, "request_requoted", "booking_request", requestId, {
          oldAmountClp: reservation.quote_clp,
          newAmountClp: candidate.quote.totalClp,
        });
        return {
          priceChanged: true,
          email: request.email,
          code: reservation.code,
          amountClp: candidate.quote.totalClp,
          reservationId: reservation.id,
        };
      }
      conn
        .prepare(
          "UPDATE booking_requests SET status='confirmed',current_quote_clp=?,updated_at=? WHERE id=?",
        )
        .run(candidate.quote.totalClp, now, requestId);
      conn
        .prepare("UPDATE reservations SET commercial_status='confirmed',updated_at=? WHERE id=?")
        .run(now, reservation.id);
      addAudit(actor, "request_approved", "booking_request", requestId, {
        amountClp: candidate.quote.totalClp,
      });
      return {
        confirmed: true,
        email: request.email,
        code: reservation.code,
        reservationId: reservation.id,
      };
    });
    let notificationPending = false;
    if (result.email) {
      const payload = {
        to: result.email,
        subject: result.rejected
          ? `Solicitud cerrada · ${getSettings().venueName}`
          : result.priceChanged
            ? `Precio actualizado · ${getSettings().venueName}`
            : `Reserva confirmada · ${getSettings().venueName}`,
        text: result.rejected
          ? `Recepción rechazó la solicitud ${result.code}.`
          : result.priceChanged
            ? `La tarifa actualizada es $${result.amountClp.toLocaleString("es-CL")} CLP. Abre el enlace seguro recibido anteriormente y acepta el importe para confirmar.`
            : `Recepción aprobó la solicitud ${result.code}.`,
      };
      const mailId = transaction((conn) => queueMail(conn, payload));
      notificationPending = !(await deliverQueuedMail(mailId));
    }
    return json(res, 200, { ...result, notificationPending });
  }
  if (method === "POST" && path === "/api/staff/blocks") {
    const actor = requireActor(req);
    const body = await readBody(req);
    const startMs = Number(body.startMs);
    const endMs = Number(body.endMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs)
      throw new HttpError(400, "Intervalo de bloqueo inválido.");
    const intervalMinutes = getSettings().startIntervalMinutes;
    if (
      !alignedToScheduleStep(startMs, intervalMinutes) ||
      !alignedToScheduleStep(endMs, intervalMinutes)
    )
      throw new HttpError(
        400,
        `El bloqueo debe comenzar y terminar en bloques de ${intervalMinutes} minutos.`,
      );
    const laneId = body.laneId == null ? null : Number(body.laneId);
    if (laneId != null && (!Number.isInteger(laneId) || laneId < 1 || laneId > 12))
      throw new HttpError(400, "Pista inválida.");
    const reason = requireText(body.reason, "Motivo", 250);
    const id = randomUUID();
    transaction((conn) => {
      const conflict = conn
        .prepare(`SELECT a.id FROM allocations a JOIN reservations r ON r.id=a.reservation_id WHERE a.active=1
        AND (? IS NULL OR a.lane_id=?) AND a.start_ms<? AND a.end_ms>? AND r.commercial_status NOT IN ('cancelled','rejected','finished') LIMIT 1`)
        .get(laneId, laneId, endMs, startMs);
      if (conflict)
        throw new HttpError(
          409,
          "El bloqueo afectaría una reserva o preparación existente. Gestiona primero la incidencia con el cliente.",
        );
      conn
        .prepare(
          "INSERT INTO maintenance_blocks(id,lane_id,start_ms,end_ms,reason,created_at,created_by) VALUES(?,?,?,?,?,?,?)",
        )
        .run(id, laneId, startMs, endMs, reason, Date.now(), actor.id);
      addAudit(actor, "maintenance_block_created", "maintenance_block", id, {
        laneId,
        startMs,
        endMs,
        reason,
      });
    });
    return json(res, 201, { id, laneId, startMs, endMs, reason });
  }
  if (method === "DELETE" && /^\/api\/staff\/blocks\/[\w-]+$/.test(path)) {
    const actor = requireActor(req);
    const id = path.split("/").at(-1);
    transaction(() => {
      db.prepare(
        "UPDATE maintenance_blocks SET status='released' WHERE id=? AND status='active'",
      ).run(id);
      addAudit(actor, "maintenance_block_released", "maintenance_block", id, {});
    });
    return json(res, 200, { ok: true });
  }
  if (method === "GET" && path === "/api/staff/settings") {
    requireActor(req, ["admin"]);
    const settings = getSettings();
    return json(res, 200, {
      ...settings,
      extensionDurations: extensionDurationsFor(settings.startIntervalMinutes),
      pendingEmailCount: db
        .prepare("SELECT COUNT(*) AS count FROM email_outbox WHERE status='queued'")
        .get().count,
      users: db.prepare("SELECT id,email,name,role,active FROM users ORDER BY email").all(),
    });
  }
  if (method === "PUT" && path === "/api/staff/settings") {
    const actor = requireActor(req, ["admin"]);
    const body = await readBody(req);
    const old = getSettings();
    const updated = { ...old };
    for (const key of [
      "venueName",
      "preparationMinutes",
      "closingMarginMinutes",
      "startIntervalMinutes",
      "minimumAdvanceMinutes",
      "maximumAdvanceDays",
      "lateArrivalToleranceMinutes",
      "operationalLockMinutes",
      "calendarHourWidthPx",
      "weeklyHours",
      "exceptions",
      "generalRateClpPerLaneHour",
      "rateBands",
      "rateExceptions",
      "promotions",
      "cancellationFreeHours",
      "lateCancellationPenaltyClp",
      "requireManualApprovalFromLanes",
    ]) {
      if (Object.hasOwn(body, key)) updated[key] = body[key];
    }
    if (
      !Number.isInteger(updated.preparationMinutes) ||
      updated.preparationMinutes < 0 ||
      updated.preparationMinutes > 60
    )
      throw new HttpError(400, "La preparación debe estar entre 0 y 60 minutos.");
    if (
      !Number.isInteger(updated.closingMarginMinutes) ||
      updated.closingMarginMinutes < 0 ||
      updated.closingMarginMinutes > 180
    )
      throw new HttpError(400, "El margen de cierre debe estar entre 0 y 180 minutos.");
    if (
      !Number.isInteger(updated.generalRateClpPerLaneHour) ||
      updated.generalRateClpPerLaneHour < 0
    )
      throw new HttpError(400, "La tarifa debe ser un entero CLP igual o mayor que cero.");
    if (!supportedScheduleIntervals.includes(updated.startIntervalMinutes))
      throw new HttpError(400, "El bloque de agenda debe ser 5, 10, 12, 15, 20, 30 o 60 minutos.");
    if (
      !Number.isInteger(updated.calendarHourWidthPx) ||
      updated.calendarHourWidthPx < 36 ||
      updated.calendarHourWidthPx > 120 ||
      updated.calendarHourWidthPx % 12 !== 0
    )
      throw new HttpError(
        400,
        "El ancho del calendario debe estar entre 36 y 120 píxeles por hora.",
      );
    if (
      !Number.isInteger(updated.maximumAdvanceDays) ||
      updated.maximumAdvanceDays < 1 ||
      updated.maximumAdvanceDays > 365
    )
      throw new HttpError(400, "La anticipación máxima debe estar entre 1 y 365 días.");
    if (
      !Number.isInteger(updated.requireManualApprovalFromLanes) ||
      updated.requireManualApprovalFromLanes < 1 ||
      updated.requireManualApprovalFromLanes > 12
    )
      throw new HttpError(400, "El umbral de aprobación debe estar entre 1 y 12 pistas.");
    if (
      !Number.isInteger(updated.minimumAdvanceMinutes) ||
      updated.minimumAdvanceMinutes < 0 ||
      updated.minimumAdvanceMinutes > 43_200
    )
      throw new HttpError(400, "La anticipación mínima debe estar entre 0 minutos y 30 días.");
    if (
      !Number.isInteger(updated.lateArrivalToleranceMinutes) ||
      updated.lateArrivalToleranceMinutes < 0 ||
      updated.lateArrivalToleranceMinutes > 60
    )
      throw new HttpError(400, "La tolerancia de llegada debe estar entre 0 y 60 minutos.");
    if (
      !Number.isInteger(updated.cancellationFreeHours) ||
      updated.cancellationFreeHours < 0 ||
      updated.cancellationFreeHours > 720
    )
      throw new HttpError(400, "El plazo sin penalización debe estar entre 0 y 720 horas.");
    if (
      updated.lateCancellationPenaltyClp != null &&
      (!Number.isSafeInteger(updated.lateCancellationPenaltyClp) ||
        updated.lateCancellationPenaltyClp < 0)
    )
      throw new HttpError(
        400,
        "La penalización tardía debe ser CLP entero o permanecer sin configurar.",
      );
    validateHours(updated.weeklyHours, updated.exceptions);
    validateRates(updated);
    validatePromotions(updated.promotions);
    transaction((conn) => {
      if (old.preparationMinutes !== updated.preparationMinutes) {
        const allocations = conn
          .prepare(`SELECT a.id,a.lane_id,a.start_ms,r.end_ms FROM allocations a JOIN reservations r ON r.id=a.reservation_id
          WHERE a.active=1 AND r.commercial_status NOT IN ('cancelled','rejected','finished')`)
          .all();
        for (const allocation of allocations) {
          const newEnd =
            allocation.end_ms -
            old.preparationMinutes * 60_000 +
            updated.preparationMinutes * 60_000;
          const other = conn
            .prepare(
              "SELECT id FROM allocations WHERE id<>? AND lane_id=? AND active=1 AND start_ms<? AND end_ms>? LIMIT 1",
            )
            .get(allocation.id, allocation.lane_id, newEnd, allocation.start_ms);
          if (other)
            throw new HttpError(
              409,
              "El nuevo tiempo de preparación entraría en conflicto con una reserva protegida. Ajusta el horario o los compromisos antes de guardar.",
            );
        }
        for (const allocation of allocations)
          conn
            .prepare("UPDATE allocations SET end_ms=? WHERE id=?")
            .run(
              allocation.end_ms -
                old.preparationMinutes * 60_000 +
                updated.preparationMinutes * 60_000,
              allocation.id,
            );
      }
      saveSettings(updated, actor.id);
      addAudit(actor, "settings_updated", "settings", "venue", {
        changed: Object.keys(body),
        preparationMinutes: updated.preparationMinutes,
        rateChanged: old.generalRateClpPerLaneHour !== updated.generalRateClpPerLaneHour,
      });
    });
    return json(res, 200, { settings: updated });
  }
  if (method === "POST" && path === "/api/staff/users") {
    const actor = requireActor(req, ["admin"]);
    const body = await readBody(req);
    const email = requireEmail(body.email);
    const name = requireText(body.name, "Nombre", 120);
    const password = requireText(body.password, "Contraseña", 200);
    const role = body.role;
    if (!["reception", "admin"].includes(role)) throw new HttpError(400, "Perfil inválido.");
    if (password.length < 12)
      throw new HttpError(400, "Usa una contraseña de al menos 12 caracteres.");
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 64).toString("hex");
    const id = randomUUID();
    try {
      db.prepare(
        "INSERT INTO users(id,email,name,role,password_salt,password_hash,created_at) VALUES(?,?,?,?,?,?,?)",
      ).run(id, email, name, role, salt, hash, Date.now());
    } catch {
      throw new HttpError(409, "Ya existe un usuario con ese correo.");
    }
    addAudit(actor, "employee_created", "user", id, { email, role });
    return json(res, 201, { id, email, name, role });
  }
  const userStatusMatch = /^\/api\/staff\/users\/([\w-]+)\/status$/.exec(path);
  if (method === "POST" && userStatusMatch) {
    const actor = requireActor(req, ["admin"]);
    const body = await readBody(req);
    const userId = userStatusMatch[1];
    if (typeof body.active !== "boolean")
      throw new HttpError(400, "El estado de la cuenta debe ser activo o inactivo.");
    const target = db.prepare("SELECT id,email,role,active FROM users WHERE id=?").get(userId);
    if (!target) throw new HttpError(404, "No encontramos esa cuenta.");
    if (!body.active && target.id === actor.id)
      throw new HttpError(409, "No puedes desactivar tu propia cuenta.");
    if (
      !body.active &&
      target.role === "admin" &&
      target.active &&
      db.prepare("SELECT COUNT(*) AS count FROM users WHERE role='admin' AND active=1").get()
        .count <= 1
    ) {
      throw new HttpError(409, "Debe quedar al menos una cuenta de administración activa.");
    }
    transaction((conn) => {
      conn.prepare("UPDATE users SET active=? WHERE id=?").run(body.active ? 1 : 0, userId);
      if (!body.active) conn.prepare("DELETE FROM sessions WHERE user_id=?").run(userId);
      addAudit(actor, body.active ? "employee_activated" : "employee_deactivated", "user", userId, {
        email: target.email,
        role: target.role,
      });
    });
    return json(res, 200, { id: userId, active: body.active });
  }
  if (method === "GET" && path === "/api/staff/emails") {
    requireActor(req, ["admin"]);
    const rows = db
      .prepare(
        "SELECT id,recipient,attempts,created_at,last_error FROM email_outbox WHERE status='queued' ORDER BY created_at LIMIT 100",
      )
      .all();
    return json(res, 200, {
      emails: rows.map((row) => ({
        id: row.id,
        recipient: row.recipient,
        attempts: row.attempts,
        createdAt: row.created_at,
        lastError: row.last_error,
      })),
    });
  }
  const retryEmailMatch = /^\/api\/staff\/emails\/([\w-]+)\/retry$/.exec(path);
  if (method === "POST" && retryEmailMatch) {
    const actor = requireActor(req, ["admin"]);
    const emailId = retryEmailMatch[1];
    if (!db.prepare("SELECT id FROM email_outbox WHERE id=? AND status='queued'").get(emailId))
      throw new HttpError(404, "No encontramos un correo pendiente de reintento.");
    const sent = await deliverQueuedMail(emailId);
    addAudit(actor, "email_delivery_retried", "email", emailId, { sent });
    return json(res, 200, { id: emailId, sent });
  }
  if (method === "GET" && path === "/api/staff/audit") {
    requireActor(req, ["admin"]);
    const rows = db
      .prepare(
        `SELECT a.*,u.name AS actor_name FROM audit_log a LEFT JOIN users u ON a.actor_id=u.id ORDER BY a.created_at DESC LIMIT 200`,
      )
      .all();
    return json(res, 200, {
      events: rows.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        actor: row.actor_name ?? row.actor_role ?? "sistema",
        details: JSON.parse(row.details_json),
        at: row.created_at,
      })),
    });
  }
  throw new HttpError(404, "Ruta no encontrada.");
}

async function serveStatic(req, res, pathname) {
  const dist = resolve(here, "../dist");
  if (!existsSync(resolve(dist, "index.html")))
    return json(res, 503, { error: "La aplicación todavía no está compilada." });
  let target = resolve(dist, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (target !== dist && !target.startsWith(dist + sep))
    return json(res, 404, { error: "No encontrado." });
  try {
    if (!(await stat(target)).isFile()) target = resolve(dist, "index.html");
  } catch {
    target = resolve(dist, "index.html");
  }
  res.writeHead(200, {
    "content-type": mimeTypes[extname(target)] ?? "application/octet-stream",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  createReadStream(target).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
    else await serveStatic(req, res, url.pathname);
  } catch (error) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const status =
      error instanceof HttpError
        ? error.status
        : error.message?.includes("lane allocation conflict")
          ? 409
          : 500;
    if (status === 500) process.stderr.write(`[api error] ${error.stack ?? error}\n`);
    json(res, status, {
      error:
        status === 500
          ? "Ocurrió un error interno. El equipo puede revisar la auditoría del servicio."
          : error.message,
    });
  }
});

server.listen(port, "0.0.0.0", () =>
  process.stdout.write(
    `Bowling API escuchando en http://localhost:${port} (${demoMode ? "demo" : "production"})\n`,
  ),
);
void drainMailOutbox();
const mailRetryTimer = setInterval(() => void drainMailOutbox(), 30_000);
mailRetryTimer.unref();
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
