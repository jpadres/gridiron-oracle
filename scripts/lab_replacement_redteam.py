"""FASES 18-19 — red team del nivel de reemplazo y del reparto del flex.

No busca que los números salgan bonitos: busca que NINGUNA entrada produzca un
ancla indefinida convertida en número, un hueco sin asignar o un reparto que
ignore el pool que tiene delante.
"""

from __future__ import annotations

import math
import sys

from oracle.fantasy.league import (
    UnsupportedRoster,
    greedy_replacement,
    roster_context,
)

BENCH = ["BN"] * 4
fallos = 0


def check(nombre: str, ok: bool, detalle: str = "") -> None:
    global fallos
    if not ok:
        fallos += 1
    print(f"  {'ok   ' if ok else 'FALLA'} {nombre}" + (f" — {detalle}" if detalle else ""))


def pool(**kw):
    base = {"QB": 60, "RB": 90, "WR": 110, "TE": 50}
    base.update(kw)
    escala = {"QB": (310.0, 3.0), "RB": (250.0, 2.0), "WR": (245.0, 1.6), "TE": (200.0, 2.4)}
    return {p: [escala[p][0] - i * escala[p][1] for i in range(n)] for p, n in base.items()}


R = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX"]

print("=== FASE 18 — reemplazo adversario ===")

# 1. Pool MÁS CORTO que los titulares que la liga exige.
ctx = roster_context(R + BENCH, 12)
rep, rank, used = greedy_replacement(pool(QB=3, RB=5, WR=5, TE=2), ctx)
check("pool más corto que la demanda: no revienta", True, f"consumidos {used}/{ctx.starter_slots}")
check("y ningún reemplazo sale NaN o infinito",
      all(math.isfinite(v) for v in rep.values()), str(rep))
check("y ningún reemplazo sale cero por agotamiento",
      all(v > 0 for v in rep.values()), str(rep))

# 2. Pool EXACTAMENTE igual a los titulares.
ctx12 = roster_context(["QB", "RB", "WR", "TE"] + BENCH, 12)
rep2, rank2, used2 = greedy_replacement(pool(QB=12, RB=12, WR=12, TE=12), ctx12)
check("pool exacto: el reemplazo es el último, no cero",
      all(v > 0 for v in rep2.values()) and used2 == ctx12.starter_slots,
      f"rank {rank2} consumidos {used2}")

# 3. Un jugador de más: el reemplazo es ese, y sólo ese.
rep3, rank3, _ = greedy_replacement(pool(QB=13, RB=13, WR=13, TE=13), ctx12)
check("un jugador de más: el reemplazo es el 13", all(v == 13 for v in rank3.values()), str(rank3))

# 4. Pool enorme: el rank no se dispara ni se queda corto.
rep4, rank4, used4 = greedy_replacement(pool(QB=400, RB=400, WR=400, TE=400), ctx12)
check("pool enorme: el reparto sigue cuadrando", used4 == ctx12.starter_slots, str(used4))

# 5. Posición ENTERAMENTE ausente del pool.
rep5, rank5, _ = greedy_replacement({"QB": pool()["QB"], "RB": pool()["RB"]}, ctx)
check("posición ausente NO aparece con reemplazo inventado",
      "WR" not in rep5 and "TE" not in rep5, str(sorted(rep5)))

# 6. Pool vacío del todo.
rep6, rank6, used6 = greedy_replacement({"QB": [], "RB": [], "WR": [], "TE": []}, ctx)
check("pool vacío: sin reemplazos y sin excepción", rep6 == {} and used6 == 0, f"{rep6} {used6}")

# 7. Cero titulares en una posición: no se le asigna nada dedicado.
sin_te = roster_context(["QB", "RB", "RB", "WR", "WR", "WR", "FLEX"] + BENCH, 12)
check("cero titulares dedicados sigue en cero", sin_te.dedicated["TE"] == 0, str(sin_te.dedicated))

# 8. Valores degenerados en el pool (todos iguales).
rep8, rank8, used8 = greedy_replacement(
    {"QB": [100.0] * 40, "RB": [100.0] * 40, "WR": [100.0] * 40, "TE": [100.0] * 40}, ctx)
check("pool completamente plano: el reparto sigue cuadrando", used8 == ctx.starter_slots, str(used8))
check("y es determinista", greedy_replacement(
    {"QB": [100.0] * 40, "RB": [100.0] * 40, "WR": [100.0] * 40, "TE": [100.0] * 40}, ctx)[1] == rank8)

print("\n=== FASE 19 — red team del reparto del flex ===")

TRES_FLEX = ["QB", "RB", "WR", "TE", "FLEX", "FLEX", "FLEX"]
ctxf = roster_context(TRES_FLEX + BENCH, 12)

# 9. Cada posición domina el flex por turnos: el reparto tiene que SEGUIRLO.
resultados = {}
for dominante in ("RB", "WR", "TE"):
    p = pool()
    p[dominante] = [v + 120.0 for v in p[dominante]]
    _, rank, used = greedy_replacement(p, ctxf)
    resultados[dominante] = rank
    check(f"con {dominante} dominante el reparto cuadra", used == ctxf.starter_slots, str(used))

check("el reparto CAMBIA según quién domina el flex",
      len({tuple(sorted(r.items())) for r in resultados.values()}) == 3,
      " | ".join(f"{k}:{v}" for k, v in resultados.items()))

# 10. Todos los elegibles de flex vienen de UNA posición.
# Con WR y TE inexistentes, sus 24 huecos DEDICADOS no se pueden llenar: no hay
# jugadores. Consumir menos que los huecos declarados es lo correcto, y exigir
# la igualdad era el test equivocado — pedía que un hueco se llenara con nadie.
# Lo que sí hay que exigir: los 36 flex van ENTEROS al corredor, que es el único
# elegible, y el reemplazo se mueve en consecuencia.
solo_rb = {"QB": pool()["QB"], "RB": pool()["RB"], "WR": [], "TE": []}
_, rank10, used10 = greedy_replacement(solo_rb, ctxf)
dedicados_llenables = 12 * 2          # sólo QB y RB tienen pool
flex_totales = ctxf.flex * ctxf.teams
check("con sólo corredores elegibles, el flex va ENTERO al corredor",
      rank10["RB"] == 12 + flex_totales + 1,
      f"rank RB {rank10['RB']}, esperado {12 + flex_totales + 1}")
check("y se consume lo llenable, ni un hueco más",
      used10 == dedicados_llenables + flex_totales,
      f"consumidos {used10}, llenables {dedicados_llenables + flex_totales} de {ctxf.starter_slots}")
check("los huecos de una posición inexistente quedan VACÍOS, no rellenados",
      used10 < ctxf.starter_slots and "WR" not in rank10,
      f"{used10}/{ctxf.starter_slots}, posiciones con rank {sorted(rank10)}")

# 11. El flex se agota a mitad.
_, _, used11 = greedy_replacement(pool(RB=8, WR=8, TE=4), ctxf)
check("pool insuficiente: consume lo que hay y no más",
      used11 <= ctxf.starter_slots, str(used11))

# 12. TODO hueco compartido queda contabilizado, en 30 configuraciones.
descuadres = []
for teams in (8, 10, 12, 14, 32):
    for flex in range(0, 4):
        for sf in range(0, 2):
            r = ["QB", "RB", "RB", "WR", "WR", "TE"] + ["FLEX"] * flex + ["SUPER_FLEX"] * sf
            c = roster_context(r + BENCH, teams)
            _, _, u = greedy_replacement(pool(QB=200, RB=300, WR=400, TE=200), c)
            if u != c.starter_slots:
                descuadres.append(f"{teams}eq flex{flex} sf{sf}: {u}/{c.starter_slots}")
check("40 configuraciones: cada hueco compartido asignado exactamente",
      not descuadres, "; ".join(descuadres[:3]))

# 13. Plantilla imposible: sólo banquillo.
try:
    roster_context(BENCH, 12)
    check("plantilla sólo de banquillo levanta", False, "no levantó")
except UnsupportedRoster:
    check("plantilla sólo de banquillo levanta", True)

# 14. Equipos absurdos.
for teams in (0, 1, -5, None, "doce", 2.5):
    try:
        roster_context(R + BENCH, teams)
        check(f"teams={teams!r} levanta", False, "no levantó")
    except (UnsupportedRoster, TypeError):
        check(f"teams={teams!r} levanta", True)

print(f"\n{'SIN FALLOS' if fallos == 0 else str(fallos) + ' FALLOS'}")
sys.exit(1 if fallos else 0)
