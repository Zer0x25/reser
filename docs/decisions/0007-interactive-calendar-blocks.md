# ADR 0007: Bloques configurables y calendario operativo interactivo

**Estado:** aceptado para el MVP
**Fecha:** 2026-10-24

## Contexto

El ancho visual en píxeles por hora ajusta la escala y el desplazamiento horizontal del tablero. No establece intervalos de reserva. El intervalo de inicio ya era configurable, pero las reservas iniciales seguían limitadas a horas completas y las extensiones ofrecían solo 15, 30 o 60 minutos. La recepción tampoco podía mover una reserva desde el tablero ni fijar explícitamente sus pistas ante la reorganización automática.

## Decisión

- La administración configura el bloque operativo en minutos. Para el MVP se ofrecen 5, 10, 12, 15, 20, 30 y 60 minutos; el valor inicial es 10.
- El bloque operativo alinea los inicios, las duraciones de reserva y las extensiones. Una reserva nueva dura al menos 60 minutos y después avanza por bloques; a 10 minutos, una hora ocupa seis bloques. Las extensiones van desde un bloque hasta 60 minutos y requieren aceptación del cliente.
- El tablero dibuja separadores de bloque usando la configuración, mientras que los píxeles por hora siguen siendo solo escala visual y zoom.
- Hacer clic en un espacio libre crea una reserva interna con hora precargada. Arrastrar sobre un espacio libre selecciona inicio y duración; la duración inicial mínima sigue siendo una hora. El formulario equivale a la alternativa accesible para teclado.
- Una reserva futura confirmada puede moverse horizontalmente a otra hora o verticalmente a una pista objetivo. El servidor conserva duración y tamaño de grupo, busca una agrupación física que incluya la pista elegida y vuelve a validar horario, cierre, bloqueos y conflictos dentro de una transacción.
- Si el cambio de hora altera el precio, la API entrega el nuevo total sin guardar. Recepción confirma la aceptación del cliente antes de volver a enviar la operación. Cada cambio exitoso queda auditado.
- Un movimiento manual fija la asignación para que la reorganización automática no la cambie. La ficha de reserva permite fijarla o volverla flexible explícitamente; el check-in también la fija y no se puede retirar mientras la reserva está en curso. La reorganización automática continúa cambiando solo pistas, nunca horarios.
- En una reserva con check-in, arrastrar el extremo derecho selecciona la extensión y abre la confirmación con el importe. El endpoint existente valida capacidad, preparación, horario, margen de cierre y aceptación.

## Consecuencias

- La escala visual y la unidad operativa pueden cambiar por separado sin alterar el contrato del motor.
- La manipulación directa del DOM solo propone cambios; el servidor sigue siendo la autoridad del inventario, precio, horario y permiso.
- El movimiento manual requiere un canal de cambio de horario con idempotencia, control de estado esperado, transacción, auditoría y protección frente a cambios tarifarios.
- Los gestos de mouse cuentan con controles de formulario para teclado y con pruebas de navegador para selección, movimiento, extensión y protección automática.

## Referencias

- [Diseño del sistema](../design/system-design.md).
- [Estrategia de pruebas](../testing/strategy.md).
- [ADR 0004: dominio, casos de uso y UX](0004-domain-use-cases-and-ux.md).
