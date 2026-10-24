# Estrategia de pruebas

**Estado:** vigente para el MVP · **Fecha:** 2026-10-24 · **Decisión relacionada:** [ADR 0003 — estrategia de pruebas](../decisions/0003-testing-strategy.md)

## Objetivo y niveles

Probar reglas comerciales y concurrencia cerca de su implementación, y reservar el navegador para recorridos que dependen de interacción real. Cada prueba usa datos desechables; ninguna se conecta a clientes, correo productivo, pasarelas ni bases remotas.

| Nivel                                | Qué valida                                                                                                                                                          | Herramienta y alcance                                                                                                                 | Comando                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| L0 · calidad estática y build        | Formato, lint, tipos y compilación.                                                                                                                                 | Vite+ en todo el workspace.                                                                                                           | `pnpm exec vp check` · `pnpm exec vp run website#build`     |
| L1 · unidad                          | Capacidad, agrupación, preparación, horarios, tarifas, promociones, alternativas, DST y funciones puras de navegación/escala del calendario.                        | `node:test` para dominio/tiempo; Vite+ Test para `src/calendar.ts`.                                                                   | `pnpm exec vp run test:unit`                                |
| L2 · integración/API                 | Contratos HTTP observables, roles, persistencia, idempotencia, concurrencia, verificación de correo local, pagos manuales, bloqueos y reoptimización transaccional. | `node:test`, servidor Node real y SQLite temporal.                                                                                    | `pnpm exec vp run test:integration`                         |
| L3 · E2E                             | Flujos de cliente y recepción que cruzan UI y API: solicitud, aprobación, cambio de precio, renovación/cancelación, reserva presencial, check-in y extensión.       | Playwright con Chromium, Vite/API reales, correo local y SQLite temporal. Incluye una tarea móvil de búsqueda y selección de horario. | `pnpm exec vp run e2e`                                      |
| L4 · smoke                           | Recorridos esenciales: entrada pública, calendario de recepción y uso móvil del calendario.                                                                         | Tres pruebas Playwright etiquetadas `@smoke`, primero contra dev y después contra la aplicación compilada servida por Node.           | `pnpm exec vp run smoke` · `pnpm exec vp run smoke:preview` |
| Transversal · accesibilidad y reflow | Axe WCAG 2.0/2.1/2.2 A/AA en siete estados; reflow de recepción en 320–428, 768 y 1024 px y legibilidad del flujo público en 320 px.                                | Playwright + axe-core; el calendario conserva su propio desplazamiento horizontal.                                                    | Incluido en `e2e` y `regression`                            |

### Pipeline de regresión

`pnpm exec vp run regression` ejecuta, en este orden:

1. `ready`: `vp check`, pruebas de unidad e integración del workspace y build.
2. `e2e`: las diez pruebas de navegador completas.
3. `smoke:preview`: vuelve a compilar el sitio y ejecuta las tres pruebas smoke contra los archivos compilados servidos por el proceso Node local en el puerto 3001.

El workflow de GitHub corre `regression` en cada push y pull request e instala Chromium. El smoke de vista previa valida el artefacto compilado en un entorno local aislado; no es una prueba contra un hosting ni un despliegue real, que aún no está configurado. `smoke` sigue disponible para una verificación corta sobre Vite en desarrollo.

## Cobertura funcional actual

- **Dominio y hora:** capacidad, parejas físicas, agrupación, buffers de preparación, excepciones, horarios nocturnos, DST y cálculo determinista de alternativas. Las pruebas comparan los criterios de primera opción, cercanía y compactación básica; esto no demuestra optimalidad global del optimizador.
- **Escenarios sintéticos del motor:** una jornada con compromisos y mantenimiento valida siete tamaños representativos, agrupación física y ausencia de conflictos; casos de 5/10 minutos verifican la siguiente hora posible. Un día con ocupación predefinida compara el vector de capacidad preservada del motor con primero libre, hora más cercana y compactación sencilla.
- **Simulación de jornada completa:** `pnpm exec vp run simulate:engine` reproduce una cola de doce solicitudes contra inventario y bloqueos fijos, y compara cuatro políticas. Reporta aceptación, rechazos, horas-pista, ingreso ilustrativo, desvío medio y capacidad residual por perfil. Las pruebas fijan los resultados de esta fixture y comprueban que todas las asignaciones sean factibles.
- **API e inventario:** autenticación/roles, SQLite, escrituras repetidas, solicitudes que compiten por la última capacidad, seguimiento y operaciones manuales.
- **Reoptimización por API:** dos asignaciones flexibles se reorganizan; una reserva fijada conserva su pista; la decisión queda auditada. Un bloqueo que hace imposible la reorganización fuerza un `409` y la prueba confirma que las asignaciones previas se restauran y no quedan eventos parciales de auditoría.
- **Cliente web:** verificación local de correo, solicitud de tres o más pistas, aprobación humana, recotización y aceptación del nuevo importe, renovación de enlace vencido y cancelación elegible.
- **Usabilidad automatizada:** a 320 px el flujo público conserva texto legible y no desborda el viewport; elegir un horario lleva el foco al formulario, y enviar una solicitud muestra el resultado sin conservar opciones antiguas. Esto valida interacción observable, no determina si personas reales consideran la experiencia intuitiva.
- **Recepción:** alta presencial, check-in y extensión autorizada de una reserva ocupada, verificando el nuevo término.
- **Accesibilidad:** axe revisa búsqueda pública, formulario de solicitud, tablero, bandeja, ficha modal, renovación y extensión. Los tests de axe se ejecutan con tags WCAG 2.0/2.1/2.2 A/AA.
- **Reflow:** el documento no puede exceder el viewport de 320, 360, 375, 390, 414, 428, 768 ni 1024 px. El eje de horas del calendario puede desplazarse dentro de su contenedor horizontal propio.

### Próxima ronda de evaluación con personas

Las pruebas automáticas detectan fallos repetibles, pero no miden comprensión ni confianza. Antes de cerrar la UX, hacer una ronda formativa moderada con datos sintéticos: 4–5 personas que reserven desde móvil y 2–3 personas de recepción. Pedir que piensen en voz alta, sin explicar la interfaz ni guiarlas.

1. Cliente: buscar para un grupo pequeño, comparar horarios/precios, elegir una alternativa y explicar qué ocurrirá después de enviar.
2. Cliente: buscar para un grupo grande, interpretar pistas juntas/separadas y reconocer cuándo recepción debe aprobar.
3. Cliente: recuperar un enlace de seguimiento vencido y encontrar el estado/precio de la reserva.
4. Recepción: encontrar un espacio libre en el calendario móvil, crear una reserva y confirmar qué pistas quedaron ocupadas.

Registrar éxito de tarea, tiempo, errores o retrocesos, pedidos de ayuda y confianza declarada (escala 1–5). Al terminar, aplicar SUS si se busca una medida comparable entre rondas. Agrupar las fricciones por severidad, corregir las que bloquean o inducen decisiones equivocadas y repetir los escenarios afectados. Esta ronda todavía no se ha realizado; requiere participantes humanos y dispositivos reales.

Los datos de Playwright son efímeros. Un test restaura las horas de demo después de una extensión; el test que cambia la tarifa la restaura incluso si falla. Cada test usa un proceso de Playwright y una ruta SQLite temporal independiente del archivo local `data/demo.sqlite`. La integración de reoptimización usa SQLite temporal y una fixture directa para representar una asignación ya fijada y un bloqueo operativo tardío.

### Lectura del benchmark sintético

En la jornada de referencia, la política del motor acepta 6 de 12 solicitudes, vende 48 horas-pista y suma CLP 576.000 ilustrativos; la política más cercana acepta 7, vende 43 horas-pista y suma CLP 516.000, con menor desvío de la hora pedida. La política de compactación simple acepta 6 y promedia 82 minutos de desvío. Este caso muestra un intercambio entre volumen vendido y cercanía; no demuestra que una política sea mejor con demanda real.

La tarifa fija de CLP 12.000 por pista-hora y todos los nombres son sintéticos. La política de motor simula que el cliente toma la alternativa con mejor puntuación de preservación; en producción se muestran opciones y el cliente elige, por lo que `Con horario simulado` no equivale a conversión ni reserva real. Los baselines cambian la selección temporal, pero usan las agrupaciones factibles que entrega el motor.

La capacidad residual se estima con sesiones consecutivas de inicio más temprano para cuatro perfiles, cada uno sobre una copia independiente del horario. Esos valores no se suman: representan pruebas alternativas de demanda y sus sesiones pueden competir entre sí.

## Datos, correo y reportes

- El correo E2E se captura en `127.0.0.1:3002`; el servicio solo vive durante la ejecución.
- La base de cada proceso de prueba se crea en el directorio temporal y se elimina en el teardown.
- Los nombres y emails son sintéticos y usan `example.test` o `demo.local`.
- Playwright conserva traza y captura solo ante un fallo; CI no publica ni despliega la aplicación.
- Cobertura dirigida disponible: `pnpm exec vp run coverage:domain` mide dominio/tiempo y `pnpm exec vp run coverage:calendar` mide `calendar.ts`. La última medición, después de sumar escenarios de demanda, fue 88.07% líneas, 83.04% ramas y 95.35% funciones; `calendar.ts` obtuvo 100% en las tres métricas. Volver a ejecutar los comandos para actualizar los valores.
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
