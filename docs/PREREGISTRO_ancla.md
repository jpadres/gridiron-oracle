# Preregistro — el ancla del encogimiento depende de la muestra

Fecha: 2026-09-01. Escrito **antes** de correr el experimento.

## La hipótesis, en una frase

Un jugador del que apenas hay muestra no es un titular medio: es alguien que no
ha conseguido rol. Encogerlo hacia el punto por partido del **partido medio
jugado** lo proyecta como si fuera a jugar como titular, y eso es lo que infla
toda la cola del board.

## Lo que hace hoy `project_season`

```python
position_mean = np.average(group["points_per_game"], weights=group["weighted_games"])
ppg_shrunk    = position_mean + reliability * (ppg - position_mean)
reliability   = weighted_games / (weighted_games + 10)
```

`position_mean` está **ponderada por partidos**, así que la fija quien más juega:
es el punto por partido de un titular. Un jugador con `weighted_games = 2` tiene
fiabilidad 0,17 y acaba a un 83% de esa media — proyectado como titular medio
sin haberlo sido nunca.

## Los tres síntomas que ya están medidos y que esto explicaría

1. Sesgo **+17,9 puntos** en la banda 101-180 del board (sobreproyección de la
   cola), frente a −38,4 en la banda 1-50.
2. A igual proyección y misma posición, los novatos de 2019-2025 realizaron
   **127,2 puntos y los veteranos de al lado 19,6** (n=128). No es que el novato
   esté mal colocado: es que sus vecinos están inflados.
3. La disponibilidad salió INCONCLUSA porque atacaba los partidos y no el punto
   por partido. Es el mismo agujero por el otro lado.

## El cambio que se prueba

El ancla deja de ser una constante por posición y pasa a depender del tamaño de
muestra: cada jugador se encoge hacia el punto por partido de **los jugadores con
una muestra parecida a la suya**, estimado sobre las mismas temporadas
anteriores que ya se usan (sin dato futuro, ni un solo partido de la temporada
que se proyecta).

Cubos de `weighted_games`: `[0, 3)`, `[3, 8)`, `[8, 14)`, `[14, ∞)`. Son cortes
declarados, no ajustados: con pesos 56/30/14 sobre temporadas de 17 partidos el
máximo posible ronda 17, así que parten el rango en cuatro tramos con sentido —
suplente profundo, rotación, titular a medias, titular.

## Métrica y umbral, fijados ahora

- **Primaria:** valor capturado por posición, walk-forward 2022-2025, sobre el
  pool congelado (los 180 primeros por puntos de la temporada anterior, que no
  depende del modelo). `k` estructural: QB 12, RB 24, WR 36, TE 12.
- **Secundarias:** Spearman y MAE por posición, y el sesgo por banda.

**Se acepta sólo si** el valor capturado **no empeora en ninguna** de las cuatro
posiciones y **mejora en al menos dos**.

**Comprobación de cordura, obligatoria:** el sesgo de la banda 101-180 tiene que
**bajar**. Si la métrica primaria mejora y el sesgo de esa banda no baja, la
hipótesis es falsa aunque el número salga bonito, y el cambio se descarta: habría
mejorado por otra razón que no se entiende.

Cualquier otro resultado es **INCONCLUSO** y el ancla se queda como está. Sin
reintentos con otros cortes: si estos cuatro no valen, la respuesta es que no.


---

# Resultado — 2026-09-01. RECHAZADO.

Walk-forward 2022-2025, pool congelado, 4 temporadas.

## Métrica primaria: valor capturado

| posición | ancla actual | ancla por muestra | |
|---|---|---|---|
| QB | 0,631 | 0,631 | igual |
| RB | **0,810** | 0,779 | **empeora** |
| TE | **0,730** | 0,725 | **empeora** |
| WR | **0,839** | 0,826 | **empeora** |

El umbral pedía no empeorar en ninguna y mejorar en al menos dos. Empeora en
tres. **Rechazado**, y se queda apagado.

## La comprobación de cordura tampoco pasa

El sesgo de la banda 101-180 tenía que bajar y **subió**: +17,9 → +22,7. La
hipótesis ni siquiera hizo lo que predecía. (Parte de eso es que las bandas se
cortan sobre el board de cada modelo, así que no comparan a los mismos
jugadores; da igual, la primaria ya decidió.)

## Lo que sí mejoró, y por qué no basta

El MAE baja (TE 50,2 → 48,9; banda 1-50 77,6 → 74,1) y el sesgo por posición se
acerca a cero (RB −5,3 → +3,0; TE −10,4 → +1,8). O sea: **el número queda mejor
calibrado y el orden queda peor**. Es la lección del proyecto otra vez —
compilar mejor la magnitud no es ordenar mejor— y es exactamente para lo que
existe el valor capturado como métrica primaria.

## El mecanismo, que es lo interesante

La muestra pequeña no significa lo mismo en todos los casos. Un suplente
profundo con dos partidos y **un titular que se perdió una temporada por lesión**
tienen la misma `weighted_games` y son cosas opuestas: el segundo vuelve con rol
garantizado. El ancla por muestra hunde a los dos por igual, y los que vuelven de
lesión son buenos picks. Eso explica que la calibración mejore y el orden empeore.

La variable correcta no es cuánto ha jugado, sino **qué rol tiene cuando está
disponible** — cuota de uso del equipo, no partidos. Eso es otro experimento, con
su preregistro, y no se hace de camino.

## Lo que sí se hizo con el hallazgo

Nada de esto cambia el modelo, pero el diagnóstico dejó a la vista algo que no
era una hipótesis sino aritmética: con `weighted_games = 0,3`, el **97%** de la
proyección de un jugador es la media de su posición. El board publicaba a diez
corredores de plantilla profunda entre los puestos 150 y 180, todos con ~112
puntos, porque 112 es el ancla del corredor. Eso se marca en la fila (`% PRIOR`)
y se saca de la lista corta por debajo de tres partidos ponderados. No hay nada
que validar ahí: es la fórmula del encogimiento leída al revés.
