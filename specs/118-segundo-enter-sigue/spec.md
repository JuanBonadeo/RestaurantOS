# 118 · Menú del día: el segundo Enter sigue

**Issue:** [#182](https://github.com/gachetponzellini/RestaurantOS-app/issues/182) ·
**Milestone:** Post-demo · Growth & hardening

## Por qué

En el asistente del menú del día, los grupos de modificadores **obligatorios de
a uno** (`isSingleChoiceGroup`) se cierran solos: elegís y avanza. Los
**opcionales o de varias** no, y con razón — «ninguno» y «dos» son respuestas
válidas, así que el paso lo cierra el usuario con «Seguir» (FR-003 de la spec
083).

El problema era qué hacía el Enter en esos pasos, que es donde la mano ya está
después de elegir: sobre la opción **ya elegida** la desmarcaba. Dos Enter
seguidos y volvías a cero sin enterarte — y en un paso opcional eso pasa
desapercibido, porque no hay nada que te frene.

Reportado por Juan sobre «Estilo de papas» (opcional, hasta 1).

## Qué se construye

En el paso de modificadores, con Enter (o Espacio) sobre una opción:

| Estado | Qué hace |
|---|---|
| La opción **no** está elegida | La elige (como siempre) |
| La opción **ya** está elegida y el grupo cumple su mínimo | **Avanza** — lo mismo que «Seguir» |

Desmarcar sigue disponible con el dígito y con el click, que son gestos
deliberados; el Enter pasa a ser «listo, seguí».

## Qué NO cambia

- Los grupos obligatorios de a uno: ya avanzaban solos al elegir.
- El botón «Seguir» y su `disabled` mientras falten selecciones.
- Los pasos de elección de plato (`kind: "choice"`), que siempre avanzaron al
  elegir.

## Verificación

1. `daily-menu-wizard.test.tsx` — dos tests: el segundo Enter avanza y conserva
   lo elegido; sin nada elegido el Enter sigue eligiendo.
2. En vivo: menú del día con un grupo opcional → Enter, Enter → estás en el paso
   siguiente y la opción quedó marcada.
