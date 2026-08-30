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
    """Titulares por equipo y posición, con el flex ya repartido por pesos."""
    has_kicker: bool = False
    has_defense: bool = False
    bench: int = 0
    source: str = "sleeper"
    dedicated: dict[str, int] | None = None
    """Huecos DEDICADOS por equipo, sin flex. Es lo que necesita el voraz."""
    flex: int = 0
    superflex: int = 0

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

    @property
    def starter_slots(self) -> int:
        """Huecos titulares de fantasy en la liga entera.

        Es el número que la asignación voraz tiene que consumir EXACTAMENTE.
        Pateador y defensa no cuentan: no entran en el board por VOR.
        """
        per_team = sum((self.dedicated or {}).values()) + self.flex + self.superflex
        return int(self.teams * per_team)

    def describe(self) -> str:
        """La liga en una línea, para que la interfaz no invente la etiqueta."""
        parts = [f"{self.teams}-team"]
        if self.is_superflex:
            parts.append("Superflex")
        return " · ".join(parts)


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

    # Los huecos DEDICADOS, antes de repartir nada. El voraz los necesita
    # enteros: repartir primero y deshacer después perdería la información de
    # qué huecos son de una posición y cuáles se comparten.
    dedicated = {position: int(count) for position, count in starters.items()}

    for position, weight in FLEX_WEIGHTS.items():
        starters[position] += flex * weight
    for position, weight in SUPERFLEX_WEIGHTS.items():
        starters[position] += superflex * weight

    if sum(starters.values()) <= 0:
        raise UnsupportedRoster(f"Ninguna posición de fantasy en {roster_positions!r}")

    return LeagueContext(
        league_id=league_id, season=season, teams=teams, starters=starters,
        has_kicker=has_kicker, has_defense=has_defense, bench=bench,
        dedicated=dedicated, flex=int(flex), superflex=int(superflex),
    )


# Qué posiciones admite cada clase de hueco compartido. Es la tabla que hace que
# la competencia por el flex sea explícita en vez de postulada.
FLEX_ELIGIBLE: tuple[str, ...] = ("RB", "WR", "TE")
SUPERFLEX_ELIGIBLE: tuple[str, ...] = ("QB", "RB", "WR", "TE")


def greedy_replacement(
    points_by_position: dict[str, list[float]],
    context: LeagueContext,
) -> tuple[dict[str, float], dict[str, int], int]:
    """Nivel de reemplazo asignando de verdad los huecos compartidos.

    ## Qué está mal en repartir el flex por pesos

    El reparto por pesos calcula el reemplazo de cada posición **como si el hueco
    compartido no existiera**: le suma a RB su trozo, a WR el suyo, a TE el suyo,
    y redondea cada uno por separado. Dos consecuencias:

    1. La demanda total deja de cuadrar. Tres redondeos independientes no suman
       los huecos que la liga define, así que el board se calcula contra una liga
       que no es la del usuario — por poco, pero sistemáticamente.
    2. El peso es una convención, no una medida. Dice que el 45% de los flex son
       corredores **antes** de mirar quiénes están disponibles, cuando eso es
       justo lo que decide quién ocupa el hueco.

    ## Lo que hace esto

    Llena los huecos dedicados de toda la liga, y después cada hueco compartido
    se lo lleva la posición cuyo **mejor jugador libre vale más** en ese momento.
    El reemplazo de una posición es su mejor jugador que no entró de titular.

    La competencia entre RB, WR y TE por el flex —y del QB por el superflex—
    queda dentro del cálculo en vez de en una constante. Y la demanda cuadra por
    construcción: se consume un jugador por hueco, ni uno más.

    ## Lo que este reparto NO resuelve, dicho aquí

    Los huecos compartidos se asignan por **puntos brutos**, que es como los
    llena un mánager de verdad: alineas al que más suma. Para un FLEX entre RB,
    WR y TE eso está bien — son escalas comparables.

    Para un SUPER_FLEX que admite quarterback **no** lo está del todo: el QB suma
    del orden de 1,7 veces más que un receptor, así que gana el hueco por escala
    y no por valor marginal. En datos reales apunta al mismo sitio que la
    realidad —los superflex se llenan con quarterbacks— pero coincide por el
    motivo aproximado, no por el exacto. El reparto correcto iteraría hasta un
    punto fijo sobre el VOR, que es circular: el VOR depende del reemplazo y el
    reemplazo del reparto. No se ha hecho, y por eso no se afirma.

    Se vio con un fixture sintético cuyo QB24 valía menos que el WR40: allí el
    voraz mandaba huecos de superflex a receptores, correctamente para ese pool y
    absurdamente para el fútbol. El fixture estaba mal calibrado; la lección es
    que la regla es sensible a la escala relativa entre posiciones.

    Devuelve `(puntos_de_reemplazo, rank_de_reemplazo, huecos_consumidos)`.
    """
    ranked = {
        position: sorted(points, reverse=True)
        for position, points in points_by_position.items()
    }
    taken = dict.fromkeys(ranked, 0)
    dedicated = context.dedicated or {}

    def best_available(position: str) -> float | None:
        pool = ranked.get(position) or []
        index = taken.get(position, 0)
        return pool[index] if index < len(pool) else None

    def claim(position: str) -> bool:
        if best_available(position) is None:
            return False
        taken[position] += 1
        return True

    consumed = 0
    # 1. Huecos dedicados. Se llenan todos los equipos a la vez porque el orden
    #    entre equipos no cambia quién queda libre al final, sólo quién se lleva
    #    a quién — y el reemplazo depende de cuántos salen, no de a qué equipo.
    for position, per_team in dedicated.items():
        for _ in range(int(per_team) * context.teams):
            if claim(position):
                consumed += 1

    # 2. Huecos compartidos, en orden de valor. Cada uno va a la posición cuyo
    #    mejor jugador libre vale más AHORA: por eso el primer flex se lo puede
    #    llevar un RB y el décimo un TE, sin que nadie lo haya decidido antes.
    shared: list[tuple[str, ...]] = []
    shared += [SUPERFLEX_ELIGIBLE] * (context.superflex * context.teams)
    shared += [FLEX_ELIGIBLE] * (context.flex * context.teams)
    for eligible in shared:
        candidates = [
            (best_available(position), position)
            for position in eligible
            if best_available(position) is not None
        ]
        if not candidates:
            continue
        _, position = max(candidates)
        if claim(position):
            consumed += 1

    replacement: dict[str, float] = {}
    rank: dict[str, int] = {}
    for position, pool in ranked.items():
        if not pool:
            continue
        # El reemplazo es el mejor que NO entró de titular. Si se agotó la
        # posición entera se usa el último: no hay nadie peor al que apuntar, y
        # decir cero fabricaría un VOR enorme para toda la posición.
        index = min(taken.get(position, 0), len(pool) - 1)
        replacement[position] = float(pool[index])
        rank[position] = index + 1
    return replacement, rank, consumed


# Hasta dónde está VALIDADO el valor por liga.
#
# E18 pasó sus 16 propiedades a 10, 12 y 14 equipos. Al extenderlo a 32 —el
# máximo con sentido, una franquicia por equipo NFL— fallaron dos, y las dos son
# de MAGNITUD, no de estructura:
#
#   - el VOR del quarterback en superflex sube +10,5 puntos, no los +20 exigidos
#   - no entra ni un quarterback más en el top-25
#
# El diagnóstico no es que superflex importe menos en una liga profunda: es que
# **el ancla de reemplazo cae donde la proyección ya es casi el prior**. Medido:
# entre el QB33 y el QB65 hay 30 puntos en bruto y 11 después de encoger — el
# encogimiento se come el 65%. A esa profundidad el QB45 tiene 0,3 partidos
# ponderados y una proyección bruta de 10 puntos, y sale por encima del QB65 que
# tiene 7,1 partidos y un ritmo real de 164. El orden ahí no es información.
#
# Lo que sigue siendo cierto a 32 equipos: el reparto consume exactamente los
# huecos, el reemplazo se profundiza de forma monótona y el rank del QB se dobla.
# La ESTRUCTURA responde bien; lo que no se sostiene es la magnitud del valor.
#
# Publicar más jugadores no lo arregla — no es un problema de pool, es del
# modelo de proyección. Arreglarlo es no encoger tan fuerte, o excluir del ancla
# a quien no tenga muestra, y las dos cosas exigen su propia validación.
VALIDATED_MAX_TEAMS = 14


def value_confidence(context: LeagueContext) -> str:
    """¿Está validado el VALOR en una liga de este tamaño?

    `VALIDATED` o `UNVALIDATED_DEPTH`. No es un cero/uno sobre si el número se
    puede calcular —se puede— sino sobre si se ha comprobado que signifique algo.
    Enseñar un VOR de liga profunda sin decir esto sería exactamente la clase de
    número correcto de forma aparente que este proyecto existe para no publicar.
    """
    return "VALIDATED" if context.teams <= VALIDATED_MAX_TEAMS else "UNVALIDATED_DEPTH"


# ===========================================================================
# PRESETS DE PLANTILLA — plantillas conocidas, nunca respaldos silenciosos
# ===========================================================================
#
#     UN PRESET ES UNA COMODIDAD. NO ES LO QUE UNA LIGA DESCONOCIDA TIENE.
#
# Estas listas existen para dos cosas: sembrar un configurador y servir de
# fixture de regresión. Lo que NO hacen es rellenar una liga cuya estructura no
# se ha leído: para eso está UNKNOWN, y `roster_context` levanta si le falta el
# dato. Colar un preset como configuración real es exactamente el fallo que ya
# costó una iteración con `counts[pos] or DEFAULT_STARTERS[pos]`.

#: Plantilla estándar confirmada por el dueño del repositorio. Nueve huecos.
NORMAL_ROSTER: tuple[str, ...] = (
    "QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DEF", "K",
)

#: Liga especial de 32 equipos, observada en su pantalla de plantilla. Seis
#: huecos, sin quarterback ni ala cerrada dedicados. NO es una variante de la
#: anterior y las dos no se mezclan nunca.
DEEP_32_ROSTER: tuple[str, ...] = (
    "RB", "WR", "FLEX", "FLEX", "FLEX", "SUPER_FLEX",
)

# Qué admite cada hueco al PINTAR una plantilla. Es elegibilidad de la liga, no
# una opinión sobre a quién conviene poner ahí.
SLOT_ELIGIBILITY: dict[str, tuple[str, ...]] = {
    "QB": ("QB",),
    "RB": ("RB",),
    "WR": ("WR",),
    "TE": ("TE",),
    "FLEX": ("RB", "WR", "TE"),
    "SUPER_FLEX": ("QB", "RB", "WR", "TE"),
    "K": ("K",),
    "DEF": ("DST", "DEF"),
    "DST": ("DST", "DEF"),
}


def assign_slots(
    players: list[dict],
    roster_positions: list[str],
) -> tuple[list[dict], list[dict]]:
    """Reparte jugadores en huecos de plantilla, para PINTARLOS.

    Es lógica de presentación. Devuelve `(huecos, sin_sitio)`, donde cada hueco
    lleva `{"slot", "player"}` y `player` es `None` si está libre.

    ## El orden importa, y no es el obvio

    Se llenan **primero los huecos dedicados y al final los más permisivos**:
    QB/RB/WR/TE, luego FLEX, luego SUPER_FLEX. Al revés —empezando por el
    superflex— un jugador que sólo cabía en su hueco dedicado puede quedarse sin
    sitio porque un flexible se lo llevó, y la plantilla aparecería con un hueco
    abierto y un jugador sobrante que sí encajaba. El orden restrictivo →
    permisivo evita ese caso sin buscar ningún máximo.

    Dentro de cada hueco, entre varios elegibles gana el de más valor publicado.
    Es determinista, que es lo único que se le exige.

    ## Lo que NO es

    No dice a quién conviene alinear ni qué falta por draftear. Un hueco abierto
    es un hecho de la plantilla; convertirlo en «te falta un corredor» sería una
    recomendación, y `BEST_PICK_FOR_ME` sigue BLOCKED.
    """
    orden = {"QB": 0, "RB": 0, "WR": 0, "TE": 0, "K": 0, "DEF": 0, "DST": 0,
             "FLEX": 1, "SUPER_FLEX": 2}
    huecos = [
        {"index": i, "slot": str(s).upper().strip(), "player": None}
        for i, s in enumerate(roster_positions)
        if str(s).upper().strip() not in BENCH_SLOTS
    ]
    libres = sorted(
        (h for h in huecos if h["slot"] in SLOT_ELIGIBILITY),
        key=lambda h: (orden.get(h["slot"], 3), h["index"]),
    )
    # Mayor valor primero: quien más vale entra antes en el hueco más ajustado.
    pendientes = sorted(
        players, key=lambda p: float(p.get("vor") or p.get("projected_points") or 0.0),
        reverse=True,
    )

    for hueco in libres:
        elegibles = SLOT_ELIGIBILITY[hueco["slot"]]
        for jugador in pendientes:
            if str(jugador.get("position", "")).upper() in elegibles:
                hueco["player"] = jugador
                pendientes.remove(jugador)
                break

    huecos.sort(key=lambda h: h["index"])
    return huecos, pendientes
