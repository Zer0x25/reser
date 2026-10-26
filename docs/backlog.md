# Mejoras de experiencia para precios dinámicos

Seguimiento de mejoras de flujo, interfaz y cobertura identificadas al revisar el panel y el proceso público. Las mejoras iniciales quedaron implementadas en las PR #1–#5; el precio dinámico sigue desactivado por defecto.

## Prioridad alta

- [x] **Aclarar qué configuración simula Administración.** El formulario envía los valores actuales del borrador al endpoint de simulación, pero el resultado dice que usa la configuración guardada. Indicar explícitamente si se evalúan cambios sin guardar.
- [x] **Separar oferta potencial del beneficio realmente aplicado.** Si una promoción supera al descuento dinámico, mostrar el precio potencial dinámico y, por separado, el precio final con el mayor beneficio válido.
- [x] **Mostrar el ahorro al cliente.** En las alternativas y la selección final, desglosar tarifa de catálogo, descuento aplicado (dinámico o promoción) y total, sin presentar como aplicado un descuento potencial.
- [x] **Corregir el contraste del panel dinámico.** Axe detectó texto `#8e7b60` sobre fondo `#fff3e3` con contraste 3.72:1 en el callout de la regla; el texto normal necesita al menos 4.5:1 para WCAG AA.

## Prioridad media

- [x] **Facilitar la recuperación de cotizaciones vencidas.** Después de un vencimiento, ofrecer una acción clara para actualizar horarios y precios, manteniendo fecha, hora, grupo y duración para que el cliente no tenga que rehacer la búsqueda.
- [x] **Ajustar la pestaña de precio dinámico en móvil.** A 390 px, el nombre y el estado «Apagado» quedan cortados en la navegación horizontal; mostrar una etiqueta de estado legible sin perder acceso a las secciones.
- [x] **Estabilizar los iconos de enlace externo.** En Chromium/Linux, `↗` se dibuja como emoji cuadrado azul en varios botones y pasos; usar un glifo o SVG que conserve el aspecto de flecha.
- [x] **Añadir regresión visual del panel dinámico.** Crear capturas móvil y escritorio del panel de Precio dinámico y del resultado del simulador; las capturas actuales de administración cubren la sección de Tarifas y promociones.

## Medición del piloto

- [x] **Resumir resultados de reservas con precio dinámico.** Mostrar reservas registradas, descuentos aplicados, potencial no aplicado y resultados por canal. Los datos describen reservas creadas, no búsquedas ni ingresos incrementales.
- [x] **Medir el recorrido desde cotización hasta reserva.** Contar alternativas web renderizadas, selecciones y solicitudes creadas con la cotización firmada; desglosar por tipo de precio. Guardar solo hash de token, tipo y fechas, sin datos personales, con retención automática de 90 días.
- [x] **Seguir las reservas hasta confirmación y pago.** Enlazar la cotización con una referencia interna a la reserva por hasta 90 días; mostrar confirmaciones, pagos completos actuales y pagos verificados netos de devoluciones.
- [x] **Medir ingreso por pista-hora contratada.** Dividir los pagos verificados netos de reservas confirmadas no canceladas por las horas y pistas contratadas; no presentarlo como ingreso por pista-hora disponible.
- [x] **Calcular ingreso por pista-hora disponible.** Dividir los pagos verificados netos por reservas en el período entre las horas abiertas de pistas activas, descontando mantenciones registradas. El horario configurado actual se usa para períodos históricos y puede hacer la estimación imprecisa si hubo cambios.

## Pendiente de medición

- [ ] **Historial de ocupación y fragmentación.** Medir ocupación y huecos no vendibles con una ventana y una definición operativa acordadas.
