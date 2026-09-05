"""Registro de capacidades: qué puede y qué no puede afirmar este producto.

Bloques D y E del Decision Lab V2.

## El problema que resuelve

Un modelo puede producir un número perfectamente utilizable y **aun así no tener
autoridad para respaldar una recomendación**. Las dos cosas a la vez.

El caso que motivó esto: el modelo de quarterback proyecta puntos razonables
—T.Lawrence 22,6— y la capacidad de recomendar Start/Sit de QB **no está
validada**: pierde contra la media ponderada de sus seis últimos partidos por
tres vías independientes (Spearman 0,213 vs 0,248; acierto por pares 54,2% vs
54,4%; y el MAE sólo gana tras mezclar). La interfaz puede enseñar ese 22,6.
No puede decir «alinea a Lawrence».

Sin un sitio donde esté escrito, esa distinción vive en la cabeza de quien
programa la pantalla, y dura hasta la siguiente pantalla.

## Cómo funciona

    SALIDA DEL MODELO -> ESTADO DE VALIDACIÓN -> AUTORIDAD -> PRESENTACIÓN

La autoridad se **deriva** del estado, el estado sale de un experimento con su
número, y el registro entero viaja al payload. La interfaz no puede presentar
una capacidad con más autoridad de la que este fichero permite, y eso lo
comprueba un test en vez de la disciplina de quien escriba el JSX.

## Regla de mantenimiento

Cambiar un `status` **exige** cambiar `experiment_id`, `metric` y
`last_validated`. Un estado sin experimento detrás es una opinión con formato de
dato, que es justo lo que este fichero existe para impedir.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from enum import Enum


class Status(str, Enum):
    """Qué sabemos de esta capacidad."""

    VALIDATED = "VALIDATED"
    """Medida fuera de muestra, bate a su baseline, umbral preregistrado."""

    NOT_READY = "NOT_READY"
    """Produce números utilizables pero no ha demostrado batir a su baseline."""

    REJECTED = "REJECTED"
    """Medida y **rechazada**. No es que falte trabajo: es que no funciona."""

    BLOCKED = "BLOCKED"
    """Faltan datos o infraestructura. No se ha podido medir todavía."""

    DESIGN_ONLY = "DESIGN_ONLY"
    """Diseñada, sin implementar. No hay nada que enseñar."""


class Authority(str, Enum):
    """Cuánto puede decir la interfaz."""

    RECOMMEND = "RECOMMEND"
    """«Alinea a X», con la evidencia al lado."""

    INFORM = "INFORM"
    """Enseñar el número y dejar comparar. **No** recomendar."""

    DATA_ONLY = "DATA_ONLY"
    """El dato crudo, sin orden ni juicio. Ni rankings ni etiquetas."""

    HIDE = "HIDE"
    """No se enseña."""


# El mapeo es total y no tiene excepciones a propósito. En cuanto una capacidad
# pudiera saltarse su estado «porque este caso es distinto», el registro deja de
# valer para nada.
_AUTHORITY: dict[Status, Authority] = {
    Status.VALIDATED: Authority.RECOMMEND,
    Status.NOT_READY: Authority.INFORM,
    Status.REJECTED: Authority.DATA_ONLY,
    Status.BLOCKED: Authority.HIDE,
    Status.DESIGN_ONLY: Authority.HIDE,
}


@dataclass(frozen=True)
class Capability:
    """Una cosa que el producto podría querer afirmar."""

    id: str
    status: Status
    evidence: str
    experiment_id: str | None = None
    metric: str | None = None
    sample_size: int | None = None
    limitations: tuple[str, ...] = ()
    last_validated: str | None = None
    model_version: str | None = None

    @property
    def authority(self) -> Authority:
        """Se deriva del estado. No es un campo, para que no se pueda subir."""
        return _AUTHORITY[self.status]

    def as_payload(self) -> dict:
        data = asdict(self)
        data["status"] = self.status.value
        data["authority"] = self.authority.value
        data["limitations"] = list(self.limitations)
        return data


# --- el registro ------------------------------------------------------------
#
# Cada entrada apunta a un experimento del registro (`docs/experimentos/`) y
# lleva su número. Una entrada sin experimento sólo puede estar BLOCKED o
# DESIGN_ONLY: sin medición no hay nada que validar ni que rechazar.

MODEL_VERSION = "2026.08.29"

REGISTRY: tuple[Capability, ...] = (
    # --- modelo de partidos --------------------------------------------------
    # Hasta 2026-08-30 la web publicaba margen, total y probabilidad SIN entrada
    # en este registro: una capacidad sin evaluar que ya estaba en producción.
    # La auditoría E20 la cierra. Cada una tiene autoridad INDEPENDIENTE: que
    # el margen esté validado no valida el edge — BETTING_EDGE sigue REJECTED.
    Capability(
        id="PROJECTED_MARGIN",
        status=Status.VALIDATED,
        evidence=(
            "MAE 10,04 walk-forward 2012-2025, frente a 11,30 de predecir empate "
            "y 9,97 del spread de cierre: iguala al mercado, no lo bate"
        ),
        experiment_id="E20",
        metric="MAE margen = 10.04 (cierre 9.97, cero 11.30)",
        sample_size=3829,
        limitations=(
            "El margen PUBLICADO es MERCADO-INFORMADO (residual sobre la línea, "
            "mezclado con el modelo libre): no puede presentarse como evidencia "
            "independiente contra ese mismo mercado (docs/REGLA_edge.md).",
            "El modelo LIBRE (sin línea) da 10,28: existe, se publica aparte, y "
            "es el único comparable honestamente contra el mercado.",
        ),
        last_validated="2026-08-30",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="PROJECTED_TOTAL",
        status=Status.VALIDATED,
        evidence=(
            "MAE 10,57 frente a 10,51 del total de cierre y 11,08 de la media de "
            "la temporada anterior"
        ),
        experiment_id="E20",
        metric="MAE total = 10.57 (cierre 10.51, media previa 11.08)",
        sample_size=3829,
        limitations=(
            "Es RESIDUAL sobre el total de cierre: no existe un total "
            "independiente del mercado. Sin línea publicada no hay proyección.",
        ),
        last_validated="2026-08-30",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="PROJECTED_SCORE",
        status=Status.VALIDATED,
        evidence=(
            "los marcadores por equipo son la derivación EXACTA de margen y total "
            "(mitad de cada uno): MAE 7,49 local y 7,26 visitante, frente a 7,43 "
            "y 7,23 de los implícitos del mercado"
        ),
        experiment_id="E20",
        metric="MAE puntos de equipo = 7.49/7.26 (mercado 7.43/7.23)",
        sample_size=3829,
        limitations=(
            "No es un tercer modelo: hereda la procedencia (mercado-informada) y "
            "los límites de PROJECTED_MARGIN y PROJECTED_TOTAL.",
            "Un marcador puntual no implica certeza; el intervalo vive en la "
            "distribución de márgenes, no en esta cifra.",
        ),
        last_validated="2026-08-30",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="WIN_PROBABILITY",
        status=Status.VALIDATED,
        evidence=(
            "calibración por cubos walk-forward 2012-2025: 0,36→0,35, 0,56→0,57, "
            "0,74→0,77; Brier 0,2127 frente a 0,2470 de la constante"
        ),
        experiment_id="E20",
        metric="Brier 0.2127; cubos dentro de ±0.03 salvo extremos con n<25",
        sample_size=3829,
        limitations=(
            # 0,2119 es lo que MIDE este repositorio (`validation.overall."
            # market_brier`): la probabilidad implícita en el spread de cierre,
            # por una normal neutral. El 0,2113 que ponía antes era el moneyline
            # sin vig del proyecto ORIGINAL, y nunca se reprodujo aquí — la
            # misma deriva que las cifras de portada, dentro del registro que
            # existe para que la interfaz no afirme de más.
            "NO bate al mercado (Brier del spread de cierre: 0,2119): es una "
            "probabilidad calibrada, no una ventaja.",
            "Sale de la distribución discreta de márgenes (números clave 3 y 7) "
            "más calibración logística — no de una heurística margen→sigmoide.",
            "E20 es una AUDITORÍA del artefacto walk-forward, con el listón del "
            "campo (fiabilidad por cubos y batir a la constante) declarado en el "
            "registro; la confirmación preregistrada prospectiva es 2026.",
            "Ligero exceso de humildad en favoritos claros: el cubo 0,8-0,9 "
            "gana el 89,8% (n=216).",
        ),
        last_validated="2026-08-30",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="MODEL_LEAN",
        status=Status.VALIDATED,
        evidence=(
            "es ARITMÉTICA entre dos cantidades validadas por separado: el signo "
            "de (margen o total del modelo, E20) menos (línea real del mercado)"
        ),
        experiment_id="E20",
        metric="hereda E20; el lean no añade número propio",
        sample_size=3829,
        limitations=(
            "Un lean dice DÓNDE CAE el modelo, no que convenga apostarlo: E4 "
            "midió que el tamaño del desacuerdo NO predice el acierto contra el "
            "spread (49,3/50,9/48,8% por cubo, plano).",
            "Nunca se presenta como edge, confianza, lock ni «best bet»; la "
            "interfaz lo llama «model lean» y lleva el resultado de E4 al lado.",
            "En props el lean exige una línea REAL tecleada por el usuario: sin "
            "línea, MARKET UNAVAILABLE — jamás una línea inventada.",
            "El orden del board normaliza por la dispersión de desacuerdos de "
            "cada familia esa jornada: descriptivo, no probabilístico.",
        ),
        last_validated="2026-08-30",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="BEST_VALUE_BET",
        status=Status.NOT_READY,
        evidence=(
            "la clase de apuestas publicada (desacuerdo 1-2 pts) ganó el 50,9% de "
            "1.173 casos fuera de muestra: positivo y SIN alcanzar significación "
            "(p≈0,18), con el equilibrio en 52,4%"
        ),
        experiment_id="E4",
        metric="50.9% en 1,173 apuestas; IC inferior por debajo del 52.4%",
        sample_size=3708,
        limitations=(
            "Es una HIPÓTESIS publicada como tal: la tabla de la web lleva el "
            "registro histórico de su clase al lado, y ningún cubo supera el "
            "equilibrio ni en la media ni en el IC.",
            "El acierto NO crece con la discrepancia (E4): «confianza» "
            "construida sobre el edge está refutada, no pendiente.",
            "El stake es cuarto de Kelly con el edge encogido al 50% y tope del "
            "2%: maquinaria de riesgo, no señal.",
        ),
        last_validated="2026-08-30",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="PLAYER_PROP_PROJECTION",
        status=Status.BLOCKED,
        evidence=(
            "los modelos de volumen semanales existen (E7) pero un prop exige "
            "DISTRIBUCIÓN validada por mercado concreto y líneas históricas con "
            "marca de tiempo, y no hay ninguna de las dos"
        ),
        experiment_id=None,
        metric=None,
        sample_size=None,
        limitations=(
            "La proyección semanal (media) NO es un prop: pasing yards over/under "
            "pregunta por una cola, y la dispersión publicada está comprimida "
            "(sd 3,3 frente a 8,4 en QB, límite ya registrado en E7).",
            "Sin líneas históricas de props no hay baseline de mercado ni "
            "validación posible: no se conoce fuente gratuita con historial.",
        ),
        last_validated=None,
        model_version=None,
    ),
    Capability(
        id="PLAYER_PROP_OVER_UNDER_PROBABILITY",
        status=Status.BLOCKED,
        evidence="exige PLAYER_PROP_PROJECTION más calibración de cola por mercado",
        experiment_id=None,
        metric=None,
        sample_size=None,
        limitations=(
            "Un «65% over» sin calibración medida es un número inventado.",
            "Bloqueada aguas arriba: no se evalúa hasta que exista la proyección "
            "de prop con distribución.",
        ),
        last_validated=None,
        model_version=None,
    ),
    Capability(
        id="GAME_PROP_PROJECTION",
        status=Status.BLOCKED,
        evidence=(
            "el total por equipo YA se deriva del modelo validado, pero afirmarlo "
            "COMO PROP exige líneas de mercado con marca de tiempo que no hay"
        ),
        experiment_id=None,
        metric=None,
        sample_size=None,
        limitations=(
            "Mitades, cuartos y márgenes exactos ni siquiera tienen modelo.",
            "El desbloqueo es de DATOS (líneas de team total con timestamp), no "
            "de modelado: la mitad del camino ya existe en PROJECTED_SCORE.",
        ),
        last_validated=None,
        model_version=None,
    ),
    Capability(
        id="START_SIT_RB",
        status=Status.VALIDATED,
        evidence="53,9% de acierto en pares apretados frente al 51,8% de su forma reciente",
        experiment_id="E11",
        metric="acierto por pares = 0.539",
        sample_size=8294,
        limitations=(
            "Sólo pares con los dos jugadores proyectados por encima de 8 puntos.",
            "Por debajo de 1 punto de diferencia proyectada el acierto cae al 50,6%: "
            "ver SEPARATION_SCALE.",
        ),
        last_validated="2026-08-29",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="START_SIT_WR",
        status=Status.VALIDATED,
        evidence="52,4% frente al 48,6% de su forma reciente — la mayor ventaja medida",
        experiment_id="E11",
        metric="acierto por pares = 0.524",
        sample_size=24834,
        limitations=("Misma zona de decisión que RB.",),
        last_validated="2026-08-29",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="START_SIT_TE",
        status=Status.VALIDATED,
        evidence="51,7% frente al 49,7% de su forma reciente",
        experiment_id="E11",
        metric="acierto por pares = 0.517",
        sample_size=3267,
        limitations=("Ventaja de 2 puntos porcentuales: la más pequeña de las tres validadas.",),
        last_validated="2026-08-29",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="START_SIT_QB",
        status=Status.NOT_READY,
        evidence=(
            "PIERDE contra la media ponderada de sus seis últimos partidos por tres "
            "vías independientes: Spearman 0,213 frente a 0,248, acierto por pares "
            "54,2% frente a 54,4%, y el MAE sólo gana después de mezclar"
        ),
        experiment_id="E6, E7, E11",
        metric="acierto por pares = 0.542 frente a baseline 0.544",
        sample_size=5959,
        limitations=(
            "El modelo produce proyecciones utilizables — la interfaz puede enseñarlas.",
            "Lo que no está validado es RECOMENDAR entre dos quarterbacks.",
        ),
        last_validated="2026-08-29",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="WEEKLY_PROJECTION",
        status=Status.VALIDATED,
        evidence="la mezcla con la forma reciente bate al baseline en MAE en las cuatro posiciones",
        experiment_id="E7",
        metric="MAE 5,13–6,57 según posición, siempre por debajo del baseline",
        sample_size=6299,
        limitations=(
            "Es una MEZCLA: el modelo solo no bate al baseline en ninguna posición.",
            "Calibrada en nivel, no en dispersión: la proyección sigue comprimida "
            "frente a la realidad (sd 3,3 frente a 8,4 en QB).",
        ),
        last_validated="2026-08-29",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="SEPARATION_SCALE",
        status=Status.VALIDATED,
        evidence=(
            "moneda al aire por debajo de 1 punto (50,6%), leve entre 1 y 3 (53–56%), "
            "claro entre 3 y 5 (59,8%), muy claro por encima de 5 (66,7%)"
        ),
        experiment_id="E12",
        metric="acierto por tramo de separación",
        sample_size=89114,
        limitations=(
            "Son frecuencias históricas del sistema, NO probabilidades por par.",
            "Decir «A tiene un 60% de superar a B» exigiría calibración por par, "
            "que es otro experimento.",
        ),
        last_validated="2026-08-29",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="ROOKIE_PRIOR",
        status=Status.VALIDATED,
        evidence="Spearman 0,604 walk-forward frente a 0,093 de la media de posición",
        experiment_id="E9",
        metric="Spearman = 0.604",
        sample_size=2250,
        limitations=(
            "Gana en ORDEN, no en puntos: el MAE apenas bate a predecir cero, porque "
            "el rookie modal realmente hace cero puntos.",
            "La distribución es bimodal en varias celdas — el QB de 2ª ronda promedia "
            "63,4 con mediana 15,9. Hay que publicar intervalo, nunca un punto.",
            "El modelo de bust de veteranos NO aplica a quien no tiene historial NFL.",
            "SU SITIO EN EL BOARD ESTÁ MEDIDO Y ES CONSERVADOR. A igual proyección y "
            "misma posición, el novato realizó 127,2 puntos y el veterano 19,6 "
            "(2019-2025, n=128 emparejados: +107,6). Las dos escalas no son la misma "
            "—el veterano se proyecta como si jugara 15,5 partidos y la previa de "
            "novato es el total observado, ceros incluidos— así que el novato cae "
            "por debajo de donde produce. Se publica sin corregir: no hay ninguna "
            "corrección validada, y un multiplicador a ojo sería peor que el sesgo. "
            "Medido en scripts/rookie_placement_validate.py.",
        ),
        last_validated="2026-09-01",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="KICKER_ORDINAL_RANKING",
        status=Status.REJECTED,
        evidence=(
            "la separación entre K1–K6 y K7–K12 es de 0,26 puntos por partido con "
            "IC95% [−0,36, +0,87]: no distinguible de cero"
        ),
        experiment_id="E8b",
        metric="diferencia K1-K6 menos K7-K12 = +0.26 pts/partido",
        sample_size=2108,
        limitations=(
            "El modelo SÍ bate a sus baselines en MAE — lo rechazado es el ORDEN "
            "dentro del top 12, no el modelo.",
            "Lo que distingue es «titular en buen ataque» frente a «suplente en ataque "
            "malo», y para eso nadie necesita un modelo.",
            "Presentación permitida: grupo de streaming. Nunca K1…K12.",
        ),
        last_validated="2026-08-29",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="KICKER_SKILL_ESTIMATE",
        status=Status.REJECTED,
        evidence=(
            "el porcentaje de acierto no predice el del año siguiente (r 0,024) y su "
            "dispersión (0,071) apenas supera la del azar binomial (0,066)"
        ),
        experiment_id="E8",
        metric="r año N -> N+1 = 0.024",
        sample_size=359,
        limitations=("Alrededor del 13% de la varianza es habilidad. El resto es azar.",),
        last_validated="2026-08-29",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="BETTING_EDGE",
        status=Status.REJECTED,
        evidence=(
            "49,81% contra el spread, IC95% [48,2%, 51,4%], frente a un equilibrio de "
            "52,4%; y el acierto NO crece con la discrepancia (49,3% / 50,9% / 48,8%)"
        ),
        experiment_id="E4",
        metric="acierto ATS = 0.4981",
        sample_size=3736,
        limitations=("Regla permanente del proyecto: docs/REGLA_edge.md.",),
        last_validated="2026-08-29",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="WEATHER_PREDICTION",
        status=Status.BLOCKED,
        evidence=(
            "el efecto del viento es real (−3,47 puntos por encima de 15 mph) pero "
            "nflverse sólo publica clima OBSERVADO: cero de los 272 partidos de 2026 "
            "lo traen"
        ),
        experiment_id="E10, E10b",
        metric="efecto medido = -3.47 pts, pero sin dato en tiempo de pronóstico",
        sample_size=5008,
        limitations=(
            "Se desbloquea con datos en tiempo de PRONÓSTICO y validación prospectiva.",
            "Los −2,22 puntos contra el total de cierre NO son una ventaja: son fuga.",
        ),
        last_validated="2026-08-29",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="WEATHER_HISTORICAL",
        status=Status.VALIDATED,
        evidence="por encima de 15 mph los partidos anotan 3,47 puntos menos, IC95% [−4,78, −2,16]",
        experiment_id="E10",
        metric="diferencia = -3.47 pts",
        sample_size=5008,
        limitations=(
            "DESCRIPTIVO Y RETROSPECTIVO. Nunca como entrada de una predicción.",
            "Medido con viento observado; un pronóstico tiene su propio error, "
            "nunca medido aquí.",
        ),
        last_validated="2026-08-29",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="DST_STREAMING",
        status=Status.DESIGN_ONLY,
        evidence=(
            "el total implícito del rival predice los puntos permitidos a r 0,388, "
            "frente a r 0,060 del último partido de la propia defensa"
        ),
        experiment_id="E24",
        metric="walk-forward 2018-2025: el modelo bate a los tres baselines en 0 de 8 temporadas",
        sample_size=4254,
        limitations=(
            "E24 (preregistrado en docs/PREREGISTRO_dst.md, 2026-09-05): una regresión "
            "sobre total implícito del rival + capturas y balones recientes NO bate al "
            "total implícito del rival a secas en NINGUNA de las ocho temporadas: la forma "
            "reciente no aporta nada. Se queda en DESIGN_ONLY por el umbral fijado antes.",
            "Lo que sí salió: el total implícito del rival, solo, ordena las defensas "
            "dentro de la jornada a Spearman 0,31 de media y bate a la media de liga y a "
            "la forma reciente en las ocho. Era un BASELINE del preregistro, no el "
            "candidato, así que no se promueve por haberlo visto: queda para un "
            "preregistro nuevo con ese candidato.",
            "La puntuación medida es PARCIAL: sin touchdowns defensivos, safeties ni "
            "bloqueos, que `team_games` no tiene.",
            "Las pérdidas forzadas NO son una cualidad estable: balones sueltos "
            "año contra año r 0,044.",
        ),
        last_validated="2026-09-05",
        model_version=None,
    ),
    Capability(
        id="MATCHUP_WIN_PROBABILITY",
        status=Status.BLOCKED,
        evidence="hacen falta distribuciones por jugador validadas, y no existen",
        experiment_id=None,
        metric=None,
        sample_size=None,
        limitations=(
            "Necesita: distribuciones de resultado por jugador, correlaciones dentro "
            "de una alineación y cobertura validada de los cuantiles.",
            "Sin eso, un «tienes un 61% de ganar» es un número inventado con dos cifras.",
        ),
        last_validated=None,
        model_version=None,
    ),
    Capability(
        id="MULTI_LEAGUE_SCORING",
        status=Status.BLOCKED,
        evidence="el payload publica puntos ya cocinados, no componentes proyectados",
        experiment_id=None,
        metric=None,
        sample_size=None,
        limitations=(
            "Se desbloquea con el bloque A de V2: componentes canónicos en el payload.",
            "El compilador de puntuación (ScoringRules) ya existe y funciona.",
        ),
        last_validated=None,
        model_version=None,
    ),
    Capability(
        id="MULTI_LEAGUE_DRAFT_STATE",
        status=Status.VALIDATED,
        evidence=(
            "el estado de draft se guarda bajo una clave compuesta "
            "(temporada + liga + draft) y 19 tests demuestran que no hay fuga entre "
            "ligas: A->B->A devuelve cada estado intacto y el blob global v1 no se "
            "atribuye a ninguna liga"
        ),
        experiment_id="E14",
        metric="19/19 escenarios de aislamiento, cero fugas",
        sample_size=19,
        limitations=(
            "Es ESTADO de liga, no VALOR por liga: el board sigue siendo uno solo.",
            "Sin las tres partes de la identidad no se persiste — falla seguro.",
        ),
        last_validated="2026-08-30",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="LEAGUE_SPECIFIC_VALUE",
        status=Status.VALIDATED,
        evidence=(
            "el valor responde a las REGLAS de la liga, no sólo a su puntuación: "
            "16 propiedades preregistradas sobre 861 proyecciones reales y 13 "
            "configuraciones. Superflex lleva el reemplazo del QB de QB13 a QB25 "
            "y sube su VOR una mediana de +26,4 puntos; 10/12/14 equipos "
            "profundizan el reemplazo de forma monótona; el TE premium sube a "
            "todos los TE y a nadie más (Δ exactamente 0 fuera de TE)"
        ),
        experiment_id="E18",
        metric="16/16 a 10-14 equipos; 18/20 al extender a 32",
        sample_size=861,
        limitations=(
            "Prueba que el CÁLCULO responde correctamente a las reglas. NO prueba "
            "que draftear por este valor mejore la temporada: eso exige medir "
            "contra resultados y no está hecho.",
            "Los TIERS siguen siendo los del board publicado. Salen de los huecos "
            "de VOR y se moverían solos, pero nadie ha validado que los cortes "
            "signifiquen algo en otra liga, así que no se presentan como suyos.",
            "Los huecos compartidos se reparten por PUNTOS BRUTOS, que es como los "
            "llena un mánager. Para un SUPER_FLEX que admite QB eso favorece al "
            "quarterback por escala y no por valor marginal: acierta en datos "
            "reales por el motivo aproximado. El reparto exacto iteraría a un "
            "punto fijo sobre el VOR y sería circular; no se ha hecho.",
            "El pool publicado se eligió por VOR en la liga por defecto. Se "
            "garantiza profundidad por posición para el sobre soportado (hasta 14 "
            "equipos, superflex, 3 flex); fuera de él `buildLeagueBoard` declara "
            "la posición corta en vez de dar un número.",
            "Sin pateadores, sin defensas y sin novatos: ninguno tiene componentes "
            "proyectados, así que no entran en la comparación entre posiciones.",
            "VALIDADO HASTA 14 EQUIPOS. A 32 fallan las dos propiedades de "
            "magnitud del superflex: ver DEEP_LEAGUE_VALUE.",
        ),
        last_validated="2026-08-30",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="SLEEPER_SYNC_PERIODIC",
        status=Status.VALIDATED,
        evidence=(
            "comprobado desde GitHub Actions el 2026-08-30: `state/nfl` y "
            "`user/<nombre>` responden 200 con datos reales; `league/<id>/rosters` y "
            "`draft/<id>/picks` responden 404 sobre ids inventados, que es llegar al "
            "servicio. Contraste con api.github.com en 200"
        ),
        experiment_id="E13",
        metric="4 de 4 endpoints alcanzables (2x200, 2x404 esperado)",
        sample_size=4,
        limitations=(
            "Prueba alcance desde un runner, NO desde el navegador ni desde Vercel.",
            "Habilita la sincronización PERIÓDICA: waivers, traspasos y multi-liga, "
            "que no necesitan tiempo real.",
            "No habilita Game Day: eso necesita el camino del navegador, sin comprobar.",
        ),
        last_validated="2026-08-30",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="LIVE_DRAFT_ROOM",
        status=Status.VALIDATED,
        evidence=(
            "registro de eventos canónico con dos suites en navegador. E16: 27 "
            "comprobaciones a 390/768/1440 — un pick en 35-60 ms, veinte seguidos "
            "sin duplicar, deshacer renumera, recargar conserva el draft. E19: un "
            "draft de 12 equipos ENTERO (180 picks) entrando por el adaptador sin "
            "una sola intervención manual, con los 15 turnos propios detectados "
            "solos y con lista corta, más la matriz de configuraciones, la corrida "
            "de posición y la frescura de la sincronización"
        ),
        experiment_id="E19",
        metric="15/15 (draft completo) + 31/31 (matriz); p95 de pick manual 84 ms",
        sample_size=46,
        limitations=(
            "Es CORRECCIÓN del registro, de la ingesta y de la interacción, no una "
            "afirmación sobre la calidad de las decisiones que se tomen con él.",
            "Enseña BEST AVAILABLE (board validado) con el contexto de plantilla "
            "al lado. NO «best pick for me», que sigue BLOCKED.",
            "NO depende de SLEEPER_LIVE_BROWSER: el modo manual funciona en "
            "cualquier plataforma y en un draft presencial.",
            "La ingesta se ejercita contra un DOBLE de la API de Sleeper servido "
            "por el navegador de pruebas. Prueba el adaptador entero —sondeo, "
            "emparejamiento, plegado y frescura—, NO que la red del usuario llegue "
            "a `api.sleeper.app`: eso es SLEEPER_LIVE_BROWSER, hoy NOT_READY — el "
            "transporte está verificado desde un runner real y el mock no cubre la "
            "identidad de la liga.",
        ),
        last_validated="2026-09-01",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="DRAFT_STATE_CANONICAL",
        status=Status.VALIDATED,
        evidence=(
            "el board y el Draft Room dejan de tener estado propio: los dos "
            "resuelven la identidad con `activeIdentity`, migran con "
            "`loadOrMigrateLog` y pliegan con el mismo `fold`. 10 tests "
            "unitarios y 19 comprobaciones en navegador — un jugador tachado "
            "está tachado en las dos pantallas, deshacer funciona desde "
            "cualquiera, y las claves por liga siguen sin poder leerse entre sí"
        ),
        experiment_id="E17",
        metric="21/21 escenarios preregistrados (10 unitarios + 19 de navegador)",
        sample_size=21,
        limitations=(
            "Es CONVERGENCIA de representación, no una afirmación nueva sobre el "
            "valor de las decisiones. LEAGUE_SPECIFIC_VALUE sigue NOT_READY.",
            "Los picks del proveedor se funden en memoria y NO se persisten: "
            "SLEEPER_LIVE_BROWSER sigue BLOCKED y su salida todavía no es una "
            "fuente que se pueda archivar.",
            "Un pick DESHECHO a mano ya no puede devolverlo el sondeo. Es "
            "deliberado —lo manual manda sobre el proveedor— y el precio es que "
            "un pick rehecho por el comisionado hay que volver a marcarlo.",
            "Lo heredado de la forma vieja va con `rosterSource: MIGRATED` y sin "
            "número de pick: no se inventa un historial que nadie guardó.",
        ),
        last_validated="2026-08-30",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="DEEP_LEAGUE_VALUE",
        status=Status.NOT_READY,
        evidence=(
            "a 32 equipos la ESTRUCTURA responde bien —el reparto consume los "
            "288 huecos exactos, el reemplazo se profundiza de forma monótona y "
            "el rank del QB se dobla (QB33 -> QB65)— pero las dos propiedades de "
            "MAGNITUD fallan: el VOR del quarterback en superflex sube +10,5 "
            "puntos frente a los +20 preregistrados, y no entra ni un QB más en "
            "el top-25. El diagnóstico es el ancla: entre el QB33 y el QB65 hay "
            "30 puntos en bruto y 11 tras encoger, o sea que el encogimiento se "
            "come el 65% de la diferencia"
        ),
        experiment_id="E18",
        metric="18/20 al extender a 32 equipos; 2 fallos, los dos de magnitud",
        sample_size=861,
        limitations=(
            "NO se arregla publicando más jugadores: no es un problema de pool "
            "sino del modelo de proyección. A esa profundidad el QB45 tiene 0,3 "
            "partidos ponderados y sale por encima del QB65, que tiene 7,1 y un "
            "ritmo real de 164 puntos.",
            "Arreglarlo sería encoger menos, o excluir del ancla a quien no tenga "
            "muestra. Las dos cosas son cambios de modelo y exigen su propia "
            "validación; no se han hecho.",
            "El board SÍ se calcula en ligas profundas y responde a la estructura. "
            "Lo que no se afirma es la magnitud del valor, y la interfaz lo dice.",
        ),
        last_validated="2026-08-30",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="KICKER_PROJECTION",
        status=Status.VALIDATED,
        evidence=(
            "la proyección por oportunidad del equipo bate en MAE a la media de "
            "liga y a la forma reciente del pateador (3,73 frente a 3,77 y 4,07)"
        ),
        experiment_id="E8",
        metric="MAE 3.73 vs 3.77 (media de liga) y 4.07 (forma)",
        sample_size=2108,
        limitations=(
            "Vale la PROYECCIÓN, no el orden: KICKER_ORDINAL_RANKING sigue "
            "REJECTED (E8b) y la interfaz publica puntos sin columna K1…K12.",
            "Todo el modelo es del equipo: la identidad del pateador no aporta "
            "parámetros (r 0,024 año contra año en acierto).",
            # E8c (scripts/kicker_falsify.py, 2022-2025, 2.108 pateador-semanas):
            # bate a la forma en TODOS los estratos, y proyecta BAJO en todos.
            # Se publica sin corregir: no hay corrección preregistrada, y un
            # multiplicador a ojo sería peor que el sesgo conocido.
            "Proyecta BAJO de forma sistemática (E8c): sesgo global −0,66 puntos "
            "por partido, y −1,25 en estadios con techo fijo o retráctil (725 "
            "pateador-semanas; si el retráctil estaba abierto no se sabe). "
            "Sin corregir: ninguna corrección está preregistrada ni validada.",
        ),
        last_validated="2026-09-05",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="CANDIDATE_SHORTLIST",
        status=Status.VALIDATED,
        evidence=(
            "es PRESENTACIÓN del board validado: los primeros disponibles por VOR "
            "de la liga (E18), sin ningún ajuste personal añadido. Desde E19 el "
            "board que la alimenta se RECOMPILA de verdad en la liga del usuario "
            "por el mismo compilador que usa la pantalla de board: la superflex "
            "de 12 pasa de 5 a 17 quarterbacks entre los 50 primeros, y media "
            "recepción cambia quién encabeza la lista"
        ),
        experiment_id="E19",
        metric="hereda la validación del valor por liga; no añade número propio",
        sample_size=861,
        limitations=(
            "Es una lista transparente («top available by VOR»), NO una "
            "recomendación personalizada: no mira tu plantilla ni tu hueco.",
            "Cuando la liga NO se puede compilar (puntuación desconocida, "
            "plantilla no soportada) la lista sale del board publicado y el "
            "encabezado lo dice: «by the published value». Los dos casos no se "
            "escriben igual porque no son la misma afirmación.",
            "Cualquier reordenación por conveniencia personal cae en "
            "BEST_PICK_FOR_ME, que sigue BLOCKED.",
            "En ligas de más de 14 equipos hereda el límite de DEEP_LEAGUE_VALUE.",
        ),
        last_validated="2026-08-30",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="BEST_PICK_FOR_ME",
        # MEDIDO EN E23, y el umbral estaba fijado antes de mirar.
        #
        # Estuvo BLOCKED mientras no hubo experimento — no por prudencia
        # decorativa: el registro exige métrica y muestra, y no las había. Ahora
        # las hay, así que sube. Pero léase la evidencia entera antes de fiarse:
        # el efecto está CONCENTRADO en 2019-2022 y en 2025 es NEGATIVO.
        status=Status.VALIDATED,
        evidence=(
            "E23: se draftean 7 temporadas × 12 puestos con el board compilado "
            "walk-forward, y se puntúa con lo REALIZADO —que el motor no ve—. "
            "Seguir la recomendación gana +48,3 puntos por equipo-temporada "
            "sobre seguir el board (t = 2,32), midiendo SÓLO donde el board "
            "completó su alineación: el +91,4 de portada incluía un 47% que "
            "venía de que un drafter por VOR puro a veces se deja el ala cerrada "
            "sin llenar, y un hueco vacío son cero puntos"
        ),
        experiment_id="E23",
        metric="puntos realizados de la alineación titular, diferencia pareada",
        sample_size=63,
        limitations=(
            "EL EFECTO SE HA IDO APAGANDO Y EN 2025 ES NEGATIVO: +53, +100, +89, "
            "+128, +12, +6, −37 por temporada. La regla se fijó antes y se "
            "respeta, pero esto NO se puede contar como «gana 48 puntos al año»: "
            "ganó mucho hace cinco años, nada hace dos y perdió el año pasado. "
            "Hipótesis razonable y NO comprobada: cuanto mejor ordena el board, "
            "menos queda por ganar reordenando por plantilla.",
            "EL BASELINE NO ES UN HUMANO. Es un autodraft por VOR puro, y ningún "
            "humano se deja el ala cerrada sin llenar. Contra un drafter "
            "competente la ventaja sería menor, probablemente mucho menor.",
            "Los once rivales draftean igual en los dos brazos, sin carreras por "
            "posición ni reaches, y la alineación se fija una vez por temporada "
            "en vez de jornada a jornada. Una liga real no se comporta así.",
            "El multiplicador de necesidad que existió (VOR × 0,35 con plantilla "
            "estándar supuesta) se RETIRÓ en 2026-08 y NO ha vuelto: aquí no hay "
            "multiplicador, ni puntuación compuesta, ni nota. Cada motivo que se "
            "enseña es un hecho comprobable contra la plantilla y el pool.",
            "La disponibilidad futura sigue sin calibrar: esto NO dice «aguanta "
            "hasta tu próximo pick». La fuente está identificada (FFC) y el "
            "estudio no está hecho; sin él, cualquier «probablemente vuelve» "
            "sería un número inventado.",
            "BEST AVAILABLE sigue siendo una lista SEPARADA y sin tocar: el VOR "
            "de un jugador no cambia porque tú ya tengas un quarterback. Las dos "
            "se enseñan juntas a propósito.",
            "Sin estructura de plantilla declarada no se emite recomendación "
            "ninguna: la pantalla cae a BEST AVAILABLE y dice por qué.",
        ),
        last_validated="2026-09-05",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="SLEEPER_LIVE_BROWSER",
        status=Status.NOT_READY,
        evidence=(
            "el TRANSPORTE está verificado por dos vías independientes. Por "
            "construcción: `/fantasy/draft` se compila como página estática, no "
            "existe ni una ruta de servidor ni una server action en todo el repo, "
            "y el `fetch` vive dentro de un `useEffect` de un componente de "
            "cliente — o sea que la petición sale del navegador del usuario y "
            "NUNCA del servidor. Y en la práctica: el dueño siguió un mock draft "
            "completo desde su portátil. El 403 que veía el contenedor era su "
            "proxy de egreso, no el producto. El adaptador entero está además "
            "ejercitado contra un doble fiel (E21)"
        ),
        experiment_id="E21",
        metric="22/22 en laboratorio + 1 mock draft real seguido de principio a fin",
        sample_size=22,
        limitations=(
            "La CSP ya permite connect-src a api.sleeper.app: el camino está abierto "
            "por diseño, sólo falta ejecutarlo una vez.",
            "El 403 de desarrollo NO era de Sleeper — era el proxy del contenedor, que "
            "bloquea también Google y el propio sitio de producción de este proyecto.",
            "NOT_READY y no VALIDATED porque un mock NO cubre el camino de un "
            "draft de liga real. Lo que el mock demuestra es el transporte; lo que "
            "no demuestra es la RESOLUCIÓN DE IDENTIDAD, que en un draft de liga "
            "pasa por `/league/{id}/rosters` y `draft_order`.",
            "DEFECTO 1, identificado y sin corregir: `/league/{id}/drafts` "
            "devuelve también los mocks creados desde esa liga. La selección "
            "prefiere el que esté `drafting`, así que un mock abandonado en ese "
            "estado SECUESTRA la sesión — y el `draft_id` se fija en la primera "
            "resolución, así que se queda con el equivocado toda la noche.",
            "DEFECTO 2, identificado y sin corregir: `resolveStable()` corre UNA "
            "vez. Si al abrir todavía no hay `draft_order` —Sleeper lo rellena "
            "cuando se fija el orden— el puesto queda `null` y NO se vuelve a "
            "derivar: sin reloj, sin «picks until me» y sin lista corta hasta "
            "recargar la página.",
            "DEFECTO 3: el `fetch` no lleva timeout. Un sondeo colgado no rechaza "
            "nunca, y como el intervalo sigue disparando, una respuesta vieja "
            "puede aterrizar DESPUÉS de una nueva y pisarla con su lista de picks "
            "anterior y un `lastSyncAt` fresco.",
            "ALCANCE: NO afecta al Draft Room, que consume eventos de pick "
            "canónicos y funciona entero en modo manual sin red.",
            "Lo que FALTA es exactamente una cosa: que la petición salga de un "
            "navegador de verdad. El adaptador entero está ejercitado contra un "
            "doble de la API (E19) —180 picks, emparejamiento, frescura, caída y "
            "recuperación— así que un draft real contesta esta capacidad en una "
            "tarde. No se sube sola por haber pasado el laboratorio: un doble "
            "prueba el código, no la red.",
        ),
        last_validated="2026-08-31",
        model_version=MODEL_VERSION,
    ),
)

BY_ID: dict[str, Capability] = {c.id: c for c in REGISTRY}


def get(capability_id: str) -> Capability:
    """La capacidad, o revienta.

    No devuelve un valor por defecto permisivo a propósito: una capacidad que no
    está en el registro es una que nadie ha evaluado, y el comportamiento seguro
    ante lo no evaluado no es «adelante».
    """
    if capability_id not in BY_ID:
        raise KeyError(
            f"Capacidad desconocida: {capability_id!r}. Añádela al registro con su "
            f"experimento antes de usarla. Conocidas: {sorted(BY_ID)}"
        )
    return BY_ID[capability_id]


def may_recommend(capability_id: str) -> bool:
    """¿Puede la interfaz emitir una recomendación respaldada por esto?"""
    return get(capability_id).authority is Authority.RECOMMEND


def as_payload() -> dict:
    """El registro entero, para que viaje a la web."""
    return {
        "model_version": MODEL_VERSION,
        "capabilities": [c.as_payload() for c in REGISTRY],
    }
