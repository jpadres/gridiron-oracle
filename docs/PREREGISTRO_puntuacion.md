# Preregistro — E15: los componentes reproducen los puntos

Escrito **antes** de ejecutar `scripts/scoring_equivalence.py`. 30/8/2026.

## La afirmación

Mover la unidad fundamental de la proyección de «puntos» a «componentes de
fútbol» **no cambia ningún número** bajo las reglas actuales, y permite compilar
cualquier otra puntuación.

## Por qué el umbral es cero y no una tolerancia

La puntuación de fantasy es lineal en las estadísticas y la media es lineal:

    media(Σ cᵢ·xᵢ) = Σ cᵢ·media(xᵢ)

Las dos cantidades **son la misma**. Así que no se acepta «< 0,01 puntos», que
es lo que se propuso al principio: una tolerancia así escondería un componente
olvidado o un alias contado dos veces, que son los dos fallos reales que puede
tener esta migración. El umbral es el epsilon de coma flotante.

## Umbral de aceptación, fijado antes

1. **Equivalencia de componentes.** Máxima diferencia absoluta entre
   `media_ponderada(puntuar(semanas))` y `puntuar(componentes)` sobre todos los
   jugadores de 2022-2025 y **siete** perfiles de puntuación: **< 1e-9**.
2. **Equivalencia del board.** Regenerado el board canónico (12 equipos, PPR,
   QB1/RB2/WR3/TE1): diferencia máxima en `projected_points`, `vor` y
   `replacement_points` **exactamente 0**, cero cambios de orden y cero cambios
   de tier.
3. **Superflex material.** El reemplazo de quarterback pasa de 12 a 24 y el VOR
   del mejor QB sube **más de un 50%**. Si no, la migración no sirve: los puntos
   serían por liga y el valor no.

Los tres, o falla.

## Lo que este experimento NO demuestra

Que un board por liga produzca **mejores drafts**. Eso es una afirmación de
resultado y nadie la ha medido: haría falta comparar decisiones contra
resultados a lo largo de temporadas. Por eso la capacidad sube a NOT_READY y no
a VALIDATED — produce números correctos, no números que hayan demostrado batir a
nada.

## Límite conocido, escrito antes de que sorprenda

Los **bonus por partido** (300 yardas de pase, 100 de carrera) no son lineales:
dependen de la distribución semanal. Dos jugadores con la misma media cobran
bonus distintos y desde la media no se puede saber cuál. El compilador **falla**
ante una liga con bonus en vez de devolver un número que parece exacto.
