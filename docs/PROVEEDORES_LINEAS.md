# Líneas de apertura y snapshots: qué haría falta, y quién lo tiene

**Estado a 5 de septiembre de 2026:** el proyecto sólo tiene la LÍNEA DE
CIERRE (`spread_line`, `total_line` y moneylines de `games.csv` de nflverse,
que replica la de Pro Football Reference). No hay apertura ni instantáneas.
Por eso `BETTING_EDGE` está REJECTED y la web llama «model − market» a la
diferencia, no edge.

El contrato de datos que haría posible lo correcto está en
`src/oracle/betting/market_snapshot.py`: observación con `observed_at`
obligatorio, fases OPEN / DECISION / CLOSE separadas, y un `DecisionSnapshot`
que congela modelo + mercado + instante. El backtest que use ese contrato sólo
podrá mirar observaciones ANTERIORES a la decisión; el cierre queda como
comparador (CLV).

## Auditoría de proveedores

Lo que sigue es conocimiento del autor de este documento **sin verificar en
esta sesión** —la política de salida del entorno impide consultar los sitios—
y hay que comprobarlo antes de decidir nada: condiciones, cobertura y precios
cambian. Cada fila dice qué habría que confirmar.

| Proveedor | Cobertura | Libros | Granularidad | Profundidad | Acceso | Licencia / uso comercial | Coste | A confirmar |
|---|---|---|---|---|---|---|---|---|
| **The Odds API** | spreads, totales, ML, props | decenas de libros US/UE | snapshots por petición; histórico por marca de tiempo (endpoint `historical`) | histórico desde 2020 aprox. | REST con clave | uso comercial en planes de pago; revender datos, no | gratis 500 req/mes; planes desde ~$30/mes | profundidad real de aperturas; frecuencia de snapshots en histórico |
| **SportsDataIO** | líneas pre-partido con apertura y cierre, por libro | varios libros | apertura, cierre y movimientos | varias temporadas | REST con clave | comercial con contrato | de pago (cientos/mes) | si «apertura» es del libro o consenso |
| **OddsJam / OpticOdds** | líneas en tiempo real por libro | muchos | streaming y snapshots | histórico limitado según plan | API de pago | comercial | de pago (alto) | precio y si venden histórico |
| **Pinnacle (API de afiliado)** | sus propias líneas | 1 | cambios de línea | según acceso | requiere cuenta/afiliado | restrictiva | — | disponibilidad para particulares |
| **Kaggle / archivos públicos (sportsbookreviewsonline, etc.)** | aperturas y cierres agregados de temporadas pasadas | consenso | apertura / cierre | 2007+ | descarga | licencias variadas, a menudo no aptas para uso comercial | gratis | procedencia y licencia de cada fichero; el cierre coincide con PFR |
| **nflverse `games.csv`** (lo que hay) | cierre | consenso PFR | una por partido | 1999+ | descarga | abierta | gratis | nada: es lo que ya se usa |

### Recomendación, sin comprar nada

- **Mejor gratis para empezar a acumular DECISIÓN:** The Odds API en plan
  gratuito, guardando cada respuesta como `MarketObservation` con
  `observed_at` real. No da aperturas históricas gratis, pero desde el primer
  día crea el histórico propio, que es lo único que nunca se podrá comprar
  hacia atrás con `observed_at` fiable.
- **Mejor de pago para histórico de aperturas:** SportsDataIO o el endpoint
  histórico de The Odds API, según lo que confirme la comprobación de arriba.
- **Integración realista:** un job diario en `weekly-predictions.yml` que
  lea The Odds API y escriba `data/market/observations.parquet`; el
  backtest de decisión llega cuando haya al menos una temporada acumulada.

## Lo que sigue estando prohibido

Mientras no exista una observación de decisión con su hora, ninguna pantalla
llama «edge» a la diferencia con el cierre, y ningún backtest contra el
cierre se presenta como validación accionable. Es la regla 5 aplicada a las
cuotas: un dato real con la hora equivocada es una respuesta falsa.
