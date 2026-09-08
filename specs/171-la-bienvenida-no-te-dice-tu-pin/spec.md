# 171 · La bienvenida no te dice tu PIN

**Issue:** [#265](https://github.com/gachetponzellini/RestaurantOS-app/issues/265) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ implementada y verificada en vivo (2026-09-08)

**Input:** Juan, 2026-09-08: *"habría que revisar el tema de los magic links,
debería de decirte el pin en la pantalla de ingreso no? y el mail"*.

**Depende de**: [`142`](../142-entrar-es-lo-mas-dificil/spec.md) (el PIN como
identificador de login, el magic link desde la fila del miembro y
`buildAccessMessage`), [`11`](../../../../wiki/specs/11-fichaje/spec.md) (el PIN).

---

## Por qué

La 142 se escribió para que un mozo no tenga que tipear
`nombre.apellido@golf-jcr.internal` en la compu del salón, y resolvió bien las dos
puntas del flujo:

- **El login** acepta PIN o email (`parseIdentificador`).
- **El mensaje** que el encargado copia y manda ya nombra el PIN primero:
  *«De ahí en más entrás con tu PIN 1234 (o tu email, …) y esa contraseña»*
  ([`access-message.ts`](../../src/lib/admin/access-message.ts)).

Falta **el medio**: `/admin/bienvenida`, la pantalla a la que el magic link lleva
a la persona, donde elige su contraseña. Ahí, y sólo ahí, la tenemos con toda la
atención puesta en *«cómo entro mañana»* — y le decimos el identificador difícil,
dos veces, sin mencionar el fácil:

> Usamos `nombre.apellido@golf-jcr.internal` como tu email de login.

> A partir de ahora entrás desde `/golf-jcr/admin/login` **con este email** y la
> contraseña que elijas.

El mensaje de WhatsApp se pierde entre otros veinte y nadie vuelve a buscarlo. La
pantalla es la que se lee, y es la que está mintiendo por omisión.

## Decisiones

### D1 · El PIN primero, el mail atrás — pero los dos

Los dos identificadores entran, así que los dos se dicen. El orden no es cosmético:
el PIN son 4 dígitos que ya usa todos los días para fichar, y es lo único de todo
esto que se va a acordar sin mirar un papel. El email es el que sirve cuando el PIN
se le fue de la cabeza, o cuando no tiene PIN.

**Sin PIN cargado, la pantalla queda como hoy** (dueño, admin, cualquiera dado de
alta sin PIN): un solo identificador, el email, sin un hueco vacío ni un «—».

El texto de cierre pasa a decir lo mismo que el mensaje que la persona recibió por
WhatsApp. Un solo relato: el que le mandaron y el que lee en pantalla no pueden
enseñarle a entrar de dos maneras distintas.

### D2 · El PIN se muestra, no se elige

La bienvenida **no** deja cambiarlo. El PIN lo asigna el encargado y es el mismo con
el que se ficha: es único por negocio (`business_users_pin_unique_idx`) y su
colisión ya está manejada en el alta. Dejarlo editar acá abriría esa puerta en la
única pantalla del sistema donde la persona todavía no tiene rol ni supervisión.

### D3 · El link vencido termina en el login, con el motivo

El link dura ~1 h y la 142 ya lo avisa en el mensaje, pero el que igual lo abre
tarde hoy queda mudo: `/auth/confirm` redirige a `next` con `?error=<texto crudo de
Supabase>`, y `next` es `/admin/bienvenida` o `/admin` — páginas cerradas que sin
sesión rebotan a `/admin/login` **y se comen el parámetro**. Pantalla de login
pelada, cero explicación, y una persona que concluye que el sistema no anda.

Cuando el `verifyOtp` falla, el redirect va **directo al login del negocio**, con el
slug sacado del propio `next`, y con un motivo. Un solo lugar tocado en vez de
abrirle un parámetro nuevo al gate de `context.ts`.

### D4 · El motivo viaja como código, no como texto

Lo que se pinta lo elige el server. Si el mensaje viajara en la query, cualquiera
podría mandar un link a `/golf-jcr/admin/login?error=Llamá%20al%2011-5555` y el
sistema se lo firmaría con su propia cartelería. Va un código (`link_vencido`), el
login lo mapea a su texto, y **lo que no reconoce no lo pinta**.

De paso deja de filtrarse el `error.message` de Supabase, que es inglés y jerga
(*«Email link is invalid or has expired»*) para alguien que está tratando de entrar
a trabajar.

Vencido e inválido dicen lo mismo, como en el D2 de la 142: no hace falta que la
pantalla ayude a distinguir un token caducado de uno inventado.

## Alcance

1. `bienvenida/page.tsx` trae el `pin` del miembro (ya hace la query por el rol) y
   se lo pasa a `WelcomeForm`.
2. `WelcomeForm`: el PIN adelante, el mail atrás, y el cierre alineado con
   `buildAccessMessage`.
3. `auth/confirm/route.ts`: el fallo de `verifyOtp` cae en el login del negocio con
   `?reason=link_vencido`; helper puro para derivar a dónde.
4. `admin/login/page.tsx`: pinta el motivo, con la misma forma del cartel de cuenta
   deshabilitada que ya existe.

## No-objetivos

- **Login con PIN solo, sin contraseña.** No-objetivo de la 142 y sigue siéndolo.
- **Reenvío masivo de links.** Caducan en 1 h; de a uno, cuando se le avisa a la
  persona.
- **Mandar el link por email o WhatsApp desde el sistema.** Hoy se copia y se manda
  a mano, y eso no cambia acá.
- **Tocar el gate de `context.ts`.** El D3 se resuelve antes de llegar ahí.
