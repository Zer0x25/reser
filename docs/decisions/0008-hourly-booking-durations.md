# ADR 0008: Duraciones comerciales de reservas y extensiones

**Estado:** aceptado para el MVP
**Fecha:** 2026-10-24

## Contexto

La especificación funcional inicial comercializa las reservas en horas completas y deja las extensiones sujetas a duraciones adicionales configurables. ADR 0007 había alineado también la duración de una reserva nueva con el bloque operativo de inicio, por lo que la búsqueda pública y recepción ofrecían duraciones como 70 o 90 minutos cuando la cuadrícula era de 10 minutos.

La duración de una reserva inicial es una condición comercial distinta de la granularidad para elegir su hora de inicio. Una extensión ocurre durante la operación y puede usar tramos más cortos si hay disponibilidad y el cliente los acepta.

## Decisión

- Las reservas iniciales nuevas, por web y por recepción, se solicitan en horas completas: 60, 120, 180 minutos o más.
- La hora de inicio sigue alineada al bloque operativo configurable. Ese bloque no cambia la duración comercial de la reserva.
- La interfaz pública y el formulario manual ofrecen duraciones en incrementos de una hora. Al arrastrar un espacio libre en recepción, la duración se ajusta a la hora completa más cercana, con mínimo de una hora.
- La API y el dominio rechazan solicitudes y búsquedas iniciales que no sean múltiplos de 60 minutos; la validación no depende del navegador.
- Las extensiones conservan los tramos configurados por el bloque operativo, requieren disponibilidad hasta el nuevo término y aceptación del cliente. No se cambia unilateralmente una reserva existente.
- Reprogramar una reserva existente conserva su duración aceptada, incluso si fue creada bajo la regla anterior de ADR 0007.

## Consecuencias

- La búsqueda no muestra opciones iniciales de 10, 15 o 30 minutos cuando esos son los bloques de inicio.
- Las horas de inicio pueden seguir comenzando, por ejemplo, a las 17:10; la sesión reservada dura una o más horas completas.
- La recepción puede autorizar una extensión más corta que una hora solo si el tramo está configurado, disponible y aceptado.
- ADR 0007 sigue vigente para la configuración y visualización del calendario, el movimiento de reservas y la operación de extensiones; esta decisión reemplaza únicamente su regla de duración inicial.

## Alternativas descartadas

- **Usar el bloque operativo también para la duración inicial:** mezcla la precisión de agenda con una condición comercial que debe ser horaria.
- **Permitir duraciones parciales desde el selector público:** presenta como producto una condición distinta de la especificación acordada.
- **Cambiar la duración de reservas existentes:** alteraría unilateralmente condiciones ya aceptadas.

## Referencias

- [Especificación funcional original](../product/initial-one-shot-implementation-prompt.md).
- [ADR 0002: compromisos de reserva, pagos y límites de demo](0002-reservation-and-demo-boundaries.md).
- [ADR 0007: bloques configurables y calendario operativo interactivo](0007-interactive-calendar-blocks.md).
