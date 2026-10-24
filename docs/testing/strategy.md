# Estrategia de pruebas

**Estado:** vigente para el MVP
**Fecha:** 2026-10-24
**Decisión relacionada:** [ADR 0003 — estrategia de pruebas](../decisions/0003-testing-strategy.md)

## Objetivo

Detectar errores de reglas, integración y UX antes de integrar cambios y repetir un recorrido corto en la vista previa. Las pruebas son deterministas, usan datos desechables y no contactan clientes ni servicios reales.

## Capas y comandos

| Nivel                      | Qué valida                                                                                                                                       | Herramienta / alcance                                                               | Comando                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------- |
| Unidad del dominio y fecha | Tarifas, capacidad, agrupación, preparación, bloqueos, alternativas, conversión local y DST.                                                     | `node:test`; funciones puras de `server/domain.mjs` y `shared/time.mjs`.            | `pnpm exec vp run test:unit`.                  |
| Unidad de presentación     | Navegación de días, rangos, zoom y selección de una franja.                                                                                      | Vite+ Test/Vitest sobre `src/calendar.ts`, sin DOM ni servidor.                     | `pnpm exec vp run test:unit`.                  |
| Integración/API            | HTTP real con SQLite temporal: roles, disponibilidad, escritura concurrente, idempotencia, correo de desarrollo, pagos manuales y mantenimiento. | `node:test`; cada proceso usa una base en el directorio temporal.                   | `pnpm exec vp run test:integration`.           |
| E2E navegador              | Carga pública; login de recepción; navegación/zoom; activación por teclado; desplazamiento del calendario a 390 px.                              | Playwright con Chromium, API y Vite reales, base temporal y credenciales solo demo. | `pnpm exec vp run e2e`.                        |
| Smoke local                | Repite los dos recorridos críticos del navegador con base temporal.                                                                              | Subconjunto Playwright etiquetado `@smoke`.                                         | `pnpm exec vp run smoke`.                      |
| Smoke de vista previa      | Ejecuta los flujos E2E esenciales contra una URL de vista previa cuando esa infraestructura exista.                                              | Playwright, entorno separado y fixtures aprobadas para test.                        | Aún no existe URL de vista previa configurada. |

`ready` incluye revisión de formato/lint/tipos, todas las pruebas unitarias y de integración, y build. `regression` ejecuta `ready` y E2E. El workflow de GitHub instala Chromium y corre `regression` en cada push y pull request; los dos casos E2E actuales también están etiquetados para el comando corto `smoke`.

## Escenarios críticos

### Reglas e inventario

- Capacidad de 1–72 jugadores y agrupación física válida.
- Horario normal, cierre que cruza medianoche, excepciones, preparación y mantenimiento.
- No solapar asignaciones activas incompatibles; dos solicitudes que compiten por la última capacidad producen exactamente un ganador.
- Repetir una escritura con la misma clave idempotente no crea una segunda reserva.
- El importe se calcula por intervalos tarifarios y promociones elegibles sin exceder el subtotal aplicable.

### Hora local

- Inicio/fin de día local en cambios DST de 23 y 25 horas.
- Hora inexistente rechazada; hora repetida identificada como dos instantes en el buscador.
- Navegar días y mostrar el tablero en una zona distinta del host no cambia la fecha comercial.

### Acceso y dinero

- Sin sesión no se accede a la operación; recepción y administración respetan permisos distintos.
- Producción inicia sin fixtures, tarifas ni horario de demo y no confirma correo sin proveedor configurado.
- Pago informado y devolución externa conservan estados y auditoría; no activan integración de cobro.

### Experiencia de recepción

- Inicio, día anterior/siguiente y fecha seleccionada corresponden al valor consultado en API.
- El control de rango actualiza el zoom y el indicador visible.
- Mouse y teclado activan solo el flujo de precarga; el guardado se valida otra vez en servidor.
- La interfaz consume los límites horarios del tablero y no interpreta reglas semanales en paralelo.

## Fixtures y aislamiento

- Pruebas de dominio usan objetos inline pequeños con fecha fija.
- Pruebas API crean un SQLite nuevo por proceso y lo eliminan en teardown.
- Playwright establece su propio `DATABASE_PATH` en temporales; las cuentas y tarifas son demo y sus emails usan `.test`.
- La semilla de demo de uso manual sigue en `apps/website/data/demo.sqlite`; ninguna prueba lee ni modifica esa base.
- La API y el navegador se levantan localmente; no se conectan a correo productivo, pago, ni base remota.

## Reglas para cambios

- Corregir un bug incluye un caso que reproduce el fallo antes del fix.
- Cambios al planificador o a pagos deben probar las transiciones relevantes, no solo el código HTTP 200.
- Cambios a la UI que alteren una interacción de cliente o staff añaden prueba de unidad de estado/cálculo y, si el recorrido cruza la API, E2E.
- Mantener los E2E en flujos críticos; la granularidad fina pertenece a unidad o integración.
- No fijar un porcentaje global de cobertura sin medir la línea base. Priorizar ramas de autorización, horario, asignación, precio e idempotencia.

## Reportes y fallos

Playwright conserva trazas y capturas solo ante fallos. Los resultados CI bloquean la promoción del cambio; no hay despliegue automático conectado. En una falla E2E, reproducir con `pnpm exec vp run website#e2e -- --headed` si el entorno tiene display, o inspeccionar la traza adjunta en CI.

## Cobertura pendiente

- Flujos de solicitud con aceptación y cancelación en navegador.
- Acciones de recepción para aprobación, check-in y extensión.
- Vista móvil en más tamaños y chequeos automatizados de accesibilidad.
- Smoke autenticado de una URL de vista previa después de elegir proveedor de hosting.
