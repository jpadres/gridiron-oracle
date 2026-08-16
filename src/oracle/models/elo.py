"""Elo con margen de victoria y ventaja local adaptativa.

Elo es la línea base honesta de cualquier modelo de deportes: usa una sola cifra
por equipo y el resultado de los partidos. Si un modelo con veinte features no
bate a esto por un margen claro, las veinte features no están aportando nada.

Dos cosas lo separan de un Elo de ajedrez:

1. **El margen importa, pero con rendimientos decrecientes.** Ganar de 40 no es
   el doble de informativo que ganar de 20 — suele significar que el rival
   abandonó en el tercer cuarto. El multiplicador logarítmico refleja eso.

2. **La corrección por autocorrelación del favorito.** Sin ella, un equipo que
   gana de mucho siendo muy favorito infla su rating más de lo que debería, y
   Elo se vuelve inestable en la cola. El denominador
   `(elo_diff_ganador * 0.001 + 2.2)` amortigua exactamente ese caso.

La ventaja local **no** es una constante. Cayó de ~2.7 puntos a mediados de los
2000 a ~1.5 en 2020-22 y ha vuelto a subir. Fijarla es un sesgo sistemático de
medio punto que dura temporadas enteras, así que se estima de forma recursiva a
partir de los residuos de los partidos en casa.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# 25 puntos de Elo ≈ 1 punto de spread. Sale de ajustar la conversión sobre el
# histórico completo; es también el valor clásico de FiveThirtyEight. Cambiarlo
# reescala K, así que los dos se tocan juntos o ninguno.
ELO_PER_POINT = 25.0

BASE_RATING = 1500.0


@dataclass
class EloModel:
    """Elo de equipos actualizado partido a partido.

    Uso obligatorio en orden cronológico: `expected_margin` para emitir la
    predicción y sólo *después* `update` con el resultado. Al revés es fuga de
    información y el test anti-fuga lo detecta.
    """

    k: float = 20.0
    # Arrastre entre temporadas. 0.75 = se retiene tres cuartos de la distancia
    # a la media. Con 1.0 un equipo que se rehace en el draft tarda medio año en
    # ser creído; con 0.5 se pierde información real de continuidad de plantilla.
    season_carryover: float = 0.75
    # HFA inicial en puntos y velocidad a la que se adapta. 0.002 es lento a
    # propósito: la HFA se mueve entre temporadas, no entre semanas, y un valor
    # alto la convierte en un seguidor de rachas.
    hfa_points: float = 2.0
    hfa_learning_rate: float = 0.002

    ratings: dict[str, float] = field(default_factory=dict)
    _last_season: int | None = field(default=None, repr=False)

    def rating(self, team: str) -> float:
        return self.ratings.get(team, BASE_RATING)

    def start_season(self, season: int) -> None:
        """Regresión a la media al cambiar de temporada.

        Se llama desde la pasada cronológica al ver el primer partido de una
        temporada nueva, no desde un bucle aparte: así el estado sólo avanza en
        un sitio y es imposible que se adelante a los datos.
        """
        if self._last_season is not None and season != self._last_season:
            for team in self.ratings:
                self.ratings[team] = BASE_RATING + self.season_carryover * (
                    self.ratings[team] - BASE_RATING
                )
        self._last_season = season

    def expected_margin(self, home: str, away: str, neutral: bool = False) -> float:
        """Margen esperado del local en puntos."""
        diff = self.rating(home) - self.rating(away)
        hfa = 0.0 if neutral else self.hfa_points
        return diff / ELO_PER_POINT + hfa

    def win_probability(self, home: str, away: str, neutral: bool = False) -> float:
        """Probabilidad de victoria del local.

        400 es la escala logística estándar de Elo. Se aplica sobre la
        diferencia *incluyendo* la HFA convertida a Elo, no sobre el margen.
        """
        hfa_elo = 0.0 if neutral else self.hfa_points * ELO_PER_POINT
        diff = self.rating(home) - self.rating(away) + hfa_elo
        return 1.0 / (1.0 + 10.0 ** (-diff / 400.0))

    def update(
        self, home: str, away: str, margin: float, neutral: bool = False
    ) -> tuple[float, float]:
        """Actualiza los ratings con el resultado. Devuelve (delta_local, residuo).

        El ajuste se hace sobre el **resultado binario** ponderado por el margen,
        no sobre el residuo del margen:

            delta = K · mov(margen) · (ganó − P(ganar))

        Es importante que sea así y no `K · mov · residuo_de_margen`: esa
        variante aplica el margen dos veces (una en el residuo, que crece lineal,
        y otra en el multiplicador, que crece con el logaritmo), y el resultado
        es que ganar de 40 mueve el rating **más del doble** que ganar de 20 —
        justo lo contrario de los rendimientos decrecientes que se buscan.
        """
        expected_margin = self.expected_margin(home, away, neutral)
        residual = margin - expected_margin

        outcome = 1.0 if margin > 0 else (0.0 if margin < 0 else 0.5)
        expected_probability = self.win_probability(home, away, neutral)

        # Multiplicador por margen. El +1 evita log(0) en los empates.
        sign = 1 if margin > 0 else -1
        elo_diff_winner = (self.rating(home) - self.rating(away)) * sign
        if not neutral:
            elo_diff_winner += self.hfa_points * ELO_PER_POINT * sign
        mov = _mov_multiplier(margin, elo_diff_winner)

        delta = self.k * mov * (outcome - expected_probability)
        self.ratings[home] = self.rating(home) + delta
        self.ratings[away] = self.rating(away) - delta

        # La HFA se aprende sólo de partidos con local real. En sede neutral el
        # residuo no contiene información sobre la ventaja de jugar en casa.
        if not neutral:
            self.hfa_points += self.hfa_learning_rate * residual

        return delta, residual


def _mov_multiplier(margin: float, elo_diff_winner: float) -> float:
    """Peso del margen, con rendimientos decrecientes y corrección de favorito."""
    import math

    return math.log(abs(margin) + 1.0) * (2.2 / (elo_diff_winner * 0.001 + 2.2))


@dataclass
class MarketAnchoredElo(EloModel):
    """Variante que aprende contra la línea en vez de contra el resultado.

    En vez de preguntar "¿ganó?", pregunta "¿superó lo que se esperaba de él?".
    Converge mucho más rápido tras un cambio de plantilla, porque el mercado ya
    ha digerido la noticia (un fichaje, una lesión) antes de que el equipo haya
    jugado un solo partido con ella.

    El precio es evidente y hay que decirlo: **no es un modelo independiente del
    mercado.** Sus predicciones no valen para comprobar si el modelo aporta algo
    por su cuenta. Para eso está `pred_margin_free`, que no toca la línea.
    """

    market_weight: float = 0.5

    def update_with_line(
        self, home: str, away: str, margin: float, spread_line: float, neutral: bool = False
    ) -> tuple[float, float]:
        """El objetivo es una mezcla entre el resultado y la línea de cierre.

        `market_weight = 0.5` encoge el ruido de un solo partido (la varianza del
        margen es enorme: σ ≈ 13,5 puntos) sin llegar a copiar la línea, que
        haría el rating redundante.
        """
        target = (1 - self.market_weight) * margin + self.market_weight * spread_line
        return self.update(home, away, target, neutral)
