# Estrategia de pruebas

**Estado:** vigente para el MVP
**Fecha:** 2026-10-24
**Decisión relacionada:** [ADR 0003 — estrategia de pruebas](../decisions/0003-testing-strategy.md)

## Objetivo

Detectar errores de reglas, integración y UX antes de integrar cambios y repetir un recorrido corto en la vista previa. Las pruebas son deterministas, usan datos desechables y no contactan clientes ni servicios reales.

## Capas y comandos

| Nivel                      | Qué valida                                                                                                                                                                                                                                           | Herramienta / alcance                                                                                 | Comando                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Unidad del dominio y fecha | Tarifas, capacidad, agrupación, preparación, bloqueos, alternativas, conversión local y DST.                                                                                                                                                         | `node:test`; funciones puras de `server/domain.mjs` y `shared/time.mjs`.                              | `pnpm exec vp run test:unit`.                  |
| Unidad de presentación     | Navegación de días, rangos, zoom y selección de una franja.                                                                                                                                                                                          | Vite+ Test/Vitest sobre `src/calendar.ts`, sin DOM ni servidor.                                       | `pnpm exec vp run test:unit`.                  |
| Integración/API            | HTTP real con SQLite temporal: roles, disponibilidad, escritura concurrente, idempotencia, correo de desarrollo, pagos manuales y mantenimiento.                                                                                                     | `node:test`; cada proceso usa una base en el directorio temporal.                                     | `pnpm exec vp run test:integration`.           |
| E2E navegador              | Verificación de correo de prueba, solicitud grande, aprobación de recepción, seguimiento privado, reserva presencial y check-in; navegación por teclado; calendario móvil; disposición a 768/1024 px; axe WCAG 2.2 A/AA en página pública y tablero. | Playwright con Chromium, API y Vite reales, SQLite temporal y correo capturado por un sumidero local. | `pnpm exec vp run e2e`.                        |
| Smoke local                | Carga pública; navegación/zoom/teclado del calendario de recepción; desplazamiento del calendario a 390 px.                                                                                                                                          | Tres pruebas Playwright etiquetadas `@smoke`.                                                         | `pnpm exec vp run smoke`.                      |
| Smoke de vista previa      | Ejecuta los flujos E2E esenciales contra una URL de vista previa cuando esa infraestructura exista.                                                                                                                                                  | Playwright, entorno separado y fixtures aprobadas para test.                                          | Aún no existe URL de vista previa configurada. |

`ready` incluye revisión de formato/lint/tipos, todas las pruebas unitarias y de integración, y build. `regression` ejecuta `ready` y las siete pruebas E2E. El workflow de GitHub instala Chromium y corre `regression` en cada push y pull request. Las tres pruebas etiquetadas `@smoke` forman el comando corto `smoke`.

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
- El pedido de verificación mantiene nombre, correo y aceptación de condiciones después de redibujar el formulario.
- La reserva de grupo atraviesa verificación, retención, aprobación humana y seguimiento privado; la reserva presencial atraviesa alta y check-in.
- axe analiza los criterios WCAG 2.0/2.1/2.2 A y AA en la entrada pública y el tablero de recepción.
- La página no desborda el ancho del viewport a 768 px y 1024 px; el calendario móvil conserva desplazamiento horizontal propio a 390 px.

## Fixtures y aislamiento

- Pruebas de dominio usan objetos inline pequeños con fecha fija.
- Pruebas API crean un SQLite nuevo por proceso y lo eliminan en teardown.
- Playwright establece su propio `DATABASE_PATH` en temporales; las cuentas y tarifas son demo y sus emails usan `.test`.
- Playwright levanta un servicio local de correo falso en `127.0.0.1:3002`; ningún correo de prueba sale del equipo.
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

- Cobertura dirigida disponible: `pnpm exec vp run coverage:domain` mide el dominio y tiempo con `node:test`; `pnpm exec vp run coverage:calendar` mide el módulo puro de calendario con V8. La última medición fue 88.07% líneas, 81.76% ramas y 95.35% funciones para dominio/tiempo; `calendar.ts` quedó en 100% en las tres métricas. No es una cifra global de API y UI.
- Aún no hay instrumentación unificada de cobertura de rutas HTTP y vistas ni umbral global; primero conviene cubrir las transiciones comerciales que faltan.
- Cancelación, renovación del enlace y aceptación de precio en navegador; el pago sigue siendo manual.
- Extensión y otras acciones de recepción que cambian una reserva.
- axe solo cubre la entrada pública y el tablero inicial; faltan formularios, modales, solicitudes y más tamaños móviles.
- Smoke autenticado de una URL de vista previa después de elegir proveedor de hosting.
