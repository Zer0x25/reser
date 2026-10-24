# Estrategia de pruebas

**Estado:** vigente para el MVP · **Fecha:** 2026-10-24 · **Decisión relacionada:** [ADR 0003 — estrategia de pruebas](../decisions/0003-testing-strategy.md)

## Objetivo y niveles

Probar reglas comerciales y concurrencia cerca de su implementación, y reservar el navegador para recorridos que dependen de interacción real. Cada prueba usa datos desechables; ninguna se conecta a clientes, correo productivo, pasarelas ni bases remotas.

| Nivel                                | Qué valida                                                                                                                                                    | Herramienta y alcance                                                                                                       | Comando                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| L0 · calidad estática y build        | Formato, lint, tipos y compilación.                                                                                                                           | Vite+ en todo el workspace.                                                                                                 | `pnpm exec vp check` · `pnpm exec vp run website#build`     |
| L1 · unidad                          | Capacidad, agrupación, preparación, horarios, tarifas, promociones, alternativas, DST y funciones puras de navegación/escala del calendario.                  | `node:test` para dominio/tiempo; Vite+ Test para `src/calendar.ts`.                                                         | `pnpm exec vp run test:unit`                                |
| L2 · integración/API                 | Contratos HTTP observables, roles, persistencia, idempotencia, concurrencia, verificación de correo local, pagos manuales y bloqueos.                         | `node:test`, servidor Node real y SQLite temporal.                                                                          | `pnpm exec vp run test:integration`                         |
| L3 · E2E                             | Flujos de cliente y recepción que cruzan UI y API: solicitud, aprobación, cambio de precio, renovación/cancelación, reserva presencial, check-in y extensión. | Playwright con Chromium, Vite/API reales, correo local y SQLite temporal.                                                   | `pnpm exec vp run e2e`                                      |
| L4 · smoke                           | Recorridos esenciales: entrada pública, calendario de recepción y uso móvil del calendario.                                                                   | Tres pruebas Playwright etiquetadas `@smoke`, primero contra dev y después contra la aplicación compilada servida por Node. | `pnpm exec vp run smoke` · `pnpm exec vp run smoke:preview` |
| Transversal · accesibilidad y reflow | Axe WCAG 2.0/2.1/2.2 A/AA en siete estados; reflow de recepción en 320–428, 768 y 1024 px.                                                                    | Playwright + axe-core; el calendario conserva su propio desplazamiento horizontal.                                          | Incluido en `e2e` y `regression`                            |

### Pipeline de regresión

`pnpm exec vp run regression` ejecuta, en este orden:

1. `ready`: `vp check`, pruebas de unidad e integración del workspace y build.
2. `e2e`: las nueve pruebas de navegador completas.
3. `smoke:preview`: vuelve a compilar el sitio y ejecuta las tres pruebas smoke contra los archivos compilados servidos por el proceso Node local en el puerto 3001.

El workflow de GitHub corre `regression` en cada push y pull request e instala Chromium. El smoke de vista previa valida el artefacto compilado en un entorno local aislado; no es una prueba contra un hosting ni un despliegue real, que aún no está configurado. `smoke` sigue disponible para una verificación corta sobre Vite en desarrollo.

## Cobertura funcional actual

- **Dominio y hora:** capacidad, parejas físicas, agrupación, buffers de preparación, excepciones, horarios nocturnos, DST y cálculo determinista de alternativas. Las pruebas comparan los criterios de primera opción, cercanía y compactación básica; esto no demuestra optimalidad global del optimizador.
- **API e inventario:** autenticación/roles, SQLite, escrituras repetidas, solicitudes que compiten por la última capacidad, seguimiento y operaciones manuales.
- **Cliente web:** verificación local de correo, solicitud de tres o más pistas, aprobación humana, recotización y aceptación del nuevo importe, renovación de enlace vencido y cancelación elegible.
- **Recepción:** alta presencial, check-in y extensión autorizada de una reserva ocupada, verificando el nuevo término.
- **Accesibilidad:** axe revisa búsqueda pública, formulario de solicitud, tablero, bandeja, ficha modal, renovación y extensión. Los tests de axe se ejecutan con tags WCAG 2.0/2.1/2.2 A/AA.
- **Reflow:** el documento no puede exceder el viewport de 320, 360, 375, 390, 414, 428, 768 ni 1024 px. El eje de horas del calendario puede desplazarse dentro de su contenedor horizontal propio.

Los datos de Playwright son efímeros. Un test restaura las horas de demo después de una extensión; el test que cambia la tarifa la restaura incluso si falla. Cada test usa un proceso de Playwright y una ruta SQLite temporal independiente del archivo local `data/demo.sqlite`.

## Datos, correo y reportes

- El correo E2E se captura en `127.0.0.1:3002`; el servicio solo vive durante la ejecución.
- La base de cada proceso de prueba se crea en el directorio temporal y se elimina en el teardown.
- Los nombres y emails son sintéticos y usan `example.test` o `demo.local`.
- Playwright conserva traza y captura solo ante un fallo; CI no publica ni despliega la aplicación.
- Cobertura dirigida disponible: `pnpm exec vp run coverage:domain` mide dominio/tiempo y `pnpm exec vp run coverage:calendar` mide `calendar.ts`. La última medición registrada para dominio/tiempo fue 88.07% líneas, 81.76% ramas y 95.35% funciones; `calendar.ts` obtuvo 100% en las tres métricas. Volver a ejecutar los comandos para actualizar los valores.
- No hay instrumentación unificada de cobertura HTTP y vistas, ni umbral global. Se priorizan ramas comerciales y de autorización para evitar que un porcentaje global premie pruebas superficiales.

## Lógica de dominio, UX y arquitectura de pruebas

El dominio se prueba sin navegador y no debe importar UI, DOM, HTTP ni persistencia. La API valida de nuevo toda operación que compromete inventario dentro de la transacción; las validaciones del cliente solo guían la interacción. La lógica visual determinista (por ejemplo, rangos y zoom) vive en módulos puros comprobables, como `src/calendar.ts`. La UX de `src/main.ts` se prueba por recorrido en Playwright, sin replicar allí reglas de reserva, precio o capacidad.

Para el mapa de componentes, fronteras, secuencias de reserva y plan de refactor incremental, ver [Diseño del sistema](../design/system-design.md). La API sigue siendo un monolito modular de un proceso; extraer casos de uso desde `server/index.mjs` o dividir vistas de `main.ts` se hará por flujo con pruebas de regresión antes de mover límites transaccionales.

## Pendientes reales

La estrategia por capas y el pipeline local están implementados. La cobertura funcional no equivale a completar todos los requisitos del producto. Aún requieren nuevos casos de prueba —y en varios casos la función misma sigue pendiente—:

- Modificaciones sensibles de reservas, límites/duplicados de canales manuales, excepciones de recepción y alertas de abuso.
- Políticas de anticipo, ausencia, penalización tardía y demás reglas comerciales aún no definidas; ninguna debe inventarse para la suite.
- Incidencia y falla de pista con reubicación supervisada, reservas parciales y conflictos detallados de extensión.
- Auditoría de autorización más amplia y escenarios completos de permisos por rol.
- Pruebas manuales con lector de pantalla y verificación visual en navegadores/dispositivos reales; axe no las reemplaza.
- Smoke de una URL desplegada cuando se defina hosting y un entorno de preview con fixtures seguras.
- Contratos versionados/OpenAPI si aparecen consumidores externos de la API; hoy las pruebas de integración fijan sus respuestas y códigos HTTP relevantes.

## Reglas de evolución

- Todo bug corregido incluye un caso que falla antes del fix.
- Cambios del planificador o pagos prueban transiciones y resultados de dominio, además del estado HTTP.
- Cambios de interacción que cruzan API incluyen E2E del flujo crítico; los cálculos deterministas permanecen en L1.
- Añadir pruebas a nivel donde detectan el fallo con menor costo; no convertir cada combinación en E2E.
- No probar únicamente el estado `200`: verificar inventario, autorización, estados comercial/financiero y auditabilidad pertinentes.
- No fijar un umbral global de cobertura hasta instrumentar y revisar una línea base por módulo.
