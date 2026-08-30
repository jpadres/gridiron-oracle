#!/usr/bin/env python3
"""Contraste de los colores de la web, calculado y no estimado.

El contraste es de las poquísimas cosas de una interfaz que son **computables**,
así que no tiene sentido opinar sobre ella. El umbral es 4,5:1 para texto normal
(WCAG AA); 3:1 sólo vale para texto grande, y ninguno de estos lo es.

Lo encontró de verdad: el verde de «Solid» daba 4,36:1 sobre su propio fondo.
A ojo era perfectamente legible, que es exactamente por qué hay que medirlo.
"""

from __future__ import annotations

import sys

MINIMUM = 4.5


def _channel(value: float) -> float:
    value /= 255
    return value / 12.92 if value <= 0.03928 else ((value + 0.055) / 1.055) ** 2.4


def luminance(colour: str) -> float:
    colour = colour.lstrip("#")
    red, green, blue = (int(colour[index:index + 2], 16) for index in (0, 2, 4))
    return 0.2126 * _channel(red) + 0.7152 * _channel(green) + 0.0722 * _channel(blue)


def composite(colour: str, alpha: float, background: str) -> str:
    """Un color con transparencia, resuelto sobre su fondo real.

    Sin esto se mide el contraste contra un fondo que no existe: las etiquetas
    usan `rgba(...)`, así que el fondo efectivo es la mezcla, no el color puro.
    """
    top, under = colour.lstrip("#"), background.lstrip("#")
    channels = (
        round(int(top[i:i + 2], 16) * alpha + int(under[i:i + 2], 16) * (1 - alpha))
        for i in (0, 2, 4)
    )
    return "#" + "".join(f"{channel:02x}" for channel in channels)


def ratio(first: str, second: str) -> float:
    high, low = sorted((luminance(first), luminance(second)), reverse=True)
    return (high + 0.05) / (low + 0.05)


LIGHT, DARK = "#ffffff", "#101216"

CASES = [
    ("bust «Solid» claro", "#0d6e4a", composite("#1baf7a", 0.14, LIGHT)),
    ("bust «Fragile» claro", "#b32d2d", composite("#d03b3b", 0.14, LIGHT)),
    ("bust «Solid» oscuro", "#4fd3a2", composite("#1baf7a", 0.20, DARK)),
    ("bust «Fragile» oscuro", "#f08a8a", composite("#d03b3b", 0.22, DARK)),
    ("cambio de equipo claro", "#b45309", "#fffbeb"),
    ("cambio de equipo oscuro", "#d08a1f", "#241f11"),
    ("sello de build claro", "#5b6472", "#f6f7f9"),
    ("sello de build oscuro", "#98a1b0", "#171a20"),
]


def main() -> int:
    failed = 0
    for name, foreground, background in CASES:
        value = ratio(foreground, background)
        if value < MINIMUM:
            failed += 1
        state = "OK  " if value >= MINIMUM else "FALLA"
        print(f"  {state} {name:<24} {foreground} sobre {background} = {value:.2f}:1")
    print(f"\nUmbral {MINIMUM}:1 (WCAG AA, texto normal) -> "
          f"{'PASA' if not failed else f'{failed} FALLAN'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
