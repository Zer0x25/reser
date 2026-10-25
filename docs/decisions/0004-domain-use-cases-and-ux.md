# ADR 0004: Límites de dominio, casos de uso y UX

**Estado:** aceptado para la evolución del MVP  
**Fecha:** 2026-10-24

## Contexto

El producto necesita que disponibilidad, asignación, precio y autorizaciones sigan siendo comprobables sin navegador y que el servidor vuelva a validar cualquier operación que comprometa inventario. El dominio y los cálculos de calendario ya tienen módulos puros y pruebas específicas. A la vez, `server/index.mjs` reúne rutas, coordinación de flujos y transacciones; `src/main.ts` reúne renderizado, estado de pantalla, formularios, eventos y llamadas HTTP.

Una reescritura total aumentaría el riesgo de cambiar comportamiento comercial y transaccional sin aportar valor inmediato. La separación debe avanzar por flujos con evidencia de pruebas.

## Decisión

- Mantener un **monolito modular**: interfaz web, adaptadores HTTP, casos de uso del servidor, dominio, persistencia y adaptadores de integración tienen responsabilidades distintas aunque hoy compartan pocos archivos.
- Mantener reglas de capacidad, asignación, horario, precio y transiciones autorizadas en el servidor y dominio. El navegador puede ofrecer validación y precarga para UX, pero no es autoridad comercial ni compromete inventario.
- Mantener el dominio libre de DOM, HTTP, acceso a SQLite y dependencias de la UI. Probarlo con funciones deterministas.
- Extraer comportamiento visual determinista a módulos puros, como `src/calendar.ts`; mantener allí solo reglas de navegación/escala, nunca duplicados de horario o inventario comercial.
- Tratar `server/index.mjs` como adaptador HTTP actual. Al extraer cada flujo, dejar el adaptador con parseo y validación de entrada, invocación de caso de uso y serialización de respuesta. El caso de uso conserva autorización, transacción, auditoría y coordinación necesarias para la operación.
- Dividir `src/main.ts` gradualmente por flujo de pantalla cuando reduzca acoplamiento y el flujo ya tenga pruebas E2E útiles. Las vistas no importan el dominio de servidor; llaman a contratos API y presentan su resultado.
- Hacer cada extracción vertical: conservar códigos HTTP, payloads, estados y límites de transacción; añadir o mantener pruebas de unidad, integración o E2E según la frontera afectada.

## Secuencia de refactor

1. Continuar completando pruebas de dominio/API y flujos E2E antes de mover módulos existentes.
2. Extraer casos de uso de una ruta o grupo de rutas cuando exista una frontera estable y la lógica no dependa del transporte HTTP.
3. Extraer vistas públicas, seguimiento, tablero y administración de `main.ts` cuando puedan recibir estado y comandos explícitos sin trasladar reglas comerciales.
4. Repetir formato, tipos, unidad, integración, E2E y smoke compilado al finalizar cada extracción.

La secuencia es incremental. No se impone crear carpetas/capas vacías, cambiar framework ni reescribir módulos que no tengan un límite funcional claro.

## Consecuencias

- Se conserva una única autoridad para compromisos de inventario y reglas comerciales, compartida por los canales web y de recepción.
- La UX puede mejorar o reorganizarse sin que las reglas del negocio dependan de componentes de pantalla.
- El refactor conserva el riesgo bajo y se puede revisar por caso de uso; `main.ts` e `index.mjs` aún no están completamente separados.
- En futuras extracciones hay que vigilar que la transacción no quede repartida entre rutas, casos de uso y repositorios.
- Las pruebas E2E detectan regresiones del recorrido, pero no sustituyen las pruebas de dominio de estados y reglas límite.

## Alternativas consideradas

- **Reescribir toda la UI y API ahora:** descartada por el riesgo de romper flujos que ya funcionan y por carecer de una necesidad que justifique una migración amplia.
- **Dejar reglas comerciales en la interfaz:** descartada porque la UI no controla concurrencia y no puede ser autoridad de precios, roles ni disponibilidad.
- **Extraer carpetas de casos de uso sin mover responsabilidad real:** descartada porque crearía estructura vacía y dificultaría entender las transacciones.
- **Usar el mismo runtime de dominio en navegador y servidor:** no es requisito del MVP; las decisiones que comprometen inventario permanecen en servidor. La lógica pura del calendario se comparte donde corresponda.

## Referencias

- [Diseño del sistema](../design/system-design.md).
- [Estrategia de pruebas](../testing/strategy.md).
- [ADR 0001: stack y límites arquitectónicos](0001-mvp-stack.md).
- [ADR 0003: pruebas por capa](0003-testing-strategy.md).
- [Especificación funcional original](../product/initial-one-shot-implementation-prompt.md).
