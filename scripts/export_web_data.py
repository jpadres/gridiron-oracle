#!/usr/bin/env python3
"""Genera el payload de la web y lo comprime.

## El flujo de datos de la web, y por qué es así

    scripts/*.py  ->  web/data/model.json      (JSON legible, NO se versiona)
                  ->  web/data/model.b64.js    (gzip + base64, ~24 KB, SÍ se versiona)
                  ->  web/data/model.js        (lo descomprime EN BUILD TIME)

El sitio no hace **ni una** petición de red en runtime: las seis páginas salen
estáticas con los datos ya dentro. Eso es lo que permite que la superficie de
ataque sea literalmente cero (sin endpoints, sin fetch, sin variables de
entorno) y que todo corra en el plan gratuito.

**Si regeneras los datos hay que recomprimir**, o la web seguirá mostrando los
anteriores sin dar ningún error. El paso está automatizado en
`.github/workflows/weekly-predictions.yml`.
"""

from __future__ import annotations

import argparse
import base64
import gzip
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import pandas as pd

from oracle import capabilities, decisions
from oracle.backtest.metrics import calibration_table, evaluate, summarize_ats
from oracle.backtest.walkforward import season_table, walk_forward
from oracle.config import DEFAULT_BACKTEST_START
from oracle.config import paths as resolve_paths
from oracle.data import identity
from oracle.fantasy.components import COMPONENTS
from oracle.fantasy.draft import PROJECTED_GAMES, SHRINK_PRIOR_GAMES, TD_PERSISTENCE
from oracle.leagues.sleeper import rookies_2026, sleeper_id_map
from oracle.pipeline import Oracle

# Límite de aviso del payload comprimido. No es un límite técnico: es la señal
# de que alguien ha metido en la web una tabla que debería ser un fichero
# descargable. A partir de ~200 KB el primer render se nota.
SIZE_WARNING_KB = 200

# Columnas que la web pinta de cada tabla de fantasy. Cualquier otra cosa que
# lleve el artefacto de `out/` es intermedio del modelo y no viaja al bundle.
DRAFT_COLUMNS = (
    "player_id", "overall_rank", "player_name", "position", "team", "position_rank",
    # El nombre completo no se pinta —la tabla usa el abreviado— pero viaja
    # porque es la clave con la que el modo draft cruza los picks de Sleeper.
    "player_full_name",
    # Cambio de equipo. Es la señal más honesta de «desconfía de este número»:
    # la proyección hereda el reparto de uso del equipo ANTERIOR, así que en
    # estos 146 el volumen proyectado es el del sitio del que se fue.
    "team_changed", "previous_team",
    # SIGUE EN LA NFL, o no. La proyección viene de tres años de producción y no
    # comprueba si el jugador está en una plantilla: el equipo que se publica es
    # el último en el que jugó. Sin este campo, un agente libre sin firmar se ve
    # exactamente igual que un titular.
    "rostered",
    "tier", "projected_points", "vor",
    # Riesgo: la etiqueta, sus tres componentes y los motivos que se nombran.
    # Las componentes viajan aunque no se pinten en una columna porque el
    # tooltip las enseña — una etiqueta de riesgo sin su descomposición es un
    # oráculo, y de esos no se puede discrepar.
    "risk_label", "risk_score", "risk_reasons",
    "risk_sample", "risk_shrink", "risk_touchdown",
    # NOVATO. La marca y, con ella, lo que hace falta para leer su número sin
    # confundirlo con el de un veterano: la ronda en que lo eligieron, el
    # intervalo OBSERVADO de su celda (p25-p50-p75), cuántos rookies la
    # sostienen y si esa celda es bimodal — «o juega o no juega», que es el caso
    # del quarterback de segunda ronda: media 63,4 y mediana 15,9.
    #
    # El intervalo viaja aunque ocupe: una previa de novato sin su dispersión es
    # exactamente el número que la capacidad prohíbe publicar solo.
    "rookie", "draft_pick", "rookie_round",
    "rookie_p25", "rookie_p50", "rookie_p75", "rookie_sample", "rookie_bimodal",
    # Ausencia y bust. Son señales distintas de la volatilidad y por eso viajan
    # aparte: la volatilidad mide cuánto puede moverse la proyección en los dos
    # sentidos, `p_bust` sólo la cola de abajo, y `missed_rate` cuántos partidos
    # se pierde. Un jugador puede ser estable, sano y aun así un bust probable.
    "missed_rate", "missed_games", "p_bust", "bust_label",
)
WEEKLY_COLUMNS = (
    "player_id", "position_rank", "player_name", "position", "team", "opponent",
    # Las tres piezas de la proyección publicada, que es una MEZCLA:
    #   projected_points = blend_weight * baseline_points
    #                    + (1 - blend_weight) * model_points
    # Se publican las tres porque antes no componían: el QB1 salía con baseline
    # 20,1, multiplicador 1,04 y proyección 15,2, y quien intentara la
    # aritmética evidente obtenía otro número. Un dato publicado que invita a
    # una cuenta que no cuadra es peor que no publicarlo.
    "projected_points", "model_points", "baseline_points", "blend_weight",
    "matchup_multiplier", "is_home",
    # Líneas de stats (MEDIAS del volumen × eficiencia, sin ajuste de rival ni
    # calibración): el contexto del board de props. Los TD de carrera/recepción
    # se quedan fuera a propósito — «anytime TD» pide un modelo de eventos que
    # no existe, y publicar su media invitaría a leerla como ese modelo.
    "proj_pass_att", "proj_pass_yds", "proj_pass_tds", "proj_pass_ints",
    "proj_carries", "proj_rush_yds", "proj_targets", "proj_receptions",
    "proj_rec_yds",
)
# Pateadores: proyección validada (E8) SIN rank ordinal — publicarlo es lo que
# E8b rechaza. Defensas: hechos y nada más — sin proyección ni rank, porque no
# hay modelo de DST (DESIGN_ONLY); el orden lo da el total implícito del rival.
KICKER_COLUMNS = (
    "player_id", "player_name", "player_full_name", "team", "opponent", "is_home",
    "team_points", "projected_points",
)
DST_COLUMNS = (
    "team", "opponent", "is_home", "opponent_implied",
    "points_allowed_recent", "sacks_recent", "takeaways_recent", "recent_games",
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Genera web/data/model.b64.js")
    parser.add_argument("--root", default=None)
    parser.add_argument("--season", type=int, default=None, help="Temporada a publicar.")
    parser.add_argument("--week", type=int, default=None, help="Jornada a publicar.")
    parser.add_argument("--from", dest="first_season", type=int, default=DEFAULT_BACKTEST_START)
    parser.add_argument("--skip-backtest", action="store_true",
                        help="Reutiliza el backtest anterior (útil al iterar el diseño).")
    parser.add_argument("--with-narrative", action="store_true",
                        help="Genera resumen y explicaciones con Claude (necesita ANTHROPIC_API_KEY).")
    args = parser.parse_args(argv)

    paths = resolve_paths(args.root).ensure()
    print("Entrenando el modelo de producción...")
    oracle = Oracle.train(args.root)

    # Sin `generated_at` de reloj en la raíz.
    #
    # Estaba desde el principio, no lo leía nadie —la web sólo usa
    # `narrative.generated_at`— y hacía que **cada regeneración produjese un
    # fichero distinto aunque los datos fuesen idénticos**. Es exactamente el
    # bug que se arregló en `out/research.json`, viviendo un nivel más arriba
    # sin que nadie lo comprobase: la verificación de aquel arreglo sólo cubría
    # la ruta de `research_patch.py`, que no toca esta clave.
    #
    # Cuándo se horneó el sitio ya lo dice el sello de build del pie, y ése sí
    # sale de una variable de Vercel en vez de del reloj del proceso.
    payload: dict = {"placeholder": False}

    # --- validación fuera de muestra ---------------------------------------
    backtest_cache = paths.out / "backtest.json"
    if args.skip_backtest and backtest_cache.exists():
        print("Reutilizando el backtest en caché.")
        payload["validation"] = json.loads(backtest_cache.read_text(encoding="utf-8"))
    else:
        print(f"Walk-forward desde {args.first_season} (esto tarda unos minutos)...")
        predictions, metrics = walk_forward(oracle.features, args.first_season)
        overall = evaluate(predictions)
        ats = summarize_ats(predictions)
        validation = {
            "overall": overall.to_dict(),
            "ats": ats.to_dict(),
            "seasons": season_table(metrics).to_dict(orient="records"),
            "calibration": calibration_table(predictions).astype(
                {"bin": str}
            ).to_dict(orient="records"),
        }
        backtest_cache.write_text(json.dumps(validation, default=str), encoding="utf-8")
        payload["validation"] = validation

    # --- qué puede afirmar el producto ---------------------------------------
    #
    # El registro viaja con los datos, no aparte, y por un motivo concreto: si
    # vive sólo en Python, la interfaz tiene que acordarse de consultarlo, y eso
    # dura hasta la siguiente pantalla. Yendo en el payload, cada tarjeta puede
    # leer la autoridad de la capacidad que está a punto de presentar.
    #
    # La regla que impone: la interfaz NO puede presentar una capacidad con más
    # autoridad de la que dice el registro. El QB es el caso: se pueden enseñar
    # sus proyecciones (INFORM) y no se puede decir «alinea a Lawrence»
    # (RECOMMEND), porque esa capacidad pierde contra una media de seis partidos.
    payload["capabilities"] = capabilities.as_payload()
    payload["separation_bands"] = decisions.as_payload()
    # Identidad de equipo: nombre, división y los dos colores ya verificados
    # contra los dos fondos por `scripts/check_identity.py`. Va en el payload y
    # no en el CSS porque es dato, y porque así se comprueba.
    payload["teams"] = identity.as_payload()

    # --- jornada publicada --------------------------------------------------
    season, week = _resolve_week(oracle, args.season, args.week)
    payload["week"] = {"season": season, "week": week}
    print(f"Publicando {season} semana {week}.")

    week_predictions = oracle.predict(oracle.week_features(season, week))
    # Marcadores por equipo: derivados EXACTOS de margen y total (la mitad de
    # cada uno), no un tercer modelo. Se publican para que la tarjeta pueda
    # decir «SEA 24.7 – NE 21.1» sin que el navegador haga aritmética.
    week_predictions["pred_home_points"] = (
        week_predictions["pred_total"] + week_predictions["pred_margin"]
    ) / 2.0
    week_predictions["pred_away_points"] = (
        week_predictions["pred_total"] - week_predictions["pred_margin"]
    ) / 2.0
    payload["predictions"] = _round_frame(
        week_predictions[
            [
                "game_id", "home_team", "away_team", "spread_line", "total_line",
                "pred_margin", "pred_margin_free", "pred_total", "home_win_prob",
                "edge_vs_line", "pred_home_points", "pred_away_points",
            ]
        ]
    ).to_dict(orient="records")
    # «Why this number»: atribución REAL del miembro residual (coeficiente ×
    # feature estandarizada = puntos de separación respecto de la línea). Se
    # publican los cuatro mayores por magnitud; el resto es ruido de centésimas.
    contributions = oracle.model.residual_contributions(week_predictions)
    for row, (_, contrib) in zip(payload["predictions"], contributions.iterrows(), strict=True):
        top = contrib.abs().sort_values(ascending=False).head(4).index
        row["drivers"] = [
            {"f": name, "pts": round(float(contrib[name]), 2)} for name in top
        ]

    bets = oracle.value_bets(week_predictions)
    payload["bets"] = _enrich_bets(bets, week_predictions)

    payload["ratings"] = _round_frame(oracle.team_ratings()).to_dict(orient="records")

    # --- fantasy ------------------------------------------------------------
    # Se recortan a las columnas que la web pinta. Los artefactos de `out/`
    # llevan además los intermedios del modelo (ppg_shrunk, weighted_games,
    # age_factor...), que son imprescindibles para depurar y no pintan nada en
    # la página. Dejarlos dentro triplica el payload, y el payload viaja en el
    # bundle de cada página.
    payload["fantasy"] = _trim_records(
        _load_optional(paths.out / "fantasy_draft.json"), "board", DRAFT_COLUMNS
    )
    # Componentes canónicos: lo que convierte el board en recompilable por liga.
    #
    # Van como ARRAY en el orden de `COMPONENTS` y no como diez claves por fila:
    # los nombres se repetirían 250 veces y cuestan más que los propios números.
    # El orden viaja en `fantasy.components` para que el navegador no lo suponga.
    #
    # Tres decimales: la media por partido de una estadística no tiene más
    # precisión real que eso, y guardar quince cifras es guardar ruido.
    _attach_components(payload, _load_optional(paths.out / "fantasy_draft.json"))
    # `league` y `starters` no son columnas del board: `_trim_records` sólo
    # recorta la tabla, así que estas claves de nivel superior sobreviven solas.
    payload["fantasy_weekly"] = _trim_records(
        _load_optional(paths.out / "fantasy_weekly.json"), "rankings", WEEKLY_COLUMNS
    )
    payload["fantasy_weekly"] = _trim_records(
        payload["fantasy_weekly"], "kickers", KICKER_COLUMNS
    )
    payload["fantasy_weekly"] = _trim_records(
        payload["fantasy_weekly"], "defenses", DST_COLUMNS
    )

    # --- research (prensa e insiders) ---------------------------------------
    # Viaja aparte de todo lo anterior a propósito: son afirmaciones de terceros
    # con su fuente al lado, no salidas del modelo, y no entran en ningún cálculo.
    payload["research"] = attach_today(_strip_runtime_fields(_research(paths, payload)))

    # --- dossier curado (parte médico, campamento, reporteros) ---------------
    # Atribuido y fechado, pero SIN enlace: por eso viaja aparte del research y
    # la web lo dice donde se enseña. Ver `narrative/dossier.py`.
    payload["dossier"] = _dossier(paths, payload)

    # --- survivor -----------------------------------------------------------
    # Lo genera `scripts/survivor_build.py`. Es el único sitio del proyecto
    # donde el modelo tiene ventaja real: no compite contra un mercado, compite
    # contra el calendario.
    payload["survivor"] = _load_optional(paths.out / "survivor.json")

    # --- textos generados ---------------------------------------------------
    if args.with_narrative:
        payload["narrative"] = _narrative(payload)

    write_payload(paths.web_data, payload)
    return 0


# Importe por debajo del cual una apuesta no se publica.
#
# Kelly a un cuarto con el encogimiento del 50% devuelve, para un edge pequeño,
# fracciones que redondean a un céntimo. Publicar «apuesta 0,01 €» no es un
# número pequeño: es una fila que dice «no apuestes» disfrazada de recomendación,
# y ensucia la tabla justo donde el lector busca señal.
MIN_STAKE = 1.0


def _enrich_bets(bets, predictions) -> list[dict]:
    """Cada apuesta con la ficha histórica de su clase, y sin las de céntimos.

    La ficha histórica es lo que sustituye a la «confianza» que no se puede
    calcular: mide `docs/PREREGISTRO_confianza.md`. Casi siempre dice que la
    clase de esa apuesta pierde dinero, y se publica igual — es el dato.
    """
    from oracle.betting.evidence import lookup

    if bets.empty:
        return []

    lines = predictions.set_index("game_id")
    rows = []
    for record in _round_frame(bets).to_dict(orient="records"):
        if float(record.get("stake") or 0) < MIN_STAKE:
            continue
        game = lines.loc[record["game_id"]]
        disagreement = abs(float(game["pred_margin"]) - float(game["spread_line"]))
        evidence = lookup(disagreement)
        record["disagreement"] = round(disagreement, 2)
        record["evidence_label"] = evidence.label
        record["evidence_bets"] = evidence.bets
        record["evidence_win_rate"] = evidence.win_rate
        record["evidence_beats_breakeven"] = evidence.beats_breakeven
        record["evidence_verdict"] = evidence.verdict
        rows.append(record)
    return rows


# Campos que NO viajan al payload de la web, por mucho que estén en el archivo.
#
# `ingested_at` y `first_seen_at` son relojes de pared: cambian en cada ejecución
# aunque el contenido sea idéntico, y eso hace que el fichero comprimido cambie
# a diario y el repo acumule un commit de ruido cada día. Ya pasó exactamente
# eso con el `generated_at` de `out/research.json` y se quitó por lo mismo.
#
# Sirven para medir latencia, que se calcula sobre el archivo versionado. La web
# no necesita saber a qué hora lo ingerimos.
RUNTIME_ONLY_FIELDS = ("ingested_at", "first_seen_at")


def _strip_runtime_fields(section: dict | None) -> dict | None:
    if not section:
        return section
    for item in section.get("items", []):
        for field in RUNTIME_ONLY_FIELDS:
            item.pop(field, None)
    return section



def _attach_byes(payload: dict, fantasy: dict) -> None:
    """Semanas de descanso de la temporada proyectada.

    Es un HECHO derivado del calendario publicado, no una proyección: un equipo
    que no juega en una semana de temporada regular descansa. Treinta y dos
    entradas, unos 300 bytes, y evita que el navegador tenga que pedirle a nadie
    algo que se sabe con certeza.

    Si el calendario no está completo —a algún equipo le faltan semanas— NO se
    publica un mapa a medias: se omite. Media verdad sobre descansos produce
    exactamente el aviso falso que no queremos.
    """
    from oracle.fantasy.schedule import season_schedule

    season = fantasy.get("season")
    games_path = Path("data/processed/games.parquet")
    if not season or not games_path.exists():
        return
    try:
        schedule = season_schedule(pd.read_parquet(games_path), int(season))
    except Exception:  # noqa: BLE001 - un calendario ilegible no tumba el export
        return
    if not schedule.complete or len(schedule.bye_week) != len(schedule.teams):
        return
    fantasy["byes"] = dict(sorted(schedule.bye_week.items()))


def _attach_components(payload: dict, source: dict | None) -> None:
    """Cuelga los componentes canónicos de cada fila del board.

    Sin ellos el navegador sólo tiene puntos ya cocinados con UNAS reglas, y no
    hay forma de recuperar cuántas recepciones había dentro. Con ellos, la
    puntuación de cualquier liga se compila en el cliente.
    """
    fantasy = payload.get("fantasy")
    if not isinstance(fantasy, dict) or not isinstance(source, dict):
        return
    rows = source.get("board")
    board = fantasy.get("board")
    if not isinstance(rows, list) or not isinstance(board, list):
        return
    by_id = {row.get("player_id"): row for row in rows if isinstance(row, dict)}
    for record in board:
        origin = by_id.get(record.get("player_id"))
        if not origin:
            continue
        record["c"] = [round(float(origin.get(name, 0.0) or 0.0), 3) for name in COMPONENTS]
        # El factor de edad multiplica la proyección y no se puede derivar de los
        # componentes: sin él, recompilar en el cliente daría otro número.
        record["age_factor"] = round(float(origin.get("age_factor", 1.0) or 1.0), 4)
        # `weighted_games` decide cuánto se encoge a este jugador. Sin él el
        # navegador tendría los componentes y no sabría cuánto fiarse de ellos.
        record["wg"] = round(float(origin.get("weighted_games", 0.0) or 0.0), 3)
    fantasy["components"] = list(COMPONENTS)
    _attach_byes(payload, fantasy)
    fantasy["projected_games"] = PROJECTED_GAMES

    # Las constantes y las medias por posición: lo que falta para reproducir el
    # encogimiento fuera de Python. Se calcularon sobre TODOS los jugadores
    # proyectados, no sobre los 250 publicados, así que tienen que viajar — el
    # navegador no las puede recalcular sin cambiar el resultado.
    priors: dict[str, dict] = {}
    for row in rows:
        position = row.get("position")
        if not position or position in priors:
            continue
        if f"mean_{COMPONENTS[0]}" not in row:
            continue
        priors[position] = {
            "mean_components": [
                round(float(row.get(f"mean_{name}", 0.0) or 0.0), 4) for name in COMPONENTS
            ],
            "td_mean": round(float(row.get("td_mean", 0.0) or 0.0), 5),
        }
    if priors:
        fantasy["position_priors"] = priors
        fantasy["shrink_prior_games"] = SHRINK_PRIOR_GAMES
        fantasy["td_persistence"] = TD_PERSISTENCE

    _attach_sleeper_ids(fantasy)


def _attach_sleeper_ids(fantasy: dict) -> None:
    """El mapa `sleeper_id` -> jugador del board, horneado.

    Es lo que permite resolver un pick en vivo **por identificador** y no por
    nombre. El nombre abreviado ya costó una iteración en este proyecto (los dos
    «B.Robinson» de Atlanta) y en un draft el precio es peor: tachar al jugador
    equivocado te borra del tablero a alguien que sí puedes elegir.

    Es información ESTABLE, así que viaja en el payload y no se pide en caliente:
    el catálogo de jugadores de Sleeper son 5 MB y su propia documentación pide
    no bajarlo a menudo. Aquí sale de los rosters de nflverse, que ya están en
    disco porque el board se construye con ellos.

    Si no se puede construir **no se inventa nada**: sin mapa, el adaptador
    marca cada pick como UNMAPPED en vez de adivinar por nombre.
    """
    board = fantasy.get("board")
    if not isinstance(board, list) or not board:
        return
    raw_dir = Path("data/raw")
    if not raw_dir.exists():
        return

    # NOVATOS SIN PREVIA APLICABLE. Los que SÍ la tienen van en el board, con su
    # valor y su intervalo, desde que `ROOKIE_PRIOR` pasó a VALIDATED. Aquí
    # queda sólo el resto: existen, se pueden draftear y la interfaz escribe
    # UNKNOWN, que sigue siendo la respuesta correcta cuando no hay nada medido
    # que decir.
    #
    # El filtro contra el board no es cosmético: publicar a un novato en las dos
    # listas lo pintaría dos veces en el tablero y descuadraría el conteo de
    # disponibles, que es lo que el asistente usa para decir cuántos quedan.
    en_board = {row.get("player_id") for row in board if isinstance(row, dict)}
    try:
        rookies = [
            row for row in rookies_2026(raw_dir, int(fantasy.get("season") or 0))
            if row["player_id"] not in en_board
        ]
    except Exception:  # noqa: BLE001 - sin novatos se publica igual
        rookies = []
    fantasy["rookies"] = rookies
    specialists = fantasy.get("specialists") or {}
    kickers = specialists.get("kickers") or [] if isinstance(specialists, dict) else []
    defenses = specialists.get("defenses") or [] if isinstance(specialists, dict) else []
    ids = {row.get("player_id") for row in board if isinstance(row, dict)}
    ids |= {row.get("player_id") for row in kickers if isinstance(row, dict)}
    # Sin esto, el pick de un novato sería UNMAPPED: identidad NO resuelta. Y no
    # es eso — su identidad se resuelve perfectamente; lo que falta es su valor.
    ids |= {row["player_id"] for row in rookies}
    try:
        mapping = sleeper_id_map(
            raw_dir,
            board_ids={i for i in ids if isinstance(i, str)},
            defense_teams=[
                row.get("team") for row in defenses if isinstance(row, dict) and row.get("team")
            ],
        )
    except Exception:  # noqa: BLE001 - sin mapa se sigue publicando, sin resolver por id
        return
    if mapping:
        fantasy["sleeper_ids"] = dict(sorted(mapping.items()))


def _research(paths, payload: dict) -> dict | None:
    """La sección de prensa: del artefacto del día si está, y si no, del archivo.

    La segunda vía no es un lujo. `out/` no se versiona, así que la
    regeneración semanal corre sobre un checkout limpio donde `research.json` no
    existe — y sin reconstruirla desde `research/`, la sección de prensa
    desaparecería de la web cada miércoles.
    """
    cached = paths.out / "research.json"
    if cached.exists():
        return json.loads(cached.read_text(encoding="utf-8"))

    from oracle.narrative import archive

    weekly = payload.get("fantasy_weekly") or {}
    section = archive.consolidate(paths.root, days=10, players=weekly.get("rankings", []))
    if section is None:
        print("  (aviso) sin research: la sección saldrá vacía en la web.")
    return section


def _dossier(paths, payload: dict) -> dict | None:
    """El dossier curado, con cada entrada colgada de su jugador del ranking."""
    path = paths.root / "research" / "dossier.json"
    if not path.exists():
        return None

    from oracle.narrative import dossier as dossier_module

    data = json.loads(path.read_text(encoding="utf-8"))
    players = (payload.get("fantasy_weekly") or {}).get("rankings", [])
    board = (payload.get("fantasy") or {}).get("board", [])
    # Se busca en las dos listas: el board de draft tiene 250 jugadores y el
    # ranking semanal sólo a los titulares, así que un suplente lesionado sólo
    # aparece en el primero — y es justo el que interesa marcar.
    dossier_module.attach_players(data.get("medical", []), players + board)
    dossier_module.attach_players(data.get("camp", []), players + board)

    # Contraste con el consenso de expertos. Lo valioso es el desacuerdo: si los
    # dos boards dicen lo mismo, daba igual cuál mirases.
    consensus = data.pop("consensus", [])
    if consensus and board:
        data["gap"] = dossier_module.consensus_gap(board, consensus)
        data["ambiguous"] = dossier_module.ambiguous_names(consensus)
        data["consensus_size"] = len(consensus)
        print(f"  consenso: {len(data['gap'])} de {len(consensus)} emparejados, "
              f"{len(data['ambiguous'])} descartados por nombre ambiguo.")

    # Los reportes de campamento de sustancia media y baja no se pintan, y el
    # consenso completo tampoco: viajan sólo las diferencias. `research/` guarda
    # los dos enteros.
    # El parte médico viaja entero porque la etiqueta de disponibilidad de cada
    # fila del board se saca de él. Los reportes de campamento, no: sólo se
    # pintan los de sustancia alta, y los otros 71 son 18 KB de bundle que nadie
    # ve. Siguen en `research/dossier.json`, que es el archivo.
    data["camp"] = [entry for entry in data.get("camp", []) if entry["substance"] == "alta"]
    linked = sum(1 for entry in data.get("medical", []) if entry.get("player_id"))
    print(f"  dossier: {len(data.get('medical', []))} avisos médicos, {linked} sobre un jugador del board.")
    return data


def _narrative(payload: dict) -> dict | None:
    """Resumen de la jornada y explicaciones, verificados contra los propios datos.

    Se hace aquí y no en un script aparte porque el contexto que necesita el
    texto —predicciones, validación y ranking de la semana— ya está montado en
    memoria en este punto. Un script independiente tendría que reentrenar el
    modelo para reconstruirlo.
    """
    from oracle.narrative import weekly as narrative_weekly
    from oracle.narrative.client import NarrativeUnavailable, available

    if not available():
        print("  (aviso) sin ANTHROPIC_API_KEY: la web sale sin resumen ni explicaciones.")
        return None

    context = _narrative_context(payload)
    try:
        print("Redactando el resumen de la jornada...")
        summary = narrative_weekly.week_summary(context)
        players = _players_to_explain(payload)
        print(f"Explicando {len(players)} jugadores...")
        notes = narrative_weekly.player_notes(players, context["semana"]) if players else []
    except NarrativeUnavailable as error:
        print(f"  (aviso) la API no respondió: {error}. La web sale sin textos.")
        return None

    if not summary and not notes:
        return None
    return {
        # La FECHA, no el instante. La web lo pinta como «Generado el 29/8/2026»,
        # así que la hora no se ve y lo único que hace es que el payload cambie
        # cada vez que se regenera.
        "generated_at": pd.Timestamp.now("UTC").date().isoformat(),
        "summary": summary,
        "player_notes": {note["player_id"]: note["text"] for note in notes},
    }


def _narrative_context(payload: dict) -> dict:
    """El material que ve el redactor: sólo números del modelo, y pocos.

    Recortado a conciencia. Cada número que entra aquí es un número que el texto
    puede citar —el verificador de `factcheck` lo autoriza— así que meter la
    tabla entera no es generosidad, es ampliar la superficie de error.
    """
    predictions = sorted(
        payload.get("predictions", []),
        key=lambda row: -abs(row.get("edge_vs_line") or 0),
    )[:6]
    weekly = payload.get("fantasy_weekly") or {}
    rankings = weekly.get("rankings", [])
    return {
        "jornada": payload.get("week"),
        "validacion": (payload.get("validation") or {}).get("overall"),
        "partidos_donde_mas_se_separa_del_mercado": predictions,
        "semana": {
            "jornada": payload.get("week"),
            "jugadores": _with_delta(rankings)[:40],
        },
    }


def _players_to_explain(payload: dict) -> list[dict]:
    """Los que valen una explicación: los mejores de cada puesto y los que más se mueven.

    No todo el ranking. Explicar al número 34 de receptores cuesta lo mismo que
    explicar al primero y no lo lee nadie.
    """
    weekly = payload.get("fantasy_weekly") or {}
    rows = _with_delta(weekly.get("rankings", []))
    chosen: dict[str, dict] = {}
    for position in ("QB", "RB", "WR", "TE"):
        group = [row for row in rows if row.get("position") == position]
        top = sorted(group, key=lambda row: -(row.get("projected_points") or 0))[:3]
        movers = sorted(group, key=lambda row: -abs(row.get("delta") or 0))[:2]
        for row in top + movers:
            chosen[str(row.get("player_id"))] = row
    return list(chosen.values())[:20]


def _with_delta(rows: list[dict]) -> list[dict]:
    """Añade la diferencia con el listón.

    El texto la va a mencionar seguro, y `factcheck` sólo deja citar números que
    estén en los datos. Calcularla aquí es lo que evita que el modelo tenga que
    restar de cabeza — y que el validador lo rechace por hacerlo bien.
    """
    out = []
    for row in rows:
        projected = row.get("projected_points")
        baseline = row.get("baseline_points")
        enriched = dict(row)
        if projected is not None and baseline is not None:
            enriched["delta"] = round(projected - baseline, 2)
        out.append(enriched)
    return out


def _resolve_week(oracle: Oracle, season: int | None, week: int | None) -> tuple[int, int]:
    """Si no se especifica, se publica la primera jornada sin jugar.

    Es lo que quiere el workflow semanal: la jornada que viene, no la que acaba
    de terminar.
    """
    if season is not None and week is not None:
        return season, week
    pending = oracle.features[~oracle.features["played"].astype(bool)]
    if pending.empty:
        last = oracle.features.iloc[-1]
        return int(last["season"]), int(last["week"])
    first = pending.sort_values(["season", "week"]).iloc[0]
    return int(first["season"]), int(first["week"])


def _round_frame(frame: pd.DataFrame, decimals: int = 4) -> pd.DataFrame:
    """Redondea los flotantes.

    No es cosmética: 15 decimales de un float multiplican por tres el tamaño del
    JSON antes de comprimir, y el payload viaja en el bundle de la página.
    """
    out = frame.copy()
    for column in out.select_dtypes(include=["float64", "float32"]).columns:
        out[column] = out[column].round(decimals)
    return out


def _load_optional(path: Path) -> object:
    if not path.exists():
        print(f"  (aviso) falta {path.name}: la sección saldrá vacía en la web.")
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def attach_today(research: dict | None) -> dict | None:
    """Añade «Today's Intelligence»: el subconjunto que puede cambiar hoy una
    decisión. Se calcula en Python y no en la web para que el filtro viva junto
    al resto de las reglas del modelo, con tests.

    Es una FUNCIÓN COMPARTIDA y no dos copias porque ya divergieron: el parche
    diario (`research_patch.py`) sustituía la sección entera sin esta clave, de
    modo que cada barrido BORRABA la sección de la web hasta la siguiente
    regeneración semanal. Dos caminos que escriben el mismo campo con distinta
    cobertura es exactamente el fallo que este proyecto ya cometió con los dos
    traductores de puntuación de Sleeper.
    """
    if not research:
        return research
    from oracle.narrative import intelligence

    research["today"] = intelligence.todays(research.get("items", []), limit=10)
    return research


def _trim_records(section: object, key: str, columns: tuple[str, ...]) -> object:
    """Deja en `section[key]` sólo las columnas indicadas.

    Tolera que la sección no exista (los artefactos de fantasy son opcionales) y
    que a una fila le falte alguna columna: se omite en vez de fallar, porque un
    board generado con una versión anterior del script sigue siendo publicable.
    """
    if not isinstance(section, dict) or key not in section:
        return section
    section[key] = [
        {c: row[c] for c in columns if c in row} for row in section[key]
    ]
    return section


def _finite(value):
    """Convierte NaN e infinitos a null, recursivamente.

    **Esto no es opcional.** `json.dumps` de Python emite `NaN` e `Infinity` tal
    cual, y son extensiones que JavaScript **no** acepta: `JSON.parse` revienta
    con el payload entero, no sólo con el campo afectado.

    El fallo es especialmente traicionero porque no se ve en Python (que relee
    su propio NaN sin quejarse) y en la web se manifiesta como «todavía no hay
    datos generados» en *todas* las secciones — que parece un problema de
    generación, no de serialización. Un solo jugador sin fecha de nacimiento
    (`age`) basta para tumbar la página entera.
    """
    if isinstance(value, dict):
        return {k: _finite(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_finite(v) for v in value]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def write_payload(web_data: Path, payload: dict) -> Path:
    """Escribe el JSON y su versión comprimida en base64."""
    web_data.mkdir(parents=True, exist_ok=True)

    # allow_nan=False convierte en excepción ruidosa cualquier no-finito que se
    # escape a `_finite`. Preferimos que falle el script a publicar una web que
    # se queda muda.
    raw = json.dumps(
        _finite(payload), ensure_ascii=False, default=str, separators=(",", ":"),
        allow_nan=False,
    )
    (web_data / "model.json").write_text(raw, encoding="utf-8")

    # mtime=0 para que el gzip sea reproducible: si no, cada ejecución produce
    # bytes distintos aunque los datos sean idénticos y el diff de git es ruido.
    compressed = gzip.compress(raw.encode("utf-8"), compresslevel=9, mtime=0)
    encoded = base64.b64encode(compressed).decode("ascii")

    (web_data / "model.b64.js").write_text(
        "// GENERADO POR scripts/export_web_data.py — NO EDITAR A MANO.\n"
        "// gzip + base64 del payload del modelo. Lo descomprime model.js\n"
        "// en build time, para que las páginas salgan estáticas y el sitio\n"
        "// no haga ni una petición de red en runtime.\n"
        f"export const MODEL_B64 = \"{encoded}\";\n",
        encoding="utf-8",
    )

    size_kb = len(encoded) / 1024
    print(f"Escrito web/data/model.b64.js ({size_kb:.1f} KB en base64).")
    if size_kb > SIZE_WARNING_KB:
        print(f"  AVISO: por encima de {SIZE_WARNING_KB} KB. ¿Hay una tabla que sobra?")
    return web_data / "model.b64.js"


if __name__ == "__main__":
    raise SystemExit(main())
