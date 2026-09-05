# E25 — La escala del novato contra la del veterano (preregistro)

**Escrito antes de correr nada.** Medido antes (`rookie_placement_validate.py`,
2019-2025): a igual proyección y posición, el novato realizó **+107,6 puntos**
más que los veteranos de al lado. Las dos escalas no son la misma convención:

    veterano  = puntos por partido × 15,5     (supone que juega la temporada)
    novato    = puntos por partido × E[partidos de su celda]  (ceros incluidos)

## Pregunta

¿Es comparable el número del novato con el VOR del veterano si se le aplica
LA MISMA convención de partidos (× 15,5) en vez de la esperanza de su celda?
No es un multiplicador a ojo: es quitar una diferencia de convención.

## Candidato único

- C1: `projected_points = points_per_game × 15.5` para el novato (la
  `points_per_game` es la previa por capital de draft, sin tocar).

## Métricas fuera de muestra (walk-forward, 2019-2025)

1. Diferencia EMPAREJADA (misma posición, proyección ±10) entre lo realizado
   por el novato y por sus veteranos vecinos — la de siempre.
2. Spearman entre proyección y realizado ENTRE novatos (¿se conserva el
   orden que validó E9?).
3. n de pares emparejados.

## Aceptación, fijada ahora

C1 se adopta si y sólo si:

1. |diferencia emparejada| < 20 puntos (el umbral original), y
2. Spearman entre novatos ≥ Spearman del baseline − 0,02, y
3. n ≥ 100 pares.

Si falla cualquiera: se mantiene la escala actual, el novato sigue
IDENTIFICADO, VISIBLE y DRAFTEABLE, y la limitación se publica como está.
En ningún caso el estado de `ROOKIE_PRIOR` sube por esto: ordenar novatos
entre sí (E9) y colocarlos junto a veteranos son dos preguntas.

## Resultado (mismo día)

C1 resultó IDÉNTICO al baseline: `expected_games` ya vale 15,5 para todo novato. Hipótesis falsada; nada cambia. Detalle en `docs/evidence/rookie_scale_2026-09-05.md`.
