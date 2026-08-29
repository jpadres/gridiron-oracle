"""Catálogo de feeds. Fuentes estables, no nombres de periodistas.

## Por qué aquí no hay nombres propios

Un beat reporter cambia de equipo y de medio cada pocos meses; el diario local
sigue cubriendo al equipo aunque cambie quién firma. Una lista de cien nombres
empieza a pudrirse en semanas y lo hace **en silencio**: el feed sigue
respondiendo, sólo que ya no es esa persona.

Y hay un motivo de diseño encima del práctico: el reliability score existe para
decidir en quién fiarse. Si la lista lo decide antes, el score no tiene nada que
descubrir. Los nombres salen de `author`, que ya se guarda, y el ranking de
personas lo construye el bucle — no yo de memoria.

## Cobertura

Se arranca deliberadamente corto. Veinte feeds que funcionan valen más que cien
a medio verificar, y añadir uno cuesta una línea. Los de equipo van con su
código, que es lo que permite emparejar jugadores sin adivinar.
"""

from __future__ import annotations

from .feeds import Feed

# Nacionales. Cubren las noticias que cruzan equipos y son las que antes se
# publican en un traspaso o una baja larga.
NATIONAL: tuple[Feed, ...] = (
    Feed("https://www.espn.com/espn/rss/nfl/news", "ESPN"),
    Feed("https://api.foxsports.com/v1/rss?tag=nfl", "FOX Sports"),
    Feed("https://www.pff.com/feed", "PFF"),
    Feed("https://www.rotowire.com/rss/news.php?sport=NFL", "RotoWire"),
)

# De equipo. `team` en código nflverse: es lo que hace determinista el
# emparejamiento de jugadores, porque `narrative.matching` necesita el equipo
# para distinguir a dos jugadores con el mismo apellido.
#
# Se empieza por los ocho equipos con jugadores en la cabeza del board. El resto
# se añade cuando esto demuestre que aporta.
TEAMS: tuple[Feed, ...] = (
    Feed("https://www.espn.com/blog/sanfrancisco49ers/rss", "ESPN 49ers", team="SF"),
    Feed("https://www.espn.com/blog/losangelesrams/rss", "ESPN Rams", team="LAR"),
    Feed("https://www.espn.com/blog/atlantafalcons/rss", "ESPN Falcons", team="ATL"),
    Feed("https://www.espn.com/blog/detroitlions/rss", "ESPN Lions", team="DET"),
    Feed("https://www.espn.com/blog/cincinnatibengals/rss", "ESPN Bengals", team="CIN"),
    Feed("https://www.espn.com/blog/miamidolphins/rss", "ESPN Dolphins", team="MIA"),
    Feed("https://www.espn.com/blog/indianapoliscolts/rss", "ESPN Colts", team="IND"),
    Feed("https://www.espn.com/blog/arizonacardinals/rss", "ESPN Cardinals", team="ARI"),
)

ALL_FEEDS: tuple[Feed, ...] = NATIONAL + TEAMS
