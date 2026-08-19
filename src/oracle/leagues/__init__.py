"""Sincronización con la plataforma donde se juega la liga.

Ahora mismo sólo Sleeper, cuya API es **pública y de sólo lectura**: sin clave,
sin OAuth y sin nada que rotar. Eso es lo que la hace aceptable para este
proyecto — no añade ninguna credencial que gestionar.

El motivo de fondo para conectar la liga no es comodidad. El board se construye
hoy asumiendo PPR y doce equipos, y **la puntuación cambia el ranking**: en PPR
un receptor de volumen vale más que un corredor de 1.100 yardas y en estándar es
al revés. Un board calculado con las reglas equivocadas no es aproximado, es de
otra liga. El tamaño de liga hace lo mismo con el nivel de reemplazo del VOR.

Y hay un detalle que lo hace mejor que cualquier otra fuente: cada jugador de
Sleeper trae su `gsis_id`, que **es** el `player_id` de nflverse. El cruce es por
identificador, no por nombre — se acaba el problema de los dos «B.Robinson» de
Atlanta.
"""

from oracle.leagues.sleeper import (
    SleeperError,
    UnmappedScoring,
    league_settings_from,
    scoring_from,
)

__all__ = ["SleeperError", "UnmappedScoring", "league_settings_from", "scoring_from"]
