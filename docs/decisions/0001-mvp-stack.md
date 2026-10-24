# ADR 0001: Stack y límites del MVP

**Estado:** aceptado para el MVP
**Fecha:** 2026-10-24

## Contexto

El repositorio era un starter vacío de Vite+. Se necesita una aplicación web en español, lógica de asignación determinista, persistencia transaccional para doce pistas y una operación local sencilla, sin exigir servicios externos de pago.

## Decisión

- Mantener Vite+ para desarrollo, TypeScript del navegador y compilación.
- Servir la aplicación y la API desde Node.js. Usar `node:sqlite` para evitar un servicio de base de datos y guardar las migraciones SQL en `server/migrations`.
- Mantener reglas puras de inventario, tarifas y planificación en `server/domain.mjs`; la API valida solicitudes y compromete asignaciones dentro de transacciones `BEGIN IMMEDIATE`.
- Usar control optimista de concurrencia complementado por un trigger SQLite que rechaza solapamientos activos por pista.
- Separar estado comercial, inventario y finanzas. Registrar las transiciones sensibles en una bitácora y conservar pagos corregidos como movimientos auditables.
- Usar una interfaz HTTP configurable para correo. Desarrollo imprime mensajes localmente; producción requiere una URL y credencial configuradas. La cola persiste mensajes cifrados con una clave derivada de `TOKEN_SECRET`.
- Implementar alternativas cercanas y alternativas que puntúan bien en escenarios de demanda de una, dos o tres pistas. La reoptimización modifica solo asignaciones futuras flexibles y es localizada y transaccional.

## Consecuencias

- Desarrollo y producción usan la misma lógica de dominio; producción parte sin horarios, precios ni cuentas de demostración.
- SQLite es suficiente para una sede y un proceso API. Los reintentos de correo actuales dependen de ese proceso; varios trabajadores requieren un mecanismo de reclamación distribuida.
- El optimizador hace una búsqueda determinista acotada, pero no garantiza un óptimo global.
- Mantener `TOKEN_SECRET` estable es necesario para validar sesiones y enlaces, y descifrar mensajes de correo pendientes.
- Los valores comerciales no especificados se mantienen sin penalización ni cobro automático. Las tarifas y horarios de demo sirven solo para explorar el flujo.

## Alternativas descartadas

- PostgreSQL u otro servicio administrado: agrega operación e infraestructura innecesarias para un MVP de una sede.
- Pasarela de pago: fuera del alcance; los pagos y devoluciones son registros manuales de operaciones externas.
- Asignar la primera pista libre: no refleja las parejas físicas ni la capacidad comercializable futura.
- Optimización global exacta: no es necesaria para demostrar la política de asignación y tiene un costo computacional alto; queda como evolución futura.
