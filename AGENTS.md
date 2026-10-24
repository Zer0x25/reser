# Instrucciones del repositorio

## Propósito y fuente de requisitos

Este repositorio implementa **Bowling Smart Booking Engine**, un MVP en español para las reservas y la operación de un salón de bolos de 12 pistas en Chile.

- La especificación inicial completa, conservada sin recortes ni reescritura, está en [docs/product/initial-one-shot-implementation-prompt.md](docs/product/initial-one-shot-implementation-prompt.md). Úsala como fuente de alcance funcional y reglas de negocio.
- El prompt describe el objetivo original; no significa que todas sus funciones ya estén implementadas ni convierte cada tarea futura en una autorización para rehacer el MVP. Comprueba el código, el [README.md](README.md), los ADR y el encargo actual antes de cambiar algo.
- El README describe el estado conocido y las limitaciones actuales. Si el código no cumple una regla de la especificación, no afirmes que está resuelta: corrígela cuando corresponda al encargo o registra el pendiente con claridad.
- Las decisiones arquitectónicas aceptadas están en [docs/decisions](docs/decisions/). No reemplaces reglas comerciales confirmadas por una preferencia técnica.

## Invariantes del producto

- Comparte un único inventario entre web, teléfono y atención presencial. Las 12 pistas tienen capacidad máxima de 6 jugadores cada una. Modela la distribución física explícitamente: la numeración consecutiva por sí sola no demuestra proximidad.
- Respeta horarios, excepciones, preparación configurable (10 minutos iniciales), mantenimiento, bloqueos y compromisos existentes. Acepta inicios a los minutos permitidos por la operación; no fuerces todas las reservas a horas redondas.
- El planificador debe preservar capacidad comercializable futura y considerar agrupaciones físicas. No reemplaces su criterio por “primera pista libre”, no cuentes como independientes alternativas que se solapan y no declares optimalidad global si el algoritmo no la demuestra.
- Presenta alternativas; el cliente debe elegir y aceptar el horario, precio y condiciones. No cambies una reserva confirmada unilateralmente.
- Mantén separados el estado comercial, el compromiso de inventario y el estado financiero. Las operaciones que comprometen pistas deben ser transaccionales, idempotentes y seguras ante concurrencia; registra las transiciones sensibles en auditoría.
- Para reservas web, la verificación de correo precede al compromiso de capacidad; verificar el correo no retiene pistas. Los canales manuales pueden seguir sus reglas de contacto y omisión de verificación, pero deben registrar al operador y no marcar contactos como verificados sin prueba.
- No hay pasarela de pago. Un pago informado no equivale a uno acreditado; los pagos y devoluciones son registros manuales auditables de operaciones externas. No inventes tarifas reales, impuestos, penalizaciones, anticipos ni compensaciones que el negocio no haya definido.
- En producción, no habilites cuentas, horarios ni tarifas de demostración. No uses credenciales demo como accesos reales, no guardes secretos en Git y no presentes el adaptador local de correo como entrega productiva.
- La autenticación y autorización se aplican en el servidor. Ocultar botones en la interfaz no sustituye controles de acceso.

## Límites de arquitectura

- Conserva la separación existente: lógica de dominio en `apps/website/server/domain.mjs`, persistencia y creación de datos en `apps/website/server/db.mjs`, API en `apps/website/server/index.mjs`, migraciones en `apps/website/server/migrations/` e interfaz web en `apps/website/src/main.ts`.
- Mantén las reglas de planificación, tarifas y disponibilidad comprobables sin depender de la interfaz. No dupliques reglas comerciales en el navegador.
- El MVP usa SQLite para una sede y un proceso API. Revisa ADR 0001 antes de introducir varios procesos, trabajadores de correo distribuidos o una base de datos externa.
- En desarrollo, el proxy `/api` de Vite debe conservar el `Host` de la interfaz (`changeOrigin: false`), porque la API valida el encabezado `Origin` para solicitudes de escritura. No cambies este ajuste sin verificar el inicio de sesión y los demás flujos de escritura desde el navegador.
- La configuración productiva debe permanecer cerrada y explícita. Los secretos requeridos, la base persistente, la URL pública y el adaptador de correo se describen en `.env.example` y en el README.

## Cambios, ADR y documentación

- Antes de editar, inspecciona el estado de Git y los archivos afectados. Preserva cambios locales y trabajo no relacionado.
- En encargos de implementación, avanza más allá del plan hasta dejar un cambio funcional y revisable. Toma decisiones técnicas reversibles con criterio; no despliegues, publiques ni hagas cambios destructivos sin autorización explícita.
- No añadas controles visuales que no estén conectados al flujo real ni mensajes que confundan solicitud, retención, aprobación y reserva confirmada.
- Registra un ADR cuando una decisión técnica o de producto tenga impacto transversal, alternativas razonables y consecuencias duraderas. Usa contexto, decisión, consecuencias y alternativas descartadas; enlázalo desde AGENTS o README cuando sea una regla que afecte cambios futuros.
- Mantén README y documentación alineados con el comportamiento real. Separa lo implementado, lo configurable, lo pendiente y lo que solo existe en modo demo.
- No elimines datos, migraciones, configuración ni comportamiento existente sin analizar dependencias y compatibilidad.

## Comandos del proyecto

Revisa `package.json` y `vite.config.ts` antes de ejecutar un comando: `vp <comando>` puede ser una función integrada, mientras que `vp run <nombre>` ejecuta un script del proyecto.

- `vp run dev` desde la raíz ejecuta el script del proyecto y levanta la API junto con la interfaz web.
- `vp run ready` desde la raíz ejecuta la revisión Vite+, las pruebas de los paquetes y la compilación, según el script actual.
- Para una tarea específica de un paquete, usa los scripts definidos en su `package.json` y ejecútalos mediante `vp run` desde la ubicación correspondiente.
- Usa `vp install` después de cambios remotos o de dependencias, siguiendo la versión de Node y el gestor declarados por el proyecto.

## Vite+

<!--VITE PLUS START-->

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

### Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

### Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+ release. Add a tool name to select part of the graph. For example, run `vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use `vp why <package>` to show the package-manager dependency graph.

### Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and the relevant `vp run` test/build scripts when validation is requested for a code change.
- [ ] Check whether `vite.config.ts` defines tasks or `package.json` defines scripts that must be run with `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
