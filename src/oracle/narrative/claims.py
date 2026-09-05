"""AFIRMACIONES: lo que la prensa dice, con esquema, linaje y sin borrar el desacuerdo.

El barrido diario deja FICHAS (`research/<fecha>.json`): titular, resumen,
equipo, jugadores, tipo, impacto, confianza, fuentes. Son texto para pantalla.
Este módulo las convierte, SIN modelo de lenguaje, en afirmaciones con esquema
fijo, para poder contar lo que hay, cruzarlas y decir qué las sostiene.

Tres decisiones, cada una con su motivo:

  1. **Normalizar el vocabulario.** El archivo lleva `OFICIAL` y `OFFICIAL`,
     `REPORTADO` y `REPORTED`, `neutro` y `neutral`: el mismo hecho con dos
     etiquetas. Contar por etiqueta daba dos clases donde había una. Aquí se
     traducen a UNA clase epistémica y a UN impacto, y lo que no se reconoce
     queda `UNKNOWN`, no «la primera que aparezca».

  2. **Superseder no es borrar.** Dos afirmaciones del mismo jugador y del
     mismo tipo se ordenan por su fecha de publicación (el archivo no trae
     `event_at`; y NUNCA la de descarga): la más nueva supersede a la anterior y la
     anterior se conserva con `status = SUPERSEDED`. Cuando además se
     contradicen en impacto (alza contra baja), las DOS quedan marcadas
     `DISPUTED`: «el equipo lo da dudoso» y «el reportero espera que juegue» no
     son la misma evidencia, y quedarse con una borra lo que decide una
     alineación (regla 5).

  3. **Un artículo no es una fuente.** `supporting_sources` cuenta ORÍGENES
     distintos por organización, no enlaces: catorce reescrituras de un informe
     son un origen. Esto es lo que `sources/lineage.py` exige y aquí se aplica
     por dominio, que es lo único que el archivo permite establecer sin
     inventar linaje.

Lo que este módulo NO hace: no toca ningún número del modelo (regla 8) y no
afirma frescura por su cuenta — `status` describe la relación entre
afirmaciones, y la frescura la decide `freshness.py` con sus ventanas.
"""
from __future__ import annotations

import hashlib
import re
from collections import Counter, defaultdict
from collections.abc import Iterable
from dataclasses import asdict, dataclass, field
from datetime import date, datetime
from urllib.parse import urlparse

# ---------------------------------------------------------------------------
# Vocabulario canónico
# ---------------------------------------------------------------------------

CLAIM_TYPES = frozenset({
    "INJURY", "STATUS", "DEPTH_CHART", "ROLE", "TRANSACTION", "DISCIPLINE",
    "CAMP", "ROSTER", "SCHEDULE", "OTHER",
})

_KIND_TO_TYPE = {
    "lesion": "INJURY", "injury": "INJURY", "lesión": "INJURY",
    "depth_chart": "DEPTH_CHART", "rol": "ROLE", "role": "ROLE",
    "transaccion": "TRANSACTION", "transacción": "TRANSACTION", "transaction": "TRANSACTION",
    "disciplina": "DISCIPLINE", "suspension": "DISCIPLINE", "suspensión": "DISCIPLINE",
    "camp": "CAMP", "roster": "ROSTER", "status": "STATUS", "estado": "STATUS",
    "calendario": "SCHEDULE", "schedule": "SCHEDULE", "otro": "OTHER", "other": "OTHER",
}

# Clase epistémica: qué clase de evidencia es. El orden importa para resolver.
EVIDENCE_CLASSES = ("OFFICIAL", "OBSERVED", "REPORTED", "OPINION", "UNKNOWN")
# `HECHO`/`FACT` es la etiqueta del barrido para «esto es un hecho», puesta por
# un modelo de lenguaje: NO es una comunicación oficial del equipo o la liga, y
# la clase OFFICIAL es la que `freshness` pone por delante de todo. Cae a
# REPORTED, que es lo que de verdad es: un medio afirmándolo.
_EVIDENCE = {
    "OFICIAL": "OFFICIAL", "OFFICIAL": "OFFICIAL", "HECHO": "REPORTED", "FACT": "REPORTED",
    "OBSERVADO": "OBSERVED", "OBSERVED": "OBSERVED",
    "REPORTADO": "REPORTED", "REPORTED": "REPORTED",
    "OPINION": "OPINION", "OPINIÓN": "OPINION",
}
# La confianza del barrido cae a la misma escala cuando no hay evidence_type.
_CONFIDENCE = {"oficial": "OFFICIAL", "confirmado": "REPORTED", "informado": "REPORTED", "rumor": "OPINION"}

_IMPACT = {"alza": "UP", "up": "UP", "baja": "DOWN", "down": "DOWN",
           "neutro": "NEUTRAL", "neutral": "NEUTRAL"}

STATUSES = ("CURRENT", "SUPERSEDED", "DISPUTED")


def normalize_evidence(evidence_type: object, confidence: object = None) -> str:
    """OFICIAL/OFFICIAL/HECHO -> OFFICIAL; sin tipo, la confianza; si no, UNKNOWN."""
    token = str(evidence_type or "").strip().upper()
    if token in _EVIDENCE:
        return _EVIDENCE[token]
    return _CONFIDENCE.get(str(confidence or "").strip().lower(), "UNKNOWN")


def normalize_impact(impact: object) -> str:
    return _IMPACT.get(str(impact or "").strip().lower(), "UNKNOWN")


def normalize_type(kind: object) -> str:
    return _KIND_TO_TYPE.get(str(kind or "").strip().lower(), "OTHER")


def _domain(url: object) -> str | None:
    if not url:
        return None
    host = urlparse(str(url)).netloc.lower()
    host = re.sub(r"^(www|m|amp)\.", "", host)
    return host or None


_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}")


def _day(stamp: object) -> str | None:
    """Sólo la fecha, y sólo si parece una. `None` antes que una inventada."""
    if isinstance(stamp, (datetime, date)):
        return stamp.strftime("%Y-%m-%d")
    text = str(stamp or "").strip()
    return text[:10] if _DATE.match(text) else None


# ---------------------------------------------------------------------------
# La afirmación
# ---------------------------------------------------------------------------

@dataclass
class Claim:
    claim_id: str
    subject: str                    # jugador (nombre) o equipo
    claim_type: str                 # CLAIM_TYPES
    statement: str                  # el titular, tal cual
    source: str | None              # dominio del primer enlace
    author: str | None
    published_at: str | None        # fecha de publicación (día)
    observed_at: str | None         # cuándo lo vio el barrido — NUNCA da frescura
    team: str | None
    player_id: str | None
    confidence_class: str           # EVIDENCE_CLASSES
    impact: str                     # UP / DOWN / NEUTRAL / UNKNOWN
    status: str = "CURRENT"         # STATUSES
    supersedes: str | None = None
    supporting_sources: int = 0     # ORÍGENES distintos, no enlaces
    source_domains: tuple[str, ...] = field(default=())
    beat: str | None = None
    # Identidad: la afirmación EXISTE aunque no se sepa de quién es. Sólo la
    # RESOLVED se puede colgar de la ficha de un jugador; el resto se queda a
    # nivel de equipo, con su sujeto en crudo.
    identity_status: str = "UNRESOLVED"   # RESOLVED | AMBIGUOUS | UNRESOLVED | NO_TEAM | NO_SUBJECT
    subject_raw: str | None = None

    @property
    def product_linked(self) -> bool:
        """¿Puede colgarse de la ficha de un jugador? Sólo con identidad resuelta."""
        return self.identity_status == "RESOLVED" and bool(self.player_id)

    @property
    def as_of(self) -> str | None:
        """La fecha que ordena: publicación. La de descarga no cuenta."""
        return self.published_at

    def to_dict(self) -> dict:
        return asdict(self)


def claim_id_for(item: dict) -> str:
    raw = "|".join(str(item.get(k) or "") for k in ("team", "headline", "published_at", "first_seen_at"))
    return "c_" + hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


def claim_from_item(item: dict, *, observed_at: str | None = None) -> Claim:
    sources = [s for s in (item.get("sources") or []) if isinstance(s, dict)]
    domains = tuple(sorted({d for d in (_domain(s.get("url")) for s in sources) if d}))
    players = item.get("players") or []
    ids = item.get("player_ids") or []
    first_source = sources[0] if sources else {}
    return Claim(
        claim_id=claim_id_for(item),
        subject=str(players[0]) if players else str(item.get("team") or "UNKNOWN"),
        claim_type=normalize_type(item.get("kind")),
        statement=str(item.get("headline") or "").strip(),
        source=_domain(first_source.get("url")) if first_source else None,
        author=(first_source.get("author") or None) if first_source else None,
        published_at=_day(item.get("published_at")) or _day(item.get("published")),
        observed_at=_day(item.get("first_seen_at")) or _day(observed_at),
        team=item.get("team") or None,
        player_id=str(ids[0]) if ids else None,
        confidence_class=normalize_evidence(item.get("evidence_type"), item.get("confidence")),
        impact=normalize_impact(item.get("impact")),
        supporting_sources=len(domains),
        source_domains=domains,
        beat=item.get("beat") or None,
        identity_status=("RESOLVED" if ids else ("UNRESOLVED" if players else "NO_SUBJECT")),
        subject_raw=str(players[0]) if players else None,
    )


def claims_from_archive(days: list[dict]) -> list[Claim]:
    """Todas las fichas de todos los días, como afirmaciones. Sin deduplicar."""
    out: list[Claim] = []
    for day in days:
        stamp = day.get("date") if isinstance(day, dict) else None
        for item in (day.get("items", []) if isinstance(day, dict) else []):
            out.append(claim_from_item(item, observed_at=stamp))
    return out


# ---------------------------------------------------------------------------
# Supersesión y contradicción
# ---------------------------------------------------------------------------

def resolve_identities(claims: list[Claim], players: Iterable[dict]) -> list[Claim]:
    """Cuelga cada afirmación de su jugador por el índice canónico, o no.

    Usa el MISMO índice y la MISMA regla conservadora que la prensa del board
    (`matching.build_index` / `_pick`): nombre completo idéntico, o abreviado
    único en ese equipo. Lo que ya venía con `player_id` del barrido se
    respeta. Lo demás queda UNRESOLVED o AMBIGUOUS, y la afirmación sigue
    existiendo con su sujeto en crudo.
    """
    from .matching import build_index, resolve_one

    index = build_index(players)
    for claim in claims:
        if claim.player_id or claim.identity_status == "NO_SUBJECT":
            continue
        pid, status = resolve_one(claim.subject_raw or claim.subject, claim.team, index)
        claim.player_id = pid
        claim.identity_status = status
    return claims


def _key(claim: Claim) -> tuple[str, str] | None:
    """Sobre quién y sobre qué. Sin sujeto identificable no se cruza nada.

    Sin `player_id` —que hoy son TODAS las fichas del archivo— el nombre va con
    el EQUIPO: dos «Josh Allen» de equipos distintos no se superseden entre sí.
    Es la lección de los dos Robinson, y sin equipo no se cruza: un nombre
    suelto sin equipo no identifica a nadie.
    """
    if claim.player_id and claim.identity_status == "RESOLVED":
        return (claim.player_id.lower(), claim.claim_type)
    if not claim.team or claim.subject == claim.team:
        return None
    return (f"{claim.subject.lower()}@{claim.team.upper()}", claim.claim_type)


def link(claims: list[Claim]) -> list[Claim]:
    """Ordena por fecha dentro de cada (sujeto, tipo) y marca la relación.

    · la más nueva es CURRENT y `supersedes` a la anterior;
    · las anteriores quedan SUPERSEDED — se conservan;
    · si dos consecutivas discrepan en impacto (UP contra DOWN), las dos son
      DISPUTED: el desacuerdo es información y no se resuelve aquí.
    · sin fecha de publicación no se puede ordenar: la afirmación se queda
      CURRENT y fuera de la cadena, en vez de colocarse por la de descarga.
    """
    groups: dict[tuple[str, str], list[Claim]] = defaultdict(list)
    for claim in claims:
        key = _key(claim)
        if key is not None and claim.as_of:
            groups[key].append(claim)
    for group in groups.values():
        group.sort(key=lambda c: (c.as_of, c.claim_id))
        for previous, current in zip(group, group[1:], strict=False):
            current.supersedes = previous.claim_id
            # Una disputa ya marcada NO se pisa al seguir la cadena: A(UP) →
            # B(DOWN) → C(DOWN) deja A y B en disputa aunque C supersede a B.
            if previous.status != "DISPUTED":
                previous.status = "SUPERSEDED"
            if {previous.impact, current.impact} == {"UP", "DOWN"}:
                previous.status = "DISPUTED"
                current.status = "DISPUTED"
    return claims


def contradictions(claims: list[Claim]) -> list[tuple[Claim, Claim]]:
    """Pares que discrepan en dirección, en orden: (anterior, posterior).

    Se decide por los IMPACTOS del par, no por el estado: el estado de la
    anterior puede haber pasado a SUPERSEDED por una tercera afirmación y la
    discrepancia entre las dos primeras sigue siendo información.
    """
    by_id = {c.claim_id: c for c in claims}
    out = []
    for c in claims:
        prev = by_id.get(c.supersedes) if c.supersedes else None
        if prev is not None and {prev.impact, c.impact} == {"UP", "DOWN"}:
            out.append((prev, c))
    return out


# ---------------------------------------------------------------------------
# Estado actual: cronología + autoridad, no el último titular
# ---------------------------------------------------------------------------

_AUTHORITY = {"OFFICIAL": 4, "OBSERVED": 3, "REPORTED": 2, "OPINION": 1, "UNKNOWN": 0}


@dataclass
class CurrentState:
    """Lo que hoy se puede afirmar de (sujeto, tipo), con lo que discrepa al lado."""

    current: Claim
    others: tuple[Claim, ...]
    disputed: bool

    @property
    def basis(self) -> str:
        return f"{self.current.confidence_class} {self.current.published_at or 'undated'}"


def current_state(claims: list[Claim]) -> dict[tuple[str, str], CurrentState]:
    """El estado actual por (sujeto, tipo): primero lo OFICIAL, después lo más nuevo.

    Es la regla 5 aplicada a las afirmaciones: «el equipo lo da inactivo» (oficial,
    domingo) manda sobre «el reportero esperaba que jugara» (reportado, martes o
    viernes), y al revés también: un oficial del viernes sigue mandando sobre un
    reportero del sábado. Entre iguales de clase, la más nueva. Lo que pierde
    NO se borra: va en `others`, y si discrepa en dirección, `disputed`.

    Sin fecha de publicación no se puede ordenar y la afirmación no compite:
    aparece sólo en `others`, nunca como estado actual.
    """
    groups: dict[tuple[str, str], list[Claim]] = defaultdict(list)
    for claim in claims:
        key = _key(claim)
        if key is not None:
            groups[key].append(claim)
    out: dict[tuple[str, str], CurrentState] = {}
    for key, group in groups.items():
        dated = [c for c in group if c.as_of]
        if not dated:
            continue
        winner = max(dated, key=lambda c: (_AUTHORITY.get(c.confidence_class, 0), c.as_of, c.claim_id))
        others = tuple(c for c in group if c is not winner)
        disputed = any({o.impact, winner.impact} == {"UP", "DOWN"} for o in others)
        out[key] = CurrentState(current=winner, others=others, disputed=disputed)
    return out


# ---------------------------------------------------------------------------
# Cobertura: lo que hay y lo que falta, en números
# ---------------------------------------------------------------------------

def coverage(claims: list[Claim]) -> dict:
    n = len(claims)
    by_team = Counter(c.team or "UNKNOWN" for c in claims)
    by_type = Counter(c.claim_type for c in claims)
    by_class = Counter(c.confidence_class for c in claims)
    return {
        "claims": n,
        "with_player_id": sum(1 for c in claims if c.player_id),
        "identity": dict(Counter(c.identity_status for c in claims).most_common()),
        "product_linked": sum(1 for c in claims if c.product_linked),
        "with_published_at": sum(1 for c in claims if c.published_at),
        "with_author": sum(1 for c in claims if c.author),
        "single_origin": sum(1 for c in claims if c.supporting_sources <= 1),
        "multi_origin": sum(1 for c in claims if c.supporting_sources >= 2),
        "unknown_class": by_class.get("UNKNOWN", 0),
        "unknown_impact": sum(1 for c in claims if c.impact == "UNKNOWN"),
        "superseded": sum(1 for c in claims if c.status == "SUPERSEDED"),
        "disputed": sum(1 for c in claims if c.status == "DISPUTED"),
        "teams_covered": sum(1 for t in by_team if t != "UNKNOWN"),
        "by_team": dict(sorted(by_team.items())),
        "by_type": dict(by_type.most_common()),
        "by_class": dict(by_class.most_common()),
    }
