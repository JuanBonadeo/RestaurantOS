# Estándar GPSF — cómo se trabaja en este repo

> **La convención completa vive en un solo lugar:**
> **[`gachetponzellini/claude-dev-kit` → `DESARROLLO.md`](https://github.com/gachetponzellini/claude-dev-kit/blob/main/DESARROLLO.md)**
>
> Ese documento es la wiki canónica. Si algo acá lo contradice, gana ese documento.

## Lo mínimo que no se negocia

1. **El trabajo se ve en GitHub.** Si no está en una issue, no existe: no suma progreso,
   no aparece en tu perfil y no cuenta en la velocidad del proyecto.

2. **Las issues, los milestones y las specs viven en el repo `-brain`.** No en los repos
   de código. Una sola cola, una sola secuencia de sprints, una sola secuencia de specs.

3. **Milestones = sprints**: `Sprint NN`, **siempre con due date**.

4. **Dos tipos de ítem:**
   - Spec: título `NN · descripción`, label `sdd`, archivo `specs/NNN-slug/spec.md`
   - Tarea: título `[área] descripción` — área ∈ `dev · bug · setup · ops · research ·
     deploy · design · seguridad` (lista cerrada)

5. **Labels canónicos, únicos:** `sdd` · `status:blocked` · `prio:high|med|low`.
   El estado **se deriva solo** (cerrada = hecha · `status:blocked` = bloqueada ·
   abierta tocada ≤7 días = en curso · >7 días = backlog). **No se declara con labels.**

6. **Commits atómicos** `tipo: descripción`, con `Closes #N` al terminar la issue o
   `refs #N` si es avance parcial.

7. **Cada uno abre sus propias issues.** El panel atribuye el trabajo al **autor** de la
   issue, no al assignee: si la abrís vos, el score es tuyo y el de la otra persona queda
   en cero.

8. **Nunca** credenciales en commits, issues o comments. Viven en Bitwarden (vault GPSF).

## Nomenclatura de repos

`<slug>-<tipo>` — el **guion medio** separa el tipo (`-app`, `-brain`, `-mock`, `-web`,
`-catalog`), el **guion bajo** es un espacio dentro del slug
(`cam_presupuestador-app` = proyecto "cam presupuestador", tipo app).

## Panel

Los PMs y devs trabajan sobre **`gpsf-command-center.vercel.app`** (login con GitHub).
`hermes.gachetponzellini.com/tasks` está **dado de baja** — no usar.

---

## Este repo

- **Cliente:** RestaurantOS (producto)
- **Responsable:** Juan Bonadeo
