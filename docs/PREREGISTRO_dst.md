# Preregistro — ¿se puede proyectar una defensa (DST) con los datos que hay?

**Escrito antes de medir.** 5 de septiembre de 2026.

## Lo que se afirma hoy

`DST_STREAMING` está en `DESIGN_ONLY`: la pantalla semanal enseña HECHOS
—total implícito del rival, puntos permitidos, capturas y balones recientes— y
ningún ranking. La evidencia exploratoria dice que el total implícito del rival
correlaciona con los puntos permitidos a r 0,388, y que las pérdidas forzadas
NO son estables (r 0,044 año contra año).

## Qué se mide

Puntos de fantasy de defensa por jornada, con una puntuación estándar parcial
que SÓLO usa lo que `team_games` tiene:

    captura            +1        (`def_sacks_taken`)
    intercepción       +2        (`def_interceptions`)
    balón recuperado   +2        (`def_fumbles_lost` del rival)
    puntos permitidos  +10 / +7 / +4 / +1 / 0 / −1 / −4
                       para 0 / 1–6 / 7–13 / 14–20 / 21–27 / 28–34 / 35+

**No están** los touchdowns defensivos/especiales, los safeties ni los
despejes bloqueados: no hay columna. La puntuación es PARCIAL y se dice así.
Un modelo que gane aquí no gana en la puntuación completa hasta que se mida.

## Candidatos

- **Modelo:** regresión lineal walk-forward de los puntos de DST sobre
  `opponent_implied` (del backtest de partidos, que no ha visto la jornada) y
  las medias de las últimas 6 jornadas de capturas y balones. Se ajusta con
  temporadas < S para predecir S.
- **Baseline A:** media de liga de la temporada anterior.
- **Baseline B:** media ponderada de las últimas 6 jornadas de esa defensa
  (0,85 de decaimiento), estrictamente anteriores.
- **Baseline C:** sólo el total implícito del rival, sin más (una regresión
  de una variable): si el modelo no bate a esto, la forma reciente no aporta.

## Métrica y umbral, fijados antes de ver nada

- MAE de puntos por jornada, y Spearman DENTRO de cada jornada (que es lo que
  decide a quién alineas).
- Temporadas de evaluación: 2018–2025 (ocho), cada una con modelo ajustado
  sólo con las anteriores.
- **Umbral para pasar a EXPERIMENTAL:** el modelo bate a los TRES baselines en
  MAE y en Spearman en al menos 6 de las 8 temporadas.
- **Umbral para SUPPORTED:** además, Spearman medio dentro de jornada ≥ 0,20.
- **Umbral de alarma:** Spearman > 0,45 — con lo poco que predice una defensa,
  eso es señal de fuga (la respuesta metida en la pregunta), no de acierto.

Si no se cumple, `DST_STREAMING` se queda en DESIGN_ONLY y el resultado se
publica igual.
