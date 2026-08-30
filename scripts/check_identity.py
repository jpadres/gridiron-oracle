"""¿Se ve el color de cada equipo sobre los dos fondos del sitio?

Un rail de 3px del color del equipo es el elemento de identidad del rediseño. Si
el negro de Las Vegas se pinta sobre un fondo oscuro, ese rail no se ve poco: no
existe. Y no falla nada — la página se construye, los tests pasan, y la
identidad simplemente no está en 4 de los 32 equipos.

El umbral es **3:1**, el de WCAG para componentes de interfaz que no son texto.
El texto exige 4,5:1, pero un rail no se lee: se distingue.

Se comprueban las dos direcciones: `primary` sobre el lienzo claro, `mark` sobre
el oscuro. Un color por fondo, cada uno contra el suyo.
"""

from __future__ import annotations

import sys

from oracle.data.identity import TEAMS

LIGHT = "#ffffff"
DARK = "#0E1511"
THRESHOLD = 3.0


def _luminance(hex_color: str) -> float:
    value = hex_color.lstrip("#")
    channels = [int(value[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def contrast(a: str, b: str) -> float:
    la, lb = _luminance(a), _luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def main() -> int:
    failures = 0
    for abbr, team in sorted(TEAMS.items()):
        on_light = contrast(team.primary, LIGHT)
        on_dark = contrast(team.mark, DARK)
        ok_light = on_light >= THRESHOLD
        ok_dark = on_dark >= THRESHOLD
        if not (ok_light and ok_dark):
            failures += 1
        flag = "OK  " if ok_light and ok_dark else "FALLA"
        print(f"  {flag} {abbr:4s} claro {team.primary} {on_light:5.2f}:1"
              f"   oscuro {team.mark} {on_dark:5.2f}:1")

    print(f"\nUmbral {THRESHOLD}:1 (WCAG AA, componente no textual) -> "
          f"{'PASA' if failures == 0 else f'{failures} EQUIPOS FALLAN'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
