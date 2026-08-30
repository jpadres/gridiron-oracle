"""Identidad visual de los 32 equipos: nombre, división y color.

## Por qué esto es un módulo y no una constante en el CSS

El color de equipo es **dato**, no decoración: viaja en el payload junto al
resto, se versiona, y se puede comprobar. Escribirlo a mano en el CSS lo
convertiría en 64 valores sueltos que nadie verifica y que se desincronizan del
primer equipo que se mude de ciudad.

## Dos colores por equipo, y el motivo

`primary` es el color canónico del equipo. `mark` es el que se pinta sobre fondo
oscuro. **Muchas veces no pueden ser el mismo.** El azul de Dallas es #041E42 y
el negro de Las Vegas es #0B0B0B: sobre un fondo oscuro, una barra de ese color
no se ve — no es que se vea poco, es que no existe. En esos casos `mark` toma el
color secundario real del equipo, que es justo el que usa la televisión por el
mismo motivo.

Los dos pasan una comprobación de contraste automática
(`scripts/check_identity.py`) contra los dos fondos del sitio. Un color que no la
pasa no entra: una barra invisible no es identidad, es un bug silencioso.

## Lo que NO hay aquí, a propósito

No hay logos ni escudos. Son marcas registradas de los clubes, la CSP del sitio
sólo permite imágenes propias, y descargarlos añadiría un segundo destino
externo — que es exactamente lo que las tres comprobaciones de CI impiden. Un
color y una abreviatura no son marca registrada; un escudo sí.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TeamIdentity:
    abbr: str
    location: str
    nickname: str
    conference: str
    division: str
    primary: str
    """Color canónico. Se usa sobre fondo claro."""
    mark: str
    """Color sobre fondo oscuro. Igual al primario salvo que éste sea invisible."""

    @property
    def name(self) -> str:
        return f"{self.location} {self.nickname}"


def _t(abbr, loc, nick, conf, div, primary, mark=None):
    return TeamIdentity(abbr, loc, nick, conf, div, primary, mark or primary)


# Los secundarios elegidos como `mark` son los que la propia televisión usa
# cuando el fondo es oscuro: la plata de Las Vegas, el naranja de Chicago, el
# verde acción de Seattle.
TEAMS: dict[str, TeamIdentity] = {
    t.abbr: t for t in (
        _t("ARI", "Arizona", "Cardinals", "NFC", "West", "#97233F", "#C8355A"),
        _t("ATL", "Atlanta", "Falcons", "NFC", "South", "#A71930", "#D02440"),
        _t("BAL", "Baltimore", "Ravens", "AFC", "North", "#241773", "#7B6AE0"),
        _t("BUF", "Buffalo", "Bills", "AFC", "East", "#00338D", "#4A8FE7"),
        _t("CAR", "Carolina", "Panthers", "NFC", "South", "#0085CA", "#37A9E8"),
        _t("CHI", "Chicago", "Bears", "NFC", "North", "#0B162A", "#E05A1E"),
        _t("CIN", "Cincinnati", "Bengals", "AFC", "North", "#C43D0C", "#FB4F14"),
        _t("CLE", "Cleveland", "Browns", "AFC", "North", "#C42E00", "#FF6A33"),
        _t("DAL", "Dallas", "Cowboys", "NFC", "East", "#041E42", "#9BA7AE"),
        _t("DEN", "Denver", "Broncos", "AFC", "West", "#C43D0C", "#FB4F14"),
        _t("DET", "Detroit", "Lions", "NFC", "North", "#0076B6", "#3AA0DC"),
        _t("GB", "Green Bay", "Packers", "NFC", "North", "#203731", "#FFB612"),
        _t("HOU", "Houston", "Texans", "AFC", "South", "#03202F", "#C4374C"),
        _t("IND", "Indianapolis", "Colts", "AFC", "South", "#002C5F", "#5A9BE0"),
        _t("JAX", "Jacksonville", "Jaguars", "AFC", "South", "#006778", "#3FA9BC"),
        _t("KC", "Kansas City", "Chiefs", "AFC", "West", "#E31837", "#F0304F"),
        _t("LAC", "Los Angeles", "Chargers", "AFC", "West", "#0080C6", "#38A8E8"),
        _t("LAR", "Los Angeles", "Rams", "NFC", "West", "#003594", "#5A8DE0"),
        _t("LV", "Las Vegas", "Raiders", "AFC", "West", "#0B0B0B", "#B0B6BA"),
        _t("MIA", "Miami", "Dolphins", "AFC", "East", "#00767D", "#2BC0C9"),
        _t("MIN", "Minnesota", "Vikings", "NFC", "North", "#4F2683", "#9068C8"),
        _t("NE", "New England", "Patriots", "AFC", "East", "#002244", "#D0455C"),
        _t("NO", "New Orleans", "Saints", "NFC", "South", "#7A6035", "#D3BC8D"),
        _t("NYG", "New York", "Giants", "NFC", "East", "#0B2265", "#5A83D8"),
        _t("NYJ", "New York", "Jets", "AFC", "East", "#125740", "#33A87A"),
        _t("PHI", "Philadelphia", "Eagles", "NFC", "East", "#004C54", "#3AA0A8"),
        _t("PIT", "Pittsburgh", "Steelers", "AFC", "North", "#7A5D00", "#FFB612"),
        _t("SEA", "Seattle", "Seahawks", "NFC", "West", "#002244", "#69BE28"),
        _t("SF", "San Francisco", "49ers", "NFC", "West", "#AA0000", "#D93A3A"),
        _t("TB", "Tampa Bay", "Buccaneers", "NFC", "South", "#C00909", "#E84040"),
        _t("TEN", "Tennessee", "Titans", "AFC", "South", "#0C2340", "#4B92DB"),
        _t("WAS", "Washington", "Commanders", "NFC", "East", "#5A1414", "#C2564A"),
    )
}


def as_payload() -> dict[str, dict[str, str]]:
    """Los 32, para que la interfaz no reinvente ni un color."""
    return {
        abbr: {
            "abbr": t.abbr, "location": t.location, "nickname": t.nickname,
            "name": t.name, "conference": t.conference, "division": t.division,
            "primary": t.primary, "mark": t.mark,
        }
        for abbr, t in TEAMS.items()
    }
