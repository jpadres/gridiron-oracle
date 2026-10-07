"""DOS HECHOS QUE EL PRODUCTO NO PUEDE INVENTAR.

1. Quien no puede jugar NO recibe una proyección completa. D.Achane salía RB24
   con 10,9 puntos estando en lista de reserva, y Josh Jacobs el 38 del board
   apartado por el comisionado: un número plausible al lado de un jugador que
   no va a jugar es peor que no tener número, porque desinfla una alineación
   mientras la presenta completa.

2. El QB titular de cada equipo se VERIFICA, no se adivina. El modelo de rol
   contesta otra pregunta —quién acumuló volumen— y de ahí salían Mayfield en
   Dallas y Caleb Williams en Chicago. Ahora hay dos testigos y, cuando
   discrepan, se publica la DISPUTA: un desempate inventado sería peor que el
   desacuerdo.
"""

from __future__ import annotations

from pathlib import Path

import payload_source
import pytest

from oracle.fantasy.dst import (
    QB_BASIS_DEPTH_CHART,
    QB_BASIS_DISPUTED,
    QB_BASIS_LAST_PLAYED,
    starting_qb_of_record,
)


@pytest.fixture(scope="module")
def payload():
    """Del crudo si está, del comprimido si no: `model.json` está en .gitignore
    y en CI no existe, así que leerlo a secas dejaba estos tests dormidos justo
    donde tenían que correr. Ver `tests/payload_source.py`."""
    datos = payload_source.load()
    if datos is None:
        pytest.skip("sin payload publicado (ni model.json ni model.b64.js)")
    return datos


# --- 1. la proyección retenida ---------------------------------------------

def test_quien_no_puede_jugar_no_lleva_proyeccion(payload):
    filas = payload["fantasy_weekly"]["rankings"]
    retenidas = [r for r in filas if r.get("unavailable")]
    assert retenidas, (
        "ninguna fila lleva la proyección retenida: o la capa de disponibilidad "
        "no llega al payload, o este test comprueba en vacío"
    )
    for row in retenidas:
        assert row["projected_points"] is None, (
            f"{row['player_name']}: se le retuvo y sigue publicando puntos"
        )
        # `None` y NO cero: un cero se lee como «juega y no suma».
        assert row["projected_points"] != 0


def test_el_numero_no_se_borra_sino_que_se_aparta(payload):
    # La transparencia del proyecto: lo que habría proyectado sigue publicado,
    # con otro nombre. Borrarlo dejaría a la pantalla sin poder explicar nada.
    for row in payload["fantasy_weekly"]["rankings"]:
        if row.get("unavailable"):
            assert isinstance(row["projected_points_if_available"], (int, float))


def test_cada_retencion_dice_en_QUÉ_se_apoya_y_de_cuándo_es(payload):
    for row in payload["fantasy_weekly"]["rankings"]:
        fuera = row.get("unavailable")
        if not fuera:
            continue
        assert fuera["basis"], f"{row['player_name']}: retenido sin decir por qué fuente"
        assert fuera["reason"]
        assert fuera["as_of"], (
            f"{row['player_name']}: una afirmación de disponibilidad sin fecha no se "
            f"puede clasificar (regla 5)"
        )


def test_el_desacuerdo_entre_fuentes_se_conserva(payload):
    # «El equipo lo da dudoso» y «el registro lo pone en reserva» no son la
    # misma clase de evidencia, y quedarse con una sola borra lo que decide una
    # alineación.
    for row in payload["fantasy_weekly"]["rankings"]:
        fuera = row.get("unavailable")
        if not fuera:
            continue
        assert isinstance(fuera["all_reasons"], list) and fuera["all_reasons"]
        assert fuera["basis"] == fuera["all_reasons"][0]["basis"]


def test_el_retenido_no_ocupa_un_puesto_entre_los_alineables(payload):
    # Que Achane saliera RB24 empujaba al RB25 real fuera de la ventana que se
    # mira. El puesto es de los que pueden jugar.
    filas = payload["fantasy_weekly"]["rankings"]
    for row in filas:
        if row.get("unavailable"):
            assert row["position_rank"] is None, (
                f"{row['player_name']}: retenido y con puesto {row['position_rank']}"
            )
    por_pos: dict[str, list[int]] = {}
    for row in filas:
        if row.get("unavailable"):
            continue
        por_pos.setdefault(row["position"], []).append(row["position_rank"])
    for pos, puestos in por_pos.items():
        assert sorted(puestos) == list(range(1, len(puestos) + 1)), (
            f"{pos}: los puestos de los alineables tienen huecos"
        )


def test_la_retencion_sale_de_fuentes_OFICIALES_y_no_de_la_prensa(payload):
    """Regla 8: la prensa MARCA, no calcula.

    `status_severity` es el dossier curado, y dejar que RETENGA un número
    sería prensa tocando un número del board — lo que invalidaría la
    demostración anti-fuga de la que dependen todas las métricas.
    """
    fuente = (Path(__file__).resolve().parent.parent
              / "scripts" / "export_web_data.py").read_text(encoding="utf-8")
    cuerpo = fuente.split("def _withhold_unavailable(", 1)[1].split("\ndef ", 1)[0]
    # Sin DOCSTRING ni comentarios: el propio bloque EXPLICA que la prensa no
    # decide, y esa prosa casa con el patrón igual que el código casaría — ya
    # costó una versión en `Briefs.jsx` y otra en `reloj.mjs`.
    trozos = cuerpo.split('"""')
    if len(trozos) >= 3:
        # [firma, docstring, código]: el docstring se cae, la firma se queda.
        cuerpo = trozos[0] + "".join(trozos[2:])
    cuerpo = "\n".join(
        linea.split("#")[0] for linea in cuerpo.splitlines()
        if not linea.lstrip().startswith("#")
    )
    assert "status_severity" not in cuerpo, (
        "la capa de prensa ha vuelto a decidir si alguien recibe proyección"
    )
    assert "injury_designation" in cuerpo and "roster_state" in cuerpo


# --- 2. el QB titular, verificado ------------------------------------------

def test_el_club_y_quien_jugo_de_acuerdo_dan_DEPTH_CHART():
    r = starting_qb_of_record(
        "KC",
        depth={"KC": {"player_name": "P.Mahomes", "effective_at": "2026-10-06"}},
        last_played={"KC": {"player_name": "Patrick Mahomes", "week": 4}},
    )
    assert r["basis"] == QB_BASIS_DEPTH_CHART
    assert r["name"] == "P.Mahomes"


def test_cuando_discrepan_se_publica_la_DISPUTA_y_no_un_desempate():
    r = starting_qb_of_record(
        "DAL",
        depth={"DAL": {"player_name": "Baker Mayfield", "effective_at": "2026-10-06"}},
        last_played={"DAL": {"player_name": "Jalon Daniels", "week": 4}},
    )
    assert r["basis"] == QB_BASIS_DISPUTED
    # Las DOS, para que quien decide una alineación vea el desacuerdo.
    assert r["declared"] == "Baker Mayfield"
    assert r["last_played"] == "Jalon Daniels"
    assert "Jalon Daniels" in r["note"] and "Baker Mayfield" in r["note"]


def test_sin_depth_chart_se_dice_que_el_testigo_es_quien_JUGO():
    r = starting_qb_of_record(
        "NYJ", depth={}, last_played={"NYJ": {"player_name": "J.Fields", "week": 4}}
    )
    assert r["basis"] == QB_BASIS_LAST_PLAYED
    assert r["name"] == "J.Fields"


def test_sin_ningun_testigo_no_se_adivina():
    r = starting_qb_of_record("NYJ", depth={}, last_played={})
    assert r["name"] is None
    assert r["basis"] not in {QB_BASIS_DEPTH_CHART, QB_BASIS_LAST_PLAYED, QB_BASIS_DISPUTED}


def test_un_sufijo_no_es_un_apellido_distinto():
    """«Michael Penix Jr.» y «Michael Penix» son el mismo jugador.

    La primera versión los daba en disputa: tres falsos positivos en treinta,
    y una disputa falsa gasta la atención que la verdadera necesita.
    """
    r = starting_qb_of_record(
        "ATL",
        depth={"ATL": {"player_name": "Michael Penix Jr.", "effective_at": "2026-10-06"}},
        last_played={"ATL": {"player_name": "Michael Penix", "week": 4}},
    )
    assert r["basis"] == QB_BASIS_DEPTH_CHART, r


def test_el_payload_NO_adivina_ni_un_QB_rival(payload):
    filas = payload["fantasy_weekly"]["defenses"]
    assert filas, "sin defensas no hay nada que comprobar"
    bases = {r.get("opposing_qb_basis") for r in filas}
    assert "MODEL_PROJECTED_STARTER" not in bases, (
        "el contexto DST ha vuelto a tomar el titular del modelo de ROL, que "
        "contesta otra pregunta: de ahí salían Mayfield en DAL y Caleb Williams en CHI"
    )
    assert bases <= {QB_BASIS_DEPTH_CHART, QB_BASIS_LAST_PLAYED, QB_BASIS_DISPUTED,
                     "UNKNOWN", None}, bases


def test_toda_disputa_del_payload_publica_LAS_DOS(payload):
    disputas = [r for r in payload["fantasy_weekly"]["defenses"]
                if r.get("opposing_qb_basis") == QB_BASIS_DISPUTED]
    assert disputas, "sin una sola disputa, la mitad que importa se comprueba en vacío"
    for row in disputas:
        assert row["opposing_qb_declared"], f"{row.get('team')}: disputa sin el del club"
        assert row["opposing_qb_last_played"], f"{row.get('team')}: disputa sin el que jugó"
        assert row["opposing_qb_declared"] != row["opposing_qb_last_played"]
        assert row["opposing_qb_note"]


def test_los_dos_testigos_se_construyen_UNA_vez(payload):
    """`dst.witnesses` y no dos lecturas del mismo fichero.

    Lo cometí arreglando esto mismo: el artefacto del barrido publicaba
    `DEPTH_CHART_OF_RECORD` y el payload seguía en `MODEL_PROJECTED_STARTER`,
    porque el exportador calculaba el contexto DST por su cuenta.
    """
    raiz = Path(__file__).resolve().parent.parent
    for ruta in ("scripts/export_web_data.py", "scripts/weekly_research.py"):
        fuente = (raiz / ruta).read_text(encoding="utf-8")
        assert "witnesses(" in fuente, (
            f"{ruta} no usa el constructor compartido de los dos testigos"
        )


# --- la RETENCIÓN como código, no sólo como artefacto ----------------------
#
# Los tests de arriba leen el payload EXPORTADO: valen como contrato del
# artefacto —cazan un payload malo recién commiteado— y NO cazan un cambio de
# código hasta que alguien reexporta. Se vio inyectando: quitar la retención
# dejó los catorce en verde porque el fichero en disco seguía siendo el bueno.
# Es «un guardián sobre una función que ninguna pantalla llama» del revés: un
# guardián sobre un artefacto que ningún cambio de código toca.

def _exportador():
    """`_withhold_unavailable` cargada por RUTA.

    Por `importlib` y no con `from scripts import ...`: `python -m pytest` mete
    el directorio actual en `sys.path` y el ejecutable de consola NO, así que un
    import por paquete pasa en local y ni se recolecta en CI. Ya costó dos
    commits con CI en rojo dados por buenos.
    """
    import importlib.util

    ruta = Path(__file__).resolve().parent.parent / "scripts" / "export_web_data.py"
    spec = importlib.util.spec_from_file_location("_exp_withhold", ruta)
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo._withhold_unavailable


def _payload_sintetico():
    return {"fantasy_weekly": {"rankings": [
        {"player_name": "A.Jugable", "position": "RB", "projected_points": 14.0,
         "position_rank": 1, "injury_designation": None, "roster_state": "ACTIVE",
         "rostered": True},
        {"player_name": "B.EnReserva", "position": "RB", "projected_points": 11.0,
         "position_rank": 2, "injury_designation": None, "roster_state": "RESERVE",
         "roster_label": "RESERVE LIST", "roster_source_as_of": "2026-10-06",
         "rostered": True},
        {"player_name": "C.Jugable", "position": "RB", "projected_points": 9.0,
         "position_rank": 3, "injury_designation": None, "roster_state": "ACTIVE",
         "rostered": True},
        {"player_name": "D.Fuera", "position": "RB", "projected_points": 8.0,
         "position_rank": 4, "injury_designation": "OUT",
         "injury_source_as_of": "2026-10-06", "roster_state": "ACTIVE", "rostered": True},
    ]}}


def test_la_funcion_RETIENE_el_numero_de_quien_no_puede_jugar():
    payload = _payload_sintetico()
    _exportador()(payload)
    filas = {r["player_name"]: r for r in payload["fantasy_weekly"]["rankings"]}
    for nombre in ("B.EnReserva", "D.Fuera"):
        assert filas[nombre]["projected_points"] is None, f"{nombre} sigue con número"
        assert filas[nombre]["projected_points_if_available"] is not None
        assert filas[nombre]["unavailable"]["as_of"] == "2026-10-06"
    for nombre in ("A.Jugable", "C.Jugable"):
        assert filas[nombre]["projected_points"] is not None
        assert filas[nombre].get("unavailable") is None


def test_el_numero_retenido_no_es_CERO():
    """Un cero se lee como «juega y no suma».

    `Number(null)` vale cero en el navegador, así que un cero aquí habría
    contado como un titular conocido con cero puntos — desinflando la alineación
    mientras la presenta completa. Es la cuarta forma del mismo fallo.
    """
    payload = _payload_sintetico()
    _exportador()(payload)
    for row in payload["fantasy_weekly"]["rankings"]:
        if row.get("unavailable"):
            assert row["projected_points"] is None
            assert row["projected_points"] != 0


def test_los_puestos_se_rehacen_entre_los_que_PUEDEN_jugar():
    # Que el retenido se quedara en el puesto 2 empujaba al RB3 real fuera de la
    # ventana que se mira.
    payload = _payload_sintetico()
    _exportador()(payload)
    filas = {r["player_name"]: r for r in payload["fantasy_weekly"]["rankings"]}
    assert filas["A.Jugable"]["position_rank"] == 1
    assert filas["C.Jugable"]["position_rank"] == 2, "el RB3 real no subió a su puesto"
    assert filas["B.EnReserva"]["position_rank"] is None


def test_el_exportador_lee_el_campo_que_la_capa_de_lesiones_ESCRIBE():
    """Un fixture mío decía `injury_report_as_of` y el campo es `injury_source_as_of`.

    El fallo era del doble, no del producto — pero la forma es la del survivor
    leyendo `week` sobre una sección que publica `from_week`: una clave que
    nadie escribe deja la pregunta sin contestar con cara de contestada. Se
    comprueba contra quien la escribe.
    """
    raiz = Path(__file__).resolve().parent.parent
    escribe = (raiz / "src/oracle/fantasy/injuries.py").read_text(encoding="utf-8")
    lee = (raiz / "scripts/export_web_data.py").read_text(encoding="utf-8")
    cuerpo = lee.split("def _withhold_unavailable(", 1)[1].split("\ndef ", 1)[0]
    for campo in ("injury_designation", "injury_source_as_of"):
        assert f'row["{campo}"] =' in escribe, f"nadie escribe {campo}"
        assert campo in cuerpo, f"la retención no lee {campo}"
