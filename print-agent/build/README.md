# Build & deploy del print-agent (dev-side)

Tooling para compilar el `.exe`, armar el ZIP instalador (spec 046 fase 2) y
publicarlo en Supabase Storage. **No** se empaqueta con el producto ni corre en
Vercel — es del lado del dev.

Los artefactos (`*.exe`, `*.zip`, `*.backup`, `dist/`) y `node_modules/` están
**gitignoreados**: son binarios/generados, no fuente. Acá viven solo los scripts.

## Requisitos
- Node ≥ 20 para los scripts de deploy.
- `SUPABASE_SERVICE_ROLE_KEY` del proyecto en el env (jamás commitearla).
- `npm i` (o `pnpm i`) en esta carpeta → trae `@supabase/supabase-js`.

## 1) Compilar el .exe

```bash
./build-exe.sh          # → dist/print-agent.exe (target node22-win-x64)
```

⚠️ **`--public --public-packages "*"` es obligatorio** (ya está en el script):
embebe el **código fuente** en vez de bytecode V8. Sin eso, un build
cross-platform (ej. desde macOS) mete bytecode del host que el V8 de Windows
**rechaza al arrancar** (`[pkg] V8 rejected the bytecode cache`) — el agente
crashea en loop. Lo ideal es buildear en Windows; si cross-compilás, `--public`
es innegociable.

⚠️ **Un `.exe` de Windows no se puede ejecutar/verificar desde macOS.** Probalo
en una PC Windows real (`print-agent.exe` a mano, con un `config.json` al lado,
debe imprimir el banner y consultar) **antes** de publicarlo.

## 2) Armar el ZIP instalador

```bash
../installer/armar-zip.sh dist/print-agent.exe print-agent.zip
```

Junta el `.exe` con
`../installer/{instalar.bat,iniciar-agente.bat,registrar-tarea.ps1,LEEME.txt}`
(convertidos a CRLF). El `config.json` **no** va adentro: lo baja la card por
negocio y el usuario lo deja en la carpeta antes de correr `instalar.bat`.

### Atajo: cambios que sólo tocan el instalador

Si no cambió `agent.mjs`, **no recompiles el exe**: bajá el ZIP publicado y
reempaquetalo con los scripts del repo.

```bash
../installer/reempaquetar-zip.sh print-agent-actual.zip print-agent.zip
```

Evita el build cross-platform, que es el que mete el bytecode que el V8 de
Windows rechaza (ver el aviso de arriba). Si el agente no cambió, tampoco hay
nada que probar del lado del `.exe`.

## 3) Publicar en el bucket

```bash
SUPABASE_SERVICE_ROLE_KEY=… node deploy-zip.mjs print-agent.zip
```

Respalda el objeto actual (`print-agent.zip.backup`) y sube el nuevo. La card
(`getPrintAgentInstaller`, `src/lib/print-agent/credentials-actions.ts`) sirve
`print-agent-releases/print-agent.zip` por signed URL.

## Utilidades
- `node delete-object.mjs <objeto>` — borra un objeto del bucket (limpiar viejos).

## Flujo completo (resumen)
```bash
npm i
./build-exe.sh
../installer/armar-zip.sh dist/print-agent.exe print-agent.zip
# → probar dist/print-agent.exe en Windows real
SUPABASE_SERVICE_ROLE_KEY=… node deploy-zip.mjs print-agent.zip
```
