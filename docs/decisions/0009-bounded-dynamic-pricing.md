# ADR 0009: Precio dinámico acotado para horarios con riesgo de quedar vacíos

**Estado:** aceptado para implementación; activación en producción bloqueada hasta configurar variables comerciales
**Fecha:** 2026-10-25

## Contexto

El MVP mantiene una tarifa de lista por pista/hora y promociones existentes. La especificación original excluía precios dinámicos autónomos. El negocio necesita, sin embargo, vender capacidad que probablemente quedaría vacía en pistas de 6 jugadores, sin canibalizar la demanda dispuesta a pagar la tarifa completa ni bajar precios unilateralmente.

Un descuento dinámico acotado es distinto de "surge pricing" o de promociones acumulables: solo desciende el precio, solo se aplica a horarios con riesgo real de orphanidad y exige aceptación explícita del cliente.

## Decisión

- Se añade `settings.dynamicPricing` como única fuente de verdad comercial para el precio dinámico, con estados `off`, `shadow`, `pilot` y `active`. El valor inicial seguro es `off`, sin niveles de riesgo ni protecciones inventadas.
- La tarifa de lista sigue siendo el precio base. El precio dinámico solo puede ser menor o igual; nunca mayor.
- El descuento dinámico no se acumula con promociones: se aplica el mayor beneficio válido. El piso, el porcentaje máximo, el tope absoluto y el presupuesto diario son límites obligatorios.
- La elegibilidad usa una función explicable (`evaluateOrphanRisk`) basada en ocupación, anticipación, huecos de capacidad, valor futuro y protecciones configuradas. No usa datos personales ni personalización por cliente.
- Cada cotización dinámica se bloquea por un tiempo configurable mediante token HMAC firmado. El token vincula fecha, duración, jugadores, pistas, precio, versión de configuración, señales, emisión y vencimiento. Si expira o la pista se ocupa, se exigen alternativas y nueva aceptación.
- Las solicitudes y reservas manuales sin token conservan el comportamiento anterior para no romper recepción ni clientes existentes.
- El modo sombra calcula y registra el descuento potencial sin mostrarlo. El modo piloto restringe la aplicación a días o franjas configuradas. El modo activo aplica en horarios habilitados, salvo protecciones.
- Toda reserva confirmada conserva su `quote_json` y cada decisión de precio se registra en `pricing_decisions` con snapshot de configuración. No se recalculan reservas confirmadas ni cotizaciones históricas.
- El inventario se compromete transaccionalmente e idempotentemente. El token no reserva pistas: solo bloquea el precio.
- Las variables comerciales —piso, descuento máximo, ventana, umbrales, niveles, protecciones, presupuesto, canales, vigencia y alcance del piloto— se editan desde Administración con validación, auditoría y versionado.

## Consecuencias

- El sistema puede mostrar alternativas más baratas para llenar huecos sin cambiar unilateralmente una reserva confirmada.
- La activación exige que el establecimiento defina piso, niveles, presupuesto, protecciones y canales. Con configuración vacía no se aplica ningún descuento.
- Las cotizaciones dinámicas incluyen señales y motivo, lo que facilita auditoría y calibración en sombra.
- El panel de Administración y las pruebas unitarias/API deben cubrir la regla, los límites y el token.
- ADR 0002 sigue vigente: no hay pagos reales, no hay cambios retroactivos y no se inventan valores comerciales.

## Alternativas descartadas

- **Surge pricing bidireccional:** subir precios prime además de descontar huérfanos. Rechazado por riesgo comercial, percepción de oportunismo y complejidad de explicación.
- **Descuento automático a toda solicitud:** canibalizaría la tarifa base y destruiría margen.
- **Acumular promoción y descuento dinámico:** permitiría precios por debajo del piso y descuentos compuestos no controlados.
- **Recalcular reservas confirmadas:** cambiaría unilateralmente precio y condiciones ya aceptados.
- **Primera pista libre:** ignora agrupación física y preservación de capacidad futura.

## Referencias

- [Especificación funcional original](../product/initial-one-shot-implementation-prompt.md), especialmente sección 9.
- [Plan de precio dinámico](../product/dynamic-pricing-plan.md).
- [ADR 0002: compromisos de reserva, pagos y límites de demo](0002-reservation-and-demo-boundaries.md).
- [ADR 0004: casos de uso de dominio y experiencia](0004-domain-use-cases-and-ux.md).
- [ADR 0008: duraciones comerciales de reservas y extensiones](0008-hourly-booking-durations.md).
  EOF
