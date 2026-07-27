# Estándar GPSF — cómo se trabaja en este repo

> Canónico. Generado desde `gachetponzellini/claude-dev-kit`. No editar a mano acá:
> se corrige en el dev-kit y se re-propaga a toda la flota.

## 1. Regla de oro

**El trabajo se ve en GitHub. Si no está en issues y commits, no existe.**

El progreso de cada desarrollo se lee de sus **issues**. No de un Excel, no de un mensaje
de Discord, no de "ya lo hice". Del panel se mira: issues cerradas, abiertas, bloqueadas
y backlog. Eso es el avance real.

## 2. Dónde vive cada cosa

| Qué | Dónde |
|---|---|
| **Issues, milestones, progreso** | **Este repo (el de CÓDIGO)** |
| Contexto, decisiones, reuniones, errores | El repo `-brain` del cliente |
| Tracking / vista de PM | `gpsf-command-center.vercel.app` |

Las issues **no** van en el brain. El brain es memoria; el repo de código es trabajo.

## 3. Nomenclatura de repos

Formato: `<slug>-<tipo>`

- **Guion medio (`-`) separa el TIPO.** Tipos: `-app` (producto/dev), `-brain` (cerebro
  del cliente, uno por cliente), `-mock` (maqueta/demo), `-web` (sitio), `-catalog`,
  `-brief`, `-propuesta`, `-presupuesto`.
- **Guion bajo (`_`) es un espacio dentro del slug.** Ej: `cam_presupuestador-app`
  = proyecto "cam presupuestador", tipo app.
- Todo en minúsculas.

## 4. Issues

Una issue por bloque de trabajo. Con labels canónicos (ver `.github/labels.yml`):

- `status:active` — en progreso
- `status:blocked` — bloqueada (el body explica por qué y quién destraba)
- `status:review` — esperando revisión
- `status:backlog` — identificada pero **todavía no en desarrollo**
- `prio:high|med|low` · `type:bug|feature|research|ops`

Los 4 estados de la barra de progreso salen de acá:
**cerradas** (avance) · **abiertas** (en curso) · **bloqueadas** · **backlog**.

```bash
gh issue create --title "[feature] descripción corta" \
  --label "type:feature,status:active,prio:high" --milestone "Sprint N"
```

## 5. Commits

Commits atómicos: `tipo: descripción` (feat/fix/docs/chore), **siempre referenciando su
issue**:

- `Closes #N` si el commit termina la issue
- `refs #N` si es avance parcial

Cada commit pega en una issue y marca su nivel de progreso. Un commit sin issue asociada
es trabajo invisible.

## 6. Proyectos sin issues previas → backfill

Si este repo tiene commits pero no tiene issues, hay que **reconstruir las issues desde
los commits** antes de seguir: milestones = etapas ya recorridas, issues de lo hecho
creadas y cerradas en su milestone, y el sprint actual abierto.

Procedimiento completo: `BACKFILL-PROYECTOS.md` en `gachetponzellini/claude-dev-kit`.

## 7. Reglas duras

1. **Nunca hablar directo al cliente.** El output va a Pacho o al dev asignado.
2. **Nunca exponer credenciales** en commits, issues o comments. Viven en Bitwarden
   (vault GPSF) y en env vars del VPS.
3. **Nunca borrar** `errors/`, `meetings/` ni `progress/` en los brains — son append-only.
4. **Nunca cambiar los labels canónicos** a mano en la UI. Se editan en
   `.github/labels.yml` y se commitean.

---

## Este repo

- **Cliente:** RestaurantOS (producto)
- **Responsable:** Juan Bonadeo
