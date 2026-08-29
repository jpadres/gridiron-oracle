# Registro de experimentos

Bloques 89 (registro) y 90 (conocimiento negativo) del espec.

**Un experimento fallido no se borra.** Saber qué no funciona es la mitad del
valor de haberlo medido, y sin este registro el mismo experimento se repite
dentro de seis meses porque nadie recuerda que ya se hizo.

Estados: **PASA** · **FALLA** · **NO CONCLUYENTE** · **RETIRADO**

| # | hipótesis | ventana val. | baseline | métrica | umbral | resultado | estado |
|---|---|---|---|---|---|---|---|
| E1 | La curva de edad mejora la proyección de temporada | fuera de muestra | sin edad | MAE global y de RB | ambas mejoran | mejora las dos | **PASA** |
| E2 | La tasa de ausencia pasada predice la futura | población del board | azar | Spearman | ≥ +0,15 | +0,24 en el board (+0,09 entre titulares de 16+) | **PASA** |
| E3 | La P(bust) está calibrada | 2016–2025 | — | ECE y lift decílico | ECE ≤ 0,08 y lift ≥ 1,5× | cumple | **PASA** |
| E4 | El desacuerdo con el mercado predice acierto ATS | 3.708 apuestas | 52,4% de equilibrio | % de acierto, IC95% | IC inferior > 52,4% | 49,3% / 50,9% / 48,8% — plano | **FALLA** |
| E5 | Corregir sedes, techo y sede neutral mejora el modelo de partidos | 3.829 partidos | features anteriores | MAE de margen | ≥ 0,02 mejor | +0,0003 | **FALLA** (sin efecto medible) |
| E6 | El modelo semanal bate a la media ponderada de 6 partidos | 2024–2025 | forma reciente | Spearman **y** MAE | ambas en las 4 posiciones | pierde Spearman en las 4 | **FALLA** |
| E7 | La mezcla modelo+forma bate al baseline | 2024–2025 | forma reciente | Spearman y MAE | ambas | MAE en 4/4, Spearman en 3/4 | **PASA** (parcial en QB) |
| E8 | Un modelo de pateador bate a la media de liga y a su forma | 2022–2025 | ambos | MAE y Spearman | batir a los dos | MAE 3,73 vs 3,77 y 4,07 | **PASA** |
| E8b | El ranking de pateadores separa K1 de K12 | 2022–2025 | — | pts/partido con IC95% | > 1,5 pts | +0,26, IC [−0,36, +0,87] | **FALLA** |
| E9 | El capital de draft predice el año rookie | 2016–2025 | cero y media de posición | Spearman y MAE | batir a los dos | ρ 0,604 vs 0,093 | **PASA** |

## Conocimiento negativo — cosas que NO funcionan

1. **El desacuerdo del modelo con la línea no predice el acierto contra el
   spread.** Tres tramos de desacuerdo dan 49,3%, 50,9% y 48,8%: plano y por
   debajo del equilibrio. Regla permanente en `docs/REGLA_edge.md`.
2. **La habilidad de un pateador no es medible a escala de temporada.** Su
   porcentaje de acierto no predice el del año siguiente (r 0,024) y su
   dispersión observada (0,071) apenas supera la del azar binomial (0,066).
3. **Las pérdidas de balón forzadas no son una cualidad estable de una defensa.**
   Balones sueltos recuperados año contra año: r 0,044.
4. **El rendimiento de una defensa de una semana no predice el de la siguiente.**
   Puntos permitidos r 0,060, capturas 0,030, pérdidas forzadas 0,040.
5. **Corregir features de segundo orden (viaje, huso, techo) no mueve el modelo
   de partidos**, ni siquiera arreglando el 10% de sus valores.
6. **Un multiplicador que iguala la media no minimiza el MAE.** Con una
   distribución sesgada a la derecha, el predictor que minimiza el error
   absoluto es la mediana; ajustar a la media empeora el MAE a cambio de un
   nivel correcto.
