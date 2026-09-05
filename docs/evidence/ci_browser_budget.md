# Presupuesto del job de navegador — medido el 2026-09-05

Contenedor de desarrollo, `next start` ya construido, Chromium local:

| Laboratorio | Comprobaciones | Tiempo |
|---|---|---|
| headshot-shots | 63 | 12 s |
| smoke | 42 | 12 s |
| apuestas | 21 | 4 s |
| movil | 168 | 26 s |
| controles | 16 | 350 s |
| **total** | 310 | **6 min 44 s** |

En un runner de GitHub hay que sumar `npm ci`, `playwright install
--with-deps chromium` y `next build` (~3-4 min) y contar con que el runner es
más lento. El `timeout-minutes: 25` del job cubre el doble de lo medido. Si
`controles` se acerca al límite, pasa al nocturno antes que relajar nada.

La primera pasada del runner salió ROJA por su propia guarda: `controles`
agrega muchos controles en 16 líneas de veredicto y el mínimo estaba puesto
en 30. El mínimo de cada laboratorio es ahora la MITAD de lo medido aquí.
