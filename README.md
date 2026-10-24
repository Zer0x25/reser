# Bowling Smart Booking Engine

MVP en español para gestionar reservas web y de recepción de un salón de 12 pistas. Incluye búsqueda y cotización, solicitudes con capacidad compartida, operación de pistas, pagos manuales, administración y auditoría.

## Requisitos

- Node.js 22.18 o posterior (usa `node:sqlite`).
- pnpm compatible con la versión declarada en `package.json`.

## Desarrollo local

```bash
pnpm install
pnpm --filter website dev
```

Abre <http://localhost:5173>. Vite sirve la interfaz y reenvía `/api` al servidor local en el puerto 3001. La base SQLite se crea en `apps/website/data/demo.sqlite`; la carpeta se excluye de Git.

Accesos locales:

| Perfil         | Correo                 | Contraseña         |
| -------------- | ---------------------- | ------------------ |
| Recepción      | `recepcion@demo.local` | `BowlingDemo2026!` |
| Administración | `admin@demo.local`     | `BowlingDemo2026!` |

Son credenciales exclusivas de demostración. Los códigos de verificación y mensajes de correo de desarrollo aparecen en la terminal donde corre la API. La demo agrega reservas ficticias, una solicitud pendiente de aprobación, un pago informado sin acreditar y un bloqueo de mantenimiento; los correos usan dominios reservados `.test`. Los datos y precios son ejemplos y no autorizan cobros.

## Pruebas y verificación

```bash
pnpm exec vp run ready
pnpm exec vp run e2e:install
pnpm exec vp run smoke
pnpm exec vp run smoke:preview
pnpm exec vp run e2e
pnpm exec vp run test:visual
pnpm exec vp run regression
pnpm exec vp run simulate:engine
```

`test:unit` y `test:integration` ejecutan cada capa por separado. `ready` suma formato, lint, tipos, toda la suite de unidad/integración y compilación. Usa `e2e:install` una vez para instalar Chromium. `smoke` corre tres verificaciones rápidas contra Vite; `smoke:preview` compila y corre las mismas tres contra el artefacto servido localmente por Node; `e2e` ejecuta trece pruebas, incluidos aprobación, aceptación de precio, renovación/cancelación, check-in/extensión, axe, búsqueda y selección interactiva de fechas/grupos, disponibilidad vacía y fallos de red, y reflow en nueve anchos. Cinco snapshots visuales cubren móvil, escritorio, resultados, solicitud y calendario móvil. `test:visual` ejecuta solo esas comparaciones de pantallas. Las pruebas generativas del dominio recorren los 4095 subconjuntos de pistas y verifican 5000 combinaciones seeded de inventario. `regression` corre `ready`, E2E y smoke compilado antes de integrar un cambio. Las pruebas de API y E2E usan bases SQLite temporales y no modifican el archivo de demostración. El correo de prueba se captura en un servicio local.

`simulate:engine` ejecuta una jornada sintética reproducible y compara la recomendación del motor con primera hora libre, hora más cercana y compactación simple. Reporta solicitudes aceptadas, horas-pista, ingreso ilustrativo, distancia horaria y capacidad residual por tamaño de demanda. No usa precios ni reservas reales.

Para cobertura dirigida ejecuta `pnpm exec vp run coverage:domain` y `pnpm exec vp run coverage:calendar`. La cobertura de dominio/tiempo es 88.07% líneas, 83.04% ramas y 95.35% funciones; `calendar.ts` marca 100% en las tres métricas. No representan cobertura global de la API ni de la interfaz.

La estrategia por niveles, escenarios críticos, aislamiento y pendientes está en [`docs/testing/strategy.md`](docs/testing/strategy.md). El diseño del sistema y los límites entre UX, dominio, API y persistencia están en [`docs/design/system-design.md`](docs/design/system-design.md). La evolución incremental de esos límites está documentada en [ADR 0004](docs/decisions/0004-domain-use-cases-and-ux.md).

## Producción

La configuración productiva empieza cerrada: no ofrece horarios, no tiene tarifas, no crea usuarios de demo y exige configurar correo antes de verificar contactos. Crea una copia de `.env.example`, completa los valores y exporta sus variables en el entorno del proceso. No guardes secretos reales en Git.

Variables requeridas o recomendadas:

| Variable                                                | Uso                                                                                                                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV=production` y `MVP_MODE=production`           | Desactivar semilla y política de demo.                                                                                                                              |
| `DATABASE_PATH`                                         | Ruta persistente de SQLite fuera del directorio efímero del despliegue.                                                                                             |
| `TOKEN_SECRET`                                          | Secreto estable de al menos 32 bytes para sesiones, enlaces, pruebas de correo y cifrado de la cola de correos. Respáldalo y no lo cambies sin un plan de rotación. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`                         | Crear el primer administrador; exige contraseña de 12 caracteres o más.                                                                                             |
| `PUBLIC_APP_URL`                                        | URL pública HTTPS incluida en los enlaces de reservas.                                                                                                              |
| `MAIL_DELIVERY_URL`, `MAIL_DELIVERY_TOKEN`, `MAIL_FROM` | Adaptador HTTP para el proveedor de correo.                                                                                                                         |
| `PORT`                                                  | Puerto del servidor Node; por defecto, 3001.                                                                                                                        |

Una vez configuradas las variables:

```bash
pnpm install
pnpm --filter website build
pnpm --filter website api
```

El mismo proceso Node sirve la interfaz compilada y la API. Configura el proxy TLS y el dominio público en la infraestructura de despliegue. Conserva el archivo SQLite en almacenamiento persistente. Para una copia consistente, detén el proceso antes de copiar la base y sus archivos WAL, o usa una herramienta de backup SQLite que los incluya.

Al iniciar por primera vez, configura horarios, excepciones, preparación, tarifas y promociones desde Administración antes de aceptar reservas. El inventario físico inicial es una distribución de dos pistas de ancho, con las parejas 1–2, 3–4, 5–6, 7–8, 9–10 y 11–12. Los precios, horarios y políticas comerciales reales pertenecen al establecimiento.

### Adaptador de correo

El MVP envía `POST` JSON a `MAIL_DELIVERY_URL`, con `Authorization: Bearer <MAIL_DELIVERY_TOKEN>`:

```json
{
  "from": "reservas@tu-dominio.cl",
  "to": "cliente@ejemplo.cl",
  "subject": "Reserva confirmada",
  "text": "Texto del mensaje y enlace seguro"
}
```

El servicio debe devolver un estado HTTP 2xx cuando acepte el mensaje. La aplicación no está ligada a un proveedor concreto. Los correos transaccionales quedan en una cola SQLite cifrada con `TOKEN_SECRET`; los fallidos se reintentan y Administración puede reintentarlos manualmente. Los códigos de verificación se envían sincrónicamente y no crean retenciones.

## Qué incluye el MVP

- Motor determinista que aplica capacidad, parejas, agrupaciones, horario, preparación, cierres y mantenimiento; propone horarios cercanos y opciones que preservan mejor la capacidad futura. Las pruebas de escenarios cubren grupos de 4–72 personas, buffers de 5/10 minutos y una comparación contra políticas simples de asignación.
- Inventario SQLite compartido por canales, operaciones de escritura transaccionales, prevención de solapamientos e idempotencia.
- Búsqueda pública, cotización en CLP, franjas y excepciones tarifarias, promociones no acumulables, verificación de correo, solicitud automática hasta el umbral configurado y retenciones para aprobación.
- Seguimiento con enlace aleatorio de 24 horas, renovación después de verificar el correo, aceptación de nuevo precio y cancelación web con al menos 24 horas de anticipación.
- Tablero de doce pistas, solicitudes, reservas telefónicas/presenciales, check-in, resolución manual de ausencias, término real, extensiones autorizadas, mantenimiento, reoptimización localizada, pagos informados/verificados y devoluciones externas para administración.
- Calendario de recepción con navegación por día, acceso rápido a hoy y selección de un espacio libre para precargar fecha y hora en el formulario manual. La disponibilidad se valida al guardar y la pista se asigna en el servidor.
- Administración de horarios, preparación, tarifas, promociones, empleados, activación de cuentas, cola de correo y auditoría.

La optimización utiliza una puntuación de escenarios de demanda y una búsqueda localizada limitada a 80 reservas por operación. Es una heurística reproducible; no demuestra el óptimo global. Los precios se calculan por minuto local y se redondea una sola vez al CLP más cercano (mitades hacia arriba).

## Límites conocidos y asuntos por definir

- Las tarifas y horas de demo son ficticias. En producción hay que introducir los valores aprobados por el establecimiento.
- No hay pasarela, anticipos automáticos, importes de penalización tardía, penalizaciones por ausencia, impuestos o compensaciones. Un pago verificado o devolución registrada afirma que se comprobó fuera del sistema; no mueve dinero.
- Las solicitudes web se limitan transaccionalmente a dos pendientes por correo. Aún faltan cupos y detección de duplicados para solicitudes manuales, excepciones justificadas de recepción y alertas de abuso más amplias.
- El umbral de aprobación por número de pistas es configurable; políticas de anticipos por canal/tipo aún no están implementadas.
- Las modificaciones ordinarias de horario, duración, cantidad de pistas y jugadores aún no cuentan con flujo de aprobación. Tampoco existe flujo de incidencias y reubicación supervisada por falla de pista.
- La ficha y el tablero no incluyen todos los indicadores históricos de ocupación, fragmentación, conversión e ingresos solicitados. Los indicadores presentes usan registros reales.
- La forma física del salón comienza con la distribución supuesta 2 × 6; la administración todavía no edita coordenadas o adyacencias.
- La cola de correo reintenta cada 30 segundos mientras el proceso está activo. Para varios procesos API se debe añadir coordinación de trabajadores antes del despliegue horizontal.
- Aún faltan flujos de modificación, detección de abuso en todos los canales, incidencias y reubicación de pistas, además de escenarios de pagos más completos. Tampoco hay smoke de URL desplegada, pruebas manuales con lector de pantalla ni cobertura global instrumentada.

La especificación inicial completa se conserva en [`docs/product/initial-one-shot-implementation-prompt.md`](docs/product/initial-one-shot-implementation-prompt.md). Este README describe el estado actual y sus límites; el prompt define el alcance funcional objetivo.

Decisiones aceptadas: [ADR 0001 — stack y límites arquitectónicos](docs/decisions/0001-mvp-stack.md), [ADR 0002 — ciclo de reservas, pagos y límites de demo](docs/decisions/0002-reservation-and-demo-boundaries.md), [ADR 0003 — estrategia de pruebas](docs/decisions/0003-testing-strategy.md) y [ADR 0004 — límites de dominio y UX](docs/decisions/0004-domain-use-cases-and-ux.md).
