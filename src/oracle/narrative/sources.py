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

# LOS 32 CLUBES, OFICIALES. Es la fuente que primero y mejor dice lo que decide
# un pick la víspera de un draft —una baja, una lista de reserva, un corte, un
# cambio de titular— y la única que lo dice como parte interesada declarada, que
# para un HECHO administrativo es exactamente lo que se quiere.
#
# Se añaden con su código de equipo, que es lo que permite emparejar sin
# adivinar. Los ocho blogs de ESPN de arriba llevan meses respondiendo VACÍO
# —medido en CI el 6 de septiembre de 2026, run 34019693087— así que la
# cobertura por equipo del barrido era CERO. No se borran: su salud se sigue
# publicando, y un feed que responde vacío es un dato distinto de uno que no se
# consultó.
#
# Ninguno de estos 32 está verificado desde aquí: la política de egreso de este
# contenedor deniega el CONNECT. Se comprueban en `research-feeds.yml`, que es
# donde hay salida, y el artefacto publica cuál contestó y cuál no.
OFFICIAL: tuple[Feed, ...] = (
    Feed("https://www.azcardinals.com/rss/news", "ARI official", team="ARI"),
    Feed("https://www.atlantafalcons.com/rss/news", "ATL official", team="ATL"),
    Feed("https://www.baltimoreravens.com/rss/news", "BAL official", team="BAL"),
    Feed("https://www.buffalobills.com/rss/news", "BUF official", team="BUF"),
    Feed("https://www.panthers.com/rss/news", "CAR official", team="CAR"),
    Feed("https://www.chicagobears.com/rss/news", "CHI official", team="CHI"),
    Feed("https://www.bengals.com/rss/news", "CIN official", team="CIN"),
    Feed("https://www.clevelandbrowns.com/rss/news", "CLE official", team="CLE"),
    Feed("https://www.dallascowboys.com/rss/news", "DAL official", team="DAL"),
    Feed("https://www.denverbroncos.com/rss/news", "DEN official", team="DEN"),
    Feed("https://www.detroitlions.com/rss/news", "DET official", team="DET"),
    Feed("https://www.packers.com/rss/news", "GB official", team="GB"),
    Feed("https://www.houstontexans.com/rss/news", "HOU official", team="HOU"),
    Feed("https://www.colts.com/rss/news", "IND official", team="IND"),
    Feed("https://www.jaguars.com/rss/news", "JAX official", team="JAX"),
    Feed("https://www.chiefs.com/rss/news", "KC official", team="KC"),
    Feed("https://www.raiders.com/rss/news", "LV official", team="LV"),
    Feed("https://www.chargers.com/rss/news", "LAC official", team="LAC"),
    Feed("https://www.therams.com/rss/news", "LAR official", team="LAR"),
    Feed("https://www.miamidolphins.com/rss/news", "MIA official", team="MIA"),
    Feed("https://www.vikings.com/rss/news", "MIN official", team="MIN"),
    Feed("https://www.patriots.com/rss/news", "NE official", team="NE"),
    Feed("https://www.neworleanssaints.com/rss/news", "NO official", team="NO"),
    Feed("https://www.giants.com/rss/news", "NYG official", team="NYG"),
    Feed("https://www.newyorkjets.com/rss/news", "NYJ official", team="NYJ"),
    Feed("https://www.philadelphiaeagles.com/rss/news", "PHI official", team="PHI"),
    Feed("https://www.steelers.com/rss/news", "PIT official", team="PIT"),
    Feed("https://www.49ers.com/rss/news", "SF official", team="SF"),
    Feed("https://www.seahawks.com/rss/news", "SEA official", team="SEA"),
    Feed("https://www.buccaneers.com/rss/news", "TB official", team="TB"),
    Feed("https://www.tennesseetitans.com/rss/news", "TEN official", team="TEN"),
    Feed("https://www.commanders.com/rss/news", "WAS official", team="WAS"),
)

ALL_FEEDS: tuple[Feed, ...] = NATIONAL + TEAMS + OFFICIAL
