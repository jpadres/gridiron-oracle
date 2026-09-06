"""Estado de disponibilidad de un jugador: suspensiones, exenciones y listas.

## El agujero que tapa

`mark_rostered` sabe quién NO está en ninguna plantilla. Lo que no sabe —porque
no está en los datos— es que un jugador **que sí figura en su plantilla** no va a
jugar: Josh Jacobs aparece `ACT` en Green Bay estando en la Lista de Exentos del
Comisionado sin fecha de vuelta, y salía en el puesto 38 del board como si nada.

Eso no se arregla con un campo nuevo de nflverse, porque nflverse no lo publica.
Lo tiene que traer la capa de prensa, con su fuente y su fecha. Este fichero es
el traductor: de una nota curada a una marca en la fila.

## LO QUE ESTO NO HACE, Y NO ES UN DESCUIDO

    NO TOCA NINGÚN NÚMERO.

Ni la proyección, ni el VOR, ni el tier. Es la regla 8 del proyecto y aquí no
tiene excepción: la garantía anti-fuga se demuestra recalculando features con el
historial truncado, y una noticia de agosto no tiene fecha comprobable dentro de
esa pasada. En cuanto moviera un número, esa demostración deja de valer — y con
ella todas las métricas de validación.

Lo que sí hace es **marcar** y **dejar de recomendar**, que son cosas distintas
de calcular. El jugador sigue en el board, con su número intacto y buscable; lo
que no hace es encabezar una lista corta que dice «lo mejor disponible» sobre
alguien que no va a jugar. Es exactamente lo que ya se hacía con SIN EQUIPO.

## Identidad: por id, nunca por nombre

Cada entrada trae el `player_id` de nflverse ya resuelto. El fichero es curado y
se versiona: emparejar por nombre en tiempo de ejecución es cómo «B.Robinson»
acabó siendo el Robinson equivocado. Una entrada cuyo id no está en el board no
se emparejará con nadie — y se dice cuántas, en vez de callarlo.

## Frescura: el ESTADO dura, la VERIFICACIÓN caduca

Una suspensión anunciada el 30 de agosto sigue en vigor el 15 de septiembre: el
estado no envejece solo. Lo que envejece es nuestra comprobación de que sigue
ahí. Por eso hay dos fechas y hacen cosas distintas:

    effective_at  cuándo empezó el estado          (hecho, no caduca)
    verified_at   cuándo lo comprobamos por última (esto SÍ caduca)

Pasada la ventana de verificación no se borra la marca —sería peor: diría
«disponible» de alguien apartado— sino que deja de afirmarse como actual y pasa
a «último verificado [fecha]». Es la regla 5 aplicada a un estado en vez de a una
cifra: UNKNOWN > STALE PRESENTADO COMO ACTUAL.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

# Cuánto puede pasar sin recomprobar un estado antes de dejar de afirmarlo como
# actual. Siete días es una semana de partidos: en ese plazo un jugador sale de
# la lista, se activa desde PUP o cumple su suspensión, y nadie lo habría
# comprobado. No borra la marca; le quita el presente.
VERIFY_WINDOW = timedelta(days=7)

# El catálogo. Cada estado dice DOS cosas distintas que no se pueden confundir:
# qué es (la etiqueta que se pinta) y qué implica para recomendar.
#
#   OUT   no va a jugar en el arranque, por decisión de la liga o del equipo.
#         Sale del board de recomendados; sigue en la lista y buscable.
#   RISK  puede jugar y puede no jugar. Se marca y NO se saca: sacar a alguien
#         del board por una duda es tomar la decisión por quien draftea.
#
# Un estado que no esté aquí se rechaza al cargar en vez de tratarse como leve:
# un estado desconocido tratado como RISK es exactamente cómo una suspensión
# entraría en la lista corta sin que nadie lo note.
SEVERITY: dict[str, str] = {
    "SUSPENDED": "OUT",     # suspensión de la liga, con partidos contados
    "EXEMPT": "OUT",        # Lista de Exentos del Comisionado, sin fecha
    "IR": "OUT",            # reserva de lesionados: mínimo cuatro partidos
    "RESERVE_PUP": "OUT",   # PUP de temporada: mínimo cuatro partidos
    "NFI": "OUT",           # non-football injury, mismo mínimo
    "RETIRED": "OUT",
    "OUT_FOR_SEASON": "OUT",
    "UNSIGNED": "OUT",      # agente libre sin equipo (redundante con `rostered`,
                            # pero una fuente puede saberlo antes que el roster)
    "ACTIVE_PUP": "RISK",   # PUP activo: puede activarse en cualquier momento
    "HOLDOUT": "RISK",
    "QUESTIONABLE": "RISK",
}

# Cómo se pinta cada uno. En inglés porque la interfaz está en inglés; el código
# es la clave estable y la etiqueta puede cambiar sin romper nada.
LABEL: dict[str, str] = {
    "SUSPENDED": "SUSPENDED",
    "EXEMPT": "EXEMPT LIST",
    "IR": "IR",
    "RESERVE_PUP": "RESERVE/PUP",
    "NFI": "NFI",
    "RETIRED": "RETIRED",
    "OUT_FOR_SEASON": "OUT FOR SEASON",
    # «NO NFL TEAM» y no «FREE AGENT»: en la pantalla de la liga, `FA` ya
    # significa «libre EN TU LIGA», que es lo contrario de un problema. Las dos
    # etiquetas salían juntas en la misma fila diciendo cosas opuestas.
    "UNSIGNED": "NO NFL TEAM",
    "ACTIVE_PUP": "PUP",
    "HOLDOUT": "HOLDOUT",
    "QUESTIONABLE": "QUESTIONABLE",
}


class BadStatusFile(ValueError):
    """El fichero curado no cumple el contrato. Se falla, no se ignora."""


@dataclass(frozen=True)
class PlayerStatus:
    player_id: str
    player: str
    status: str
    detail: str
    effective_at: str
    verified_at: str
    sources: tuple[dict, ...]
    games_out: int | None = None
    team: str | None = None

    @property
    def severity(self) -> str:
        return SEVERITY[self.status]

    def freshness(self, now: datetime | None = None) -> str:
        """`CURRENT` si la verificación está dentro de ventana; si no, la fecha.

        Devuelve `CURRENT` o `LAST_VERIFIED`. No devuelve `LIVE` nunca: esto es
        un documento curado, y LIVE está reservado a lo que llega como flujo.
        """
        now = now or datetime.now(UTC)
        try:
            verified = datetime.fromisoformat(self.verified_at)
        except ValueError:
            return "LAST_VERIFIED"
        if verified.tzinfo is None:
            verified = verified.replace(tzinfo=UTC)
        age = now - verified
        # Una fecha en el futuro no es «fresquísima»: es un dato que no se puede
        # situar. Misma regla que `freshness.classify`.
        if age < timedelta(0):
            return "LAST_VERIFIED"
        return "CURRENT" if age <= VERIFY_WINDOW else "LAST_VERIFIED"


def load(path: Path | str) -> list[PlayerStatus]:
    """Lee el fichero curado. Sin fichero, lista vacía; con fichero malo, falla.

    La asimetría es deliberada: que no haya estados es normal (no hay ninguno
    que declarar), pero un fichero que existe y está mal escrito significa que
    alguien creyó que estaba marcando a un jugador y no lo estaba. Eso tiene que
    doler en el build, no salir en silencio.
    """
    path = Path(path)
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    entries = data.get("entries")
    if not isinstance(entries, list):
        raise BadStatusFile("`entries` tiene que ser una lista")

    out: list[PlayerStatus] = []
    vistos: set[str] = set()
    for i, raw in enumerate(entries):
        for field in ("player_id", "player", "status", "detail",
                      "effective_at", "verified_at", "sources"):
            if not raw.get(field):
                raise BadStatusFile(f"entrada {i}: falta `{field}`")
        status = str(raw["status"])
        if status not in SEVERITY:
            raise BadStatusFile(
                f"entrada {i}: estado desconocido «{status}». Añádelo a SEVERITY "
                "decidiendo si es OUT o RISK; tratarlo como leve por defecto es "
                "cómo una suspensión acaba en la lista corta."
            )
        player_id = str(raw["player_id"])
        if player_id in vistos:
            raise BadStatusFile(
                f"entrada {i}: {raw['player']} aparece dos veces. Dos estados "
                "para el mismo jugador es un desacuerdo sin resolver, y la fila "
                "sólo puede pintar uno."
            )
        vistos.add(player_id)
        out.append(PlayerStatus(
            player_id=player_id,
            player=str(raw["player"]),
            status=status,
            detail=str(raw["detail"]),
            effective_at=str(raw["effective_at"]),
            verified_at=str(raw["verified_at"]),
            sources=tuple(raw["sources"]),
            games_out=int(raw["games_out"]) if raw.get("games_out") is not None else None,
            team=raw.get("team"),
        ))
    return out


def attach(rows: list[dict], entries: list[PlayerStatus], now: datetime | None = None) -> int:
    """Cuelga el estado de cada fila que lo tenga. Devuelve cuántas se marcaron.

    Escribe campos con prefijo `status_` y **no toca ningún otro**. Que esta
    función no pueda cambiar `projected_points` ni `vor` no es una casualidad de
    la implementación: es lo que hace que la regla 8 se pueda comprobar leyendo
    veinte líneas.
    """
    by_id = {e.player_id: e for e in entries}
    marcadas = 0
    for row in rows:
        entry = by_id.get(str(row.get("player_id")))
        if entry is None:
            continue
        row["status"] = entry.status
        row["status_label"] = LABEL[entry.status]
        row["status_severity"] = entry.severity
        row["status_detail"] = entry.detail
        row["status_games_out"] = entry.games_out
        row["status_effective_at"] = entry.effective_at
        row["status_verified_at"] = entry.verified_at
        row["status_freshness"] = entry.freshness(now)
        row["status_sources"] = [
            {"outlet": s.get("outlet"), "url": s.get("url")} for s in entry.sources
        ]
        marcadas += 1
    return marcadas
