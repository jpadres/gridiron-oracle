# E25 — la escala del novato: resultado NEGATIVO (5 de septiembre de 2026)

Preregistro: `docs/PREREGISTRO_novato_escala.md`. Candidato único C1:
aplicar al novato la convención de partidos del veterano (× 15,5) en vez de la
esperanza de su celda.

**Resultado: C1 es IDÉNTICO al baseline.** `rookie_rows` ya proyecta al
novato con `expected_games = 15,5` (mínimo, media y máximo: 15,5 en los 237
novatos de 2025; `games_source = rookie_prior`). La hipótesis «las dos escalas
difieren por la convención de partidos» queda FALSADA: la convención es la
misma. La diferencia emparejada sigue en **+108,9 puntos** (123 pares,
2019-2025; Spearman entre novatos 0,656; MAE 22,6).

| | pares | dif. emparejada | Spearman | MAE | ACEPTA |
|---|---|---|---|---|---|
| baseline | 123 | +108,9 | 0,656 | 22,6 | — |
| C1 (× 15,5) | 123 | +108,9 | 0,656 | 22,6 | no (idéntico) |

Lo que queda por explicar es otra cosa: a igual proyección, el novato que
entra en el board REALIZA mucho más que el veterano vecino. Las hipótesis que
no se han probado, y que un preregistro futuro tendría que separar: (a) el
encogimiento de la previa hacia la media de la celda comprime a los novatos
buenos; (b) selección — sólo los novatos con rol real llegan al top del board,
y los veteranos vecinos son suplentes con proyección similar pero techo bajo;
(c) el rol del novato se conoce en agosto y la previa por capital de draft no
lo usa.

Sin escala defendible: **el novato sigue IDENTIFICADO, VISIBLE y DRAFTEABLE
con la previa de E9 (VALIDATED para ordenar novatos entre sí), y el sesgo se
publica sin corregir.** Nada cambia en el registro.
