# ADR 0005: Portales separados para recepción y administración

**Estado:** aceptado para el MVP  
**Fecha:** 2026-10-24

## Contexto

La página pública de reservas compartía la navegación con la recepción y exponía un enlace de acceso al equipo. La administración se encontraba detrás de una pestaña dentro del mismo portal. Aunque la API ya comprobaba las sesiones y los roles, mezclar estas entradas confundía los recorridos de clientes y operadores.

## Decisión

- La página pública (`/`) no incluye enlaces, botones ni controles que abran recepción o administración.
- Recepción accede mediante la ruta directa `/recepcion` y una cuenta individual autenticada.
- Administración accede mediante `/admin`; la pantalla exige el rol `admin`.
- La API conserva la autoridad para autorizar. Las rutas administrativas existentes comprueban el rol en servidor; ocultar una ruta o conocer su URL no otorga permisos.
- Los portales usan la misma aplicación, sesión, API e inventario. Se separan los puntos de entrada y la experiencia, no la fuente de datos ni las reglas de negocio.

## Consecuencias

- Un cliente no encuentra el acceso interno navegando la página de reservas.
- El personal puede guardar una URL directa y autenticarse con sus propias credenciales.
- Una persona de recepción que abra `/admin` no puede ver configuración ni datos administrativos; la API conserva además las comprobaciones de rol.
- Los smoke y E2E comprueban la ausencia de enlaces públicos, las rutas directas, la entrada de administración y el rechazo de cuentas sin rol administrativo.
- Si el frontend se monta bajo un prefijo como `/bowling/`, los accesos internos deben conservar ese prefijo (`/bowling/recepcion` y `/bowling/admin`).

## Alternativas consideradas

- **Mantener el selector de portal en el público:** descartado porque mezcla recorridos de cliente y personal.
- **Confiar en una ruta secreta como autorización:** descartado; una URL no sustituye autenticación ni autorización del servidor.
- **Crear una segunda API o una segunda base de datos para administración:** descartado para el MVP; recepción y administración operan sobre el mismo inventario y los mismos casos de uso con permisos distintos.

## Referencias

- [Diseño del sistema](../design/system-design.md).
- [ADR 0002: límites de reservas, demo y confianza](0002-reservation-and-demo-boundaries.md).
- [Estrategia de pruebas](../testing/strategy.md).
