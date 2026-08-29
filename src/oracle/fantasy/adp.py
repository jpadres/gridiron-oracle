"""Instantáneas de ADP y su emparejamiento con la identidad de nflverse.

## Estado de la fuente: DESCONOCIDO, que no es lo mismo que roto

Desde este entorno **no se puede comprobar** ninguna fuente pública de ADP: la
política de red devuelve 403 al CONNECT para fantasyfootballcalculator.com,
api.sleeper.app y api.fantasypros.com por igual. Eso dice que aquí no llego, no
que la fuente esté caída.

Así que este módulo **no descarga nada**. Define la instantánea, el
emparejamiento y el informe, que es la parte difícil y la que se puede validar
sin red. Conectar una fuente es escribir un adaptador que devuelva
`list[AdpEntry]`; hasta que alguien pueda verificar el endpoint, no se escribe.

## Por qué la instantánea guarda tanto metadato

Un ADP sin su contexto no significa nada. «Bijan está en el 4» es una frase
incompleta: ¿en ligas de diez o de doce? ¿PPR o estándar? ¿de cuántos drafts?
¿de esta semana o de junio? Dos ADP de fuentes distintas no son comparables y
restarlos produce una tendencia inventada.

Por eso `AdpSnapshot` exige `source`, `scoring`, `league_size`, `fetched_at`,
`sample_size` y `window`, y por eso `trend` **se niega** a comparar dos
instantáneas que no coincidan en fuente, formato y tamaño de liga.

## Y por qué el emparejamiento es estricto

Este proyecto ya se quemó una vez: «B.Robinson» de Atlanta son Bijan Robinson y
Brian Robinson, y quedarse con el último producía «el modelo sube a Bijan 139
puestos». La regla que salió de ahí es la que gobierna aquí: **ante la duda no se
empareja**, y lo ambiguo se cuenta y se enseña en vez de descartarse en silencio.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from ..data.ingest import normalize_team
from ..narrative.matching import _fold, player_key


@dataclass(frozen=True)
class AdpEntry:
    """Una fila de ADP tal y como la publica una fuente."""

    name: str
    position: str
    team: str | None
    adp: float


@dataclass(frozen=True)
class AdpSnapshot:
    """Un ADP con todo lo que hace falta para que signifique algo.

    Ninguno de estos campos es opcional a propósito. Un ADP sin formato de
    puntuación ni tamaño de liga no es un dato incompleto: es un número que
    parece un dato.
    """

    source: str
    scoring: str
    league_size: int
    fetched_at: str
    sample_size: int
    window: str
    entries: tuple[AdpEntry, ...] = field(default_factory=tuple)

    def comparable_with(self, other: AdpSnapshot) -> bool:
        """¿Se pueden restar estos dos ADP sin inventar una tendencia?"""
        return (
            self.source == other.source
            and self.scoring == other.scoring
            and self.league_size == other.league_size
        )


@dataclass(frozen=True)
class MatchReport:
    """Emparejados, sin emparejar y ambiguos. Los tres se cuentan y se enseñan.

    Descartar en silencio lo que no encaja es como se cuelan los errores caros:
    el board parece completo y le falta gente, o peor, tiene a la persona
    equivocada.
    """

    matched: dict[str, float]
    unmatched: tuple[AdpEntry, ...]
    ambiguous: tuple[tuple[AdpEntry, tuple[str, ...]], ...]

    @property
    def summary(self) -> str:
        return (
            f"{len(self.matched)} emparejados, {len(self.unmatched)} sin emparejar, "
            f"{len(self.ambiguous)} ambiguos"
        )


def match_to_players(
    snapshot: AdpSnapshot, players: dict[str, tuple[str, str, str]]
) -> MatchReport:
    """Empareja el ADP con identidades de nflverse por clave, posición y equipo.

    `players` es `player_id -> (nombre, posición, equipo)`.

    La clave `inicial.apellido` **colisiona** —hay varios «M.Williams» en la
    liga— así que la posición y el equipo son parte de la identidad, no un
    refinamiento. Y cuando aun así quedan dos candidatos, la fila va a
    `ambiguous` y **no se empareja con ninguno**.
    """
    # DOS índices, y el orden importa.
    #
    # `player_key` reduce a inicial+apellido porque eso es lo máximo que da el
    # formato abreviado de nflverse («B.Robinson»). Pero una fuente de ADP
    # publica el nombre entero, y tirar esa información sería regalar
    # ambigüedad: «Bijan Robinson» y «Brian Robinson» sólo colisionan si uno
    # mismo los recorta.
    #
    # Así que primero se intenta el nombre completo normalizado y sólo si eso no
    # resuelve se cae a la clave abreviada. Esto aumenta lo que se empareja sin
    # aflojar nada: la regla de «ante la duda, ninguno» sigue intacta.
    full_index: dict[tuple[str, str, str | None], list[str]] = defaultdict(list)
    short_index: dict[tuple[str, str, str | None], list[str]] = defaultdict(list)
    for player_id, (name, position, team) in players.items():
        position_key = str(position).upper()
        team_key = normalize_team(team)
        full_index[(_fold(name), position_key, team_key)].append(player_id)
        short_index[(player_key(name), position_key, team_key)].append(player_id)

    matched: dict[str, float] = {}
    unmatched: list[AdpEntry] = []
    ambiguous: list[tuple[AdpEntry, tuple[str, ...]]] = []

    for entry in snapshot.entries:
        # Todo código de equipo pasa por `normalize_team`. Un «LA» que debía ser
        # «LAR» no emparejaba con nada y el jugador desaparecía en silencio: es
        # el fallo que ya costó una iteración en el importador del dossier.
        position_key = str(entry.position).upper()
        team_key = normalize_team(entry.team)
        candidates = full_index.get((_fold(entry.name), position_key, team_key), [])
        if not candidates:
            candidates = short_index.get((player_key(entry.name), position_key, team_key), [])

        if len(candidates) == 1:
            matched[candidates[0]] = entry.adp
        elif len(candidates) > 1:
            ambiguous.append((entry, tuple(candidates)))
        else:
            unmatched.append(entry)

    return MatchReport(matched, tuple(unmatched), tuple(ambiguous))


def trend(earlier: AdpSnapshot, later: AdpSnapshot) -> dict[str, float]:
    """Cuánto se ha movido cada jugador entre dos instantáneas comparables.

    Positivo = **sube** (número de ADP más bajo, se elige antes).

    Levanta si las dos instantáneas no coinciden en fuente, formato y tamaño de
    liga. Restar el ADP de PPR de una fuente al de estándar de otra produce un
    número con la forma de una tendencia y sin nada dentro.

    **Y que suba no significa que sea mejor.** Un ADP que se mueve mide lo que
    está haciendo el resto de la gente, no lo que va a hacer el jugador. Es una
    medida de mercado, y este proyecto ya tiene escrita la regla de que estar en
    desacuerdo con el mercado no es una ventaja (`docs/REGLA_edge.md`).
    """
    if not earlier.comparable_with(later):
        raise ValueError(
            "Estas dos instantáneas de ADP no son comparables "
            f"({earlier.source}/{earlier.scoring}/{earlier.league_size} frente a "
            f"{later.source}/{later.scoring}/{later.league_size}). Restarlas "
            "produciría una tendencia inventada."
        )
    before = {(player_key(e.name), e.position, normalize_team(e.team)): e.adp
              for e in earlier.entries}
    moves: dict[str, float] = {}
    for entry in later.entries:
        key = (player_key(entry.name), entry.position, normalize_team(entry.team))
        if key in before:
            moves[entry.name] = before[key] - entry.adp
    return moves
