# Preregistro — índice de riesgo por jugador

Umbrales fijados **antes** de ejecutar nada, según la regla dura nº3 del
proyecto. Si una de las dos señales no llega a su umbral, **no se publica** y se
reporta el resultado negativo.

Fecha: 2026-08-19. Autor del preregistro: Claude, a petición del dueño
(«mete en los rankings el índice de riesgo en cada jugador, de lesión o de que
sea bust»).

## Señal 1 — riesgo de ausencia

**Qué es.** La fracción de partidos de su equipo en los que el jugador *no
aparece* en los datos, ponderada 56/30/14 sobre las tres últimas temporadas y
encogida hacia la media posicional según el tamaño de muestra.

**Qué NO es.** No es un parte médico ni una predicción clínica. Un jugador puede
no aparecer por lesión, por ser suplente o por estar inactivo, y estos datos no
los distinguen. Se llama «ausencia» y no «lesión» exactamente por eso — la
etiqueta de lesión de verdad viene del dossier y ya está en la fila de al lado.

**Umbral.** Correlación de Spearman ≥ **+0,15** entre la tasa de ausencia
histórica y la tasa de ausencia de la temporada **siguiente**, calculada
walk-forward (cada temporada predicha sólo con las anteriores), sobre 2015-2025.

Si sale por debajo: no se publica la señal, y se reporta el número.

## Señal 2 — riesgo de bust

**Qué es.** La probabilidad de terminar la temporada por debajo del **70%** de su
proyección de pretemporada. El corte del 70% se fija ahora y no se mueve.

**Cómo se estima.** Tasa base empírica por bucket, sin modelo: se agrupan las
proyecciones históricas por su perfil de riesgo observable —las tres componentes
que ya existen más la tasa de ausencia— y se publica la frecuencia con la que
ese bucket quedó por debajo del corte. Cada temporada se estima con las
anteriores.

**Umbral, las dos condiciones a la vez.**

1. **Calibración**: ECE ≤ **0,08** sobre deciles de probabilidad predicha.
2. **Discriminación**: el decil de más riesgo debe tener una tasa de bust
   observada de al menos **1,5×** la del decil de menos riesgo.

Si falla cualquiera de las dos: no se publica la probabilidad. Como mucho se
publica un orden relativo sin número, y se dice que no está calibrada.

## Qué se publica pase lo que pase

El resultado, salga como salga. Un umbral que se mueve después de ver el
resultado convierte la validación en teatro — y en este proyecto ya pasó una vez
con `SAMPLE_SATURATION`, que se corrigió después de mirar y quedó anotado en el
commit precisamente para no repetirlo en silencio.
