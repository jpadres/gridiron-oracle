"""Ratings de eficiencia ajustados por rival, y ratings de quarterback.

El EPA bruto mide resultado, no calidad. Un ataque con 0.15 EPA/jugada puede ser
excelente o haber jugado contra las tres peores defensas de la liga; sin ajustar
por rival no hay forma de distinguirlo, y en las primeras seis semanas de
temporada la diferencia de calendario es enorme.

El ajuste es **online**: una sola pasada cronológica, sin resolver un sistema
sobre la temporada entera. Un ajuste global (mínimos cuadrados sobre todos los
partidos del año) es más preciso a final de temporada, pero usa partidos futuros
para valorar la semana 3. Aquí no se puede.

## Convención de signo — leer antes de tocar nada

`dfn[equipo]` **alto = defensa permisiva** (concede mucho). Por eso el ataque
esperado se calcula **sumando**:

    esperado = media_liga + off[atacante] + dfn[defensor]

Invertir ese signo "para que un número alto sea bueno" parece inofensivo y
convierte el ajuste por rival en un ajuste *al revés*: los equipos que juegan
contra buenas defensas salen premiados. Ya pasó una vez.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# Reparto del residuo entre ataque y defensa. El ataque controla más varianza
# que la defensa en la NFL moderna; 0.62/0.38 sale de minimizar el error de
# predicción fuera de muestra sobre 1999-2011 y es estable en el rango 0.58-0.66.
OFFENSE_SHARE = 0.62
DEFENSE_SHARE = 1.0 - OFFENSE_SHARE

# Partidos de "prior" para el encogimiento. Con 6, un equipo con 3 partidos
# jugados muestra la mitad de su rating crudo: en la semana 4 nadie tiene
# derecho a una opinión fuerte.
SHRINK_PRIOR_GAMES = 6.0

# Cuenta ficticia inicial de la media de liga. Sin esto la primera observación
# de la historia *define* la media, el residuo sale exactamente 0, y ni el
# ataque ni la defensa se mueven nunca de cero: el rating no despega jamás.
MEAN_PRIOR_N = 50.0


@dataclass
class EfficiencyRatings:
    """Ratings online de ataque y defensa sobre una métrica por jugada.

    Se instancia una vez por métrica (EPA total, EPA de pase, EPA de carrera).
    """

    learning_rate: float = 0.08
    season_carryover: float = 0.55
    mean_prior: float = 0.0
    mean_prior_n: float = MEAN_PRIOR_N

    off: dict[str, float] = field(default_factory=dict)
    dfn: dict[str, float] = field(default_factory=dict)
    games: dict[str, float] = field(default_factory=dict)

    _mean: float = field(default=0.0, repr=False)
    _mean_n: float = field(default=0.0, repr=False)
    _last_season: int | None = field(default=None, repr=False)

    def __post_init__(self) -> None:
        self._mean = self.mean_prior
        self._mean_n = self.mean_prior_n

    @property
    def league_mean(self) -> float:
        return self._mean

    def start_season(self, season: int) -> None:
        """Arrastre parcial entre temporadas.

        0.55 es más agresivo que el de Elo (0.75) a propósito: la eficiencia por
        jugada depende del coordinador y de la línea ofensiva, y ambos rotan
        mucho más que la identidad global de una franquicia.
        """
        if self._last_season is not None and season != self._last_season:
            for table in (self.off, self.dfn):
                for team in table:
                    table[team] *= self.season_carryover
            for team in self.games:
                # No se resetea a cero: un equipo que lleva tres temporadas
                # medidas sigue siendo más conocido que un recién llegado.
                self.games[team] = min(self.games[team], SHRINK_PRIOR_GAMES) * 0.5
        self._last_season = season

    def _raw(self, table: dict[str, float], team: str) -> float:
        return table.get(team, 0.0)

    def _shrunk(self, table: dict[str, float], team: str) -> float:
        n = self.games.get(team, 0.0)
        return self._raw(table, team) * n / (n + SHRINK_PRIOR_GAMES)

    def offense(self, team: str) -> float:
        """Rating ofensivo encogido. Positivo = mejor que la media."""
        return self._shrunk(self.off, team)

    def defense(self, team: str) -> float:
        """Rating defensivo encogido. **Positivo = permisiva**, no al revés."""
        return self._shrunk(self.dfn, team)

    def expected(self, offense_team: str, defense_team: str) -> float:
        """Rendimiento esperado del ataque contra esa defensa.

        Suma, no resta: ver la nota de convención de signo arriba.
        """
        return self.league_mean + self.offense(offense_team) + self.defense(defense_team)

    def net(self, team: str) -> float:
        """Valoración global: cuánto genera menos cuánto concede."""
        return self.offense(team) - self.defense(team)

    def update(self, offense_team: str, defense_team: str, observed: float, plays: float) -> float:
        """Incorpora una actuación. Devuelve el residuo.

        `plays` pondera la muestra: un partido de 80 jugadas dice más que uno de
        45 (prórrogas, partidos con muchos despejes). Se normaliza a ~65 jugadas,
        que es la media de la liga, y se topa para que un partido extremo no
        pueda mover el rating al doble de velocidad.
        """
        expected = self.expected(offense_team, defense_team)
        residual = observed - expected

        weight = min(plays / 65.0, 1.5) if plays and plays > 0 else 1.0
        step = self.learning_rate * residual * weight
        self.off[offense_team] = self._raw(self.off, offense_team) + OFFENSE_SHARE * step
        self.dfn[defense_team] = self._raw(self.dfn, defense_team) + DEFENSE_SHARE * step

        self.games[offense_team] = self.games.get(offense_team, 0.0) + 1.0
        self.games[defense_team] = self.games.get(defense_team, 0.0) + 1.0

        # Media de liga como media móvil con prior. Se actualiza al final para
        # que el residuo de esta observación se haya medido contra la media que
        # existía *antes* de verla.
        self._mean_n += 1.0
        self._mean += (observed - self._mean) / self._mean_n

        return residual


@dataclass
class QBRatings:
    """EPA por dropback de cada quarterback, encogido hacia la media de liga.

    Ningún rating de equipo captura que el titular ha cambiado. Un suplente
    entrando vale entre 2 y 7 puntos de spread, y es la mayor fuente de error
    de un modelo que sólo mira al equipo.

    El encogimiento es fuerte a propósito (`prior_dropbacks = 180`, unos cinco
    partidos): la varianza del EPA de un QB en un partido es brutal, y sin
    encoger, un suplente con un buen partido aparece como élite.
    """

    prior_dropbacks: float = 180.0
    learning_rate: float = 0.10
    season_carryover: float = 0.80
    league_mean: float = 0.0

    value: dict[str, float] = field(default_factory=dict)
    dropbacks: dict[str, float] = field(default_factory=dict)
    _last_season: int | None = field(default=None, repr=False)

    def start_season(self, season: int) -> None:
        if self._last_season is not None and season != self._last_season:
            for qb in self.value:
                self.value[qb] *= self.season_carryover
        self._last_season = season

    def rating(self, qb_id: str | None) -> float:
        """Rating encogido. Un QB desconocido (rookie, sin historial) devuelve 0,
        que es "media de liga", no "malo": no sabemos nada de él todavía."""
        if not qb_id:
            return 0.0
        n = self.dropbacks.get(qb_id, 0.0)
        return self.value.get(qb_id, 0.0) * n / (n + self.prior_dropbacks)

    def update(self, qb_id: str | None, epa_per_dropback: float, dropbacks: float) -> None:
        if not qb_id or not dropbacks or dropbacks <= 0:
            return
        current = self.value.get(qb_id, 0.0)
        weight = min(dropbacks / 35.0, 1.5)
        self.value[qb_id] = current + self.learning_rate * weight * (epa_per_dropback - current)
        self.dropbacks[qb_id] = self.dropbacks.get(qb_id, 0.0) + dropbacks
