# Bankroll mensual y board de apuestas (`/betting`)

El corrector del bloque anterior: la investigación estaba bien y el producto
seguía sin contestar «¿qué miro hoy?». Esta página lo contesta con lo más
fuerte que la evidencia permite decir — y ni un milímetro más.

## La escalera, por mercado

    L0 DATO DE MERCADO · L1 PROYECCIÓN · L2 MODEL LEAN · L3 BET TO CONSIDER
    · L4 EDGE VALIDADO · L5 BEST BET / STAKE ÓPTIMO

| mercado | L0 | L1 | L2 | L3 | L4 | L5 |
|---|---|---|---|---|---|---|
| spread | SÍ (nflverse, build) | SÍ (E20) | **SÍ — se enseña** | como hipótesis etiquetada (E4, p≈0,18) | NO (E4 FALLÓ) | NO |
| total | SÍ | SÍ (E20, residual) | **SÍ — se enseña** | igual | NO | NO |
| moneyline | SÍ (cierre) | SÍ (probabilidad E20) | implícito | NO | NO | NO |
| props de pase | NO (línea del usuario) | media SÍ (E7 agregado) | sólo con línea tecleada | NO | NO | NO |
| props de carrera | NO (ídem) | media SÍ | ídem | NO | NO | NO |
| props de recepción | NO (ídem) | media SÍ | ídem | NO | NO | NO |
| props de TD | NO | NO (exige modelo de eventos) | NO | NO | NO | NO |
| props de equipo | NO | SÍ (marcadores E20) | NO hasta tener líneas | NO | NO | NO |

Que el spread esté en L2 no sube a nadie más: cada mercado sube su propia
escalera con su propia evidencia.

## Decisiones de diseño que son reglas

- **El primer viewport es dinero + decisiones.** Banca del mes, disponible,
  expuesto, P/L — y debajo los cinco leans más grandes. La metodología vive al
  final, tras divulgación.
- **MODEL LEAN, con ese nombre.** Aritmética entre el modelo validado y una
  línea real. El resultado de E4 (el desacuerdo no predice acierto: 49,3 /
  50,9 / 48,8%) va impreso al lado de la lista, no escondido.
- **El orden normaliza por familia**: hueco / desviación típica de los
  desacuerdos de esa familia esta jornada («2,9× typical»). Nunca puntos de
  spread contra recepciones en crudo, y nunca un porcentaje.
- **Sin línea no hay lean.** Las líneas de props no viajan en el payload; el
  usuario teclea la de su casa y el lean aparece. `MARKET UNAVAILABLE` es un
  estado del producto, no un hueco. (Y `Number(null)===0` estuvo a punto de
  fabricar una línea 0: el guardián del test lo cazó.)
- **«Record as placed» registra en Gridiron.** No se transmite nada a ninguna
  casa; el texto lo dice donde se pulsa.
- **El snapshot es inmutable.** Colocar congela línea, cuota, stake y salida
  del modelo; editar o borrar una colocada es un no-op probado, y WON no pasa
  a LOST.
- **Un mes = un contexto.** Banca inicial declarada, historia propia, sin
  arrastre automático; el placeholder de octubre enseña el cierre de
  septiembre pero el número lo tecleas tú. Un mes existente no se recrea.
- **El stake es del usuario.** $, % y unidades se muestran a la vez; los
  límites (por apuesta, abierto, por partido) son SUS reglas y avisan sin
  bloquear. **Sin Kelly automático** mientras no haya edge validado — la
  maquinaria existe en `betting/` y se queda apagada aquí a propósito.
- **La exposición se agrupa** por partido, equipo, jugador y mercado —
  descriptivo, sin coeficientes de correlación inventados. Cinco apuestas del
  mismo partido se VEN como lo que son.

## Los números del escenario de referencia (suite `bankroll-lab`)

$10.000 · spread $150 a −110 ganado, total $100 perdido, prop $100 push, prop
$100 abierta → P/L +$36,36 · disponible $9.936,36 · récord 1-1-1 · ROI +0,4%
· 1u=$100. Octubre con $8.000 aparte; septiembre intacto al volver; recarga
sin pérdida. Todo verificado en DOM, no en consola.
