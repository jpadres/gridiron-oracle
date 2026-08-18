"""Survivor: elegir un ganador por jornada sin repetir equipo.

## Por qué este modelo sirve aquí y no sirve para apostar

Contra la línea de cierre, el modelo empata: Brier 0.2118 frente a 0.2113. Por
eso la hoja de apuestas de valor sale vacía y así debe ser.

El survivor es otro problema. **No compites contra un mercado eficiente**:
compites contra el calendario y contra tu propio bote de equipos. Lo que hace
falta ahí no es una probabilidad mejor que la del mercado, es una probabilidad
*bien calibrada* —y ésa la tenemos medida, ECE 0.0172— más la capacidad de mirar
dieciocho jornadas a la vez, que es donde una persona no llega.

La decisión difícil del survivor no es «¿quién gana esta semana?». Es «¿cuánto me
cuesta gastar hoy al equipo que me salvaría la jornada 11?». Eso es un problema
de asignación, y tiene solución exacta.

## Cómo se resuelve

Maximizar la probabilidad de sobrevivir todas las jornadas es maximizar el
producto de las probabilidades de acierto, y eso es maximizar la **suma de sus
logaritmos** con la restricción de un equipo por jornada y ningún equipo
repetido. Es un problema de asignación lineal: se resuelve exacto y en
milisegundos con el húngaro (`scipy.optimize.linear_sum_assignment`), no hace
falta simular nada.

El coste de quemar un equipo hoy sale de resolverlo dos veces: el óptimo libre y
el óptimo obligando a usar ese equipo esta jornada. La diferencia entre las dos
supervivencias **es** lo que cuesta gastarlo, en puntos de probabilidad.

## Lo que esto NO hace

No modela al resto del bote. En un survivor grande, a veces interesa separarse
del favorito público aunque cueste probabilidad, porque compartir la eliminación
con todos no te elimina y compartir la supervivencia con todos no te hace ganar.
Eso necesita datos de qué está eligiendo la gente, que no tenemos. Aquí se
maximiza supervivencia propia y punto — se dice en la web y se dice aquí.
"""

from oracle.survivor.plan import (
    Plan,
    best_plan,
    probability_matrix,
    week_board,
    win_probabilities,
)

__all__ = [
    "Plan",
    "best_plan",
    "probability_matrix",
    "week_board",
    "win_probabilities",
]
