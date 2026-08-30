# Preregistro — E18: el valor por liga responde a las reglas de la liga

Escrito **antes** de implementar la unificación y **antes** de medir nada.
30/8/2026.

## Qué se afirma, y qué no

Se afirma **corrección estructural**: que el número que Gridiron Oracle llama
«valor en esta liga» cambia porque cambian la puntuación, el número de equipos y
la estructura de titulares — y cambia en la dirección y la magnitud que esas
reglas implican.

**NO** se afirma que draftear por ese número produzca mejores temporadas. Eso es
una afirmación de resultado, exige medirla contra temporadas reales, y no está
en este bloque. `E18` puede mover `LEAGUE_SPECIFIC_VALUE` fuera de NOT_READY;
**no** puede desbloquear `BEST_PICK_FOR_ME`.

    COMPILAR LA PUNTUACIÓN NO ES CALCULAR EL VALOR.

Un jugador que suma más puntos no vale más en el draft. El quarterback es el
contraejemplo permanente: gana en puntos todas las semanas y se elige en la
ronda 8, porque el que puedes conseguir gratis en su posición también suma
mucho.

## Lo que la auditoría encontró (antes de tocar nada)

Hay **tres modelos de flex distintos** en el repositorio, y dan tres respuestas
para la misma liga (12 equipos, QB/RB/RB/WR/WR/WR/TE/FLEX):

| Modelo | Titulares WR | Rank de reemplazo WR |
|---|---|---|
| `draft.DEFAULT_STARTERS` | 3.00 | 36 |
| `sleeper.league_settings_from` | 3.50 | 42 |
| `league.roster_context` (bloque A) | 3.45 | 41 |

Seis puestos de diferencia en la misma liga. Además `draft_board()` —el que
genera el board publicado— usa el primero, y el compilador de plantilla del
bloque A **no está conectado a nada**: `buildLeagueBoard` y `projectPlayer` en
`leagueValue.js` no los llama ninguna pantalla.

Y un fallback silencioso: `league_settings_from` hace
`counts[position] or DEFAULT_STARTERS[position]`, así que una liga **sin ala
cerrada titular** recibe `TE: 1.0` inventado. Es exactamente el «valor por
defecto asumido como configuración real» que la regla 6 prohíbe.

## El modelo de flex, y por qué se cambia

El reparto por pesos fijos (RB 0,45 / WR 0,45 / TE 0,10) es una convención
declarada. Su defecto no es que los pesos sean discutibles: es que **calcula el
reemplazo de cada posición como si el hueco compartido no existiera**, y al
redondear por posición la demanda total deja de cuadrar con los huecos que la
liga define de verdad.

La alternativa que se valida es una **asignación voraz**: se llenan los huecos
dedicados, y cada hueco flexible va a la posición cuyo mejor jugador libre vale
más en ese momento. El reemplazo de una posición es su mejor jugador que **no**
entró como titular. Así la competencia por el hueco compartido es endógena en
vez de postulada.

## Escenarios y umbrales, fijados antes de medir

### Propiedades exactas (sin tolerancia)

1. **Linealidad de la puntuación.** Compilar componentes reproduce la puntuación
   directa semana a semana. Umbral: máx |Δ| **< 1e-9**. (Es E15; se vuelve a
   correr como regresión.)
2. **Determinismo.** La misma configuración dos veces da un board idéntico.
   Umbral: **igualdad exacta**, incluidos orden y tiers.
3. **La demanda voraz cuadra.** La asignación consume **exactamente**
   `equipos × huecos_titulares` jugadores. Umbral: discrepancia **0**. Se
   reporta además la discrepancia del modelo de pesos fijos, que no se le exige
   cero — se mide para saber cuánto valía la pena cambiarlo.
4. **TE premium toca los puntos antes que el valor.** Con `{"TE": 1.5}`: todo TE
   con recepciones > 0 sube estrictamente, y **ningún** jugador de otra posición
   cambia. Umbral: Δ > 0 en todos los TE, Δ **exactamente 0** fuera de TE.
5. **Sin respaldo silencioso.** Hueco de plantilla desconocido → levanta. Clave
   de puntuación desconocida → levanta. Cero titulares en una posición → esa
   posición queda en cero, **nunca** en el valor por defecto. Umbral: los tres
   levantan o respetan el cero; ninguno cae en 12 equipos PPR.

### Propiedades direccionales

6. **Más titulares, reemplazo más profundo.** Subir los titulares de una
   posición no puede hacer su rank de reemplazo más superficial. Umbral:
   monótono en todos los pasos probados, **sin excepciones**.
7. **Ligas más profundas, reemplazo más profundo.** 10 → 12 → 14 equipos: el
   rank de reemplazo crece y los puntos de reemplazo no crecen, para toda
   posición con titulares > 0. Umbral: monótono, todas las posiciones.

### Superflex — P0

8. **El rank de reemplazo del QB se dobla.** Añadir un `SUPER_FLEX` a una
   plantilla de 1QB lleva los titulares de QB de 1,0 a 2,0, así que en 12
   equipos el reemplazo pasa de QB12 a QB24. Umbral: **exactamente 2×** con el
   modelo de pesos; con el voraz, **≥ 1,8×** (el voraz no está obligado a dar un
   número redondo, y exigírselo sería fijar el resultado).
9. **El VOR del QB sube de forma material.** Umbral: la mediana del aumento
   entre los 12 primeros QB **≥ 20 puntos de temporada**. Se elige 20 porque es
   bastante menos que la distancia típica entre el QB12 y el QB24 y bastante más
   que el ruido de redondeo: un umbral que sólo se pasa por poco no distinguiría
   un efecto real de un artefacto.
10. **El orden entre posiciones se mueve.** Umbral: hay **estrictamente más** QB
    en el top-25 conjunto en superflex que en 1QB.

Si 8-10 **no** se mueven, no se acepta: se investiga antes de dar por bueno un
superflex que se comporta como una liga de un quarterback.

### Equivalencia con la línea base

11. **Puntos idénticos** para 12 equipos PPR con la plantilla histórica. Umbral:
    **< 0,01 puntos** donde la igualdad es esperable.
12. **El VOR puede romper**, y si rompe se explica. El VOR viejo usaba
    `DEFAULT_STARTERS`, que reparte el flex sólo al RB y contradice a los otros
    dos modelos del propio repositorio. No se exige igualdad: se exige que la
    ruptura esté cuantificada y justificada.

## Lo que NO se mide aquí

- Que el orden nuevo acierte más. Es descriptivo: se reportan solapamientos
  top-25/top-50 y los que más se mueven, **sin** llamarlos mejores.
- Pateadores y defensas. No entran en el board por VOR y este experimento no los
  mete: `KICKER_ORDINAL_RANKING` está REJECTED y `DST_STREAMING` es DESIGN_ONLY.
  Que la interfaz tenga filtros de K y DST no es motivo para meterlos en una
  comparación entre posiciones que no los soporta.
- Novatos. Sin partidos NFL no hay componentes, así que no tienen proyección
  comparable. Se cuenta cuántos faltan y se dice; no se les inventa un valor.
- Los tiers como cosa de liga. Se auditan; si no se validan por liga, se siguen
  publicando como globales.

## Umbral global

Las once propiedades con umbral, **todas**. Una que falle deja
`LEAGUE_SPECIFIC_VALUE` donde está.


---

# Extensión a ligas profundas (32 equipos) — resultado

Se extendió el mismo experimento, **con los umbrales ya fijados arriba**, a 32
equipos (el máximo con sentido: una franquicia por equipo NFL) con rosters
reducidos y estándar, con y sin superflex. No se inventó ningún umbral nuevo.

**18/20.** Fallan dos, las dos de magnitud y las dos en superflex a 32 equipos:

| Propiedad | Umbral | 12 equipos | 32 equipos |
|---|---|---|---|
| El VOR del QB sube | ≥ +20 pts | +26,4 ✓ | **+10,5 ✗** |
| Más QB en el top-25 | estrictamente | 1 → 4 ✓ | **1 → 1 ✗** |

Lo que sí aguanta a 32 equipos: el reparto consume los 288 huecos exactos, el
reemplazo se profundiza de forma monótona (QB33, RB97, WR97, TE33) y el rank del
quarterback se dobla (QB33 → QB65, 1,97×).

## El diagnóstico, porque el preregistro obligaba a investigar

No es que el superflex importe menos en una liga profunda. Es que **el ancla de
reemplazo cae donde la proyección ya es casi el prior**:

| | bruto | encogido | se come |
|---|---|---|---|
| QB12 → QB24 | 48 pts | 27 pts | 43% |
| QB33 → QB65 | 30 pts | 11 pts | **65%** |

Y el orden ahí deja de ser información: el QB45 tiene **0,3 partidos ponderados**
y una proyección bruta de 10 puntos, y sale **por encima** del QB65, que tiene
7,1 partidos y un ritmo real de 164.

## Consecuencia

`LEAGUE_SPECIFIC_VALUE` se mantiene VALIDATED **hasta 14 equipos**, que es donde
pasó las 16. Se añade `DEEP_LEAGUE_VALUE` en NOT_READY con este resultado, y la
interfaz etiqueta las ligas más profundas como calculadas pero no validadas.

Publicar más jugadores **no** lo arregla: no es un problema de pool sino del
modelo de proyección. Arreglarlo sería encoger menos o excluir del ancla a quien
no tenga muestra — dos cambios de modelo, cada uno con su propia validación.
