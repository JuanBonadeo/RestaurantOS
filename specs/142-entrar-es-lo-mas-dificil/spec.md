# 142 · Entrar es lo más difícil del sistema

**Issue:** [#214](https://github.com/gachetponzellini/RestaurantOS-app/issues/214) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** **spec**

**Input:** Juan, 2026-09-02: *"estaría bueno que se puedan loguear poniendo el pin,
además del mail, o sea que sea el pin o el mail, y que cuando entren los va a llevar
a la parte de ayuda, para que aprendan a usar el sistema, tiene que ser fácil para
ellos loguearse"*. Y antes: *"podríamos hacer algún sistema con esto de los magic
links, para que cada usuario cree su contraseña, que te genere un mensaje para copiar
y mandar"*.

**Depende de**: [`140`](../140-los-mozos-en-la-compu-del-salon/spec.md) (el rol
`terminal`, que es quien más va a usar esta pantalla),
[`134`](../134-guia-del-encargado/spec.md) (la guía),
[`11`](../../../../wiki/specs/11-fichaje/spec.md) (el PIN y `clock_allowed_origins`).

---

## Por qué

El paso más difícil del sistema es el primero. Un mozo de golf-jcr entra con:

```
email:       nombre.apellido@golf-jcr.internal
contraseña:  golfjcr<su PIN>
```

Treinta caracteres de un email que no existe como casilla, tipeados en la pantalla
del local. Nadie va a recordar eso, y el resultado previsible es una contraseña
anotada en un papel al lado de la compu — o que no entren.

Al mismo tiempo, esa gente **ya sabe de memoria un identificador**: su PIN de 4
dígitos, que usa todos los días para fichar.

## Decisiones

### D1 · El PIN reemplaza al email, no a la contraseña

Sigue siendo *identificador + secreto*. Lo que cambia es el identificador: en vez de
un email sintético de 30 caracteres, 4 dígitos que ya se saben. **La seguridad no
baja**: la contraseña sigue siendo lo que autentica.

Esto es lo que hace viable la idea. Un login de PIN **solo** sería otra cosa: 4
dígitos son 10.000 combinaciones, golf-jcr tiene 38 PINs activos (1 de cada 263
números es válido), `clockPunch` no tiene rate limiting y `clock_allowed_origins`
está vacío en los tres negocios. Eso no se hace.

El PIN es único por negocio (`business_users_pin_unique_idx`, parcial sobre
`disabled_at is null`) y el login ya está scopeado por slug, así que
`(business_id, pin)` resuelve a una persona sin ambigüedad.

### D2 · Un solo mensaje de error

«PIN o contraseña incorrectos», idéntico para los tres casos: el PIN no existe, el
PIN existe pero la contraseña no, el email no existe. Si el mensaje difiere, el login
se convierte en un oráculo para enumerar los PINs válidos del negocio — que después
sirven para fichar por otro.

Por la misma razón, la resolución PIN → email se hace con service role y **sin
filtrar** por si encontró o no antes de intentar el `signInWithPassword`.

### D3 · Rate limiting

Hoy `clockPunch` no tiene ninguno y este endpoint queda igual de expuesto. Va por IP,
sobre el mismo mecanismo, y es lo que hace que 10.000 combinaciones no se puedan
recorrer aunque el atacante tenga la contraseña de nadie.

### D4 · Al crear la contraseña, la guía

`/admin/bienvenida` hoy manda al panel. Pasa a mandar a `/admin/ayuda`: la persona
acaba de entrar por primera vez y lo que necesita no es el panel vacío, sino saber
qué hacer con él.

**Sólo la primera vez** — es el final del flujo de bienvenida, no un redirect
permanente al loguearse. Un «te llevo a la ayuda» en cada login sería una molestia
diaria para quien ya sabe usarlo.

Requiere abrir la sección `ayuda` para `mozo` y `terminal`, hoy en `none`.

⚠️ **La guía es del encargado.** El contenido de la 134 está escrito para él: sus
topes, sus carteles, su turno. Mandarle eso a un mozo confunde. Esta spec **abre la
puerta y rutea**; escribir la guía del mozo es contenido nuevo y va aparte. El
mecanismo para filtrar por audiencia ya existe en `contenido.ts` (`soloModo` hace lo
mismo para el modo de reservas).

### D5 · El link de acceso, desde la fila del miembro

El flujo completo —magic link → `/bienvenida` → la persona elige su contraseña, con
botón de copiar y de compartir por WhatsApp— **ya está construido** en
`inviteBusinessMemberByAdmin`. Lo único que falta es poder dispararlo para alguien
**que ya está dado de alta**: hoy el único camino es el formulario de alta, y
`user-row.tsx` no tiene nada.

Sin eso no hay forma razonable de rotar las contraseñas de arranque de los 38 de
golf-jcr y los 48 de kcc, que son débiles a propósito (`golfjcr<PIN>`) y están
anotadas como deuda en el wiki de accesos.

El mensaje que se copia se unifica en un helper puro y suma lo que hoy le falta: el
nombre del negocio (el modo contraseña ya lo usa; el modo link dice «el panel de
Pedidos»), con qué identificador entra, y que el link vence en ~1 h.

## Alcance

1. `signIn`: identificador = email **o** PIN; resolución, error uniforme (D1, D2).
2. Rate limiting por IP en el login (D3).
3. La pantalla de login: un solo campo, «Email o PIN».
4. `/bienvenida` → `/admin/ayuda`; `ayuda` abierta a `mozo` y `terminal` (D4).
5. `user-row.tsx`: «Generar link de acceso» + server action (D5).
6. Helper del mensaje, compartido por los dos modos del alta y por lo nuevo (D5).

## No-objetivos

- **Login con PIN solo, sin contraseña.** D1.
- **La guía del mozo.** Spec aparte; acá sólo se abre la sección y se rutea.
- **Reenvío masivo a todo el equipo.** Se evaluó y quedó afuera: los links caducan en
  ~1 h, así que 38 generados de una llegan vencidos a la mayoría. De a uno, cuando se
  le va a avisar a la persona.
- **Tocar `clock_allowed_origins`.** Está vacío en los tres negocios y sería bueno
  poblarlo, pero es su propia decisión (spec 11) y no bloquea esto.

## Verificación

Con el rol real, sobre `demo`.

1. Un mozo entra con su PIN + contraseña y llega a su pantalla.
2. El mismo mozo entra con su email + contraseña: sigue funcionando.
3. PIN inexistente y PIN con contraseña mala dan **el mismo** mensaje.
4. Un PIN de otro negocio no entra a este.
5. Repetir intentos fallidos corta por rate limit.
6. Una cuenta nueva que abre su link de bienvenida elige contraseña y **cae en Ayuda**.
7. Desde Equipo, «Generar link de acceso» sobre un miembro existente da un link que
   abre la bienvenida, y el mensaje copiado nombra al negocio y dice cómo entra.
