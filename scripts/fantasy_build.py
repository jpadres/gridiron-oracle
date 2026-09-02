#!/usr/bin/env python3
"""Board de draft de fantasy: proyecciones de temporada ordenadas por VOR.

Tarda ~5 minutos porque además de proyectar la temporada que viene, valida la
metodología proyectando las cuatro anteriores contra su resultado real. Esa
validación no es opcional: un board sin correlación medida es una lista de
opiniones.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import numpy as np
import pandas as pd
from scipy.stats import pearsonr, spearmanr

from oracle.config import paths as resolve_paths
from oracle.fantasy import availability as avail
from oracle.fantasy import risk
from oracle.fantasy import rookies as rookie_prior
from oracle.fantasy.ages import ages_for_season, birth_dates
from oracle.fantasy.components import COMPONENTS, compile_points
from oracle.fantasy.draft import (
    FANTASY_POSITIONS,
    PROJECTED_GAMES,
    LeagueSettings,
    _td_points,
    draft_board,
    project_season,
)
from oracle.fantasy.league import (
    BENCH_SLOTS,
    FLEX_SLOTS,
    SUPERFLEX_SLOTS,
    roster_context,
)
from oracle.fantasy.scoring import ScoringRules, rules_from_name, score_player_weeks

# Temporadas sobre las que se reporta la validación. Se fija antes de mirar el
# resultado, que es la regla del proyecto.
VALIDATION_SEASONS = (2022, 2023, 2024, 2025)


def _attach_current_team(board: pd.DataFrame, paths, season: int) -> pd.DataFrame:
    """Sobrescribe el equipo con el de la plantilla de `season`, si la hay."""
    from oracle.data.ingest import normalize_team

    roster_path = paths.raw / f"roster_{season}.parquet"
    if not roster_path.exists():
        print(f"Sin roster_{season}.parquet: el board queda con el equipo del año pasado.")
        return board

    roster = pd.read_parquet(roster_path)
    if "gsis_id" not in roster.columns:
        return board
    # La semana más temprana disponible: es la foto de pretemporada, que es la
    # que corresponde a un board de draft.
    if "week" in roster.columns:
        roster = roster[roster["week"] == roster["week"].min()]
    if "status" in roster.columns:
        active = roster[roster["status"] == "ACT"]
        if not active.empty:
            roster = active
    roster = roster.dropna(subset=["gsis_id", "team"]).drop_duplicates("gsis_id")
    current = dict(
        zip(roster["gsis_id"], roster["team"].map(normalize_team), strict=True)
    )

    board = board.copy()
    board["previous_team"] = board["team"]
    mapped = board["player_id"].map(current)
    # Quien no aparece en la plantilla conserva su equipo anterior. nflverse
    # publica el roster del año en curso de forma incompleta durante agosto
    # —Stefon Diggs no figuraba pese a haber firmado el día 5— así que un
    # jugador ausente NO significa que esté sin equipo.
    board["team"] = mapped.fillna(board["team"])
    board["team_changed"] = board["team"] != board["previous_team"]

    changed = board[board["team_changed"]]
    print(f"Plantillas {season}: {int(mapped.notna().sum())} de {len(board)} resueltos, "
          f"{len(changed)} cambiaron de equipo.")
    for _, row in changed.head(10).iterrows():
        print(f"  {row['player_name']}: {row['previous_team']} -> {row['team']}")
    return board


def _attach_risk(
    players: pd.DataFrame,
    team_games: pd.DataFrame,
    board: pd.DataFrame,
    season: int,
    rules: ScoringRules,
) -> pd.DataFrame:
    """Tasa de ausencia y probabilidad de bust para cada jugador del board.

    Los coeficientes del bust se ajustan sobre las temporadas **anteriores** a
    la que se proyecta, reconstruyendo para cada una el board que se habría
    publicado entonces. Es más lento que ajustar una vez sobre todo, y es la
    diferencia entre una probabilidad calibrada y una que se ha visto a sí
    misma.
    """
    from oracle.fantasy.bust import fit as fit_bust
    from oracle.fantasy.bust import label as bust_label
    from oracle.fantasy.bust import predict as predict_bust

    availability = avail.season_availability(players, team_games)
    positions = (
        players[players["season"] < season]
        .sort_values("season")
        .groupby("player_id", observed=True)["position"]
        .last()
    )

    past = avail.history(availability, positions, season)
    board = board.merge(past[["player_id", "missed_rate", "availability_sample"]],
                        on="player_id", how="left")
    # Sin historial se usa la media del propio board: neutro. Un 0 le regalaría
    # un «nunca falta» a quien simplemente no tiene datos.
    board["missed_rate"] = board["missed_rate"].fillna(board["missed_rate"].mean())
    board["missed_games"] = board["missed_rate"] * 17.0

    training = _bust_training(players, team_games, season, rules)
    if training is None or len(training) < 300:
        print("Sin historial suficiente para la probabilidad de bust; se omite.")
        return board

    model = fit_bust(training)
    board["p_bust"] = predict_bust(model, board)
    board["bust_label"] = [bust_label(p) for p in board["p_bust"]]
    print(f"Probabilidad de bust ajustada sobre {len(training)} jugador-temporadas "
          f"anteriores a {season}.")
    return board


def _bust_training(
    players: pd.DataFrame, team_games: pd.DataFrame, season: int, rules: ScoringRules
) -> pd.DataFrame | None:
    """Jugador-temporadas pasadas con su etiqueta de bust ya observada.

    `rules` NO es opcional a propósito. Aquí había un PPR fijo mientras el resto
    del script respetaba las reglas de la liga: el modelo de bust se entrenaba
    con resultados en PPR y luego se aplicaba a un board puntuado en estándar o
    en media recepción.

    Un bust es «terminar por debajo del 70% de su proyección», y las dos mitades
    de esa frase tienen que estar en la misma moneda. Con reglas distintas, los
    receptores de volumen salen etiquetados con el riesgo de otra liga.
    """
    from oracle.fantasy.bust import BUST_FRACTION

    scored = players.copy()
    scored["fantasy_points"] = score_player_weeks(scored, rules)
    actual = scored.groupby(["player_id", "season"], observed=True)["fantasy_points"].sum()
    availability = avail.season_availability(players, team_games)

    rows = []
    for past_season in range(2013, season):
        try:
            projected = project_season(players, past_season, rules)
        except ValueError:
            continue
        projected = risk.components(projected, {"QB": 4.0, "RB": 6.0, "WR": 6.0, "TE": 6.0})
        positions = (
            players[players["season"] < past_season]
            .sort_values("season")
            .groupby("player_id", observed=True)["position"]
            .last()
        )
        history = avail.history(availability, positions, past_season)
        if history.empty:
            continue
        frame = projected.merge(history[["player_id", "missed_rate"]],
                                on="player_id", how="left")
        frame["missed_rate"] = frame["missed_rate"].fillna(frame["missed_rate"].mean())
        frame = frame.nlargest(250, "projected_points")
        try:
            truth = actual.xs(past_season, level="season")
        except KeyError:
            continue
        frame = frame[frame["player_id"].isin(truth.index)].copy()
        if frame.empty:
            continue
        frame["observed"] = frame["player_id"].map(truth).astype(float)
        frame["bust"] = (
            frame["observed"] < BUST_FRACTION * frame["projected_points"].astype(float)
        ).astype(int)
        rows.append(frame)

    return pd.concat(rows, ignore_index=True) if rows else None


# La plantilla por defecto, escrita como `roster_positions` de verdad y no como
# titulares ya repartidos: así el board publicado pasa por el MISMO compilador
# que una liga sincronizada, y no hay una segunda ruta con sus propios números.
DEFAULT_ROSTER: tuple[str, ...] = (
    "QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "K", "DEF",
    "BN", "BN", "BN", "BN", "BN", "BN",
)

# Profundidad mínima publicada por posición.
#
# El payload se recortaba al top-250 por VOR **de la liga por defecto**, y eso
# dejaba 28 quarterbacks. El nivel de reemplazo de una liga profunda cae fuera
# del pool, y entonces no es que salga peor: es que no sale.
#
# El sobre soportado llega a **32 equipos**, que es el máximo con sentido —una
# franquicia por equipo NFL— y es el formato que se pidió. Los números son el
# rank de reemplazo MÁXIMO medido sobre rosters reducidos y estándar de 32
# equipos, con y sin superflex, más margen. Medido, no elegido:
#
#     QB 65   RB 97   WR 97   TE 33
#
# El superflex es lo que dispara el quarterback (QB33 -> QB65), así que se
# publica para ese caso: cubre también las ligas de un solo QB.
MIN_DEPTH: dict[str, int] = {"QB": 76, "RB": 112, "WR": 112, "TE": 44}
BOARD_LIMIT = 250


def _roster_positions(synced: dict | None, args) -> list[str] | None:
    """La plantilla de la liga sincronizada, o la de por defecto."""
    if synced and not args.ignore_league and isinstance(synced.get("roster_positions"), list):
        return list(synced["roster_positions"])
    return list(DEFAULT_ROSTER)


def mark_rostered(board: pd.DataFrame, raw_dir: Path, season: int) -> pd.DataFrame:
    """Marca a quien NO aparece en ningún roster de la temporada.

    ## El agujero que esto tapa

    La proyección sale de tres años de producción y **nunca comprueba si el
    jugador sigue en la NFL**. El equipo que se publica es el último en el que
    jugó. Resultado: 74 de 344 jugadores del board de 2026 no están en ningún
    roster — y no eran casos de relleno, estaban arriba. Tyreek Hill salía en el
    puesto 58 con equipo «MIA» cuando Miami lo cortó en febrero y no ha firmado
    con nadie.

    Un board que te ofrece agentes libres sin decirlo no es un board optimista:
    es un board que miente sobre un hecho comprobable con datos que ya están en
    disco.

    ## Se MARCA, no se borra

    Un agente libre puede firmar mañana y volver a valer. Lo que no puede es
    parecer un titular. La fila lo dice y el orden lo baja; el jugador sigue
    ahí, buscable.

    ## Lo que esto NO detecta, dicho aquí

    Suspensiones y la lista de exentos del comisionado **no están en este
    fichero**: Josh Jacobs figura `ACT` en Green Bay estando apartado sin fecha
    de vuelta. Eso lo caza la capa de prensa —`research/player_status.json`, que
    se cuelga en `export_web_data._attach_status`— y no ésta. Dos agujeros
    distintos con dos remedios distintos, y ninguno de los dos toca un número.
    """
    path = raw_dir / f"roster_{season}.parquet"
    if not path.exists():
        # Sin fichero NO se marca a nadie: decir «sin equipo» de todos por no
        # tener el dato sería peor que el problema que esto arregla.
        board["rostered"] = True
        return board
    roster = pd.read_parquet(path, columns=["gsis_id", "status"])
    # Cualquier situación de plantilla cuenta como «tiene equipo», incluida la
    # reserva y el practice squad: lo que se busca es quien no está en NINGUNA.
    on_a_team = set(roster["gsis_id"].dropna().astype(str))
    board["rostered"] = board["player_id"].astype(str).isin(on_a_team)
    return board


# Primera temporada de rookies que entra en la previa. nflverse publica
# `draft_number` de forma fiable desde 2006, y es la misma ventana con la que se
# validó (E9, 3.538 temporadas de rookie).
FIRST_ROOKIE_SEASON = 2006


def rookie_rows(
    paths, players: pd.DataFrame, rules: ScoringRules, season: int
) -> tuple[pd.DataFrame, list[dict]]:
    """Los novatos de `season`, con la previa por capital de draft ya aplicada.

    ## Por qué ahora sí tienen número

    Hasta hoy el board no los proyectaba y la interfaz escribía UNKNOWN. Eso era
    correcto mientras no hubiera nada validado que decir — y dejaba de serlo
    desde que `ROOKIE_PRIOR` pasó a VALIDATED: hay una previa walk-forward que
    bate a los dos baselines (Spearman 0,604 frente a 0,093 de la media de
    posición; MAE 23,68 frente a 24,06 de predecir cero). Publicar UNKNOWN
    teniendo eso medido ya no es prudencia, es esconder una medición.

    ## En COMPONENTES, no en puntos

    La previa devuelve componentes de temporada encogidos, no un número de
    puntos, y por eso un novato entra por la misma puerta que un veterano: se
    compila con las reglas de TU liga. Si se publicara «136,9 puntos» ese número
    sería de la liga que construyó el board, y en una liga de media recepción
    estaría mal sin que nada lo dijera.

    Los componentes se dividen entre `PROJECTED_GAMES` porque el board trabaja
    con medias por partido y multiplica al final. La previa es un TOTAL de
    temporada —incluye a quien no jugó ni un partido, que es la mitad de la
    señal—, así que dividir y volver a multiplicar por la misma constante la
    deja intacta. No es una tasa por partido jugado y no debe leerse así.

    ## La comparación con un veterano, dicha aquí

    Un veterano se proyecta como `puntos por partido × 15,5`: la escala supone
    que juega. La previa de novato es el total observado de su año de rookie,
    ceros incluidos. Las dos escalas NO son la misma, y la diferencia empuja al
    novato hacia abajo. Se publica así porque es lo que está validado; corregirlo
    exigiría un modelo de «probabilidad de ser titular» que no existe.

    Devuelve las filas proyectadas y la lista de los que se quedan SIN previa —
    esos siguen publicándose aparte, sin valor, como hasta ahora.
    """
    path = paths.raw / f"roster_{season}.parquet"
    if not path.exists():
        return pd.DataFrame(), []

    table = rookie_prior.season_table(paths.raw, players, rules)
    table = table[table["season"] >= FIRST_ROOKIE_SEASON]
    priors = rookie_prior.fit(table, season)
    if not priors:
        return pd.DataFrame(), []

    frame = pd.read_parquet(path)
    frame = frame[
        (frame["entry_year"] == season)
        & (frame["position"].isin(FANTASY_POSITIONS))
        & frame["gsis_id"].notna()
    ].drop_duplicates("gsis_id")

    rows: list[dict] = []
    sin_previa: list[dict] = []
    for row in frame.itertuples(index=False):
        prior = rookie_prior.predict(priors, row.position, row.draft_number)
        name = str(row.full_name)
        short = f"{name[0]}.{name.split(' ', 1)[-1]}" if " " in name else name
        pick = row.draft_number
        pick = int(pick) if pick == pick and pick is not None else None
        if prior is None or not prior.components:
            sin_previa.append({"player_id": str(row.gsis_id), "player_name": short})
            continue
        # Componente por partido = total de temporada / la misma constante por la
        # que el board multiplica. Ida y vuelta exacta.
        components = {
            name_: value / PROJECTED_GAMES
            for name_, value in zip(COMPONENTS, prior.components, strict=True)
        }
        rows.append({
            "player_id": str(row.gsis_id),
            "player_name": short,
            "player_full_name": name,
            "position": str(row.position),
            "team": str(row.team),
            **components,
            # Sin historial NFL: cero partidos ponderados. Es lo que hace que el
            # navegador NO le aplique el encogimiento de veterano — ya viene
            # encogido con su propia muestra.
            "weighted_games": 0.0,
            "points_per_game": 0.0,
            "td_per_game": 0.0,
            "age": np.nan,
            "age_factor": 1.0,
            "expected_games": float(PROJECTED_GAMES),
            "games_source": "rookie_prior",
            "season": season,
            "rookie": True,
            "draft_pick": pick,
            "rookie_round": prior.draft_round,
            # El intervalo OBSERVADO de su celda, que es lo que de verdad
            # describe a un novato: el QB de segunda ronda promedia 63 con
            # mediana 16. Publicar sólo la media sería el peor número posible.
            "rookie_p25": prior.p25,
            "rookie_p50": prior.p50,
            "rookie_p75": prior.p75,
            "rookie_sample": prior.sample,
            "rookie_bimodal": bool(prior.bimodal_warning),
        })

    if not rows:
        return pd.DataFrame(), sin_previa

    board = pd.DataFrame(rows)
    # Los de una misma celda valen lo mismo —la previa sabe la ronda y nada
    # más—, así que el desempate lo pone el número de elección: un HECHO, no una
    # afirmación sobre cuánto separa a uno del otro. `draft_board` ordena de
    # forma estable, así que este orden sobrevive al VOR. Los no elegidos van
    # después, y entre ellos por nombre para que el board no baile entre builds.
    board = board.sort_values(
        by=["draft_pick", "player_full_name"], na_position="last", kind="mergesort"
    ).reset_index(drop=True)
    board["projected_points"] = (
        compile_points(board[list(COMPONENTS)], rules, board["position"])
        * board["age_factor"] * board["expected_games"]
    )
    return board, sin_previa


def _publish_slice(board: pd.DataFrame) -> pd.DataFrame:
    """El top del board MÁS la profundidad mínima por posición.

    Sin el segundo trozo, una liga rara no se puede calcular en el navegador y
    —peor— no se nota: el reemplazo cae fuera del pool y sale un VOR inflado para
    la posición entera. Con él, o se calcula o `buildLeagueBoard` lo declara
    corto. Cuesta unas pocas decenas de filas.
    """
    keep = set(board.head(BOARD_LIMIT)["player_id"])
    for position, depth in MIN_DEPTH.items():
        rows = board[board["position"] == position].nlargest(depth, "projected_points")
        keep.update(rows["player_id"])
    # TODOS los novatos, tengan el VOR que tengan. Un draft real los ofrece —y
    # en las últimas rondas se cogen precisamente porque valen poco ahora— así
    # que recortarlos por valor los volvería a dejar fuera del tablero, que es
    # el agujero que se acaba de tapar. Son unas decenas de filas.
    if "rookie" in board.columns:
        keep.update(board.loc[board["rookie"].astype(bool), "player_id"])
    return board[board["player_id"].isin(keep)].copy()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Genera el board de draft.")
    parser.add_argument("--root", default=None)
    parser.add_argument("--season", type=int, default=None, help="Temporada a proyectar.")
    parser.add_argument("--ignore-league", action="store_true",
                        help="Ignora research/league.json y usa --scoring y --teams.")
    parser.add_argument("--scoring", default="ppr", help="ppr | half | standard | te-premium")
    parser.add_argument(
        "--publish-league-name", action="store_true",
        help="Publica el nombre de tu liga en el sitio web. Suele llevar dentro "
             "los nombres de quienes juegan en ella; por eso no es el defecto.",
    )
    parser.add_argument("--teams", type=int, default=12)
    args = parser.parse_args(argv)

    paths = resolve_paths(args.root).ensure()

    # La configuración de la liga sincronizada manda sobre los valores por
    # defecto. La puntuación **cambia el ranking**, así que si existe hay que
    # usarla: un board en PPR para una liga estándar no es aproximado, es de
    # otra liga.
    synced = _synced_league(paths.root)
    if synced and not args.ignore_league:
        rules = ScoringRules(**synced["scoring"])
        settings = LeagueSettings(
            teams=synced["teams"],
            starters=tuple(synced["starters"].items()),
        )
        print(f"Usando la liga sincronizada: {synced.get('name') or '(sin nombre publicado)'} "
              f"({settings.teams} equipos, {rules.reception:g} por recepción).")
    else:
        rules = rules_from_name(args.scoring)
        settings = None
    players = pd.read_parquet(paths.player_weeks)

    season = args.season or int(players["season"].max()) + 1
    if settings is None:
        settings = LeagueSettings(teams=args.teams)

    # Curva de edad, activa desde el 29/8/2026.
    #
    # Llevaba tiempo implementada y muerta porque `ages` llegaba vacío. Se activa
    # tras validarla, no por tener el dato: walk-forward 2019-2025 con y sin
    # ella, umbral fijado antes en `docs/PREREGISTRO_edad.md`.
    #
    # Mejora el MAE en las CUATRO posiciones, y más en running back (+4,01
    # puntos) que en ninguna otra. Eso es la confirmación que importa: RB es
    # donde la curva es más agresiva —5,5% anual pasados los 25,5— así que es
    # donde tenía que notarse si la hipótesis era buena. Si hubiera mejorado más
    # en otra posición, habría sido motivo de sospecha, no de celebración.
    #
    # La edad se calcula a 1 de septiembre de la temporada proyectada, no hoy:
    # usar la edad actual para validar 2019 le da a todos siete años de más.
    ages = ages_for_season(birth_dates(paths.raw), season)
    print(f"Proyectando {season} ({_scoring_label(rules)}, liga de {settings.teams})...")
    print(f"  curva de edad activa: {ages.notna().sum()} fechas de nacimiento.")
    # El board publicado usa el modelo de reemplazo VALIDADO en E18: los huecos
    # compartidos se asignan de verdad en vez de repartirse por pesos fijos.
    #
    # Rompe a propósito con el VOR anterior, y la ruptura está medida: el modelo
    # viejo consumía 95 de los 96 huecos titulares de una liga estándar de 12
    # —tres redondeos independientes no suman los huecos que hay— y tomaba como
    # reemplazo al ÚLTIMO TITULAR en vez de al primero que no lo es, que es la
    # definición. Solapamiento top-25 entre el board viejo y el nuevo: 24 de 25.
    context = roster_context(
        _roster_positions(synced, args) if not args.ignore_league else None,
        settings.teams,
        season=season,
    ) if _roster_positions(synced, args) else None
    proyecciones = project_season(players, season, rules, ages=ages)

    # NOVATOS, con su previa por capital de draft. Entran ANTES de calcular el
    # VOR y no después: el reemplazo de una posición es «el mejor que sigue
    # libre cuando todos han llenado esa posición», y un novato drafteable
    # ocupa uno de esos huecos. Calcular el reemplazo sin ellos y colgarlos
    # luego daría dos boards distintos —el de los veteranos y el de todos— y
    # ninguna forma de saber cuál estabas leyendo.
    novatos, sin_previa = rookie_rows(paths, players, rules, season)
    if not novatos.empty:
        proyecciones = pd.concat([proyecciones, novatos], ignore_index=True)
        print(f"Novatos con previa: {len(novatos)} "
              f"({len(sin_previa)} sin celda aplicable, se publican sin valor).")
    proyecciones["rookie"] = proyecciones.get(
        "rookie", pd.Series(False, index=proyecciones.index)
    ).fillna(False).astype(bool)

    board = draft_board(proyecciones, context, teams=settings.teams)
    # Quién sigue en una plantilla de la NFL. NO toca proyecciones ni VOR: sólo
    # añade el hecho, para que la interfaz pueda decirlo.
    board = mark_rostered(board, paths.raw, season)
    sin_equipo = int((~board["rostered"]).sum())
    print(f"Sin equipo en {season}: {sin_equipo} de {len(board)} jugadores del board.")

    # Etiqueta de riesgo. Validada contra el error realizado en
    # `scripts/fantasy_risk_validate.py`: Spearman +0.12 y el tercio de riesgo
    # yerra un 10.7% más. Pasa el umbral, y lo pasa por poco — la web lo dice
    # así, porque «predice el error» y «predice el error un poco» son
    # afirmaciones distintas.
    #
    # LOS NOVATOS SE QUEDAN FUERA DE LAS TRES SEÑALES DE RIESGO, A PROPÓSITO.
    # Volatilidad, ausencia y bust se calculan sobre el historial NFL del
    # jugador y un novato no tiene ninguno. Pasarlos por aquí les colgaría la
    # media del board —«riesgo medio», «pierde 2,4 partidos»— que es un número
    # inventado con nombre de medición. Sus columnas quedan vacías y la interfaz
    # lo dice. La limitación está escrita en la propia capacidad: el modelo de
    # bust de veteranos NO aplica a quien no tiene historial.
    es_novato = board["rookie"].to_numpy(dtype=bool)
    veteranos = board[~es_novato].copy()
    novatos_board = board[es_novato].copy()

    td_points = {pos: _td_points(pos, rules) for pos in ("QB", "RB", "WR", "TE")}
    veteranos = risk.score(veteranos, td_points)
    veteranos["risk_reasons"] = [risk.reasons(row) for _, row in veteranos.iterrows()]

    # Ausencia y bust. Las dos están validadas con umbral preregistrado en
    # `docs/PREREGISTRO_riesgo.md`:
    #
    # - Ausencia: Spearman +0,24 en la población del board, con el tercio alto
    #   perdiendo el 32,9% de los partidos frente al 18,1% del bajo.
    # - Bust: ECE 0,043 y el decil alto busteando 5,5 veces más que el bajo.
    #
    # Son cosas distintas de la volatilidad de `risk.py`, que mide cuánto puede
    # variar la proyección **en los dos sentidos**. El bust mira sólo la cola de
    # abajo, que es la pregunta que se hace en un draft.
    team_games = pd.read_parquet(paths.team_games)
    veteranos = _attach_risk(players, team_games, veteranos, season, rules)
    board = (
        pd.concat([veteranos, novatos_board], ignore_index=True)
        .sort_values("overall_rank")
        .reset_index(drop=True)
    )

    # Nombre completo, además del abreviado que se pinta.
    #
    # No es cosmético: es lo que permite emparejar los picks de Sleeper con este
    # board **sin adivinar**. Sleeper manda «Bijan Robinson»; nflverse abrevia a
    # «B.Robinson», que es indistinguible de Brian Robinson. Con el nombre
    # completo más equipo y posición el cruce es exacto, y donde no lo sea se
    # renuncia a emparejar en vez de arriesgarse — la misma regla que en el
    # dossier.
    # Equipo de la plantilla de ESTA temporada, no del último partido jugado.
    #
    # `draft.project_season` etiqueta con `group["team"].iloc[-1]`, o sea el
    # equipo del último partido del historial: en agosto, el del año pasado.
    # Tyler Allgeier salía en ATL siendo el titular de Arizona, y Trey Benson en
    # ARI después de que lo cortaran. Para un board que se lee el día del draft
    # eso no es un detalle: te hace descartar a un titular por creerlo suplente.
    #
    # `weekly.py` ya resolvía la plantilla antes de nada —está en su docstring
    # como lección aprendida— y el board se había quedado sin ese paso.
    #
    # No obliga a revalidar: `team` es una **etiqueta**, no entra en ninguna
    # cuenta de la proyección ni del VOR. Lo que sí sigue heredándose del año
    # anterior es el reparto de uso, y por eso los que cambian de equipo se
    # marcan: es justo donde la proyección vale menos.
    board = _attach_current_team(board, paths, season)

    full_names = (
        players.dropna(subset=["player_display_name"])
        .sort_values("season")
        .groupby("player_id", observed=True)["player_display_name"]
        .last()
    )
    # El nombre completo de un novato NO sale de `player_weeks` —no ha jugado—,
    # así que viene de su fila del roster y aquí sólo se rellena lo que falte.
    # Sobrescribir con el mapa dejaría a los novatos sin nombre completo, que es
    # justo la clave con la que se cruzan los picks de Sleeper.
    mapeado = board["player_id"].map(full_names)
    board["player_full_name"] = (
        mapeado.fillna(board["player_full_name"])
        if "player_full_name" in board.columns else mapeado
    )

    print("\nTop 20 por VOR:\n")
    view = board.head(20)[
        ["overall_rank", "player_name", "position", "position_rank", "tier",
         "projected_points", "vor"]
    ]
    print(view.to_string(index=False, float_format=lambda x: f"{x:8.1f}"))

    print("\nValidando la metodología sobre temporadas pasadas...")
    validation = validate(players, rules, settings, team_games=team_games)
    fmt = lambda x: f"{x:7.3f}"  # noqa: E731
    print(f"\nTemporadas: {validation['seasons']}")
    print("\nPor posición (los proyectados que no jugaron cuentan 0):")
    print(validation["by_position"].to_string(index=False, float_format=fmt))
    print("\nPor banda de rank proyectado:")
    print(validation["by_band"].to_string(index=False, float_format=fmt))
    print("\nVALOR CAPTURADO (métrica primaria) — fracción del VOR real disponible:")
    print(validation["value_captured"].to_string(index=False, float_format=fmt))
    print(f"\nAcierto del top-{TOP_N} por posición:")
    print(validation["top_n"].to_string(index=False, float_format=fmt))
    print(
        "\n`zero_share` es la fracción de la muestra que terminó en 0 puntos.\n"
        "Va al lado de Spearman a propósito: con muchos empates en cero, el\n"
        "coeficiente deja de significar lo que uno cree, y el hit rate del\n"
        "top-24 —que no depende de los empates— es la lectura honesta."
    )

    destination = paths.out / "fantasy_draft.json"
    destination.write_text(
        json.dumps(
            {
                "season": season,
                # La etiqueta describe las reglas **de verdad**, no el nombre
                # del argumento: con una liga sincronizada, «ppr» podía acabar
                # publicado sobre un board de media recepción.
                "scoring": _scoring_label(rules),
                # El nombre de la liga sólo viaja al sitio público si se pide
                # explícitamente. El fichero versionado ya no lo trae, así que
                # esto es None salvo que se pase `--publish-league-name`: el
                # nombre de una liga suele llevar dentro los nombres de los que
                # juegan en ella.
                "league": _league_name_to_publish(args, synced),
                "teams": settings.teams,
                # Los titulares que se PUBLICAN son los del contexto que calculó
                # el board, no los de `LeagueSettings`. Publicar unos y calcular
                # con otros es la misma clase de fallo que etiquetar «ppr» un
                # board de media recepción: el número y su nombre tienen que
                # salir del mismo sitio.
                "starters": {k: round(v, 3) for k, v in (
                    context.starters if context else dict(settings.starters)
                ).items()},
                "roster": _roster_positions(synced, args),
                # Cómo se repartieron los huecos compartidos. Sin esto no se
                # puede saber si el board de arriba usó el modelo validado.
                # Ya no hay dos: la asignación voraz es el único camino.
                "replacement_model": "greedy",
                "board": _publish_slice(board).round(3).to_dict(orient="records"),
                # K y DST: FICHABLES, no valorados. Sin esto el Draft Room no
                # puede registrar un pick de pateador o defensa y los huecos
                # K/DEF de la plantilla se quedan abiertos para siempre en un
                # draft manual. Llevan hechos de la temporada anterior y NADA
                # más: ni proyección ni VOR, porque el orden de pateadores está
                # rechazado (E8b) y el modelo de DST no existe (DESIGN_ONLY).
                "specialists": _specialists(players, team_games, season),
                # Las tres vistas viajan por separado: una sola correlación
                # sobre el pool entero es justo la que no contesta nada.
                "validation": validation["by_position"].round(4).to_dict(orient="records"),
                "validation_bands": validation["by_band"].round(4).to_dict(orient="records"),
                "validation_top_n": validation["top_n"].round(4).to_dict(orient="records"),
                # La métrica PRIMARIA. Va primero en la página porque es la
                # única que pesa por valor y la única invariante al nivel.
                "validation_value": (
                    validation["value_captured"].round(4).to_dict(orient="records")
                ),
            },
            ensure_ascii=False,
            default=str,
        ),
        encoding="utf-8",
    )
    print(f"\nEscrito {destination}")
    return 0


def _specialists(players: pd.DataFrame, team_games: pd.DataFrame, season: int) -> dict:
    """El pateador titular de cada equipo y las 32 defensas, con sus hechos.

    El titular se elige por VOLUMEN de intentos en la temporada anterior (el
    mismo criterio que el ranking semanal), nunca por mera recencia. La defensa
    lleva un id sintético con espacio de nombres propio (`DST_KC`): no es un
    jugador y no puede colisionar con un GSIS id.
    """
    prior_players = players[players["season"] == season - 1]
    kickers: list[dict] = []
    ks = prior_players[prior_players["position"] == "K"].copy()
    if not ks.empty:
        ks["tries"] = ks["fg_att"].fillna(0) + ks["pat_att"].fillna(0)
        latest = ks.sort_values("week").groupby("player_id", observed=True).tail(1)
        current_team = dict(zip(latest["player_id"], latest["team"], strict=True))
        ks["now"] = ks["player_id"].map(current_team)
        agg = (
            ks.groupby(["now", "player_id"], observed=True)
            .agg(
                player_name=("player_name", "last"),
                player_full_name=("player_display_name", "last"),
                games=("week", "count"), tries=("tries", "sum"),
                fg_made=("fg_made", "sum"), fg_att=("fg_att", "sum"),
            )
            .reset_index()
        )
        starters = agg.sort_values("tries", ascending=False).groupby("now", observed=True).head(1)
        for _, row in starters.sort_values("now").iterrows():
            kickers.append(
                {
                    "player_id": row["player_id"],
                    "player_name": row["player_name"],
                    "player_full_name": row["player_full_name"],
                    "position": "K",
                    "team": row["now"],
                    "games": int(row["games"]),
                    "fg_made": int(row["fg_made"]),
                    "fg_att": int(row["fg_att"]),
                }
            )

    defenses: list[dict] = []
    prior_games = team_games[(team_games["season"] == season - 1) & team_games["played"]]
    if not prior_games.empty:
        agg = prior_games.groupby("team", observed=True).agg(
            games=("week", "count"),
            points_allowed=("points_against", "mean"),
            sacks=("def_sacks_taken", "mean"),
            interceptions=("def_interceptions", "mean"),
            fumbles=("def_fumbles_lost", "mean"),
        )
        for team, row in agg.sort_index().iterrows():
            defenses.append(
                {
                    "player_id": f"DST_{team}",
                    "player_name": f"{team} D/ST",
                    "player_full_name": f"{team} D/ST",
                    "position": "DST",
                    "team": team,
                    "games": int(row["games"]),
                    "points_allowed_pg": round(float(row["points_allowed"]), 1),
                    "sacks_pg": round(float(row["sacks"]), 2),
                    "takeaways_pg": round(float(row["interceptions"] + row["fumbles"]), 2),
                }
            )
    return {"kickers": kickers, "defenses": defenses}


def _scoring_label(rules: ScoringRules) -> str:
    """Cómo se llama esta puntuación, mirando las reglas y no el argumento.

    La etiqueta sale de las reglas efectivas porque ya se publicó una vez «ppr»
    sobre un board de media recepción: la etiqueta venía del argumento de la
    línea de comandos y las reglas venían de la liga sincronizada.

    Toda regla que mueva el ranking tiene que aparecer aquí. Si añades un campo
    a `ScoringRules` y no lo reflejas, este es exactamente el sitio donde el
    fallo vuelve a ocurrir.
    """
    base = {1.0: "PPR", 0.5: "half-PPR", 0.0: "estándar"}.get(rules.reception)
    label = base or f"{rules.reception:g} por recepción"
    if rules.reception_by_position:
        apartes = ", ".join(
            f"{position} a {value:g}"
            for position, value in sorted(rules.reception_by_position.items())
        )
        label += f" con {apartes} por recepción"
    if rules.passing_td != 4.0:
        label += f", TD de pase a {rules.passing_td:g}"
    for name, attribute in (("bonus de 300 al pase", "passing_300_bonus"),
                            ("bonus de 100 al acarreo", "rushing_100_bonus"),
                            ("bonus de 100 recibiendo", "receiving_100_bonus")):
        if getattr(rules, attribute):
            label += f", {name} de {getattr(rules, attribute):g}"
    return label


def _synced_league(root) -> dict | None:
    """Las reglas de la liga sincronizada, si las hay.

    Lee el fichero versionado, que **no** trae identificadores. Si existe el
    privado (que no se versiona) se fusiona encima, para que el nombre esté
    disponible en local sin haberlo publicado nunca.
    """
    path = root / "research" / "league.json"
    if not path.exists():
        return None
    league = json.loads(path.read_text(encoding="utf-8"))
    private = root / "research" / "league_private.json"
    if private.exists():
        league = {**league, **json.loads(private.read_text(encoding="utf-8"))}
    return league


def _league_name_to_publish(args, synced) -> str | None:
    """El nombre de la liga sólo sale al sitio público si se pide.

    El sitio está desplegado y es público. El nombre de una liga de fantasy
    suele llevar dentro los nombres o los apodos de quienes juegan en ella, y
    ninguno de ellos ha decidido nada sobre este proyecto. Publicarlo tiene que
    ser un acto, no un efecto secundario de sincronizar.
    """
    if not synced or args.ignore_league or not getattr(args, "publish_league_name", False):
        return None
    return synced.get("name")


# Bandas de rank PROYECTADO. Son el equivalente offline de las bandas de ADP:
# una correlación sobre el pool entero está dominada por lo fácil —el QB1 por
# encima del WR80— y no dice nada sobre las decisiones que de verdad se toman.
RANK_BANDS: tuple[tuple[str, int, int], ...] = (
    ("1-50", 1, 50),
    ("51-100", 51, 100),
    ("101-180", 101, 180),
)

# Cuántos por posición cuentan como titulares de verdad en una liga de 12. Es el
# corte del hit rate: de los que proyectamos entre los 24 mejores de su
# posición, ¿cuántos terminaron ahí?
TOP_N = 24

# El universo DRAFTEABLE: 12 equipos x 15 rondas. Es el mismo rango que cubren
# las bandas y no es una preferencia, es corrección.
#
# Medir sobre el pool proyectado entero —353 receptores— no contesta «¿es buen
# pick?» sino «¿es jugador de NFL?». El MAE de 160 puntos en quarterback lo
# delataba: un error así es imposible en un pool real y sólo se explica porque
# la mitad de la muestra hizo cero.
#
# Y hay un motivo más fuerte, de cara a medir disponibilidad: con un 50% de
# ceros, cualquier modelo de ausencias parece brillante prediciendo que el WR300
# no juega, que es trivial. Lo que hay que medir es si acierta las ausencias de
# TITULARES, y eso exige acotar el pool ANTES de conectarlo.
DRAFTABLE = 180

# Partidos de temporada regular. El techo de lo que alguien puede jugar.
SEASON_LENGTH = 17.0


def _metrics(predicted: np.ndarray, observed: np.ndarray) -> dict:
    """Correlaciones y error, con los empates dichos en vez de escondidos.

    Con los ausentes puntuados a 0 aparecen muchos empates en la cola, y
    Spearman con empates masivos deja de significar lo que uno cree: la
    proporción de ceros va al lado del número, siempre.
    """
    zeros = float(np.mean(observed == 0.0))
    out = {
        "n": int(predicted.size),
        "zero_share": zeros,
        "mae": float(np.mean(np.abs(predicted - observed))),
        # ERROR MEDIO CON SIGNO, al lado del absoluto. El MAE dice cuánto nos
        # equivocamos; el bias dice hacia dónde. Si `PROJECTED_GAMES = 15.5`
        # está por encima de los partidos que se juegan de verdad, todas las
        # proyecciones están infladas a la vez y esto sale positivo y constante
        # — que es una firma distinta de la del ruido, y se lee de un vistazo.
        "bias": float(np.mean(predicted - observed)),
    }
    # Con varianza nula la correlación no está definida: se dice NaN, no 0.
    if predicted.size >= 3 and np.std(predicted) > 0 and np.std(observed) > 0:
        out["pearson"] = float(pearsonr(predicted, observed)[0])
        out["spearman"] = float(spearmanr(predicted, observed)[0])
    else:
        out["pearson"] = float("nan")
        out["spearman"] = float("nan")
    return out


def starters_by_position(roster_positions, teams: int) -> dict[str, int]:
    """Titulares que la liga consume en cada posición, desde la ESTRUCTURA.

    `K_P = equipos x slots dedicados a P`. Sólo los dedicados: repartir el flex
    exige puntos y eso volvería el corte circular —el valor dependería de un
    corte que depende del valor—. Es una cota inferior del pool consumido en esa
    posición, fijada antes de mirar ningún resultado.
    """
    dedicated = dict.fromkeys(FANTASY_POSITIONS, 0)
    for raw in roster_positions:
        slot = str(raw).upper().strip()
        if slot in BENCH_SLOTS or slot in ("K", "DEF", "DST"):
            continue
        if slot in FLEX_SLOTS or slot in SUPERFLEX_SLOTS:
            continue
        if slot in dedicated:
            dedicated[slot] += 1
    return {position: teams * count for position, count in dedicated.items()}


def value_captured(order: pd.Series, actual_points: pd.Series, k: int) -> float:
    """Qué fracción del VOR REAL disponible captura este orden.

    ## Por qué esta métrica y no una correlación

    El board es una herramienta de ORDENAR, pero Spearman trata igual confundir
    al RB3 con el RB5 que al RB40 con el RB42, y en un draft lo primero cuesta y
    lo segundo no. Peor: es ciego a lo único que decide un pick, que es a QUIÉN
    te llevas — dos boards con el mismo Spearman pueden dejarte plantillas
    distintas.

    Aquí el peso es el valor mismo, sin coeficientes inventados: fallar a un
    élite cuesta mucho porque su VOR real es alto; permutar dos medianos no
    cuesta casi nada porque el suyo es casi igual.

    El reemplazo sale del MISMO `k` estructural aplicado a la temporada
    realizada, así que numerador y denominador comparten criterio por
    construcción. Se acota en 0: quien queda por debajo del reemplazo no aporta
    valor capturable — eso es lo que significa el reemplazo.

    Es INVARIANTE al nivel: sumar o multiplicar todas las proyecciones no la
    mueve ni en 1e-12. Cualquier delta es reordenamiento.
    """
    if len(actual_points) < k + 2:
        return float("nan")
    replacement = float(actual_points.nlargest(k + 1).iloc[-1])
    vor = (actual_points - replacement).clip(lower=0.0)
    best = float(vor.nlargest(k).sum())
    if best <= 0:
        return float("nan")
    return float(vor.loc[order.nlargest(k).index].sum() / best)


def expected_games_for(
    season_av: pd.DataFrame, positions: pd.Series, season: int, pool: set[str] | None = None
) -> pd.Series:
    """Partidos esperados por jugador: 17 x (1 - tasa de ausencia).

    ## Cómo está calibrado lo que hay debajo, y por qué importa la población

    `availability.history` devuelve una TASA de partidos perdidos —no partidos
    esperados—, ponderada 56/30/14 y encogida hacia la media de su posición. La
    conversión es directa; lo que no es directo es sobre QUIÉN se calcula esa
    media.

    Sobre el universo entero de jugadores, la tasa mediana de ausencia es del
    49%: la mitad de las filas son suplentes profundos y subidas de un partido,
    y su «ausencia» no es fragilidad, es no ser titular. Con ese prior el
    encogimiento aplasta a todo el mundo y **el jugador más durable no pasa de
    14,09 partidos** — por debajo incluso de la constante que veníamos usando.
    Es el mismo error que ya documentó este módulo: un Spearman de +0,48 sobre
    todos los jugadores medía el puesto en la plantilla, no la propensión a
    lesionarse.

    Restringiendo la población a los drafteables, la mediana cae al 12-14% y el
    techo sube a 16,2-16,25, con 11-14 jugadores por encima de 16. Eso ya es una
    escala de disponibilidad y no un ranking de titularidad.
    """
    source = season_av if pool is None else season_av[season_av["player_id"].isin(pool)]
    rates = avail.history(source, positions, season)
    if rates.empty:
        return pd.Series(dtype=float)
    return pd.Series(
        (SEASON_LENGTH * (1.0 - rates["missed_rate"])).to_numpy(),
        index=rates["player_id"].to_numpy(),
    )


def _last_season_points(actual: pd.Series, season: int, index: pd.Index) -> np.ndarray:
    """La baseline honesta: lo que hizo cada jugador la temporada ANTERIOR.

    Es el único comparador que sobrevivió al descarte del ADP, y es el listón
    que de verdad importa: si el motor no le gana a ordenar por los puntos del
    año pasado, no está aportando nada por encima de mirar la tabla final.

    Quien no jugó la temporada anterior vale 0, igual que en el lado del
    resultado. No es un valor por defecto: es el dato — no anotó.
    """
    try:
        previous = actual.xs(season - 1, level="season")
    except KeyError:
        return np.zeros(len(index), dtype=float)
    return previous.reindex(index).fillna(0.0).to_numpy(dtype=float)


def validate(
    players: pd.DataFrame, rules, settings: LeagueSettings,
    team_games: pd.DataFrame | None = None,
) -> dict:
    """Proyección de pretemporada frente al resultado real, temporada a temporada.

    Cada temporada se proyecta usando **sólo** lo anterior. Es la misma regla
    walk-forward del modelo de partidos, y por el mismo motivo: proyectar 2023
    con datos de 2023 da correlaciones preciosas y completamente falsas.

    ## El sesgo de supervivencia que esto quita

    La versión anterior cruzaba `projected ∩ actual` y medía sólo sobre los
    jugadores que **sí** aparecieron esa temporada. O sea que el que se perdió el
    año entero desaparecía de la muestra en vez de contar como lo que fue: un
    pick quemado. Eso infla todas las cifras y, peor, deja el instrumento CIEGO
    justo al problema que más distorsiona el board — proyectar a todo el mundo
    con 15,5 partidos. Un arreglo de disponibilidad no podía verse porque el
    coste de la lesión estaba borrado del conjunto de evaluación.

    Ahora un jugador proyectado que no jugó puntúa **0 real**, que es lo que se
    come el drafteador.

    Devuelve tres vistas, porque una sola no contesta lo que importa: por
    posición, por banda de rank proyectado, y el acierto del top-24.
    """
    scored = players.copy()
    scored["fantasy_points"] = score_player_weeks(scored, rules)
    actual = scored.groupby(["player_id", "season"], observed=True)["fantasy_points"].sum()
    posiciones = players.drop_duplicates("player_id").set_index("player_id")["position"]
    season_av = (
        avail.season_availability(players, team_games) if team_games is not None else None
    )

    starters = starters_by_position(DEFAULT_ROSTER, settings.teams)
    capturado: list[dict] = []
    por_posicion: list[dict] = []
    por_banda: list[dict] = []
    aciertos: list[dict] = []
    available = sorted(players["season"].unique())
    for season in VALIDATION_SEASONS:
        if season not in available:
            continue
        try:
            projected = project_season(players, season, rules)
        except ValueError:
            continue

        # El MISMO board con el ancla del encogimiento por tamaño de muestra.
        # Preregistro en `docs/PREREGISTRO_ancla.md`: se mide, no se activa.
        con_ancla = project_season(players, season, rules, anchor="sample")

        # El MISMO board con partidos esperados por jugador, para poder dar el
        # antes/después sobre el pool congelado sin recorrer nada dos veces.
        con_disponibilidad = None
        if season_av is not None:
            previos_pool = actual.xs(season - 1, level="season", drop_level=True)
            previos_pool = previos_pool[
                previos_pool.index.map(posiciones).isin(FANTASY_POSITIONS)
            ]
            base_pool = set(previos_pool.nlargest(DRAFTABLE).index)
            juegos = expected_games_for(season_av, posiciones, season, base_pool)
            if not juegos.empty:
                con_disponibilidad = project_season(
                    players, season, rules, expected_games=juegos
                )
        # EL POOL DE EVALUACIÓN, CONGELADO. Se define UNA vez por temporada y
        # de forma independiente del modelo: los 180 primeros por puntos de la
        # temporada previa, que es el orden de la baseline.
        #
        # Sin esto, cada cambio del modelo reordena el board y por tanto cambia
        # QUIÉNES entran en la muestra, así que el delta medido mezcla «el
        # modelo ordena mejor» con «se está midiendo sobre otros jugadores».
        # Ya arruinó la lectura del commit del reemplazo, donde modelo y
        # baseline se movieron a la vez; con disponibilidad, que reordena de
        # forma agresiva, sería peor que el efecto que se quiere medir.
        previos = actual.xs(season - 1, level="season", drop_level=True)
        previos = previos[previos.index.map(posiciones).isin(FANTASY_POSITIONS)]
        congelado = list(previos.nlargest(DRAFTABLE).index)

        # Las bandas se cortan sobre el board, o sea sobre VOR — NO sobre puntos
        # brutos. Un quarterback suma del orden de 1,7 veces más que un
        # receptor, así que ordenar por puntos pone 43 quarterbacks en los 50
        # primeros: eso no es un board, es la lista de QBs, y medir ahí no dice
        # nada de las decisiones de un draft. VOR existe precisamente para que
        # las posiciones sean comparables, y es el orden que el producto enseña.
        # El MISMO reemplazo que publica el board. Antes esto llamaba a la ruta
        # por pesos, así que la línea base se midió sobre un modelo que el
        # producto ya no usaba.
        board = draft_board(
            projected, roster_context(list(DEFAULT_ROSTER), settings.teams, season=season)
        )
        projected = board.set_index("player_id")
        truth = actual.xs(season, level="season")

        # El universo es lo PROYECTADO. Quien no aparece en `truth` no se cae de
        # la muestra: vale 0. Es la línea que quita el survivorship.
        observed_all = truth.reindex(projected.index).fillna(0.0)
        if len(projected) < 30:
            continue

        orden = projected["overall_rank"]

        # La muestra es el pool CONGELADO, intersecado con lo proyectable.
        pool = projected.index.intersection(pd.Index(congelado))
        if len(pool) < 60:
            continue
        sub = projected.loc[pool]
        obs_pool = observed_all.loc[pool]
        base_puntos = _last_season_points(actual, season, pool)

        # Los dos predictores, uno al lado del otro. La baseline no es un
        # adorno: sin ella, «Spearman .35» no dice si le ganamos a mirar la
        # tabla del año pasado, que es lo único que hay que batir para aportar.
        modelos = {
            "model": sub["projected_points"].to_numpy(dtype=float),
            "last_season": base_puntos,
        }
        if con_disponibilidad is not None:
            con = con_disponibilidad.set_index("player_id")["projected_points"]
            modelos["model_availability"] = con.reindex(pool).to_numpy(dtype=float)
        ancla = con_ancla.set_index("player_id")["projected_points"]
        modelos["model_anchor"] = ancla.reindex(pool).to_numpy(dtype=float)

        for position in FANTASY_POSITIONS:
            mask = (sub["position"] == position).to_numpy()
            if int(mask.sum()) < 10:
                continue
            obs = obs_pool.to_numpy(dtype=float)[mask]
            for nombre, pred_all in modelos.items():
                por_posicion.append({
                    "season": season, "position": position, "predictor": nombre,
                    **_metrics(pred_all[mask], obs),
                })
                # Hit rate del top-24 de la posición: de los que ese predictor
                # puso arriba, cuántos terminaron arriba. Es inmune a los
                # empates en cero, que es justo lo que Spearman no es aquí.
                ids = sub.index[mask]
                k = min(TOP_N, int(mask.sum()))
                top_pred = set(pd.Series(pred_all[mask], index=ids).nlargest(k).index)
                top_obs = set(pd.Series(obs, index=ids).nlargest(k).index)
                aciertos.append({
                    "season": season, "position": position, "predictor": nombre,
                    "k": k, "hit_rate": len(top_pred & top_obs) / k,
                })
                # VALOR CAPTURADO: la métrica primaria. `k_pos` sale de la
                # estructura de la liga, no del pool medido.
                k_pos = starters.get(position, 0)
                if k_pos:
                    capturado.append({
                        "season": season, "position": position, "predictor": nombre,
                        "k": k_pos,
                        "value_captured": value_captured(
                            pd.Series(pred_all[mask], index=ids),
                            pd.Series(obs, index=ids), k_pos,
                        ),
                    })

        for label, lo, hi in RANK_BANDS:
            banda = ((orden.loc[pool] >= lo) & (orden.loc[pool] <= hi)).to_numpy()
            if int(banda.sum()) < 10:
                continue
            obs = obs_pool.to_numpy(dtype=float)[banda]
            for nombre, pred_all in modelos.items():
                por_banda.append({
                    "season": season, "band": label, "predictor": nombre,
                    **_metrics(pred_all[banda], obs),
                })

    def _resumen(rows: list[dict], key: str) -> pd.DataFrame:
        frame = pd.DataFrame(rows)
        if frame.empty:
            return frame
        return frame.groupby([key, "predictor"], as_index=False).agg(
            seasons=("season", "nunique"),
            n=("n", "mean"),
            zero_share=("zero_share", "mean"),
            pearson=("pearson", "mean"),
            spearman=("spearman", "mean"),
            mae=("mae", "mean"),
            bias=("bias", "mean"),
        )

    hits = pd.DataFrame(aciertos)
    caps = pd.DataFrame(capturado)
    value = (
        caps.groupby(["position", "predictor"], as_index=False).agg(
            seasons=("season", "nunique"), k=("k", "max"),
            value_captured=("value_captured", "mean"))
        if not caps.empty else caps
    )
    if not value.empty:
        # UN número global, y el que reproduce el arnés: la media por posición
        # ponderada por `k` (los titulares que la liga alinea de cada una).
        # Hasta hoy el arnés no publicaba ninguno, y circulaba un «82,6%» que
        # no salía de ningún sitio. Un número que el propio arnés no reproduce
        # no es una métrica: es un recuerdo.
        total = value.groupby("predictor", as_index=False).apply(
            lambda g: pd.Series({
                "position": "ALL", "seasons": int(g["seasons"].max()), "k": int(g["k"].sum()),
                "value_captured": float(np.average(g["value_captured"], weights=g["k"])),
            }), include_groups=False,
        ).reset_index(drop=True)
        value = pd.concat([value, total[value.columns]], ignore_index=True)
    return {
        "value_captured": value,
        # La tabla SIN agregar. La media de cuatro temporadas esconde si la
        # ventaja es de dos buenas y dos flojas, y la regla de aceptación del
        # proyecto es por temporada: sin esto no se puede aplicar a la
        # comparación principal, que es justo donde nunca se aplicó.
        "value_captured_by_season": caps,
        "by_position": _resumen(por_posicion, "position"),
        "by_band": _resumen(por_banda, "band"),
        "top_n": (
            hits.groupby(["position", "predictor"], as_index=False).agg(
                seasons=("season", "nunique"), k=("k", "max"), hit_rate=("hit_rate", "mean"))
            if not hits.empty else hits
        ),
        # Temporada a temporada, sin promediar: la regla de aceptación exige que
        # un cambio ayude en TODAS, y una media esconde justo eso.
        "by_season": pd.DataFrame(por_posicion),
        "seasons": sorted({r["season"] for r in por_posicion}),
        "draftable": DRAFTABLE,
    }


if __name__ == "__main__":
    raise SystemExit(main())
