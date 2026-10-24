# ONE-SHOT IMPLEMENTATION PROMPT

## Bowling Smart Booking Engine · MVP

### ROL Y MISIÓN

Actúa como **arquitecto de software senior, ingeniero full-stack y responsable técnico de calidad**.

Tu misión es analizar el repositorio actual y construir un MVP funcional, persistente y verificable de **Bowling Smart Booking Engine**, un sistema inteligente de reservas y operación para un salón de bolos de 12 pistas.

Trabaja de forma autónoma, con criterio de ingeniería profesional.

**No te limites a planificar, redactar especificaciones, generar estructuras vacías o producir interfaces simuladas. Implementa el producto y sus funcionalidades esenciales.**

Dispones de la especificación funcional completa en este prompt. No necesitas conocer conversaciones anteriores.

### INSTRUCCIONES DE EJECUCIÓN

1. Inspecciona primero el repositorio completo.
2. Lee README, AGENTS.md, instrucciones del proyecto, configuraciones y archivos existentes.
3. Si existe una arquitectura funcional, respétala y evoluciona sobre ella.
4. Si el repositorio está vacío, selecciona un stack moderno, estable, mantenible y adecuado para una aplicación web con motor de planificación, persistencia transaccional y despliegue sencillo.
5. Documenta brevemente las decisiones arquitectónicas importantes mediante ADR o documentos equivalentes.
6. Evita servicios de pago, dependencias externas innecesarias y complejidad prematura.
7. Diseña una solución modular, con separación entre lógica de dominio, persistencia, API e interfaces.
8. Implementa progresivamente y ejecuta pruebas durante el desarrollo.
9. No solicites confirmación para decisiones técnicas reversibles y razonables.
10. No elimines archivos, configuraciones o trabajo preexistente sin analizar su utilidad.
11. Prioriza seguridad, consistencia, claridad y funcionamiento real sobre sofisticación visual.
12. No detengas el trabajo después de presentar un plan. Continúa con la implementación.
13. Si una función depende de credenciales externas no disponibles, implementa una interfaz de integración real, un adaptador de desarrollo claramente identificado y documenta la configuración necesaria.
14. Nunca presentes una simulación como si fuera una integración productiva.
15. Al finalizar, informa exactamente qué funciona, qué se probó y qué permanece pendiente.

---

# 1. OBJETIVO DEL PRODUCTO

Construir una aplicación web para gestionar reservas y operación diaria de un salón de bolos.

El establecimiento dispone de **12 pistas físicas**.

Su principal característica será un motor de asignación inteligente que:

- Evalúa disponibilidad en todas las pistas.
- Propone horarios alternativos.
- Minimiza la fragmentación del inventario.
- Preserva la capacidad comercializable futura.
- Permite agrupaciones de pistas.
- Puede reorganizar asignaciones internas todavía flexibles.
- Respeta los compromisos de reservas confirmadas.
- Utiliza los ingresos como criterio secundario.

El producto incluirá:

**Portal público:** búsqueda, cotización, verificación de correo, reservas y seguimiento.

**Recepción:** tablero de pistas, reservas, aprobaciones, check-in, pagos manuales, ausencias, modificaciones y extensiones.

**Administración:** inventario, horarios, tarifas, promociones, políticas, empleados, permisos y auditoría.

El sistema funcionará con un inventario único para todos los canales.

Idioma principal: **español**.

Mercado inicial: **Chile**.

Moneda: **CLP**.

Zona horaria del establecimiento: **America/Santiago**, usando reglas horarias reales y contemplando cambios de horario de verano.

---

# 2. INVENTARIO FÍSICO

Existen 12 pistas identificadas del 1 al 12.

Capacidad máxima: **6 jugadores por pista**.

Parejas físicas obligatorias:

- Pistas 1 y 2.
- Pistas 3 y 4.
- Pistas 5 y 6.
- Pistas 7 y 8.
- Pistas 9 y 10.
- Pistas 11 y 12.

Reglas:

- Entre 1 y 6 jugadores: una pista.
- Entre 7 y 12 jugadores: dos pistas de una pareja física válida.
- Desde 13 jugadores: tres o más pistas según capacidad.
- Para grupos grandes, priorizar pistas físicamente contiguas.
- Cuando no exista una agrupación adecuada, permitir alternativas separadas si el cliente acepta expresamente esa condición.
- No confundir numeración consecutiva con proximidad física: representar la distribución del salón mediante una configuración explícita.
- No ofrecer más capacidad de la que realmente existe.
- Los clientes no eligen números físicos de pista.

Distinguir:

- Pistas mínimas necesarias.
- Pistas contratadas.
- Pistas asignadas físicamente.
- Condiciones de agrupación comprometidas.

El número de pistas contratadas no necesariamente debe cambiar cuando se reduce la cantidad de jugadores.

---

# 3. HORARIOS Y TIEMPO DE PREPARACIÓN

Permitir configurar:

- Horarios semanales de apertura y cierre.
- Excepciones por fecha.
- Cierres extraordinarios.
- Bloqueos por mantenimiento.
- Margen obligatorio previo al cierre.
- Tiempo de preparación entre reservas.
- Anticipación mínima y máxima de reservas.
- Bloqueo operacional previo al inicio.

### Preparación

Valor inicial: **10 minutos**.

Este valor debe ser configurable por el administrador y permitir modificaciones futuras, por ejemplo a 5 minutos.

Se aplica entre reservas de clientes distintos que utilizan una misma pista.

No debe insertarse preparación entre horas consecutivas de una misma reserva.

Ejemplo:

- Cliente A utiliza una pista de 19:00 a 20:00.
- Preparación: 10 minutos.
- Cliente B puede comenzar a las 20:10.

Si la preparación cambia a cinco minutos, B podría comenzar a las 20:05, siempre que se respeten todas las demás restricciones.

El cambio de configuración debe tener trazabilidad y no invalidar reservas confirmadas.

### Precisión temporal

No limitar inicios a horas redondas.

Deben poder existir reservas a las 16:10, 17:20 u otros minutos admitidos por la configuración operativa.

Las reservas iniciales se comercializan en horas completas: 1, 2, 3 horas o más.

Las extensiones podrán utilizar duraciones adicionales configurables.

### Anticipación

Configuración inicial:

- Máximo 60 días.
- Mínimo una hora antes del inicio para reservas web.
- Recepción puede gestionar clientes presenciales inmediatos.

---

# 4. MOTOR DE DISPONIBILIDAD Y OPTIMIZACIÓN

Esta es la parte central del proyecto.

**No implementar simplemente un calendario que asigne la primera pista libre.**

Construir un motor determinista de planificación que evalúe alternativas de capacidad, horarios y distribución.

### Restricciones obligatorias

Nunca incumplir:

1. Horarios de funcionamiento.
2. Margen anterior al cierre.
3. Tiempo de preparación.
4. Capacidad de pistas.
5. Parejas físicas.
6. Agrupación aceptada.
7. Reservas confirmadas.
8. Retenciones activas.
9. Bloqueos operacionales.
10. Mantenimiento.
11. Reglas de autorización.
12. Consistencia ante concurrencia.

### Objetivo principal

**Preservar capacidad comercializable futura.**

No medir exclusivamente minutos libres.

Una ventana libre inferior a la duración necesaria de una nueva reserva más sus preparaciones obligatorias puede ser comercialmente inutilizable.

Comparar las asignaciones mediante escenarios de demanda representativos:

- Una pista durante una hora.
- Una pista durante dos horas.
- Dos pistas simultáneas.
- Tres o más pistas.
- Diferentes franjas horarias.

No sumar opciones que se superponen como si fueran reservas independientes.

### Objetivo secundario

Ingresos comerciales.

El motor tarifario calcula el precio de cada alternativa.

El optimizador puede utilizar ese valor para comparar soluciones de eficiencia comparable, pero no puede cambiar tarifas ni inventar descuentos.

### Preferencias del cliente

Recibir:

- Fecha.
- Hora preferida.
- Jugadores.
- Duración.

Buscar alternativas durante toda la jornada, sin desviación horaria máxima predeterminada.

Presentar opciones útiles, incluyendo alternativas cercanas al horario solicitado cuando existan, e informar sus diferencias.

**Nunca modificar unilateralmente el horario del cliente.**

El cliente elige y acepta la alternativa que desea contratar.

### Reoptimización interna

Permitir reorganizar asignaciones futuras flexibles conservando:

- Fecha.
- Hora.
- Duración.
- Número de pistas.
- Condiciones de agrupación.
- Demás compromisos confirmados.

No modificar asignaciones:

- Bloqueadas operacionalmente.
- En preparación.
- Con check-in que haya fijado la pista.
- En curso.
- Fijadas manualmente por recepción cuando corresponda.

Para el MVP, implementar reorganización localizada con límites razonables de complejidad y resultados verificables.

Dejar preparada la arquitectura para optimización global avanzada sin exigirla ahora.

Cada reorganización debe ser atómica, auditable y reversible ante errores antes de confirmarse.

### Calidad del algoritmo

Crear pruebas que comparen el motor contra:

- Primera disponibilidad.
- Horario más cercano.
- Compactación sencilla.

Medir:

- Capacidad residual comercializable.
- Fragmentación.
- Reservas factibles por tamaño de grupo.
- Reasignaciones necesarias.
- Cercanía a la hora solicitada.
- Horas-pista vendidas.
- Ingresos de las reservas aceptadas.

No prometer optimalidad global si el algoritmo no puede demostrarla.

Documentar sus límites computacionales y reglas de desempate.

---

# 5. RESERVAS Y ESTADOS

Mantener separadas tres dimensiones:

### Estado comercial

Ejemplos:

- Solicitud pendiente.
- Pendiente de aprobación.
- Aprobada.
- Pendiente de aceptación de precio.
- Confirmada.
- Cancelada.
- Rechazada.
- Finalizada.

### Estado del inventario

- Sin compromiso.
- Retenido.
- Asignado.
- Ocupado.
- Liberado.

### Estado financiero

- Sin pago.
- Pago informado.
- Pendiente de verificación.
- Anticipo acreditado.
- Parcialmente pagado.
- Pagado.
- Devolución pendiente.
- Devolución registrada.

No representar todas las combinaciones mediante un único campo gigantesco.

Conservar eventos, fechas y responsables de las transiciones.

### Atomicidad

Dos clientes no pueden reservar simultáneamente la misma capacidad incompatible.

Las verificaciones y escrituras que comprometen inventario deben ser transaccionales.

Usar controles de concurrencia reales, no únicamente validaciones en el navegador.

Los reintentos, llamadas duplicadas y confirmaciones repetidas no deben generar reservas adicionales.

---

# 6. CANALES E IDENTIFICACIÓN

### Web

No exigir cuenta de usuario.

Permitir buscar y comparar horarios sin identificación.

Antes de comprometer capacidad:

1. Obtener nombre y correo.
2. Enviar enlace o código de verificación.
3. Confirmar control del correo.
4. Revalidar disponibilidad y precio.
5. Obtener aceptación de condiciones.
6. Crear retención o confirmación de forma consistente.

La verificación no reserva temporalmente las pistas mientras se realiza.

### Telefónica

Recepción puede crear reservas sin correo verificado.

Obligatorios:

- Nombre.
- Teléfono.

Correo opcional.

Registrar operador y canal.

### Presencial inmediata

Obligatorio:

- Nombre del responsable.

No exigir teléfono, correo ni verificación digital.

### Presencial futura

Obligatorios:

- Nombre.
- Al menos un contacto: teléfono o correo.

Recepción podrá omitir verificación electrónica.

No marcar contactos informados como verificados automáticamente.

---

# 7. SOLICITUDES ACTIVAS Y PROTECCIÓN CONTRA ABUSOS

### Canal web

Máximo **dos solicitudes pendientes de resolución comercial por correo verificado**.

Las reservas confirmadas y solicitudes cerradas no consumen este cupo.

Una tercera solicitud requiere intervención de recepción y no genera automáticamente otra retención.

### Canales manuales

Límite inicial de dos solicitudes pendientes por contacto informado, con detección de duplicados y alertas.

Las reservas presenciales inmediatas quedan excluidas de ese límite de solicitudes pendientes.

Los contactos no verificados no constituyen prueba inequívoca de identidad.

### Excepciones

Recepción podrá autorizar excepciones justificadas.

Registrar:

- Operador.
- Solicitud.
- Motivo.
- Fecha y hora.
- Acción realizada.

### Controles técnicos

Implementar:

- Limitación de intentos de verificación.
- Limitación de solicitudes repetidas.
- Detección de duplicados.
- Operaciones idempotentes.
- Registro de solicitudes sospechosas.
- Validación transaccional de límites.
- Protección de información privada.

No depender únicamente de la dirección IP.

### Retenciones por aprobación

Una solicitud formalmente admitida y pendiente de aprobación manual **no vence automáticamente**.

Conserva su capacidad comprometida hasta una decisión humana autorizada dentro del intervalo aplicable.

Si el horario de juego ya terminó, la solicitud puede continuar pendiente administrativamente, pero no bloquea fechas futuras fuera de su intervalo.

---

# 8. POLÍTICAS DE CONFIRMACIÓN

Deben ser configurables según canal y tipo de reserva.

### Configuración web inicial

**Hasta dos pistas:**

Confirmación automática cuando:

- Existe correo verificado.
- Hay capacidad disponible.
- El cliente acepta precio y condiciones.
- Se cumplen las políticas.
- No hay anticipo pendiente de acreditación.

**Tres o más pistas:**

Aprobación obligatoria de recepción.

Retener capacidad mientras la solicitud esté pendiente.

### Revalidación comercial

Cuando recepción apruebe:

- Recalcular el precio.
- Si no cambió, continuar según política.
- Si cambió, informar el importe actualizado y exigir aceptación expresa.
- Mantener la capacidad retenida mientras se espera respuesta.
- Si el cliente rechaza, cerrar la solicitud y liberar capacidad.
- No liberar automáticamente por falta de respuesta.

Conservar historial de cotizaciones y aceptación.

---

# 9. TARIFAS Y PROMOCIONES

### Modelo ordinario

Cobrar por pista y tiempo.

El precio no depende de la cantidad exacta de jugadores dentro de la capacidad contratada.

### Franjas tarifarias

Configurar:

- Tarifa general.
- Tarifas por día de la semana.
- Tarifas por franja horaria.
- Excepciones por fecha.

Precedencia inicial:

1. Excepción de fecha específica.
2. Tarifa semanal por franja.
3. Tarifa general.

### Reservas que cruzan franjas

Calcular proporcionalmente el precio correspondiente a cada tramo y sumarlo.

Ejemplo:

Una reserva de 18:30 a 20:30 debe aplicar la tarifa correspondiente entre 18:30 y 19:00 y después la tarifa correspondiente entre 19:00 y 20:30.

Utilizar cálculo monetario exacto y un procedimiento de redondeo consistente, documentado y centralizado.

### Promociones

Permitir inicialmente:

- Descuentos porcentuales.
- Descuentos de importe fijo.
- Condiciones por fecha, canal, duración u otras reglas sencillas.
- Límites y vigencia.

**Nunca acumular descuentos.**

Cuando varias promociones sean elegibles, seleccionar la que produzca el mayor beneficio económico válido.

La promoción puede aplicar solamente sobre tramos elegibles.

Conservar el desglose comercial aceptado.

No modificar retroactivamente precios de reservas confirmadas.

### No implementar en el MVP

- Precios dinámicos autónomos.
- Paquetes complejos.
- Membresías y fidelización.

---

# 10. PAGOS

**El MVP no incluye pasarela de pagos electrónicos.**

Recepción registrará manualmente:

- Efectivo.
- Transferencias verificadas.
- Pagos por terminal externa.
- Anticipos.
- Pagos parciales.
- Saldos pendientes.
- Devoluciones externas.

No ejecutar movimientos bancarios desde el sistema.

Un pago declarado no equivale a uno acreditado.

Registrar operador, fecha, referencia, importe y medio.

Los pagos no deben eliminarse silenciosamente; gestionar correcciones mediante operaciones auditables.

### Anticipos

No obligatorios por defecto.

Configurables por canal y tipo de reserva.

Si un anticipo es obligatorio, su acreditación manual condiciona la confirmación según la política aplicable.

El plazo de pago será configurable.

**No confundir vencimiento de una retención por pago con la aprobación manual sin caducidad.**

Si falta definir una consecuencia financiera o de vencimiento, usar una política segura de revisión manual y registrarla como pendiente de configuración. Nunca inventar penalizaciones.

---

# 11. CANCELACIONES Y MODIFICACIONES

### Cancelaciones

Política inicial:

- Sin penalización si faltan 24 horas o más para comenzar.
- Con menos de 24 horas, aplicar las condiciones aceptadas y la intervención de recepción cuando corresponda.

El importe de penalización tardía es configurable y no está fijado en esta especificación.

No establecer porcentajes arbitrarios.

Separar:

- Cancelación.
- Liberación del inventario.
- Penalización.
- Saldo.
- Devolución.
- Registro del reembolso externo.

Las excepciones financieras especiales requieren administración.

### Modificaciones

Configurables por tipo de cambio.

Cambios simples pueden ser automáticos si respetan las condiciones aplicables.

Cambios de horario, duración, pistas o dinero podrán requerir autorización.

Conservar la reserva original mientras una modificación está pendiente.

Reducir jugadores no cambia automáticamente el precio si se mantiene la capacidad contratada.

Reducir pistas o duración requiere aprobación y recálculo comercial conforme a política.

---

# 12. CHECK-IN, AUSENCIAS Y OPERACIÓN

Permitir registrar:

- Inicio programado.
- Check-in real.
- Inicio efectivo.
- Fin programado.
- Fin efectivo.
- Liberación operacional.

### Llegadas tardías

Tolerancia inicial: **10 minutos**.

Si no llega:

- Generar alerta.
- Mantener el compromiso durante el intervalo correspondiente.
- Esperar resolución manual de recepción.
- No declarar ausencia automáticamente.

Si el cliente llega tarde y recepción no ha declarado ausencia, podrá utilizar el tiempo restante disponible.

No ampliar automáticamente el horario de término.

### Fin anticipado

Permitir a recepción declarar la terminación efectiva.

Después de la preparación correspondiente, el inventario podrá volver a comercializarse si el horario restante permite otra reserva y no existen compromisos que lo impidan.

El término anticipado no implica devolución automática.

### Mantenimiento

Permitir bloquear pistas con motivo, fechas y operador.

No invalidar compromisos confirmados sin gestionar las incidencias correspondientes.

---

# 13. EXTENSIONES

Toda extensión requiere **autorización de recepción**.

Duraciones permitidas configurables, por ejemplo:

- 15 minutos.
- 30 minutos.
- 60 minutos.

Cobro proporcional según tarifas de los tramos adicionales.

Permitir que una parte de un grupo extienda solo algunas pistas, cuando sea físicamente viable y recepción lo autorice.

El sistema debe:

1. Evaluar disponibilidad.
2. Evaluar reorganizaciones permitidas.
3. Calcular precio adicional.
4. Obtener autorización de recepción.
5. Obtener aceptación comercial del cliente.
6. Confirmar de manera consistente.
7. Actualizar término de uso y registros económicos.

Una pista en uso no debe cambiarse automáticamente durante una extensión.

No perjudicar reservas futuras confirmadas.

---

# 14. FALLAS E INCIDENCIAS

Cuando una pista falle:

1. Registrar la incidencia.
2. Bloquear la pista afectada cuando corresponda.
3. Buscar alternativas factibles.
4. Informar a recepción.
5. Permitir una reubicación excepcional supervisada cuando sea posible.
6. No modificar unilateralmente otras reservas.
7. Registrar interrupciones, decisiones y aceptación.
8. Reservar las compensaciones económicas excepcionales a administración.

Distinguir reubicación operacional excepcional de reoptimización automática normal.

---

# 15. AUTOGESTIÓN MEDIANTE ENLACE SEGURO

No exigir cuenta al cliente.

El enlace de seguimiento tendrá vigencia inicial de **24 horas**.

Podrá renovarse mediante correo verificado.

Su expiración no cancela la reserva ni libera inventario.

El cliente podrá consultar:

- Fecha y horario.
- Duración.
- Cantidad de jugadores y pistas contratadas.
- Condiciones de agrupación.
- Estado.
- Precio y condiciones.
- Pagos registrados y saldo cuando corresponda.

La autogestión será configurable según operación.

Cambios simples podrán ejecutarse automáticamente.

Cambios sensibles deberán requerir autorización o nueva verificación de correo.

La referencia de reserva no debe funcionar como credencial suficiente.

Los enlaces tendrán acceso limitado y deberán poder revocarse.

No permitir consultar o modificar reservas ajenas.

---

# 16. ROLES Y PERMISOS

Implementar al menos:

### Cliente

- Buscar disponibilidad.
- Recibir ofertas.
- Verificar correo.
- Crear solicitudes propias.
- Consultar mediante enlace seguro.
- Aceptar cotizaciones.
- Solicitar o ejecutar modificaciones autorizadas.

### Recepción

- Crear reservas manuales.
- Aprobar solicitudes ordinarias.
- Omitir verificación electrónica en teléfono y presencial.
- Autorizar excepciones al número de solicitudes pendientes.
- Registrar pagos.
- Realizar check-in.
- Resolver ausencias.
- Autorizar extensiones.
- Gestionar modificaciones y cancelaciones ordinarias.
- Registrar fallas y bloqueos operacionales.

### Administrador

- Configurar pistas, horarios y preparación.
- Configurar tarifas y promociones.
- Configurar políticas.
- Administrar usuarios y permisos.
- Autorizar excepciones financieras especiales.
- Consultar auditoría completa.

Cada empleado tendrá identidad individual.

Implementar control de acceso real en el servidor, no solamente ocultando botones.

Registrar decisiones sensibles y excepciones.

---

# 17. INTERFAZ PÚBLICA

Crear una experiencia moderna, clara y adaptable a dispositivos móviles.

### Pantalla P1. Búsqueda

Campos:

- Fecha.
- Hora preferida.
- Jugadores.
- Duración.

Buscar sin requerir identificación.

### Pantalla P2. Alternativas

Presentar:

- Horario.
- Duración.
- Número de pistas.
- Condición de agrupación.
- Precio.
- Beneficio promocional cuando exista.

Explicar claramente si un grupo grande deberá jugar separado.

### Pantalla P3. Solicitud

- Nombre.
- Correo.
- Verificación.
- Revalidación.
- Aceptación comercial.
- Resultado de solicitud.

Distinguir claramente:

- Solicitud pendiente.
- Capacidad retenida.
- Aprobación pendiente.
- Precio pendiente de aceptación.
- Reserva confirmada.

Incluir vista de seguimiento seguro.

Evitar mensajes engañosos como «Reserva confirmada» cuando solamente existe una solicitud retenida.

---

# 18. INTERFAZ INTERNA

### P4. Tablero operacional

Mostrar las doce pistas en un calendario temporal.

Distinguir:

- Disponibles.
- Retenidas.
- Reservadas.
- En uso.
- En preparación.
- Bloqueadas.

Permitir navegación por fecha y acceso rápido a cada reserva.

Representar intervalos temporales reales, no exclusivamente celdas de una hora.

### P5. Bandeja de recepción

Incluir:

- Solicitudes pendientes.
- Aprobaciones.
- Cotizaciones por aceptar.
- Alertas de llegada.
- Solicitudes sospechosas.
- Excepciones.
- Incidencias.

### P6. Ficha de reserva

Mostrar y gestionar:

- Datos del responsable.
- Contactos y verificación.
- Canal.
- Horarios.
- Pistas contratadas.
- Asignaciones internas.
- Precio.
- Promociones.
- Pagos.
- Modificaciones.
- Cancelaciones.
- Check-in.
- Extensiones.
- Auditoría.

### P7. Administración

Configurar:

- Inventario.
- Parejas y distribución física.
- Horarios.
- Preparación.
- Cierre.
- Tarifas.
- Promociones.
- Políticas.
- Operadores.
- Permisos.

### P8. Indicadores y auditoría

Registrar:

- Ocupación comercial.
- Utilización efectiva.
- Fragmentación.
- Solicitudes recibidas y confirmadas.
- Capacidad residual.
- Reasignaciones.
- Ingresos.
- Acciones administrativas.

Evitar dashboards ficticios con números simulados presentados como reales.

---

# 19. PERSISTENCIA Y MODELO DE DOMINIO

Diseñar entidades o estructuras equivalentes para:

- Establecimiento.
- Pistas.
- Distribución y adyacencia física.
- Horarios y excepciones.
- Bloqueos operacionales.
- Clientes y medios de contacto.
- Verificaciones de contacto.
- Solicitudes.
- Reservas.
- Asignaciones de pista por intervalo.
- Retenciones.
- Cotizaciones.
- Condiciones comerciales aceptadas.
- Tarifas y franjas.
- Promociones.
- Pagos.
- Movimientos de devolución.
- Modificaciones.
- Cancelaciones.
- Check-in y operación.
- Incidencias.
- Usuarios internos.
- Roles y permisos.
- Auditoría.
- Configuración del motor.

Evitar duplicación innecesaria de datos.

Registrar fechas de creación y modificación.

Utilizar migraciones controladas y datos de demostración reproducibles.

Conservar un historial suficientemente detallado para explicar las transiciones importantes.

---

# 20. SEGURIDAD

Implementar al menos:

- Autenticación segura para empleados.
- Autorización por rol en servidor.
- Validación estricta de entradas.
- Protección contra abuso y solicitudes repetidas.
- Protección de enlaces y códigos de verificación.
- Tokens de acceso no predecibles y revocables.
- Almacenamiento seguro de credenciales y secretos.
- No incluir secretos reales en el repositorio.
- Protección contra exposición de datos de otros clientes.
- Auditoría de operaciones sensibles.
- Transacciones para cambios de inventario.
- Manejo de errores sin filtrar información privada.
- Configuración diferenciada entre desarrollo y producción.

Para correo electrónico:

- Construir una integración configurable.
- Permitir probar el flujo completo durante desarrollo.
- Documentar cómo conectar un servicio real de envío.
- En producción, no considerar un correo verificado sin haber completado una comprobación auténtica.

Los accesos de desarrollo no deben convertirse en puertas traseras productivas.

---

# 21. PRUEBAS OBLIGATORIAS

Crear pruebas unitarias, de integración y recorridos funcionales para los flujos críticos.

### Disponibilidad

- Reserva de una hora en pista libre.
- Reserva de varias horas consecutivas.
- Preparación de 10 minutos.
- Preparación de 5 minutos.
- Hueco intermedio insuficiente.
- Hueco intermedio suficiente.
- Horarios cercanos al cierre.
- Mantenimiento de pistas.
- Reservas en fechas con cambio horario local.

### Agrupaciones

- 6 jugadores.
- 7 jugadores.
- 12 jugadores.
- 13 jugadores.
- 18 jugadores.
- Parejas físicas válidas.
- Parejas físicamente incompatibles.
- Grupos grandes contiguos.
- Grupos grandes separados con aceptación.

### Optimizador

- Comparación entre dos asignaciones factibles.
- Preferencia por mayor capacidad comercializable.
- Espacios huérfanos.
- Reorganización localizada.
- Respeto del bloqueo operacional.
- Preservación de reservas confirmadas.
- Desempate comercial.
- Consistencia ante varias reservas simultáneas.

### Reservas

- Consulta pública sin retención.
- Verificación obligatoria por correo en web.
- Revalidación de disponibilidad tras verificar.
- Confirmación automática de hasta dos pistas.
- Aprobación manual desde tres pistas.
- Solicitud pendiente que retiene capacidad.
- Cotización modificada que requiere nueva aceptación.
- Límite de dos solicitudes pendientes.
- Excepción autorizada de recepción.
- Reintento que no duplica la reserva.
- Confirmaciones concurrentes sobre la última pista disponible.

### Operación

- Reserva telefónica sin correo verificado.
- Reserva presencial inmediata con nombre.
- Reserva presencial futura con contacto.
- Check-in.
- Alerta a los diez minutos.
- Resolución manual de ausencia.
- Extensión de quince o treinta minutos.
- Extensión parcial.
- Rechazo por conflicto con reserva futura.
- Falla de pista y gestión de incidencia.

### Tarifas y pagos

- Precio por pista y tiempo.
- Precio proporcional por franja.
- Reserva que cruza franjas.
- Excepción tarifaria.
- Promociones elegibles.
- Selección del mejor beneficio.
- Prohibición de acumulación.
- Registro manual de pago.
- Pago informado pero no acreditado.
- Cancelación antes de 24 horas.
- Cancelación tardía sin penalización configurada: derivación segura, sin importe inventado.

### Acceso

- Enlace válido.
- Enlace vencido.
- Renovación de enlace.
- Acceso a otra reserva rechazado.
- Usuario de recepción sin privilegios administrativos.
- Acciones auditadas.

Todas las pruebas del motor deben ser deterministas y repetibles.

---

# 22. EXPERIENCIA DE USUARIO Y DISEÑO

Crear una interfaz profesional, clara y coherente.

Prioridades:

- Adaptación móvil del portal público.
- Legibilidad y rapidez de operación en recepción.
- Calendario de doce pistas usable.
- Estados diferenciados visualmente.
- Errores comprensibles.
- Confirmaciones explícitas para operaciones irreversibles.
- Formularios cortos.
- Navegación consistente.
- Accesibilidad razonable.
- Formatos locales de fecha, hora y moneda.

No sacrificar reglas comerciales por simplificar una pantalla.

Evitar componentes decorativos que aparenten funcionalidad sin estar conectados al dominio.

---

# 23. ESTRATEGIA DE IMPLEMENTACIÓN

Trabaja en incrementos funcionales dentro de esta misma ejecución.

### Fase 1. Reconocimiento y arquitectura

- Inspeccionar repositorio.
- Determinar stack existente o seleccionar uno si está vacío.
- Documentar arquitectura.
- Preparar estructura, configuración y entorno de desarrollo.

### Fase 2. Núcleo de dominio

- Inventario.
- Horarios.
- Restricciones temporales.
- Disponibilidad.
- Reservas.
- Retenciones.
- Algoritmo de optimización.
- Persistencia transaccional.

### Fase 3. Operación comercial

- Tarifas.
- Promociones.
- Confirmaciones.
- Modificaciones.
- Cancelaciones.
- Pagos manuales.

### Fase 4. Portal público

- Búsqueda.
- Alternativas.
- Verificación.
- Solicitudes.
- Seguimiento seguro.

### Fase 5. Recepción y administración

- Tablero de pistas.
- Bandeja.
- Ficha de reserva.
- Check-in.
- Extensiones.
- Configuración.
- Permisos.
- Auditoría.

### Fase 6. Verificación integral

- Pruebas.
- Casos límite.
- Concurrencia.
- Seguridad.
- Corrección de errores.
- Documentación de funcionamiento.
- Datos de demostración.

Estas fases organizan el trabajo, pero no constituyen puntos para detenerte y esperar nuevas instrucciones.

Prioriza completar verticalmente flujos utilizables, no únicamente terminar capas aisladas.

---

# 24. ENTREGABLES EXIGIDOS

Al terminar debe existir en el repositorio:

1. Aplicación ejecutable.
2. Backend real.
3. Persistencia funcional.
4. Motor de disponibilidad y optimización.
5. Portal público conectado al backend.
6. Interfaz de recepción operativa.
7. Administración y permisos.
8. Tarifas y promociones funcionales.
9. Registro manual de pagos.
10. Flujos de check-in, ausencias y extensiones.
11. Sistema de verificación por correo configurable.
12. Pruebas automatizadas.
13. Migraciones y datos de ejemplo.
14. README actualizado.
15. Instrucciones para ejecutar y probar localmente.
16. Documentación breve de arquitectura y decisiones.
17. Lista explícita de funciones pendientes o incompletas.

Si no es posible completar algún entregable, no simules su funcionamiento ni lo marques como finalizado.

---

# 25. CRITERIOS DE ÉXITO

La implementación se considerará funcionalmente correcta cuando:

- Ninguna operación permita sobreventa.
- El inventario sea coherente entre todos los canales.
- El motor respete parejas, agrupaciones, preparación y horarios.
- Las reservas confirmadas mantengan sus compromisos.
- La reoptimización no altere reservas protegidas.
- Los clientes web deban verificar correo antes de retener capacidad.
- Las reservas de hasta dos pistas puedan seguir el flujo automático definido.
- Las reservas de tres o más pistas requieran recepción.
- Los límites de solicitudes pendientes funcionen.
- Los precios se calculen correctamente por tramos.
- Las promociones no se acumulen.
- Los pagos manuales conserven trazabilidad.
- Las extensiones requieran autorización.
- El check-in y las ausencias sigan sus políticas.
- El enlace seguro permita consultar solamente reservas autorizadas.
- Las pruebas críticas se ejecuten satisfactoriamente.
- El proyecto pueda instalarse y ejecutarse siguiendo instrucciones reproducibles.

---

# 26. LÍMITES Y DECISIONES ABIERTAS

No inventes reglas comerciales para llenar vacíos de especificación.

Especialmente:

- Porcentaje de penalización por cancelación tardía.
- Tarifas comerciales reales del establecimiento.
- Comisiones e impuestos no especificados.
- Penalizaciones por ausencia.
- Compensaciones por falla de pista.
- Importes mínimos de anticipo.
- Condiciones extraordinarias de devolución.

Implementa estos parámetros como configurables cuando corresponda, con valores seguros que no generen cobros ni penalizaciones no autorizadas.

Documenta los asuntos pendientes.

Puedes seleccionar criterios técnicos internos razonables, explicarlos y acompañarlos de pruebas, siempre que no contradigan decisiones comerciales confirmadas.

**No uses datos de demostración para tomar decisiones reales de cobro.**

---

# 27. INSTRUCCIÓN FINAL

Ejecuta la implementación del MVP directamente en el repositorio.

No te detengas en una propuesta arquitectónica ni me devuelvas simplemente un plan.

Inspecciona, diseña, implementa, prueba, corrige y documenta.

Trabaja de forma autónoma en las decisiones técnicas ordinarias.

No introduzcas cambios destructivos ni despliegues públicos sin autorización.

Prioriza una base funcional real y verificable sobre un producto visualmente completo pero operacionalmente falso.

Al finalizar entrega:

**A. Resumen de arquitectura elegida.**

**B. Funcionalidades realmente implementadas.**

**C. Resultado de pruebas y validaciones.**

**D. Instrucciones exactas para ejecutar el MVP.**

**E. Funcionalidades pendientes o limitaciones conocidas.**

**F. Próximas acciones recomendadas, priorizadas.**

No declares como terminado aquello que no hayas implementado o probado.

**Comienza inspeccionando el repositorio y continúa con el desarrollo.**
