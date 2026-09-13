#!/usr/bin/env python3
"""Barrido diario de prensa. Escribe `research/YYYY-MM-DD.json` y `out/research.json`.

    research/2026-08-17.json   archivo del día, SE VERSIONA (unos KB de texto)
    out/research.json          ventana de los últimos días, la lee export_web_data.py

Lo que hace, en orden: lee los titulares que ya se publicaron los días
anteriores, barre catorce beats (ocho divisiones y seis temas transversales)
buscando en internet, quita repetidos, cuelga cada ficha de los jugadores del
ranking semanal que le correspondan, y guarda.

**Esto no toca el modelo.** Ninguna de estas noticias entra en un cálculo; se
publican al lado de los rankings, con su fuente y su fecha, para que el ajuste lo
haga el ojo humano. La garantía anti-fuga del modelo depende de que siga siendo
así.

Sin `ANTHROPIC_API_KEY` no falla: avisa y sale con 0, y la web se construye sin la
sección igual que se construye sin los artefactos de fantasy.

    export ANTHROPIC_API_KEY=...            # en CI, un secret del repo
    python scripts/research_build.py
    python scripts/research_build.py --beats insiders,campamentos --max-searches 4
"""

from __future__ import annotations

import argparse
import base64
import gzip
import json
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from oracle.config import paths as resolve_paths
from oracle.narrative import archive, feeds, research, sweep
from oracle.narrative.client import NarrativeUnavailable, available, resolve_model

# Días de titulares que se le enseñan al modelo para que no repita. Cinco es
# suficiente: una noticia de hace una semana ya no se recicla sola.
MEMORY_DAYS = 5

# Días que viajan a la web. Diez cubre la semana entera más el arrastre, y a
# partir de ahí la página se vuelve un archivo que nadie baja.
WINDOW_DAYS = 10

# Tope de fichas en el payload. El resto sigue en `research/`, que es el archivo.
WEB_ITEMS = 60


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Barrido diario de prensa e insiders")
    parser.add_argument("--root", default=None)
    parser.add_argument("--date", default=None, help="Fecha del barrido (YYYY-MM-DD).")
    parser.add_argument("--beats", default=None, help="Lista separada por comas. Vacío = todos.")
    parser.add_argument("--max-items", type=int, default=8, help="Fichas por beat.")
    parser.add_argument("--max-searches", type=int, default=8, help="Búsquedas por beat.")
    parser.add_argument("--effort", default="medium", choices=["low", "medium", "high", "xhigh"])
    parser.add_argument("--model", default=None, help="Sobrescribe ORACLE_NARRATIVE_MODEL.")
    parser.add_argument("--window", type=int, default=WINDOW_DAYS, help="Días que van a la web.")
    parser.add_argument(
        "--require-key",
        action="store_true",
        help="Falla si no hay clave o no se puede enlazar. Para CI: allí el trabajo "
             "NO tiene otra tarea, así que no poder hacerlo es un fallo, no un aviso.",
    )
    args = parser.parse_args(argv)

    paths = resolve_paths(args.root).ensure()
    today = date.fromisoformat(args.date) if args.date else date.today()

    if not available():
        print(
            "Sin ANTHROPIC_API_KEY (o sin el SDK): no se genera research.\n"
            "  pip install -e '.[narrative]' y exporta la clave. En CI es un secret del repo.\n"
            "  La web se construye igual, sin esta sección."
        )
        # Y AUN ASÍ SE BARRE, con lo que no necesita clave. Antes esta rama
        # sólo republicaba el archivo de días anteriores, así que sin secret la
        # sección se congelaba en el último día con clave — nueve días, medido.
        # Si el barrido determinista no puede hacerse, se cae a republicar lo
        # que había, que es lo de antes.
        ok = _deterministic(paths.root, paths.out, today, args.window)
        if not ok:
            ok = _publish(paths.root, paths.out, today, args.window)
        if args.require_key:
            # En CI barrer ES la única tarea del trabajo. Salir con 0 lo pintaba
            # verde y encima commiteaba «barrido del <fecha>»: un trabajo que no
            # puede hacer lo suyo tiene que ponerse ROJO, no informar de un
            # barrido que no existió.
            # Diagnóstico con nombre, para que el rojo de CI diga QUÉ falta y no
            # «el research falló». El valor nunca se imprime: no lo hay.
            print("MISSING_SECRET: ANTHROPIC_API_KEY (se exigía con --require-key y no está en el entorno)",
                  file=sys.stderr)
            return 1
        return 0 if ok else 1

    selection = [name.strip() for name in args.beats.split(",")] if args.beats else None
    todo = research.beats(selection)
    if not todo:
        print(f"Ningún beat coincide con {args.beats!r}. Disponibles: {', '.join(research.beats())}")
        return 2

    memory = archive.known_headlines(paths.root, MEMORY_DAYS, today)
    reporters = _reporters(paths.root)
    print(f"Barrido de {today} con {resolve_model(args.model)} — {len(todo)} beats, "
          f"{len(memory)} titulares en memoria.")

    collected: list[dict] = []
    failed: list[str] = []
    for name, focus in todo.items():
        print(f"  {name}...", flush=True)
        try:
            items = research.sweep(
                name,
                focus,
                today=today.isoformat(),
                known_headlines=memory,
                reporters=reporters,
                max_items=args.max_items,
                max_searches=args.max_searches,
                effort=args.effort,
                model=args.model,
            )
        except NarrativeUnavailable as error:
            # Que un beat se caiga no puede tirar el barrido entero: los otros
            # diez ya cuestan dinero y son publicables.
            print(f"    falla: {error}")
            failed.append(name)
            continue
        print(f"    {len(items)} fichas")
        collected.extend(items)
        memory.extend(item["headline"] for item in items)

    items = research.dedupe(collected)
    print(f"{len(collected)} fichas, {len(items)} tras quitar repetidos.")

    path = archive.save_day(
        paths.root,
        today,
        items,
        meta={
            "model": resolve_model(args.model),
            "beats": list(todo),
            "failed_beats": failed,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    print(f"Escrito {path.relative_to(paths.root)}")

    _publish(paths.root, paths.out, today, args.window)
    return 0


def _reporters(root: Path) -> list[dict]:
    """El directorio del beat, si está. Orienta la búsqueda a quien está allí."""
    path = root / "research" / "dossier.json"
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8")).get("reporters", [])


def _ranking_players(root: Path, out: Path) -> list[dict]:
    """Las filas del ranking semanal, de donde se pueda.

    Dos fuentes, y la segunda es la que hacía falta: `out/` está en
    `.gitignore`, así que en CI `fantasy_weekly.json` NO EXISTE NUNCA y el
    enlazado se quedaba sin índice — cada barrido diario publicaba las fichas
    con cero `player_ids`. El payload publicado sí está versionado y lleva las
    tres columnas que el índice necesita (`player_id`, `player_name`, `team`),
    así que sirve exactamente igual.
    """
    weekly = out / "fantasy_weekly.json"
    if weekly.exists():
        rows = json.loads(weekly.read_text(encoding="utf-8")).get("rankings", [])
        if rows:
            return rows
    payload_file = root / "web" / "data" / "model.b64.js"
    if not payload_file.exists():
        return []
    try:
        match = re.search(r'MODEL_B64\s*=\s*"([^"]*)"', payload_file.read_text(encoding="utf-8"))
        if not match or not match.group(1):
            return []
        payload = json.loads(gzip.decompress(base64.b64decode(match.group(1))).decode("utf-8"))
    except Exception:
        # Un payload ilegible no puede tumbar el barrido: se devuelve vacío y
        # quien llama decide (y decide NO publicar, que es lo seguro).
        return []
    return (payload.get("fantasy_weekly") or {}).get("rankings", []) or []


def _payload(root: Path) -> dict:
    """El payload publicado, o `{}`. Versionado, así que existe también en CI."""
    payload_file = root / "web" / "data" / "model.b64.js"
    if not payload_file.exists():
        return {}
    try:
        match = re.search(r'MODEL_B64\s*=\s*"([^"]*)"', payload_file.read_text(encoding="utf-8"))
        if not match or not match.group(1):
            return {}
        return json.loads(gzip.decompress(base64.b64decode(match.group(1))).decode("utf-8"))
    except Exception:
        return {}


def _board_players(root: Path) -> list[dict]:
    """Las filas del BOARD, que son las que llevan `player_full_name`.

    No sirve el ranking semanal: sus 256 filas NO traen el nombre completo, así
    que `press.indice` sale vacío y el emparejamiento no encuentra a nadie.
    Lo comprobé pasándole el semanal y salieron CERO menciones sobre 2.113
    entradas — un cero que se lee igual que «hoy no hay noticias».
    """
    return (_payload(root).get("fantasy") or {}).get("board") or []


def _deterministic(root: Path, out: Path, today: date, window: int) -> bool:
    """El barrido SIN modelo, desde los feeds que ya se bajaron.

        UN FICHERO QUE SE REFRESCA A DIARIO Y QUE NADIE LEE NO EXISTE.

    `feed_fetch.py` publica `research/feeds_latest.json` todos los días sin
    necesitar clave, y hasta el 13 de septiembre de 2026 **ninguna pantalla lo
    leía**: la sección de Research sale del artefacto fechado, que sólo sabía
    escribir el barrido con modelo. Medido ese día: la web llevaba NUEVE días
    enseñando el barrido del 4 de septiembre con 1,8 MB de prensa de hoy en el
    repositorio, sin fallar nada y sin que ningún test lo viera.

    Lo que se publica aquí es más pobre que el barrido con modelo y lo DICE
    (`method: DETERMINISTIC_FEEDS`, y las fichas no traen los campos de
    juicio). Más pobre y de hoy es mejor que rico y de hace nueve días; lo que
    no vale es que parezca lo mismo.
    """
    feeds_file = root / "research" / "feeds_latest.json"
    if not feeds_file.exists():
        print("  sin research/feeds_latest.json: no hay nada determinista que publicar.",
              file=sys.stderr)
        return False
    datos = feeds.load_archive(feeds_file)
    entradas = datos.get("entries") or []
    board = _board_players(root)
    items = sweep.from_feeds(entradas, today=today, rows=board)
    if not items:
        # Cero fichas con 2.000 entradas leídas es un fallo, no un día tranquilo.
        # Publicar un artefacto vacío encima del anterior es la rotura que
        # parece que funcionó.
        print(f"  {len(entradas)} entradas y NINGUNA ficha del día: no se publica.",
              file=sys.stderr)
        return False
    archive.save_day(root, today, items, meta=sweep.meta(items, datos.get("summary")))
    print(f"  barrido determinista: {len(items)} fichas de {len(entradas)} entradas, "
          f"{sum(1 for i in items if i['players'])} con jugador del board nombrado.")
    return _publish(root, out, today, window)


def _publish(root: Path, out: Path, today: date, window: int) -> bool:
    """Consolida la ventana y cuelga cada ficha de los jugadores del ranking.

    Devuelve `False` si no se pudo publicar. **No reescribe nada cuando no hay
    ranking contra el que enlazar**, y ésa es la corrección importante: `out/`
    está en `.gitignore`, así que en CI `fantasy_weekly.json` no existe nunca.
    La versión anterior seguía adelante con la lista de jugadores VACÍA y
    publicaba las mismas 45 fichas con cero enlaces — borrando en producción las
    marcas de las filas del ranking y vaciando «Today's Intelligence», en verde
    y con un commit que decía «barrido del <fecha>». Degradar en silencio algo
    que ya funcionaba es peor que no ejecutarse.
    """
    players = _ranking_players(root, out)
    if not players:
        print(
            "Sin ranking contra el que enlazar. Publicar así BORRA los enlaces que\n"
            "  ya estaban, así que no se toca nada. Genera el semanal\n"
            "  (scripts/fantasy_weekly_build.py) o repara web/data/model.b64.js.",
            file=sys.stderr,
        )
        return False

    payload = archive.consolidate(
        root, days=window, today=today, players=players, limit=WEB_ITEMS
    )
    if payload is None:
        print("No hay archivo de research todavía; no se escribe out/research.json.")
        return False

    # SIN marca de tiempo a propósito. Un `generated_at` de reloj hace que el
    # payload comprimido cambie cada día aunque el archivo sea idéntico, y
    # entonces el «sin novedades hoy, no publico» del workflow no se cumple
    # nunca: se commitea ruido a diario. La fecha que importa —cuándo se barrió
    # por última vez— ya está en las fichas, y de ahí la saca la web.
    (out / "research.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    linked = sum(1 for item in payload["items"] if item["player_ids"])
    print(
        f"Escrito out/research.json — {len(payload['items'])} de {payload['total']} fichas, "
        f"{linked} enlazadas a un jugador del ranking."
    )
    return True


if __name__ == "__main__":
    raise SystemExit(main())
