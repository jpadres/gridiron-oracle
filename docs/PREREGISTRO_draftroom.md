# Preregistro — E16: el Draft Room manual es correcto

Escrito **antes** de ejecutar `web/tools/qa-room.mjs`. 30/8/2026.

## Qué se afirma, y qué no

Se afirma **corrección del registro y de la interacción**: que los picks no se
pierden, no se duplican, no rompen el recuento y no se filtran entre ligas, y
que registrar uno es una interacción.

**No** se afirma que las decisiones tomadas con esta pantalla sean mejores. Eso
sería un resultado, y nadie lo ha medido. Por eso `BEST_PICK_FOR_ME` sigue
BLOCKED aunque el Draft Room ya funcione.

## Escenarios, fijados antes de medir

A 390, 768 y 1440:

1. Un toque registra el pick.
2. El jugador desaparece del board disponible.
3. Aparece deshacer.
4. Deshacer devuelve al jugador y renumera lo que venía detrás.
5. Veinte picks seguidos: cuenta veinte, sin duplicados.
6. El estado del draft se actualiza tras cada pick.
7. Recargar conserva el draft.

Y una vez:

8. La liga B empieza vacía con la A empezada.
9. Un jugador cogido en A sigue libre en B.
10. A → B → A recupera los picks de A.
11. Sin puesto de draft se dice UNKNOWN, no se inventa turno.
12. Un pick sin dueño **no entra en la plantilla de nadie**.
13. Y se dice que el roster es desconocido.

## Umbral

**27 de 27.** Cero fugas, cero duplicados, cero picks perdidos. Uno que falle
invalida la capacidad: en un draft en vivo no hay «casi correcto».

Latencia de pick objetivo: **< 150 ms** desde el toque hasta el estado nuevo,
sin ninguna petición de red en medio.
