# ADR 0001: Stack y límites arquitectónicos del MVP

**Estado:** aceptado para el MVP
**Fecha:** 2026-10-24

## Contexto

El repositorio partía de un starter vacío de Vite+. El producto necesita una interfaz web en español, reglas de disponibilidad y asignación verificables, persistencia transaccional para las doce pistas y una operación local sencilla. El MVP debe poder ejecutarse en una sede sin exigir una base de datos administrada ni servicios externos de pago.

## Decisión

### Aplicación y límites de módulos

- Mantener Vite+ para la interfaz TypeScript, el servidor de desarrollo y la compilación.
- Servir la API con Node.js y reutilizar el mismo proceso para entregar la interfaz compilada en producción.
- Mantener las reglas de dominio en `apps/website/server/domain.mjs`, la persistencia y configuración en `apps/website/server/db.mjs`, la API y sus flujos HTTP en `apps/website/server/index.mjs`, las migraciones SQL en `apps/website/server/migrations/` y la interfaz en `apps/website/src/main.ts`.
- Mantener disponibilidad, planificación y precios independientes de la presentación para que puedan verificarse sin ejecutar la interfaz.
- En desarrollo, conservar el encabezado `Host` en el proxy `/api` de Vite (`changeOrigin: false`). La API compara el `Origin` del navegador con ese origen para proteger las operaciones de escritura.

### Persistencia y consistencia

- Usar `node:sqlite` y migraciones SQL en lugar de añadir un servicio de base de datos para una sede y un proceso API.
- Ejecutar compromisos de inventario en transacciones `BEGIN IMMEDIATE`; mantener control de concurrencia en el servidor y restricciones SQLite que rechacen solapamientos activos incompatibles por pista.
- Hacer idempotentes las operaciones que puedan reintentarse para que una solicitud duplicada no cree reservas adicionales.
- Separar estado comercial, compromiso de inventario y estado financiero. Registrar cambios sensibles y su responsable en una bitácora auditable.
- Tratar SQLite como una solución de un proceso. La cola de correo actual depende del proceso API; antes de escalar a varios procesos se requiere coordinación distribuida para reclamar trabajos.

### Planificación y contexto local

- Usar reglas deterministas de inventario, agrupación y planificación que consideren la capacidad comercializable futura, las parejas físicas, horarios, preparación, bloqueos y compromisos existentes.
- Permitir alternativas cercanas y alternativas de mayor eficiencia, pero dejar que el cliente elija y acepte el horario ofrecido.
- Limitar la reoptimización del MVP a asignaciones futuras flexibles, con alcance localizado y cambios atómicos. No prometer que la búsqueda acotada encuentra un óptimo global.
- Interpretar horarios en la zona `America/Santiago` y expresar importes en CLP. El cálculo de precio debe ser centralizado y reproducible.

### Integraciones y límites comerciales

- Usar una interfaz configurable para entrega de correo. El adaptador de desarrollo muestra los mensajes localmente; producción requiere un proveedor real configurado.
- Cifrar los mensajes de correo pendientes con una clave derivada de `TOKEN_SECRET`, que debe mantenerse estable para validar sesiones y enlaces y descifrar la cola.
- No integrar una pasarela de pago en el MVP. Pagos y devoluciones son operaciones externas registradas manualmente.
- Mantener separados los datos de demo y producción. La producción comienza sin horarios, tarifas ni cuentas de demostración; los datos de demo no son precios ni condiciones comerciales aprobadas.

## Consecuencias

- El mismo dominio sirve a los canales web y de recepción, y la base única evita inventarios divergentes entre ellos.
- SQLite reduce el costo operativo inicial, pero limita la arquitectura a una sede y un proceso API hasta introducir coordinación adicional.
- El optimizador es reproducible y acotado; no garantiza el óptimo global. Sus métricas y limitaciones deben explicarse sin exagerar resultados.
- Configurar una clave distinta para cada reinicio invalidaría sesiones y enlaces existentes y podría impedir descifrar correos pendientes.
- Los importes, horarios y políticas de demo solo permiten explorar el flujo. No deben usarse para cobrar ni para inferir decisiones comerciales reales.

## Alternativas descartadas

- **PostgreSQL u otro servicio administrado:** agrega infraestructura y operación que no son necesarias para el MVP de una sede.
- **Pasarela de pago:** no está autorizada por el alcance; el sistema registra pagos externos, pero no mueve dinero.
- **Asignar siempre la primera pista libre:** ignora las parejas físicas y puede dejar capacidad futura inutilizable.
- **Optimización global exacta:** tiene un costo computacional innecesario para el MVP; la arquitectura mantiene el dominio separado para permitir una evolución posterior.

## Referencias

- [Prompt inicial de implementación y alcance funcional](../product/initial-one-shot-implementation-prompt.md).
- [ADR 0004: límites de dominio, casos de uso y UX](0004-domain-use-cases-and-ux.md).
- [README y estado conocido del MVP](../../README.md).
