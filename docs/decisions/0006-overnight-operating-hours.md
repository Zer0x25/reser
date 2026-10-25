# ADR 0006: Jornada operativa y cierres nocturnos

**Estado:** aceptado para el MVP  
**Fecha:** 2026-10-24

## Contexto

El horario semanal define una hora de apertura y una de cierre por día. Varios locales cierran después de medianoche. En ese caso, la jornada que empezó un día se extiende al día civil siguiente, aunque ese siguiente día no tenga apertura propia.

La administración también necesitaba distinguir de forma visible un día cerrado, en vez de pedir al operador que vaciara dos campos horarios.

## Decisión

- Cada regla pertenece al día en que abre el local. Una hora de cierre igual o anterior a la apertura significa que el cierre ocurre al día siguiente. Por ejemplo, viernes `15:00–01:00` permite operar hasta el sábado a la `01:00`.
- Una reserva que empieza después de medianoche dentro de esa franja se autoriza con la regla del día de apertura anterior, aunque el día civil de inicio esté marcado cerrado. La fecha visible de la reserva sigue siendo su fecha civil local real.
- Al buscar disponibilidad para una fecha civil, el motor considera tanto la regla de ese día como el tramo nocturno que pueda continuar desde el día anterior. El horario y las excepciones se resuelven en `America/Santiago`.
- La casilla **Cerrado** guarda `{ closed: true }` para ese día y deshabilita sus horas. Si está abierto, ambas horas son obligatorias. Los horarios iguales siguen representando una jornada de 24 horas.
- El margen de cierre se aplica al término de la reserva. Con cierre `01:00` y margen `30`, la reserva debe terminar a más tardar a las `00:30`; para una sesión de una hora que empiece a las `00:00`, el margen debe ser `0`.
- El tablero de recepción conserva la escala de la jornada elegida: el horario de viernes `15:00–01:00` se gestiona desde el viernes y el eje marca las horas posteriores a medianoche como día siguiente.

## Consecuencias

- Una jornada nocturna no se corta al cambiar la fecha civil ni depende de que el día siguiente también abra.
- Las reservas y precios siguen ligados a la fecha civil real de inicio; solo la autorización horaria busca la jornada anterior cuando el inicio cae dentro de su tramo nocturno.
- Los horarios quedan explícitos y validados en la interfaz y API; una jornada abierta sin horas completas no se guarda.
- Se requieren pruebas unitarias del dominio, integración de disponibilidad HTTP y E2E de guardar cierres y horarios nocturnos.

## Referencias

- [Diseño del sistema](../design/system-design.md).
- [ADR 0004: dominio, casos de uso y UX](0004-domain-use-cases-and-ux.md).
- [Estrategia de pruebas](../testing/strategy.md).
