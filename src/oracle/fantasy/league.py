"""Contexto de liga: plantilla titular y nivel de reemplazo.

## Por qué esto no puede vivir junto a la puntuación

    LOS PUNTOS DE UN JUGADOR DEPENDEN DE LA PUNTUACIÓN.
    SU VALOR DEPENDE ADEMÁS DE LA ESTRUCTURA DE LA LIGA.

Dos ligas con puntuación idéntica dan valores distintos si una tiene 10 equipos
y otra 14, o si una alinea dos receptores y la otra tres. Colapsar las dos cosas
en una función es lo que hace que «personalizar la puntuación» parezca terminar
el trabajo cuando falta la mitad.

## El nivel de reemplazo, y por qué es donde está el daño

El VOR de un jugador es sus puntos menos los del jugador de reemplazo: el mejor
que sigue libre cuando ya todos han llenado esa posición. Ese puesto sale de
`equipos × titulares_por_equipo`, así que:

- 10 equipos frente a 14 mueve el reemplazo cinco o seis puestos.
- Superflex mueve el de quarterback de ~12 a ~22, y **eso reordena el board
  entero**, no la posición: un QB pasa de valer 40 puntos sobre el reemplazo a
  valer 90.

Por eso una liga superflex calculada con un solo quarterback no está «un poco
mal». Está mal en el orden.

## El hueco flexible

Un FLEX admite RB, WR y TE, así que no se puede asignar entero a ninguno. Se
reparte por **uso observado**, no a partes iguales: en la práctica los flex se
llenan mucho más con corredores y receptores que con alas cerradas. Los pesos
están escritos y se pueden discutir; lo que no se puede es ignorarlo, porque sin
él el reemplazo de RB y WR sale demasiado alto y su VOR demasiado bajo.
"""

from __future__ import annotations

from dataclasses import dataclass

FANTASY_POSITIONS: tuple[str, ...] = ("QB", "RB", "WR", "TE")

# Reparto de un hueco FLEX entre las posiciones que lo pueden ocupar.
#
# No es medido: es una convención declarada, y está aquí para que se vea y se
# pueda cambiar en un sitio. Repartir a partes iguales (1/3 cada uno) daría al
# ala cerrada un peso que no tiene en un flex real; darlo entero a RB
# borraría a los receptores. Los pesos suman 1.
FLEX_WEIGHTS: dict[str, float] = {"RB": 0.45, "WR": 0.45, "TE": 0.10}

# Un SUPER_FLEX admite quarterback, y en la práctica **siempre** se llena con
# uno: es la posición más valiosa por hueco con diferencia. Por eso va entero a
# QB y no repartido — repartirlo suavizaría justo el efecto que define el
# formato.
SUPERFLEX_WEIGHTS: dict[str, float] = {"QB": 1.0}

# Cómo se llama cada hueco en Sleeper. Los nombres son los de su API.
SLOT_ALIASES: dict[str, str] = {
    "QB": "QB", "RB": "RB", "WR": "WR", "TE": "TE",
    "K": "K", "DEF": "DST", "DST": "DST",
}
FLEX_SLOTS: frozenset[str] = frozenset({"FLEX", "WRRB_FLEX", "REC_FLEX", "WRRB", "WRT"})
SUPERFLEX_SLOTS: frozenset[str] = frozenset({"SUPER_FLEX", "SUPERFLEX", "QB_FLEX"})
BENCH_SLOTS: frozenset[str] = frozenset({"BN", "BE", "BENCH", "IR", "TAXI"})


class UnsupportedRoster(ValueError):
    """La plantilla trae huecos que no se saben traducir.

    Falla cerrado: un hueco desconocido que se ignora produce un nivel de
    reemplazo demasiado bajo y un board silenciosamente equivocado.
    """


@dataclass(frozen=True)
class LeagueContext:
    """Todo lo que hace falta para valorar jugadores EN ESTA liga."""

    league_id: str | None
    season: int | None
    teams: int
    starters: dict[str, float]
    """Titulares por equipo y posición, con el flex ya repartido."""
    has_kicker: bool = False
    has_defense: bool = False
    bench: int = 0
    source: str = "sleeper"

    def replacement_rank(self, position: str) -> int:
        """Puesto del jugador de reemplazo en esa posición, 1-indexado."""
        per_team = self.starters.get(position, 0.0)
        # Una posición que no se alinea no tiene reemplazo definible; se
        # devuelve 1 para no romper, y `starters` en cero la deja fuera del VOR.
        return max(int(round(self.teams * per_team)), 1)

    @property
    def is_superflex(self) -> bool:
        """Más de un quarterback titular por equipo, con margen de redondeo."""
        return self.starters.get("QB", 0.0) > 1.05


def roster_context(
    roster_positions: list[str] | None,
    teams: int | None,
    *,
    league_id: str | None = None,
    season: int | None = None,
    strict: bool = True,
) -> LeagueContext:
    """Traduce `roster_positions` de Sleeper a titulares por posición.

    `strict` levanta ante un hueco desconocido. Es el comportamiento por
    defecto: preferimos no dar board a dar uno mal.
    """
    if not isinstance(teams, int) or teams < 2:
        raise UnsupportedRoster(f"Número de equipos inesperado: {teams!r}")
    if not isinstance(roster_positions, list) or not roster_positions:
        raise UnsupportedRoster("La liga no trae `roster_positions`.")

    starters = dict.fromkeys(FANTASY_POSITIONS, 0.0)
    flex = 0.0
    superflex = 0.0
    bench = 0
    has_kicker = False
    has_defense = False
    unknown: list[str] = []

    for raw in roster_positions:
        slot = str(raw).upper().strip()
        if slot in BENCH_SLOTS:
            bench += 1
        elif slot in FLEX_SLOTS:
            flex += 1
        elif slot in SUPERFLEX_SLOTS:
            superflex += 1
        elif SLOT_ALIASES.get(slot) == "K":
            has_kicker = True
        elif SLOT_ALIASES.get(slot) == "DST":
            has_defense = True
        elif slot in starters:
            starters[slot] += 1.0
        else:
            unknown.append(slot)

    if unknown and strict:
        raise UnsupportedRoster(
            f"Huecos de plantilla que no sé traducir: {sorted(set(unknown))}. "
            "Añádelos al mapa antes de generar un board con esta liga."
        )

    for position, weight in FLEX_WEIGHTS.items():
        starters[position] += flex * weight
    for position, weight in SUPERFLEX_WEIGHTS.items():
        starters[position] += superflex * weight

    if sum(starters.values()) <= 0:
        raise UnsupportedRoster(f"Ninguna posición de fantasy en {roster_positions!r}")

    return LeagueContext(
        league_id=league_id, season=season, teams=teams, starters=starters,
        has_kicker=has_kicker, has_defense=has_defense, bench=bench,
    )
