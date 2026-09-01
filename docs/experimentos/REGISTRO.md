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
| E10 | El umbral de viento de 15 mph tiene efecto medible | 5.008 partidos | viento ≤ 10 mph | puntos totales, IC95% | efecto significativo | −3,47 pts, IC [−4,78, −2,16] | **PASA** |
| E11 | El modelo ayuda en decisiones de Start/Sit difíciles | 2024–2025, 31.776 pares | forma reciente y moneda | acierto por pares, IC95% | batir al baseline **y** IC>50% | 54,3% [53,7–54,8] vs 53,6% | **PASA** |
| E11b | Ídem incluyendo los que no jugaron | 42.354 pares | ídem | ídem | ídem | 52,9% vs **50,1%** (la forma es una moneda) | **PASA** |
| E12 | El orden del ranking significa algo por debajo de 1 punto de diferencia | 89.114 pares | moneda | acierto por tramo, IC95% | IC > 50% | 50,6% [49,5–51,7] — el 50% dentro del IC | **FALLA** (y ése es el hallazgo) |
| E13 | Sleeper es alcanzable desde un entorno real | 4 endpoints, GitHub Actions | — | código HTTP | 200 o 404 en los cuatro | 2×200 con datos, 2×404 sobre ids inventados | **PASA** |
| E14 | El estado de draft de una liga no contamina a otra | 19 escenarios adversarios | — | fugas entre ligas | **cero** fugas en los 19 | 19/19, sin fuga | **PASA** |
| E15 | Los componentes canónicos reproducen los puntos exactamente | 998 jugadores × 7 perfiles, 2022-2025 | el cálculo directo por semana | máx \|Δ\| en puntos por partido | **< 1e-9** | 1,07e-14 (epsilon de coma flotante) | **PASA** |
| E16 | El Draft Room manual registra picks sin perderlos ni filtrarlos | 27 escenarios × navegador real | — | fugas, duplicados, picks perdidos | **cero** en los 27 | 27/27, pick en 35-60 ms | **PASA** |
| E17 | Board y Draft Room son un solo estado de draft | 10 unitarios + 19 en navegador | dos estados separados, uno por pantalla | picks divergentes, fugas, deshacer perdido | **21/21**, cero fugas | 21/21; E14 y E16 siguen verdes | **PASA** |
| E18 | El valor por liga responde a las REGLAS de la liga, no sólo a su puntuación | 861 proyecciones × 13 configuraciones | el board publicado (12 equipos, PPR) | reemplazo, VOR, orden entre posiciones | **16/16** propiedades preregistradas | 16/16; superflex QB13→QB25 y +26,4 pts de VOR mediano | **PASA** |
| E18b | Lo mismo, extendido a ligas PROFUNDAS (hasta 32 equipos) | 861 proyecciones × 17 configuraciones | E18 a 10-14 equipos | VOR del QB en superflex, reparto del top-25 | los mismos umbrales de E18 | **18/20**: la estructura aguanta, la magnitud no (+10,5 pts frente a +20) | **FALLA** (ancla dominada por el prior) |
| E10b | Ese efecto es explotable contra el mercado | 457 partidos | total de cierre | residuo, IC95% | — | −2,22 aparente, **pero el clima es observado, no pronosticado** | **FALLA** (fuga) |
| E20 | AUDITORÍA del modelo de partidos publicado: margen, total, marcadores y probabilidad | 3.829 partidos, walk-forward 2012–2025 | cero / media previa / constante / **cierre** | MAE por salida; Brier y fiabilidad por cubos | batir a los baselines ingenuos y cubos ±0,03 (estándar del campo; **sin preregistro** — es auditoría de un artefacto ya publicado) | margen 10,04 (cierre 9,97; cero 11,30) · total 10,57 (10,51; 11,08) · puntos 7,49/7,26 (7,43/7,23) · Brier 0,2128 (mercado 0,2113; constante 0,2470), cubos dentro de ±0,03 | **PASA** como calibración; el mercado sigue delante en todo |
| E19 | El asistente ingiere un draft ENTERO por el adaptador y dice la verdad sobre lo que sabe | 1 draft de 12×15 (180 picks) + 31 comprobaciones de matriz, navegador real contra un doble de la API | el modo manual (mismo registro de eventos) | picks perdidos o duplicados, turnos no detectados, candidato caducado, `LIVE` sin evidencia, fuga entre ligas | **cero** picks perdidos, **15/15** turnos propios detectados solos, y ni un `LIVE` fuera de las tres condiciones | 180/180 picks · 15/15 turnos · 31/31 de matriz · p95 de pick manual 84 ms. Dos defectos REALES encontrados: el `status` del draft se cacheaba (un draft que terminaba seguía diciendo LIVE para siempre) y el asistente enseñaba el board publicado mientras decía «by your league's value» | **PASA** tras corregir los dos |
| E21 | El asistente SIGUE un draft de Sleeper sin que yo reproduzca nada | 22 comprobaciones en navegador contra un doble fiel de la API (2 ligas, 3 drafts) | el modo manual y la configuración tecleada | picks perdidos o duplicados al reconectar, identidad adivinada, emparejamiento por nombre, contagio entre ligas, `LIVE` sin evidencia | reconstruir un draft ya en 3.05 sin haber estado; el puesto y la puntuación del PROVEEDOR, no del formulario; **cero** emparejamientos por nombre | 22/22. Entra en 3.05 y reconstruye 28 picks; puesto 5 derivado de `draft_order` frente al 9 tecleado; 10 equipos y media recepción del proveedor frente a 12 y PPR tecleados; 4 picks perdidos en una caída se reconcilian sin duplicar; un id fuera del mapa sale UNMAPPED; A→B→A sin contagio | **PASA** contra el doble. NO sube `SLEEPER_LIVE_BROWSER`: un doble prueba el código, no la red |

## Conocimiento negativo — cosas que NO funcionan

00. **El valor por liga no se sostiene en ligas muy profundas.** A 32 equipos la
    estructura responde bien —el reparto consume los 288 huecos exactos, el
    reemplazo se profundiza y el rank del quarterback se dobla— pero la magnitud
    no: el VOR del QB en superflex sube **+10,5 puntos** frente a los +20
    preregistrados, y no entra ni un QB más en el top-25. La causa está medida y
    no es el fútbol: entre el QB33 y el QB65 hay **30 puntos en bruto y 11 tras
    encoger**, así que el encogimiento se come el 65%. A esa profundidad el QB45
    tiene 0,3 partidos ponderados y una proyección bruta de 10 puntos, y aun así
    sale por encima del QB65, que tiene 7,1 partidos y un ritmo real de 164.
    **Publicar más jugadores no lo arregla**: es el modelo de proyección, no el
    pool.

0. **Un pase de touchdown de 6 puntos NO cambia el board.** Sube a todos los
   quarterbacks y sube su nivel de reemplazo exactamente igual (241 → 284
   puntos), así que el VOR queda intacto: solapamiento **25/25 en el top-25 y
   50/50 en el top-50** contra la liga de 4 puntos. Es el contraejemplo más
   limpio de que **puntuación no es valor** — y en sentido contrario, superflex
   no toca ni una regla de puntuación y reordena 13 de los 50 primeros. Por eso
   la etiqueta de puntuación no menciona el pase de 6 puntos: nombrar una
   diferencia que no mueve el valor sugiere una que no existe.

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
6. **El clima no se puede usar para predecir nada.** nflverse sólo lo trae para
   partidos ya jugados: cero de los 272 de 2026. El −2,22 puntos contra el total
   de cierre con viento >15 mph parece una ventaja y es la fuga más seductora que
   hay — la que da la razón a lo que uno quería creer.
7. **Los puestos consecutivos de un ranking semanal no se distinguen.** Con
   menos de un punto de diferencia proyectada el acierto es 50,6%, IC95%
   [49,5%, 51,7%], sobre 15.837 pares. El puesto 14 y el 15 son la misma cosa.
8. **Un multiplicador que iguala la media no minimiza el MAE.** Con una
   distribución sesgada a la derecha, el predictor que minimiza el error
   absoluto es la mediana; ajustar a la media empeora el MAE a cambio de un
   nivel correcto.
