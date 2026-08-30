"""Riesgo de una proyección de draft: de qué está hecha y si predice algo.

## Por qué no es una etiqueta a ojo

«Seguro» y «arriesgado» son las dos palabras más fáciles de escribir y las más
fáciles de inventarse. Aquí el riesgo se compone de tres cantidades que ya están
en el artefacto de proyección, y **se valida**: si una etiqueta de riesgo no
predice un error mayor, no es riesgo, es decoración con nombre técnico.

## Las tres componentes

1. **Muestra** (`weighted_games`). Una proyección sobre seis partidos es peor que
   una sobre cuarenta y cinco, y la diferencia no es de opinión.

2. **Cuánto tuvo que encoger el modelo** (`points_per_game` frente a
   `ppg_shrunk`). El encogimiento hacia la media posicional es proporcional a la
   desconfianza: cuando el modelo mueve mucho la tasa bruta de un jugador, está
   diciendo que no se la cree. Publicarlo es enseñar esa duda en vez de
   esconderla dentro del número final.

3. **Dependencia del touchdown**. El touchdown es la estadística más ruidosa del
   fantasy y la que más engaña mirando el año pasado: el volumen persiste, los
   TD regresan. Un jugador que saca la mitad de sus puntos de la zona roja tiene
   la misma proyección y mucha más varianza que uno que la saca de recepciones.

La edad **no** entra, aunque el acantilado del running back es real y está
documentado: las fechas de nacimiento no están conectadas y `age` llega vacía.
Meterla a medias sería peor que no meterla.

## Cómo se etiqueta

Por percentil **dentro de cada posición**. «Seguro» significa seguro para un
running back, no seguro comparado con un quarterback: las escalas de error de
las cuatro posiciones se diferencian en un factor de tres, y mezclarlas haría que
todos los TE salieran seguros y todos los QB arriesgados por pura escala.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# Pesos de las tres componentes. No están ajustados con datos —no hay con qué
# ajustarlos sin sobreajustar— así que se reparten a partes casi iguales, con
# algo más para el touchdown porque es la única de las tres que la literatura
# de fantasy respalda de forma independiente. Si cambias esto, revalida con
# `scripts/fantasy_risk_validate.py`.
WEIGHTS = {"sample": 0.3, "shrink": 0.3, "touchdown": 0.4}

# Partidos a partir de los cuales la muestra deja de ser el problema.
#
# **17 y no 40.** El ponderado 56/30/14 de tres temporadas satura alrededor de
# 19 partidos efectivos, así que un umbral alto hace que nadie llegue nunca y
# «muestra corta» aparezca en los 250 jugadores del board, incluido el número 1.
# Un aviso que sale siempre no informa de nada. Se descubrió leyendo la primera
# salida, no con un test.
SAMPLE_SATURATION = 17.0

# «Estable» y «Volátil», no «Seguro» y «Riesgo».
#
# Las etiquetas de disponibilidad del dossier son FUERA / DUDA / SEGUIR, y en la
# misma fila del board pueden aparecer las dos. «DUDA» junto a «Seguro» se lee
# como una contradicción aunque hablen de cosas distintas —si juega, y cuánto
# varía su proyección—. Se vio en la primera captura del board.
LABELS = ("Steady", "Normal", "Volatile")

# Cortes por percentil dentro de la posición. El tercio de abajo es «Seguro» y
# el de arriba «Riesgo»; el de en medio no merece etiqueta y por eso «Normal»
# no se pinta en la tabla.
CUTS = (1 / 3, 2 / 3)


def components(board: pd.DataFrame, td_points: dict[str, float]) -> pd.DataFrame:
    """Las tres componentes, cada una normalizada a [0, 1] donde 1 es peor."""
    frame = board.copy()

    games = frame["weighted_games"].astype(float).clip(lower=0.0)
    frame["risk_sample"] = 1.0 - (games / SAMPLE_SATURATION).clip(upper=1.0)

    raw = frame["points_per_game"].astype(float)
    shrunk = frame["ppg_shrunk"].astype(float)
    # Relativo a la propia tasa: mover un punto a quien hace veinte no es lo
    # mismo que movérselo a quien hace cinco.
    denominator = shrunk.abs().clip(lower=1.0)
    frame["risk_shrink"] = ((raw - shrunk).abs() / denominator).clip(upper=1.0)

    per_td = frame["position"].map(td_points).astype(float).fillna(6.0)
    td_share = (frame["td_per_game"].astype(float) * per_td) / raw.clip(lower=0.1)
    # Un tercio de los puntos saliendo de TD ya es mucha dependencia; a partir
    # de ahí la escala satura y no distingue nada útil.
    frame["risk_touchdown"] = (td_share / 0.35).clip(lower=0.0, upper=1.0)

    return frame


def score(board: pd.DataFrame, td_points: dict[str, float]) -> pd.DataFrame:
    """Añade `risk_score` (0 = lo más seguro) y `risk_label` por posición."""
    frame = components(board, td_points)
    frame["risk_score"] = sum(
        weight * frame[f"risk_{name}"] for name, weight in WEIGHTS.items()
    )

    frame["risk_label"] = "Normal"
    for _position, group in frame.groupby("position", observed=True):
        if len(group) < 6:
            continue  # con menos de seis, un percentil no significa nada
        low, high = group["risk_score"].quantile(CUTS).to_numpy()
        frame.loc[group.index[group["risk_score"] <= low], "risk_label"] = "Steady"
        frame.loc[group.index[group["risk_score"] >= high], "risk_label"] = "Volatile"
    return frame


# Umbrales para *nombrar* un motivo. Son el percentil 75 de cada componente en
# el board real, no números redondos: un motivo que aparece en los 250 jugadores
# —como pasaba con «muestra corta» y con «desconfía de su tasa bruta» en las dos
# primeras versiones— deja de ser información y se convierte en decoración.
REASON_THRESHOLDS = {"sample": 0.60, "shrink": 0.36, "touchdown": 0.80}


def reasons(row: pd.Series) -> list[str]:
    """Por qué ese jugador está donde está. En orden de cuánto pesa.

    Sin esto la etiqueta es un oráculo. Con esto, el lector puede estar en
    desacuerdo con un motivo concreto, que es como debe poder discutirse.
    """
    out: list[tuple[float, str]] = []
    if row.get("risk_sample", 0) > REASON_THRESHOLDS["sample"]:
        games = float(row.get("weighted_games", 0))
        out.append((row["risk_sample"], f"short sample ({games:.0f} weighted games)"))
    if row.get("risk_shrink", 0) > REASON_THRESHOLDS["shrink"]:
        out.append((row["risk_shrink"], "the model distrusts his raw rate"))
    if row.get("risk_touchdown", 0) > REASON_THRESHOLDS["touchdown"]:
        share = row["risk_touchdown"] * 0.35
        out.append((row["risk_touchdown"], f"touchdown-dependent ({share:.0%} of his points)"))
    return [text for _, text in sorted(out, reverse=True)]


def normalised_error(projected: np.ndarray, observed: np.ndarray) -> np.ndarray:
    """Error absoluto en unidades de la escala de la posición.

    Las cuatro posiciones tienen errores típicos que se diferencian en un factor
    de tres. Sin normalizar, cualquier correlación entre riesgo y error mide
    sobre todo qué posición es cada jugador.
    """
    scale = float(np.mean(np.abs(observed - projected))) or 1.0
    return np.abs(observed - projected) / scale
