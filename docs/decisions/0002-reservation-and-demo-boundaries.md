# ADR 0002: Compromisos de reserva, pagos y límites de demo

**Estado:** aceptado para el MVP
**Fecha:** 2026-10-24

## Contexto

Una misma capacidad se solicita por web, teléfono y atención presencial. Una reserva puede requerir verificación, aprobación humana, aceptación de precio y registro de pago en momentos distintos. Un único estado o una confirmación optimista podría liberar capacidad demasiado pronto, venderla dos veces o presentar como acreditado un pago que solo fue informado.

Además, el MVP incluye datos de demostración, mientras que la operación productiva necesita credenciales, tarifas, horarios y correo reales. La interfaz debe poder probarse sin convertir valores de ejemplo en condiciones comerciales.

## Decisión

### Ciclo de reserva

- Mantener independientes el estado comercial de la solicitud/reserva, el compromiso de inventario y el estado financiero.
- La búsqueda pública no retiene pistas. En el canal web, comprobar el correo antes de crear un compromiso de capacidad; al verificarse, volver a comprobar disponibilidad y precio y exigir aceptación de las condiciones vigentes.
- Aplicar aprobación de recepción a las solicitudes que superen el umbral configurado. Mientras una solicitud pendiente de aprobación mantenga un compromiso válido, no liberar su capacidad por una caducidad arbitraria.
- Si la aprobación cambia el precio, conservar la capacidad comprometida mientras se espera aceptación expresa. Rechazo, cancelación o liberación deben ser acciones registradas y coherentes con la política aplicable.
- Permitir a recepción crear reservas telefónicas y presenciales según sus requisitos de contacto, sin atribuir verificación a un correo o teléfono que no se haya comprobado. Registrar el operador para acciones manuales y excepciones.
- Las reservas confirmadas conservan sus condiciones aceptadas. La reoptimización ordinaria puede cambiar asignaciones internas flexibles, pero no horario, duración, pistas contratadas ni compromisos visibles sin el flujo de aprobación correspondiente.

### Pagos y decisiones comerciales pendientes

- No ejecutar cobros, transferencias ni devoluciones desde el sistema. Registrar cada pago informado, verificado, corrección o devolución como un movimiento auditable con operador y referencia cuando exista.
- Diferenciar explícitamente pago informado de pago acreditado. No eliminar ni sobrescribir silenciosamente movimientos financieros.
- No inventar penalizaciones, impuestos, tarifas reales, compensaciones, importes de anticipo ni consecuencias de una regla aún no definida. Mantener esos valores configurables o como decisiones pendientes con un comportamiento seguro de revisión manual.
- Las promociones elegibles no se acumulan; elegir el mayor beneficio válido y conservar el desglose comercial aceptado.

### Demo y producción

- Mantener los usuarios, horarios, tarifas y datos de demo identificados como demostrativos. No reutilizar credenciales de demo en producción.
- La producción debe iniciar cerrada: requiere configuración explícita de administración, secreto estable, almacenamiento persistente, URL pública y adaptador de correo real; no debe crear tarifas, horarios ni usuarios demo.
- La verificación productiva de correo solo se completa después de una comprobación auténtica del proveedor. El adaptador local permite probar el flujo, pero no demuestra entrega productiva.
- Evitar filtraciones de datos de otros clientes mediante tokens no predecibles, enlaces revocables y autorización en servidor.

## Consecuencias

- Los flujos tienen más transiciones explícitas y exigen registrar aceptación, aprobaciones y liberaciones, pero permiten explicar quién comprometió cada pista y bajo qué condiciones.
- Los canales manuales requieren políticas de identidad y auditoría distintas de la web; omitir una verificación electrónica no significa que el contacto esté verificado.
- La ausencia de pasarela simplifica el MVP, pero la conciliación y las devoluciones dependen de procedimientos externos.
- Las decisiones comerciales no definidas bloquean la automatización de sus efectos económicos; no deben completarse con valores supuestos.
- La especificación original es el alcance funcional objetivo. El README y el código describen qué partes existen hoy; este ADR no declara por sí mismo que todos los flujos estén implementados.

## Alternativas descartadas

- **Un solo estado para solicitud, inventario y pagos:** mezcla hechos distintos y genera transiciones ambiguas.
- **Expirar automáticamente toda solicitud pendiente:** podría liberar una capacidad que la política asignó a una aprobación humana o a una aceptación de precio pendiente.
- **Exigir cuenta de usuario a todos los clientes:** añade fricción sin ser necesaria para reservas web verificadas ni atención presencial.
- **Tratar un pago informado como acreditado o automatizar una devolución:** atribuye al sistema una validación financiera que no ha realizado.
- **Completar reglas faltantes con porcentajes o tarifas arbitrarias:** crea compromisos comerciales no aprobados.

## Referencias

- [Prompt inicial de implementación y alcance funcional](../product/initial-one-shot-implementation-prompt.md).
- [ADR 0001: stack y límites arquitectónicos](0001-mvp-stack.md).
- [README y limitaciones actuales](../../README.md).
