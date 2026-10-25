# Plan: precio dinámico acotado para optimizar el uso de pistas

**Estado:** implementado en el MVP; la función queda desactivada por defecto y su activación requiere configuración comercial explícita.  
**Fecha:** 2026-10-25  
**Ámbito:** MVP de una sede, 12 pistas, SQLite y un proceso API

## 1. Resumen ejecutivo

La idea es mantener una **tarifa de lista real** —por ejemplo, 25.000 CLP por pista/hora— y añadir una capa de **descuento dinámico acotado** para horarios con alto riesgo de quedar vacíos. No se trata de subir y bajar precios libremente ni de descontar todas las reservas: se trata de vender capacidad que, de otro modo, se perdería, sin canibalizar la demanda que ya estaba dispuesta a pagar la tarifa completa.

La recomendación central es:

1. **Solo descontar, nunca recargar** por encima de la tarifa de lista.
2. **Solo descontar horarios con riesgo real de quedar huérfanos**, no cualquier solicitud.
3. **Nunca acumular** descuentos: se aplica el mayor beneficio válido entre promoción existente y descuento dinámico.
4. **Piso de precio configurable** y presupuesto máximo de descuento.
5. **Bloquear la cotización por pocos minutos** para que el cliente pague el precio que vio, sujeto a disponibilidad.
6. **Registrar y explicar** cada precio dinámico: regla, señales, vigencia y aceptación.
7. **Probar primero en modo sombra y piloto**, sin mostrarlo al público hasta calibrar.
8. **Administrar todas las variables comerciales desde la interfaz**, con validaciones, versionado y auditoría. El negocio cambia; el código no debería cambiar cada vez que cambia una tarifa, un umbral o un horario protegido.

La frase “ocupar las horas más próximas para tener tiempo de llenar la parrilla” mezcla tres estrategias distintas. Conviene separarlas porque tienen efectos comerciales diferentes:

| Palanca                | Qué hace                                                         | Cuándo conviene                                     | Riesgo principal                                                                            |
| ---------------------- | ---------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Rellenar huecos**    | Ofrece horarios cercanos que completan un espacio entre reservas | Siempre que exista fragmentación                    | Ofrecer una hora que el cliente no pidió; debe ser una alternativa, no un cambio unilateral |
| **Último minuto**      | Descuenta cupos que siguen libres a pocas horas del inicio       | Cuando hay baja ocupación y poco tiempo para vender | Enseñar al cliente a esperar el descuento                                                   |
| **Reserva anticipada** | Descuenta por reservar con semanas de anticipación               | Para construir ocupación temprana                   | Canibalizar reservas que se habrían vendido igual a precio completo                         |

Para este MVP recomiendo empezar por **rellenar huecos** y **último minuto acotado**. La reserva anticipada puede evaluarse después, con cupos limitados y sin mezclarla con las otras dos.

## 2. Qué existe hoy en el código

El motor actual ya tiene una base útil, pero el precio es estático:

- `apps/website/server/domain.mjs`, `calculateQuote()`: calcula tarifa general, franjas semanales, excepciones por fecha y promociones. Aplica la promoción de mayor beneficio, sin acumular.
- `apps/website/server/domain.mjs`, `findAlternatives()`: busca horarios, valida capacidad, preparación, cierre y agrupación física. Prioriza preservar capacidad futura y cercanía; el precio solo desempata.
- `apps/website/server/index.mjs`, `/api/availability`: devuelve alternativas con su cotización.
- `apps/website/server/index.mjs`, `/api/requests` y `/api/staff/bookings`: vuelven a cotizar al crear la solicitud o reserva. Hoy no existe un bloqueo de precio entre la búsqueda y el envío.
- `apps/website/server/index.mjs`, `/api/staff/settings`: administra tarifa general, franjas, excepciones y promociones.
- `apps/website/src/views/admin.ts`: interfaz de “Tarifas y promociones”.
- `apps/website/src/main.ts`, `renderOptions()`: muestra precio base, descuento y promoción aplicada.
- `apps/website/server/migrations/001_initial.sql`: el `quote_json` de cada reserva ya conserva el desglose comercial.
- `docs/product/initial-one-shot-implementation-prompt.md`, sección 9: el alcance original excluye “precios dinámicos autónomos”. Cualquier implementación debe aprobar un ADR que reemplace esa exclusión.

Lo que falta:

- Una señal de ocupación, anticipación y fragmentación para decidir cuándo un horario está en riesgo.
- Un piso de precio y un tope de descuento.
- Un mecanismo de cotización bloqueada.
- Un desglose de precio que distinga tarifa de lista, promoción y descuento dinámico.
- Un panel de administración para editar, versionar, simular y auditar todas las variables comerciales.
- Métricas para saber si el descuento genera ingresos incrementales o solo canibaliza.
- Una forma de explicar al cliente y a recepción por qué ese horario vale menos.

## 3. Modelo comercial recomendado

### 3.1 Definiciones

| Concepto               | Significado                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tarifa de lista**    | Precio público normal por pista/hora. Debe ser un precio real, no un precio inflado para simular descuentos.                                        |
| **Precio de catálogo** | Resultado de aplicar al tramo la tarifa general, la franja semanal o la excepción de fecha. Es el precio antes de promociones y descuento dinámico. |
| **Franja promocional** | Tarifa de catálogo más baja para un día/hora concreto, ya configurada por administración. No es un descuento acumulable: es el precio de ese tramo. |
| **Promoción**          | Descuento porcentual o fijo con vigencia y condiciones, ya existente.                                                                               |
| **Descuento dinámico** | Rebaja adicional calculada para un horario con riesgo de quedar vacío. Solo puede reducir el precio de catálogo.                                    |
| **Piso**               | Precio mínimo por pista/hora que el negocio acepta para un descuento dinámico.                                                                      |
| **Precio final**       | Precio de catálogo menos el **mayor** beneficio válido, nunca la suma de ambos.                                                                     |

### 3.2 Reglas de negocio

- **R1. La tarifa de lista es el techo.** El sistema no puede cobrar más que el precio de catálogo por una reserva nueva. No hay “surge pricing” ni recargos automáticos por demanda.
- **R2. El descuento dinámico solo aplica a horarios elegibles.** Debe existir riesgo de orphanidad, estar dentro de la ventana de anticipación configurada y no tratarse de un horario protegido.
- **R3. Piso y tope del descuento dinámico.** Una oferta dinámica nunca deja el precio bajo el piso configurado ni supera el porcentaje máximo de descuento. Las promociones existentes conservan su propia configuración; si alguna queda bajo el piso, administración debe revisarla antes de activar esta función. Si el negocio quiere un piso global, se valida también en promociones y se documenta como decisión aparte.
- **R4. No acumulación.** Se calcula el beneficio de cada promoción elegible y el beneficio dinámico; se aplica el mayor. Nunca se suman. Si una promoción ya deja el precio bajo el piso dinámico, no se le suma otro descuento: se informa en administración para que el negocio decida si esa promoción sigue vigente.
- **R5. Horarios protegidos.** Administración puede excluir días, franjas o fechas completas. Por defecto, los horarios de mayor demanda no reciben descuento dinámico.
- **R6. Cotización bloqueada.** El precio que el cliente ve al elegir una opción se conserva por un período corto (por ejemplo, 15–20 minutos), siempre que la pista siga disponible. Si expira o la pista se ocupa, se muestran alternativas actualizadas; nunca se cobra un precio distinto sin aceptación.
- **R7. Sin cambios retroactivos.** Una reserva confirmada conserva su precio y desglose. El descuento dinámico solo aplica a reservas nuevas o a una recotización aceptada expresamente.
- **R8. Mismo precio para el mismo horario.** Si el descuento se ofrece por web, recepción debe ver y poder explicar el mismo precio para esa pista/hora. Si se define una excepción por canal, debe ser explícita, auditada y no sorprender al cliente.
- **R9. Extensiones y reprogramaciones.** Recomendación: las extensiones usan precio de catálogo, sin descuento dinámico, para evitar reservar barato y extenderse a horario prime. Una reprogramación genera una cotización nueva y requiere aceptación si cambia el total.
- **R10. Todo se explica y se audita.** El cliente ve tarifa de lista, descuento y total. Recepción ve el motivo. Administración ve la regla y las señales que produjeron el precio.
- **R11. Configurabilidad comercial desde administración.** La tarifa de lista, el piso, el descuento máximo, la ventana de anticipación, los umbrales de ocupación, los niveles de riesgo, los días/franjas/fechas protegidas, el presupuesto, los canales, la vigencia de la cotización y el alcance del piloto se editan en Administración. No se hardcodean valores comerciales en el dominio ni en la interfaz.
- **R12. Configuración versionada y no retroactiva.** Cada cotización registra la versión y el snapshot de la configuración usada. Un cambio de configuración afecta cotizaciones nuevas; no altera cotizaciones vigentes ya emitidas ni reservas confirmadas. La versión se incrementa al guardar y el cambio queda auditado con actor, fecha y diferencias.
- **R13. Invariantes no configurables.** “Solo hacia abajo”, “no acumulación”, “no retroactividad”, “no personalización por cliente” y “no bajar del piso en una oferta dinámica” son reglas del sistema, no casillas que administración pueda desactivar.

### 3.3 Fórmula

```
precioCatalogo = suma proporcional de tarifas por tramo × pistas
beneficioPromo = mayor descuento de promociones elegibles
beneficioDinamico = descuento calculado si el horario es elegible
beneficioElegido = max(beneficioPromo, beneficioDinamico)
precioFinal = max(0, precioCatalogo - beneficioElegido)
```

El descuento dinámico se calcula de modo que:

```
beneficioDinamico = min(
  precioCatalogo × maxDiscountPercent / 100,
  maxDiscountClpPerLaneHour ?? infinito,
  precioCatalogo - piso
)
```

El piso se aplica a la oferta dinámica. Si una promoción existente produce un precio menor, se conserva porque fue configurada manualmente; el sistema no la recorta ni la aumenta sin intervención. Antes de activar el precio dinámico, administración debe revisar que las promociones vigentes sigan siendo válidas bajo la política comercial acordada.

Para grupos de varias pistas, el descuento se evalúa sobre **el conjunto completo de pistas y la duración completa**, no pista por pista. Si el grupo bloquea capacidad futura valiosa, no se ofrece descuento aunque haya pistas libres.

### 3.4 Ejemplos con valores ilustrativos

> Los siguientes valores son ejemplos para explicar la regla. No son tarifas reales ni una configuración aprobada.

Supongamos: tarifa de lista 25.000 CLP/pista/hora, piso 15.000, descuento máximo 30%, franja valle 18.000, ventana de último minuto 48 horas.

| Escenario                                                     | Cálculo                                                                     | Resultado                                          |
| ------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------- |
| Martes 17:00, ocupación 30%, faltan 6 h, hueco entre reservas | Riesgo alto; 30% sobre 25.000 = 7.500; queda 17.500, sobre el piso          | **17.500**                                         |
| Martes 20:00, franja valle 18.000, riesgo medio               | 20% sobre 18.000 = 3.600; queda 14.400, bajo el piso                        | **15.000** (piso)                                  |
| Sábado 21:00, ocupación 90%                                   | Horario protegido o riesgo bajo                                             | **25.000**, sin descuento                          |
| Cliente pide sábado 21:00, pero 19:00 está vacío              | 21:00 se mantiene a 25.000; se muestra 19:00 como alternativa con descuento | Cliente elige; no se cambia su hora                |
| Grupo de 3 pistas × 2 h en horario de baja demanda            | Descuento por pista/hora, verificado contra piso y contra impacto futuro    | Descuento solo si el conjunto completo es elegible |

La regla importante: **si el cliente pide un horario prime y está disponible, no se le descuenta ese horario**. Se le puede mostrar una alternativa cercana más barata, pero la decisión es suya.

### 3.5 Qué es configurable y qué no

**Configurable desde Administración:**

- tarifa de lista y franjas tarifarias;
- piso y topes del descuento dinámico;
- ventana de anticipación y umbrales de ocupación;
- niveles de riesgo y porcentaje de descuento de cada uno;
- días, franjas y fechas protegidas;
- presupuesto de descuento;
- vigencia de la cotización;
- canales habilitados;
- alcance del modo piloto;
- ventana y mínimo de historial;
- estado de la función: apagada, sombra, piloto o activa.

**No configurable, porque es un invariante:**

- el descuento dinámico nunca sube el precio por encima del catálogo;
- nunca se acumula con una promoción;
- nunca baja del piso en una oferta dinámica;
- nunca se aplica retroactivamente a una reserva confirmada;
- nunca se personaliza según la persona o su historial de navegación;
- nunca se cambia la hora del cliente sin su elección;
- nunca se inventan tarifas, impuestos, penalizaciones ni compensaciones.

Los valores de la configuración se guardan con versión. Una cotización emitida conserva el snapshot con el que se calculó, aunque administración cambie los parámetros minutos después.

## 4. Cómo decidir si un horario es “huérfano”

No conviene usar una fórmula opaca ni un modelo de machine learning desde el primer día. Para el MVP, una regla transparente y auditable es suficiente. Las señales se calculan en el servidor, con los datos de la sede.

### 4.1 Señales

1. **Ocupación del bloque relevante.** Porcentaje de pista-minutos vendidos en una ventana alrededor del horario (por ejemplo, ±2 horas) o en la misma franja del día. No usar solo la ocupación del día completo, porque esconde huecos locales.
2. **Anticipación.** Horas que faltan para el inicio. Los horarios lejanos todavía tienen tiempo de venderse a precio completo; los cercanos son candidatos a último minuto.
3. **Fragmentación.** Si la reserva llena un hueco entre dos reservas, o si deja un resto menor a una hora más preparación, el valor del hueco restante es bajo. Un hueco que no alcanza para otra reserva es capacidad perdida.
4. **Demanda histórica.** Reservas de las últimas 8–12 semanas para el mismo día de la semana y franja, normalizadas por capacidad. Solo se usa cuando hay suficientes datos; si no, se usan ocupación y anticipación.
5. **Valor futuro de la capacidad.** Si aceptar esa reserva con descuento impide vender después un grupo de 3 pistas a precio completo, el descuento no conviene. Se reutiliza la lógica de `laneUseImpact()` y los escenarios de demanda que ya existen.
6. **Protecciones.** Días, franjas y fechas excluidas por administración; eventos especiales; mantenimiento; cierres.

### 4.2 Puntaje de riesgo transparente

Una escala simple, configurable, permite explicar la decisión:

| Señal                  | Condición                                              | Puntos                          |
| ---------------------- | ------------------------------------------------------ | ------------------------------- |
| Ocupación baja         | Menos de 50% en la ventana                             | +2                              |
| Ocupación media        | Entre 50% y 70%                                        | +1                              |
| Cercanía               | Faltan 24 horas o menos                                | +1                              |
| Cercanía media         | Faltan entre 24 y 48 horas                             | +1 solo si la ocupación es baja |
| Hueco difícil          | La reserva llena un hueco o deja un resto inutilizable | +1                              |
| Demanda histórica baja | Menos de 40% de la capacidad histórica de esa franja   | +1                              |
| Valor futuro alto      | La reserva bloquearía un grupo grande probable         | Descarta el descuento           |
| Horario protegido      | Día/franja/fecha excluida                              | Descarta el descuento           |

Niveles iniciales sugeridos, todos configurables:

| Riesgo         | Descuento dinámico                    |
| -------------- | ------------------------------------- |
| 0–2 puntos     | Sin descuento                         |
| 3 puntos       | 10%                                   |
| 4 puntos       | 20%                                   |
| 5 o más puntos | Hasta el máximo configurado (ej. 30%) |

El puntaje no reemplaza el criterio comercial: es una forma de aplicar siempre la misma regla y de poder revisar por qué se ofreció un precio. Los pesos y umbrales deben calibrarse en modo sombra antes de mostrarlos al público.

### 4.3 Arranque en frío

Al principio no habrá historial suficiente. La primera versión debe funcionar solo con:

- ocupación actual,
- anticipación,
- fragmentación,
- protecciones,
- valor futuro.

La demanda histórica se incorpora después, cuando existan al menos 8 semanas de datos y un mínimo de reservas por franja. Mientras tanto, es preferible un descuento conservador a un modelo que invente demanda.

## 5. Flujo completo

### 5.1 Búsqueda pública

Cada alternativa debe mostrar:

- hora de inicio y término,
- pistas y duración,
- **tarifa de lista** o precio de catálogo,
- descuento aplicado y su motivo,
- **total final**,
- vigencia de la cotización.

Etiquetas posibles:

- `Recomendado`: preserva mejor la capacidad futura.
- `Mejor precio`: tiene descuento dinámico.
- `Promoción`: aplica una promoción existente.
- `Horario valle`: tarifa de franja.

No usar etiquetas de urgencia falsas (“último cupo”, “solo por hoy”) si no son literalmente ciertas. No usar un precio tachado que nunca se cobra.

### 5.2 Cliente que pide un horario prime

Ejemplo: pide sábado 21:00, que está disponible a 25.000. El sistema:

1. Muestra el horario pedido a 25.000.
2. Si hay un hueco cercano —por ejemplo, 19:00— muestra esa alternativa con su precio dinámico.
3. Explica la diferencia: “19:00 tiene tarifa promocional por baja ocupación”.
4. No cambia la hora automáticamente.

Esto cumple la regla de no modificar unilateralmente el horario y, a la vez, ofrece una opción que mejora la ocupación.

### 5.3 Cotización bloqueada

Al elegir una opción, el servidor devuelve un token de cotización con:

- hora, duración, pistas y jugadores,
- precio y desglose,
- fecha de expiración,
- firma o identificador no predecible.

El token no retiene la pista: **bloquear precio no es bloquear inventario**. Al enviar la solicitud, el servidor:

1. Verifica el token y su vigencia.
2. Vuelve a comprobar disponibilidad.
3. Si la pista sigue libre y el token es válido, respeta el precio mostrado.
4. Si la pista se ocupó, responde con alternativas actualizadas.
5. Si el token expiró, muestra el nuevo precio y exige nueva aceptación.

Esto evita el problema actual: el cliente ve un precio, demora en verificar el correo y al enviar se le cotiza otro sin que lo haya aceptado.

### 5.4 Confirmación y seguimiento

El correo y la pantalla de seguimiento deben incluir:

- tarifa de lista,
- descuento y motivo,
- total aceptado,
- condiciones,
- vigencia del enlace.

No se aplican descuentos retroactivos ni se recalcula una reserva confirmada si cambia la ocupación.

### 5.5 Recepción

Recepción debe ver el mismo desglose y una explicación breve:

- “Descuento dinámico por baja ocupación en esta franja”.
- “Precio de lista, sin descuento”.
- “Promoción de temporada aplicada”.

Si más adelante se permite una excepción manual, debe requerir rol autorizado, motivo y auditoría. No se debe poder “inventar” un descuento sin dejar rastro.

### 5.6 Administración

Nueva sección “Precio dinámico” dentro de Tarifas y promociones. Debe ser la **única fuente de verdad** para las variables comerciales: no se editan archivos, variables de entorno ni código para cambiar un piso, un umbral o un horario protegido.

La pantalla debe tener cuatro estados explícitos:

| Estado   | Comportamiento                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------- |
| `off`    | No calcula ni muestra descuentos. Todo se cotiza a precio de catálogo.                             |
| `shadow` | Calcula y registra la oferta que habría hecho, pero no la muestra al cliente. Sirve para calibrar. |
| `pilot`  | Muestra descuentos solo en los días/franjas definidos para el piloto.                              |
| `active` | Muestra descuentos en los canales habilitados, con presupuesto y protecciones vigentes.            |

Matriz de configuración propuesta:

| Variable                          | Valor inicial seguro        | Validación                                                                        | Efecto                                        |
| --------------------------------- | --------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------- |
| `mode`                            | `off`                       | `off`, `shadow`, `pilot` o `active`                                               | Estado global de la función                   |
| `floorClpPerLaneHour`             | `null`                      | Entero positivo, menor o igual a la tarifa de lista; obligatorio si `mode != off` | Precio mínimo de una oferta dinámica          |
| `maxDiscountPercent`              | `30` como ejemplo           | Entero entre 1 y 100; debe cubrir el mayor nivel de riesgo                        | Tope porcentual del descuento                 |
| `maxDiscountClpPerLaneHour`       | `null`                      | Entero positivo o nulo                                                            | Tope absoluto opcional por pista/hora         |
| `advanceWindowHours`              | `48`                        | Entero entre 1 y 720                                                              | Solo se descuenta dentro de esta anticipación |
| `lowOccupancyThresholdPercent`    | `50`                        | Entre 0 y 100                                                                     | Bajo este umbral, suma riesgo alto            |
| `mediumOccupancyThresholdPercent` | `70`                        | Mayor que el umbral bajo y hasta 100                                              | Bajo este umbral, suma riesgo medio           |
| `riskTiers`                       | `[]`; sugerido 10/20/30%    | Ordenados por `minPoints`, descuento positivo y no mayor que `maxDiscountPercent` | Descuento según puntaje de riesgo             |
| `protectedWeekdays`               | `[]`                        | Días 0–6, sin duplicados                                                          | Excluye días completos                        |
| `protectedBands`                  | `[]`                        | Día, hora de inicio y término válidos; sin superposición                          | Excluye franjas horarias                      |
| `protectedDates`                  | `[]`                        | Fechas locales válidas                                                            | Excluye fechas especiales o eventos           |
| `dailyDiscountBudgetClp`          | `null`                      | Entero positivo; obligatorio en `pilot` y `active`                                | Tope de descuento acumulado por día           |
| `quoteTtlMinutes`                 | `20`                        | Entero entre 5 y 60                                                               | Vigencia de la cotización mostrada            |
| `channels`                        | `["web"]` durante el piloto | Canales conocidos, sin duplicados                                                 | Dónde se puede ofrecer                        |
| `pilot.weekdays`                  | `[]`                        | Días 0–6; obligatorio si `mode = pilot`                                           | Días del piloto                               |
| `pilot.bands`                     | `[]`                        | Franjas válidas; obligatorio si `mode = pilot`                                    | Franjas del piloto                            |
| `history.windowDays`              | `56`                        | Entero entre 28 y 365                                                             | Ventana de historial para demanda             |
| `history.minimumBookings`         | `40`                        | Entero mayor o igual que 0                                                        | Mínimo para usar la señal histórica           |
| `configVersion`                   | `1`                         | Solo lectura; se incrementa al guardar                                            | Versionado de la configuración                |

Acciones de la pantalla:

- **Guardar y versionar:** valida en el servidor, incrementa `configVersion` y audita el cambio.
- **Simular:** permite elegir fecha, hora, jugadores, duración y escenario de ocupación; muestra precio de catálogo, puntos de riesgo, descuento, total y motivo. Usa la misma función de dominio que producción, no una fórmula duplicada en la interfaz. No compromete inventario.
- **Comparar:** muestra el precio actual y el propuesto antes de guardar.
- **Pasar a sombra:** empieza a registrar ofertas sin mostrarlas.
- **Pasar a piloto:** exige reglas de piloto y presupuesto.
- **Activar:** exige piso, tarifa de lista, niveles de riesgo, presupuesto y al menos un canal.
- **Desactivar:** vuelve de inmediato a precio de catálogo para cotizaciones nuevas.
- **Historial:** muestra versiones, actor, fecha y diferencias; permite restaurar una versión anterior con una nueva versión auditada, no borrando historial.

Validaciones y advertencias:

- No se puede guardar `mode = pilot` o `active` sin piso, tarifa de lista y niveles de riesgo.
- No se puede guardar `pilot` o `active` sin presupuesto diario positivo.
- No se puede guardar `pilot` sin al menos un día o franja de piloto.
- No se puede guardar `active` sin al menos un canal.
- El piso no puede superar la tarifa de lista.
- El descuento de cada nivel no puede superar el máximo global.
- Las franjas protegidas no pueden superponerse.
- Si una promoción vigente queda bajo el piso dinámico, se muestra una advertencia; no se modifica automáticamente.
- Si no hay historial suficiente, la pantalla indica que la señal histórica se ignorará.
- La configuración inválida no se guarda y no reemplaza la versión vigente.

Comportamiento al cambiar la configuración:

- Las **cotizaciones nuevas** usan la versión vigente.
- Las **cotizaciones abiertas** conservan el snapshot con el que fueron emitidas hasta su vencimiento.
- Las **reservas confirmadas** no se recalculan.
- Al desactivar, las cotizaciones abiertas pueden seguir honrándose hasta su vigencia; si el negocio necesita revocarlas, debe existir una acción explícita, auditada y con comunicación al cliente.
- En producción no se cargan valores de demo ni se activa la función por defecto.

## 6. Diseño técnico

### 6.1 Dominio

Mantener las reglas en `apps/website/server/domain.mjs`, sin dependencias de la interfaz ni de SQLite. Funciones nuevas, todas puras y comprobables:

- `calculateCatalogQuote({ startMs, durationMinutes, laneCount, settings, channel })`: separa el precio de catálogo de las promociones.
- `evaluateOrphanRisk({ startMs, endMs, laneCount, reservations, blocks, settings, history })`: devuelve señales, puntos y elegibilidad.
- `calculateDynamicOffer({ catalogQuote, risk, settings })`: devuelve descuento, precio final, motivo y regla aplicada.
- `applyBestSingleBenefit({ catalogQuote, promotions, dynamicOffer })`: elige el mayor beneficio y devuelve el desglose.
- `selectLaneSetAtTime()` y `findAlternatives()`: incorporan el descuento dinámico y el puntaje de hueco, sin reemplazar la validación de capacidad ni la agrupación física.

No se debe duplicar esta lógica en `main.ts` ni en `admin.ts`. El navegador solo presenta el desglose que devuelve la API.

Las funciones reciben `settings.dynamicPricing` como dato. No deben contener constantes comerciales como 25.000, 15.000, 30%, 48 horas, viernes/sábado protegidos ni umbrales de ocupación. Solo pueden contener invariantes técnicos: CLP entero, precio no negativo, porcentaje entre 0 y 100, redondeo consistente y límites de seguridad del rango monetario.

### 6.2 Configuración

Añadir a `settings` un objeto, con valores iniciales seguros. Todos los valores comerciales se editan desde Administración; los que aparecen aquí son solo el estado inicial propuesto, no una configuración real:

```json
{
  "dynamicPricing": {
    "mode": "off",
    "configVersion": 1,
    "floorClpPerLaneHour": null,
    "maxDiscountPercent": 30,
    "maxDiscountClpPerLaneHour": null,
    "advanceWindowHours": 48,
    "lowOccupancyThresholdPercent": 50,
    "mediumOccupancyThresholdPercent": 70,
    "riskTiers": [],
    "protectedWeekdays": [],
    "protectedBands": [],
    "protectedDates": [],
    "dailyDiscountBudgetClp": null,
    "quoteTtlMinutes": 20,
    "channels": ["web"],
    "pilot": {
      "weekdays": [],
      "bands": []
    },
    "history": {
      "windowDays": 56,
      "minimumBookings": 40
    }
  }
}
```

`riskTiers` parte vacío para no inventar descuentos. Administración debe crear los niveles —por ejemplo, 3 puntos → 10%, 4 → 20%, 5 → 30%— antes de pasar a sombra, piloto o activo. `protectedWeekdays` también parte vacío: los horarios prime son una decisión del negocio, no un valor que deba asumir el código.

Validaciones en `/api/staff/settings`:

- `mode` solo puede ser `off`, `shadow`, `pilot` o `active`.
- Si `mode != off`: la tarifa de lista debe ser mayor que cero, `floorClpPerLaneHour` debe ser un entero positivo y menor o igual a la tarifa de lista, y debe existir al menos un nivel de riesgo.
- `maxDiscountPercent` entre 1 y 100; cada nivel debe tener un descuento positivo no mayor que ese máximo.
- `maxDiscountClpPerLaneHour`, si existe, debe ser un entero positivo.
- `riskTiers` ordenado por `minPoints`, con `minPoints >= 1`; no se aceptan duplicados ambiguos.
- `advanceWindowHours` entre 1 y 720; `quoteTtlMinutes` entre 5 y 60.
- `lowOccupancyThresholdPercent < mediumOccupancyThresholdPercent`, ambos entre 0 y 100.
- `protectedBands` sin superposiciones y con día/horas válidas; `protectedDates` con fechas locales válidas.
- Si `mode` es `pilot` o `active`: `dailyDiscountBudgetClp` debe ser un entero positivo y `channels` no puede estar vacío.
- Si `mode` es `pilot`: debe existir al menos un día o franja de piloto.
- `configVersion` lo controla el servidor; se ignora cualquier valor enviado por el navegador y se incrementa al guardar.
- No se puede activar si la tarifa general es cero.
- Si una promoción vigente queda bajo el piso dinámico, se guarda la configuración pero se muestra una advertencia para revisión; no se altera la promoción automáticamente.

Durante el piloto se puede limitar `channels` a `["web"]`. En ese caso, recepción no genera nuevas ofertas dinámicas, pero debe respetar y poder explicar una cotización web vigente para el mismo horario. Lo contrario —cobrar más en recepción por la misma pista/hora— rompe la confianza y la regla R8.

### 6.3 Desglose de cotización

Ampliar el `quote_json` sin romper los campos actuales:

```json
{
  "version": 2,
  "baseClp": 25000,
  "catalogPriceClp": 25000,
  "configVersion": 3,
  "promotion": {
    "name": "Promo temporada",
    "discountClp": 2500
  },
  "dynamic": {
    "applied": true,
    "ruleId": "low-occupancy-near-term-v1",
    "configVersion": 3,
    "riskPoints": 4,
    "signals": {
      "occupancyPercent": 42,
      "leadTimeHours": 8,
      "gapRisk": true,
      "protected": false
    },
    "floorClpPerLaneHour": 15000,
    "maxDiscountPercent": 30,
    "maxDiscountClpPerLaneHour": null,
    "discountClp": 5000,
    "expiresAt": 1760000000000
  },
  "discountClp": 5000,
  "totalClp": 20000,
  "promotionName": null,
  "acceptedAt": null
}
```

Mantener `discountClp` y `promotionName` como resumen compatible con la interfaz actual, pero agregar el detalle. La reserva guarda el desglose aceptado; no se recalcula después.

### 6.4 API

- `GET /api/availability`: devuelve `quote` enriquecido y `quoteToken`/`quoteExpiresAt` por alternativa.
- `POST /api/requests`: acepta `quoteToken`; valida firma, vigencia y disponibilidad; guarda el precio aceptado. Si expiró o la pista se ocupó, responde `409` con alternativas.
- `POST /api/staff/bookings`: usa la misma evaluación; no requiere token porque la operación es presencial/telefónica, pero debe devolver el desglose y registrar al operador.
- `PUT /api/staff/settings`: valida la nueva configuración.
- `POST /api/staff/pricing/preview` (opcional): simulador de precio para una fecha/hora/grupo, sin comprometer inventario.
- `GET /api/staff/pricing/metrics` (opcional): ocupación, descuento aplicado, ingreso por pista-hora disponible y huecos.

### 6.5 Persistencia y auditoría

No se necesita migración para guardar la configuración porque `settings` ya es JSON. Para analítica y explicabilidad se recomienda una tabla append-only:

```sql
CREATE TABLE pricing_decisions (
  id TEXT PRIMARY KEY,
  quote_hash TEXT NOT NULL,
  reservation_id TEXT,
  channel TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  lane_count INTEGER NOT NULL,
  base_clp INTEGER NOT NULL,
  catalog_price_clp INTEGER NOT NULL,
  promotion_discount_clp INTEGER NOT NULL,
  dynamic_discount_clp INTEGER NOT NULL,
  total_clp INTEGER NOT NULL,
  risk_points INTEGER,
  signals_json TEXT NOT NULL,
  config_version INTEGER NOT NULL,
  config_snapshot_json TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  offered_at INTEGER NOT NULL,
  expires_at INTEGER,
  accepted_at INTEGER
);
```

El snapshot puede ser un resumen de la configuración efectiva —piso, topes, umbrales, niveles, protecciones y presupuesto— no una copia de secretos ni de datos personales. Así se puede explicar una cotización histórica aunque la configuración haya cambiado.

Cada guardado de configuración debe registrar en `audit_log`:

- actor, rol y fecha;
- `configVersion` anterior y nueva;
- valores anteriores y nuevos de los campos modificados;
- resultado de la validación;
- advertencias, por ejemplo promociones bajo el piso.

No se debe guardar el historial de configuración solo en memoria ni depender de los logs del proceso.

Se puede empezar con `audit_log` y añadir la tabla en la fase de piloto. Lo importante es no perder la relación entre precio ofrecido, precio aceptado y reserva.

### 6.6 Concurrencia e idempotencia

- La creación de la reserva sigue usando `BEGIN IMMEDIATE`, restricciones de SQLite e idempotencia.
- El token de cotización no reserva inventario; la validación final siempre ocurre dentro de la transacción.
- Si dos clientes obtienen el mismo precio para la última pista, solo uno confirma; el otro recibe alternativas. No se debe prometer la pista por el hecho de tener una cotización.
- Un reintento con la misma clave de idempotencia devuelve la misma reserva y el mismo precio aceptado, sin recalcular el descuento.
- La cotización debe estar firmada o almacenada de forma que no se pueda alterar el precio desde el navegador.

### 6.7 Archivos previstos

| Archivo                                                       | Cambio                                                                                              |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `apps/website/server/migrations/003_pricing_quote_funnel.sql` | Eventos del embudo de cotización con retención de 90 días y sin PII                                 |
| `apps/website/server/pricing-funnel.mjs`                      | Agregación del embudo por tipo de precio                                                            |
| `apps/website/server/domain.mjs`                              | Cotización por catálogo, riesgo, oferta dinámica, mejor beneficio único, ranking con hueco          |
| `apps/website/server/db.mjs`                                  | Defaults seguros de `dynamicPricing` y migración de settings existentes sin activar la función      |
| `apps/website/server/index.mjs`                               | Tokens de cotización, validaciones, endpoints, persistencia del desglose                            |
| `apps/website/server/migrations/002_pricing_decisions.sql`    | Tabla de decisiones de precio (fase de piloto)                                                      |
| `apps/website/server/domain.test.mjs`                         | Pruebas unitarias y de propiedades                                                                  |
| `apps/website/server/api.test.mjs`                            | Configuración, versionado, cotización bloqueada, expiración, concurrencia, auditoría                |
| `apps/website/server/engine-simulation.mjs`                   | Comparación de políticas con y sin descuento dinámico                                               |
| `apps/website/src/views/admin.ts`                             | Panel completo de variables, simulación e historial de versiones                                    |
| `apps/website/src/main.ts`                                    | Guardado de la configuración, visualización del desglose, etiquetas y manejo de cotización expirada |
| `apps/website/e2e/`                                           | Flujo público, administración y casos de expiración                                                 |
| `docs/decisions/0009-...md`                                   | ADR que autoriza el precio dinámico acotado y reemplaza la exclusión del alcance original           |
| `README.md`                                                   | Documentar la función como opcional, configurable y desactivada por defecto cuando se implemente    |

## 7. Rankings y alternativas

El ranking actual combina cercanía y preservación de capacidad. El precio solo desempata. Para que el descuento dinámico sea útil sin degradar la experiencia, propongo:

1. Mantener la validación de capacidad y agrupación física como está.
2. Calcular para cada alternativa: precio final, riesgo, impacto futuro y `gapFillScore`.
3. Presentar hasta tres grupos, sin duplicar horarios:
   - **Cerca de tu hora**: las más cercanas a la preferencia.
   - **Recomendado**: las que preservan mejor la capacidad futura.
   - **Oportunidades de precio**: las que tienen descuento dinámico por hueco.
4. Ordenar cada grupo con un criterio explicable; no ordenar todo solo por precio.
5. No ocultar el horario preferido si está disponible, aunque sea más caro.
6. No contar como alternativas independientes dos opciones que se solapan en la misma pista.

El objetivo no es “vender lo más barato”, sino **vender más pista-hora sin destruir margen ni fragmentar la parrilla**.

## 8. Métricas y piloto

### 8.1 Métricas

Definir antes de implementar, para no medir solo “reservas”:

| Métrica                           | Fórmula                                                          | Para qué                                         |
| --------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------ |
| Ocupación                         | pista-horas vendidas / pista-horas disponibles                   | Saber si se llena la parrilla                    |
| Ingreso por pista-hora disponible | ingreso total / pista-horas disponibles                          | Evitar celebrar ocupación comprada con descuento |
| Tasa de huecos huérfanos          | pista-minutos en huecos no vendibles / pista-minutos disponibles | Medir el problema que se quiere resolver         |
| Descuento promedio                | descuento CLP / precio de catálogo                               | Controlar erosión de margen                      |
| Conversión                        | reservas confirmadas / cotizaciones emitidas                     | Saber si el descuento convierte                  |
| Cancelaciones                     | canceladas / confirmadas                                         | Detectar abuso o arrepentimiento                 |
| Canibalización                    | reservas con descuento que habrían ocurrido a precio completo    | Requiere grupo de control                        |
| Incrementalidad                   | reservas en horarios que antes quedaban vacíos                   | Medir el beneficio real                          |

El embudo implementado cuenta alternativas web renderizadas, selecciones y solicitudes creadas con la cotización firmada; incluye las que quedan pendientes de aprobación. No equivale a reserva confirmada ni a ingreso incremental. Los eventos guardan un hash del token, tipo de precio y fechas, sin datos personales, y se eliminan a los 90 días.

La canibalización no se puede observar directamente. Se aproxima con un piloto controlado: ciertos días/franjas reciben descuento y otros comparables no, o se alternan semanas. Con una sola sede y pocos datos, la conclusión será direccional, no estadísticamente definitiva.

### 8.2 Fases del piloto

1. **Línea base (4 semanas):** medir ocupación, ingreso, huecos y conversión sin cambios.
2. **Modo sombra (2 semanas):** calcular las ofertas que se habrían hecho, registrarlas y no mostrarlas. Sirve para calibrar el puntaje y detectar descuentos absurdos.
3. **Piloto acotado (4 semanas):** mostrar solo en franjas de baja demanda, con descuento máximo bajo, piso alto y presupuesto diario. Comparar con franjas de control.
4. **Evaluación:** si mejora el ingreso por pista-hora disponible y reduce huecos sin aumentar cancelaciones, ampliar. Si solo baja el precio promedio, retirar o ajustar.
5. **Producción general:** activar por etapas, con botón de apagado inmediato.

### 8.3 Guardrails

- Presupuesto máximo de descuento por día/semana.
- Porcentaje máximo de pista-horas vendidas con descuento.
- Piso absoluto por pista/hora.
- Exclusión de horarios prime.
- Exclusión de fechas de alta demanda o eventos.
- Monitoreo de cancelaciones y quejas.
- Revisión semanal de las reglas y del ranking.
- Capacidad de desactivar sin desplegar código.

## 9. Fases de implementación

| Fase                                              | Alcance                                                                                                                                         | Entregable                                   | Criterio de salida                                                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **F0. Decisiones**                                | Confirmar piso, topes, ventana, horarios protegidos, canales y catálogo de variables. Crear ADR 0009.                                           | Documento aprobado + matriz de configuración | El negocio firmó los números, los defaults y la regla de no acumulación                                     |
| **F1. Dominio**                                   | Cotización por catálogo, riesgo, oferta dinámica, mejor beneficio único, contrato de configuración, pruebas unitarias y de propiedades. Sin UI. | `domain.mjs` + tests                         | Oferta dinámica nunca bajo el piso ni sobre catálogo; sin acumulación                                       |
| **F2. API, configuración y cotización bloqueada** | Validación/versionado de todas las variables, auditoría, tokens, expiración, persistencia del desglose, endpoints de staff.                     | API + tests de integración                   | Configuración inválida no se guarda; el cliente paga el precio que vio; expiración y concurrencia cubiertas |
| **F3. Interfaz**                                  | Público, recepción y administración; panel completo de variables, simulador, historial de versiones, etiquetas, desglose, accesibilidad.        | UI + E2E                                     | Flujo completo web y manual; administración puede operar sin tocar código; axe y móvil sin regresiones      |
| **F4. Modo sombra y piloto**                      | Métricas, tabla de decisiones, comparación con grupo de control.                                                                                | Reporte de piloto                            | Se decide ampliar, ajustar o retirar con datos                                                              |
| **F5. Demanda histórica**                         | Incorporar historial por día/franja y ajuste por eventos.                                                                                       | Modelo explicable y versionado               | Mejora medible frente a la regla simple, sin caja negra                                                     |

Orden de magnitud: F0–F1 pueden ser días; F2–F3, una o dos semanas; F4, varias semanas de operación. No conviene prometer fechas sin antes confirmar los valores comerciales y el apetito de riesgo.

## 10. Pruebas y criterios de aceptación

### 10.1 Pruebas

- **Unitarias:** piso, tope, tramos que cruzan hora, multi-pista, promociones, horarios protegidos, DST, redondeo CLP.
- **Propiedades:** para toda oferta dinámica, `piso <= total <= catálogo`; para toda cotización nueva, `total <= catálogo`; el descuento dinámico nunca supera el tope; nunca hay dos descuentos sumados; el total no es negativo. Si una promoción existente queda bajo el piso, la prueba debe reportarlo como advertencia de configuración, no como fallo silencioso.
- **Configuración:** cada variable de la matriz de administración se guarda, se valida y se rechaza si es inválida; `configVersion` se incrementa; una configuración nueva no cambia cotizaciones ya emitidas.
- **Integración:** token válido/expirado/alterado; pista ocupada entre cotización y reserva; idempotencia; auditoría; configuración inválida; producción cerrada; modo sombra no visible; piloto limitado a sus franjas.
- **E2E:** cliente ve descuento, elige, verifica correo, confirma al mismo precio; cotización expirada muestra alternativas; administración edita cada grupo de variables, activa/desactiva, simula y ve el historial; recepción ve el motivo.
- **Simulación:** extender `simulate:engine` para comparar “sin descuento”, “descuento solo en huecos” y “descuento amplio”. Reportar ingreso, ocupación, huecos y canibalización asumida. No presentar la simulación como predicción real.
- **Accesibilidad:** el desglose de precio y las etiquetas deben ser legibles por lector de pantalla; no depender solo del color; el panel de administración debe ser usable con teclado y reflow en móvil.

### 10.2 Criterios de aceptación

- [ ] La tarifa de lista y el piso se configuran en administración; no hay valores inventados en producción.
- [ ] Todas las variables comerciales de la matriz se editan desde Administración y se validan en el servidor.
- [ ] Un cambio de configuración incrementa la versión, queda auditado y no altera cotizaciones vigentes ni reservas confirmadas.
- [ ] El modo sombra calcula y registra sin mostrar precios al público.
- [ ] El modo piloto solo aplica en los días/franjas configurados.
- [ ] El panel permite simular antes de guardar y muestra el motivo del precio.
- [ ] Una configuración inválida no se guarda ni reemplaza la versión vigente.
- [ ] El descuento dinámico solo reduce el precio; nunca lo sube por encima del catálogo.
- [ ] El descuento dinámico no baja del piso configurado.
- [ ] Las promociones existentes que queden bajo el piso se detectan y revisan antes de activar.
- [ ] Nunca se acumulan promoción y descuento dinámico.
- [ ] Un horario protegido no recibe descuento.
- [ ] Un horario prime solicitado no se descuenta solo porque el cliente lo pidió.
- [ ] Se ofrecen alternativas cercanas más baratas sin cambiar la hora unilateralmente.
- [ ] El cliente acepta expresamente el total y el desglose.
- [ ] La cotización tiene vigencia y no se recotiza en silencio.
- [ ] Si la pista se ocupa, el cliente recibe alternativas, no un cobro distinto.
- [ ] La reserva confirmada conserva su precio.
- [ ] Recepción y administración pueden explicar el precio.
- [ ] Todo cambio de configuración y toda aceptación quedan auditados.
- [ ] Se puede desactivar el descuento dinámico de inmediato.
- [ ] Las pruebas existentes de capacidad, agrupación, pagos y reservas siguen pasando.

## 11. Riesgos y mitigaciones

| Riesgo                                | Efecto                                          | Mitigación                                                                                 |
| ------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Canibalización                        | Se descuenta a quien ya iba a pagar completo    | Solo horarios con riesgo; grupo de control; no descontar prime                             |
| Entrenar al cliente a esperar         | Baja el precio promedio y se pierde margen      | Último minuto acotado, no permanente; no anunciar un calendario predecible                 |
| Precio tachado falso                  | Problema comercial/legal y pérdida de confianza | La tarifa de lista debe ser real y vigente; mostrar “tarifa base” y “descuento”, no inflar |
| Inconsistencia web/recepción          | El cliente siente trato desigual                | Misma regla para el mismo horario; excepciones auditadas                                   |
| Cotización vieja                      | Cliente ve un precio y recibe otro              | Token con vigencia; aceptación expresa; alternativas si expira                             |
| Pista ocupada durante la verificación | Frustración                                     | No prometer retención; revalidar y ofrecer alternativas                                    |
| Grupo grande bloquea capacidad futura | Se pierde una venta mayor                       | Evaluar impacto futuro; no descontar si bloquea demanda valiosa                            |
| Regla demasiado compleja              | Recepción no la entiende                        | Puntaje transparente, motivo visible, simulador y documentación                            |
| Datos insuficientes                   | Descuentos mal calibrados                       | Arranque en frío con ocupación/anticipación; historial después                             |
| Abuso de tokens                       | Muchas cotizaciones baratas sin compra          | TTL corto, rate limit, tokens firmados; evaluar registro en base si escala                 |
| Descuento en extensión                | Reserva barata y extensión a prime              | Extensiones a precio de catálogo; aceptación expresa                                       |
| Impuestos/boleta                      | El descuento afecta la base tributaria          | Definir tratamiento con contabilidad antes de producción                                   |

## 12. Decisiones que debe confirmar el negocio

No se deben inventar estos valores. El plan puede implementarse con ellos como configuración, pero hay que aprobarlos:

1. **¿Los 25.000 CLP son por pista/hora, por hora total o por persona?** El motor actual cobra por pista/hora.
2. **¿La tarifa de lista de 25.000 es un precio real que se cobra hoy?** Si no, no debería mostrarse como precio de referencia.
3. **¿Cuál es el piso por pista/hora?** Ejemplo ilustrativo: 15.000. Debe cubrir costos y margen mínimo.
4. **¿Cuál es el descuento máximo?** Ejemplo: 30%.
5. **¿En qué ventana se permite el último minuto?** Ejemplo: 48 horas.
6. **¿Qué horarios son prime y quedan protegidos?** Ejemplo: viernes y sábado desde 20:00.
7. **¿El descuento aplica solo a web o también a recepción?** Recomendación: misma regla para el mismo horario; recepción con explicación visible.
8. **¿Puede recepción hacer una excepción manual?** Si sí, ¿con qué rol, motivo y límite?
9. **¿Hay presupuesto diario/semanal de descuento?**
10. **¿Las promociones actuales pueden quedar bajo el piso?** Hay que revisarlas antes de activar.
11. **¿Las extensiones llevan descuento?** Recomendación: no.
12. **¿Cómo se trata el IVA/boleta en un precio con descuento?**
13. **¿Hay al menos 8 semanas de historial de reservas por día/franja?**
14. **¿Se acepta un piloto con grupo de control, aunque algunos clientes vean precios distintos en horarios comparables?**
15. **¿Quién puede editar la configuración?** Recomendación: solo administración; recepción puede consultarla, no cambiarla.
16. **¿Qué pasa con las cotizaciones abiertas al cambiar la configuración?** Recomendación: conservan su snapshot hasta vencer; las nuevas usan la versión nueva.
17. **¿El piloto se define por días/franjas o por porcentaje de cupos?** Recomendación: por días/franjas, para que dos clientes del mismo horario no vean precios distintos.
18. **¿Se podrá restaurar una versión anterior?** Recomendación: sí, creando una versión nueva auditada, sin borrar el historial.

## 13. Lo que no se debe hacer

- No implementar recargos automáticos por demanda sin una decisión comercial y legal aparte.
- No descontar todas las reservas ni todos los horarios.
- No descontar el horario prime que el cliente ya pidió y está disponible.
- No sumar promoción + descuento dinámico.
- No bajar del piso configurado en una oferta dinámica.
- No usar precios distintos según la persona, su historial de navegación o su disposición a pagar; la regla se aplica al horario y al inventario, no al perfil del cliente.
- No mostrar un precio tachado que nunca se cobra.
- No usar cuentas regresivas ni mensajes de urgencia falsos.
- No cambiar una reserva confirmada unilateralmente.
- No inventar penalizaciones, impuestos ni compensaciones.
- No reemplazar la validación de capacidad ni la agrupación física por “primera pista libre”.
- No presentar la heurística como un óptimo global ni como una predicción de demanda.
- No activar valores de demo en producción.

## 14. Siguiente paso recomendado

1. Confirmar los valores de las decisiones 1–8.
2. Crear el ADR 0009 con la regla aprobada: descuento dinámico acotado, solo hacia abajo, no acumulable, con piso, configuración versionada y cotización bloqueada.
3. Implementar F1 (dominio y contrato de configuración) sin tocar la interfaz.
4. Implementar F2 (validación, versionado y auditoría de todas las variables) antes de exponer el panel.
5. Implementar F3 (panel de administración, simulación y flujo público).
6. Ejecutar el modo sombra con datos reales.
7. Recién entonces mostrar la primera versión al público, en piloto acotado.

La configuración se define como contrato en F1, se valida y versiona en F2, y se vuelve editable en F3. Así el panel de administración no queda como un conjunto de controles decorativos: cada variable tiene efecto real en el motor y queda auditada.

Si se confirma la dirección, el primer cambio funcional debería ser pequeño y reversible: **calcular la oferta dinámica y registrarla, pero no mostrarla todavía**. Eso permite validar la regla con datos reales antes de comprometer precios con clientes.
