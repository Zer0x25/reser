# ADR 0003: Pruebas por capa y aislamiento de datos

**Estado:** aceptado
**Fecha:** 2026-10-24

## Contexto

El MVP contiene reglas sensibles de disponibilidad, tarifas, autorización e inventario concurrente. Antes de este cambio, el dominio y la API tenían pruebas con `node:test`, pero no había cobertura específica de la lógica interactiva del calendario ni pruebas que usaran navegador. Los cambios de UX podían compilar correctamente y seguir fallando en teclado, navegación o integración HTTP.

## Decisión

- Mantener `node:test` para dominio y API; las pruebas API levantan el proceso real con SQLite temporal.
- Usar Vite+ Test/Vitest para cálculos puros de presentación como rangos y zoom del calendario.
- Usar Playwright/Chromium para flujos E2E críticos: verificación de correo local, solicitud/aprobación/seguimiento, reserva presencial/check-in, interacción por teclado y calendario a 390 px.
- Ejecutar axe en las pantallas pública y de tablero para WCAG 2.0/2.1/2.2 A y AA; comprobar que la página no desborde a 768 px y 1024 px.
- Ejecutar revisión, tipos, pruebas por unidad/integración y build con `ready`; ejecutar E2E en el workflow de calidad de cada push y pull request.
- Aislar todas las pruebas con fechas fijas o SQLite temporal. No llamar servicios de correo o pago reales.
- Añadir un caso de regresión cuando se corrige un defecto. Medir cobertura antes de establecer umbrales, priorizando reglas comerciales críticas.
- Extraer lógica pura de UX de `main.ts` a módulos pequeños comprobables. Separar componentes de vista de forma gradual, evitando duplicar las reglas del dominio en el cliente.

## Consecuencias

- Hay un navegador real en CI, lo que detecta errores de interacción y carga que una compilación no encuentra; el workflow tarda más y requiere instalar Chromium.
- Las pruebas API siguen siendo independientes de browser y preservan cobertura directa de reglas transaccionales.
- La base temporal evita contaminar los datos manuales de demo y facilita repetir ejecuciones.
- `main.ts` no se divide completamente en esta decisión; nuevas extracciones deben responder a un límite funcional probado.
- El smoke de URL desplegada queda pendiente hasta disponer de una vista previa configurada.
- Los mensajes de prueba se guardan en un sumidero HTTP de loopback; el E2E no usa proveedores de correo ni pagos.
- axe reveló contraste insuficiente en la paleta inicial; se ajustaron colores secundarios para conservar la identidad OX y cumplir las comprobaciones de contraste de esas dos pantallas.

## Alternativas consideradas

- **Usar solo pruebas unitarias:** rápido, pero no cubre HTTP real ni navegación de la interfaz.
- **Hacer todas las pruebas con navegador:** lento y frágil para reglas de precio, DST y concurrencia.
- **Reescribir la interfaz antes de probarla:** aumenta riesgo de cambiar comportamiento comercial y eleva el costo del MVP.
- **Fijar 80% de cobertura global desde el inicio:** incentiva cobertura superficial antes de conocer la línea base y las ramas de mayor riesgo.

## Referencias

- [Diseño del sistema](../design/system-design.md).
- [Estrategia de pruebas](../testing/strategy.md).
- [ADR 0001: stack y límites arquitectónicos](0001-mvp-stack.md).
