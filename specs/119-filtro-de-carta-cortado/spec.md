# 119 · El menú del filtro de carta se corta

**Issue:** [#183](https://github.com/gachetponzellini/RestaurantOS-app/issues/183) ·
**Milestone:** Post-demo · Growth & hardening

## Por qué

El desplegable de «Toda la carta» (`CartaOnlineSelector`, en el header del panel
de carga) mostraba las descripciones cortadas al medio: «Solo lo que el cliente
ve y pued…».

El menú era `absolute left-0` con ancho libre — `min-w-56` es un **mínimo**, no
un ancho. Las descripciones son largas, así que en vez de envolver estiraban el
menú hacia la derecha. Y el selector vive pegado al borde **derecho** del header
(spec 111, fase 5), dentro de un panel `overflow-hidden`: todo lo que se pasaba
quedaba recortado.

## Qué se construye

`right-0` en vez de `left-0` —el menú se ancla al borde derecho del botón y abre
hacia adentro del panel— y ancho fijo `w-64`, con lo cual las descripciones
envuelven y se leen enteras.

## Verificación

Abrir el selector en el panel del salón, con el panel angosto y ancho: el menú
queda dentro y las tres descripciones se leen completas.
