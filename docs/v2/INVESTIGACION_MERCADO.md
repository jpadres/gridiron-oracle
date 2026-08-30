# Investigación de mercado y fuentes — laboratorio de 2026-08-30

Cuatro investigaciones paralelas (FantasyPros, competidores, ecosistema de
herramientas, proveedores de datos), hechas contra fuentes primarias donde el
proxy lo permitió y por índice de búsqueda donde no, con la fecha de cada
afirmación registrada. Lo que aquí se llama VERIFICADO tiene URL; lo demás se
dice INFERIDO o UNKNOWN. Este documento es el resumen operativo; el detalle con
todas las URLs quedó en el informe del bloque.

## 1. FantasyPros: qué es verdad y qué es marketing

**Metodología ECR publicada (verificada):** suma de Rank Points por experto —
NO media simple (evita inventar un rank a los no listados) y, contra la
leyenda, **sin ponderación por precisión en la metodología publicada**: esa
afirmación circula en explicadores de terceros y FantasyPros no la documenta.
La frescura se gestiona con transparencia (fecha de última actualización por
experto + filtro de usuario), no con reponderación automática.

**El concurso de precisión es lo más serio que tienen:** pool = unión del
top-N por ECR preseason y top-N por resultado real; el error de un rank se
traduce a puntos con la producción histórica media de ese puesto (3 años
rodantes); instantáneas congeladas a horas fijas (jueves kickoff, domingo
1pm). Es lo más parecido del sector a nuestra regla de fijar el umbral antes
de mirar. 212 expertos calificaron en 2025.

**Pick Predictor:** simulaciones sobre su base de cheat sheets + ADP
multi-fuente, condicionadas a lo ya tomado y a las necesidades de los rivales.
La descripción existe; la calibración de los porcentajes NO está publicada.
La existencia del motor es metodología; los números concretos son marketing.

**Geometría del paywall:** el consenso es gratis (es su foso SEO); lo que se
cobra es aplicarlo a TU liga y TU draft en vivo — el Draft Assistant se mide
literalmente en «syncs de draft en vivo» (10 en MVP $71.88/año, 50 en HOF
$107.88/año).

**Lecciones de UX que valen:** enseñar la DISPERSIÓN del consenso como columna
(Best/Worst/StdDev) y no sólo el punto; una tabla parametrizada con URL
estable por formato; FLEX como vista real (RB+WR+TE); frescura visible por
experto; en el reloj, una lista corta y no el board entero; el sondeo se
declara («Auto-Sync every 30 seconds») en vez de fingir un socket.

## 2. Competidores: el mapa en una página

- **Draft Sharks** — el más «producto»: War Room que re-rankea en vivo con 17
  factores NOMBRADOS (pesos no publicados), proyecciones con techo y suelo,
  Injury Predictor con IC del 80%. Ancla sus afirmaciones de precisión al
  concurso de FantasyPros (real) y las estira en el branding (marketing).
- **Establish The Run** — epistemología editorial seria sin herramienta: log
  de cambios público de sus rankings (el patrón de confianza destacable del
  sector), extensión Caddy que SÓLO tacha jugadores — prueba de que un sidecar
  que hace una sola cosa ya vale dinero. No participa en el concurso.
- **4for4** — la marca de precisión con récord real (Paulsen: dos victorias y
  varios top-4 en el concurso), $29-59/año.
- **RotoWire** — «AI Draft Assistant» sin metodología publicada; su activo
  real es el wire de noticias; el optimizador expone el eje seguro↔techo como
  control de usuario.
- **Fantasy Life** — la implementación más clara del dato estrella bajo
  presión: «% de que siga disponible en tu próximo pick», junto a la cola.
  Base no publicada. Extensión de Chrome, brecha móvil.
- **PFF** — K y DST como posiciones de primera clase en sus rankings (raro en
  el sector); FLEX nativo; pick grades sin metodología.
- **Sleeper** — el local: sin rankings propios serios, ADP refrescado 1-2
  veces/mes con mocks, SIN cheat sheets personalizados. Su moat es el draft
  room móvil; su API abierta es la razón de que exista todo el ecosistema de
  sidecars (y nuestro adaptador).
- **Subvertadown** — el especialista de K/DST/streaming que publica sus
  correlaciones incluyendo las malas (r≈0,23 en pateadores «y eso es bueno
  para pateadores»). El pariente metodológico más cercano a este proyecto.
- **Fantasy Football Analytics** — el auditor independiente: 12 temporadas,
  11 fuentes de proyecciones — todas apiñadas, el consenso cerca del techo,
  fuentes sin marca (NFL.com en QB, CBS en RB) batiendo a expertos famosos.
  **Es el «no bates a la línea de cierre» del fantasy**, y la mayoría del
  marketing del sector lo contradice en silencio.

**Síntesis de autoridad:** nadie publica la calibración de su «best pick» ni
de su probabilidad de supervivencia. El sector entero corre con la ventaja de
no medirse; el que se mide (FFA) encuentra que las diferencias reales entre
tiendas serias son pequeñas. La estrategia de Gridiron — autoridad acotada y
medida — no es una limitación frente a estos productos: es la única postura
que sus propios datos justifican.

## 3. Ecosistema de herramientas: dos adopciones, todo lo demás rechazado

**Adoptar (cuando toque, no en este bloque):**

1. **`ff_playerids` (DynastyProcess vía nflverse)** — el crosswalk de
   identidad: verificado hoy con 12.484 filas, `db_season=2026`, GSIS↔Sleeper↔
   ESPN↔Yahoo↔FantasyPros↔MFL; 1.042 de los 1.551 QB/RB/WR/TE con roster
   actual llevan GSIS∧Sleeper, y 129 de los 132 rookies de 2026 ya traen GSIS.
   Trae ADEMÁS capital de draft por jugador — la mitad del roadmap M5 en un
   CSV semanal de ~2 MB. Los ids son hechos; el pipeline es el mismo que sirve
   `nflreadr::load_ff_playerids()`.
2. **ADP de Fantasy Football Calculator** — la ÚNICA fuente de ADP con licencia
   explícita de uso libre (personal y comercial, con atribución), formatos
   std/half/PPR/2QB, histórico ~2007. Coste real: sus ids son propios y NO
   están en el crosswalk → mapeo curado a mano (~200-350 jugadores del board,
   ambiguo = UNKNOWN), nunca nombre+equipo automático.

**Hallazgo que invalida un plan anterior:** la fuente de lesiones de nflverse
**murió tras la temporada 2024** («no ETA» en su changelog); no hay datos
in-season de 2025 ni de 2026. El camino defendible a coste cero para estado de
lesión/práctica ACTUAL es el endpoint público de jugadores de Sleeper, que
lleva `gsis_id` EN LÍNEA (cero crosswalk) y vive en el único dominio ya
permitido por la CSP. Sin SLA ni licencia formal escrita: `retrieved_at` nunca
da frescura, y LIVE sigue prohibido.

**Rechazos (los motivos completos, en el informe):** los ~23 servidores MCP de
fantasy (wrappers de hobby sin datos nuevos ni identidad GSIS), `ff_rankings`/
`ffpros` (contenido de FantasyPros sin derechos — el envoltorio MIT no da
licencia de datos), FantasyCalc (API sin términos publicados), ADP de Underdog
(ToS restrictivos), espn-api/yfpy (no oficial / no comercial), nfl_data_py
(archivado 2025-09; sucesor nflreadpy — nuestro ingest directo de parquets no
lo necesita), Machina/StatHead/fantasyfootball-mcp (veredictos previos sin
cambios).

## 4. Proveedores de pago: el veredicto

**Pagar no cambia el producto hoy.** Las cinco brechas por área de producto
cierran con fuentes gratis de términos limpios: lesiones/práctica → Sleeper
($0); board/rookies → FFC ADP + capital de draft nflverse ($0); deriva del
mercado en el draft → FFC + trending de Sleeper ($0); waivers → trending +
estado de lesión ($0); start/sit → totales implícitos vía The Odds API (tier
gratis, uso analítico derivado permitido) + NWS para clima (dominio público).

La única compra que superaría el listón en algún escenario: FantasyPros HOF
($107.88/año) con su API personal — y sólo si publicar comparaciones
modelo-vs-consenso se vuelve una funcionalidad; exigiría confirmar términos
por email primero. Todo lo de arriba (SportsDataIO ~$99-149/mes, Sportradar
$10k+/mes) compra SLAs y licencias que un producto de un solo usuario no
necesita. Lo que el dinero no compra barato y con licencia de publicación:
rutas corridas por jugador.

## 5. Consenso: la respuesta arquitectónica

¿Mejoraría un consenso multi-fuente al modelo único? La evidencia externa
(FFA: el consenso de FantasyPros consistentemente cerca del techo) dice que
los consensos SON robustos. Pero **no existe hoy un conjunto multi-fuente de
rankings legalmente utilizable**: todo lo gratis desemboca en contenido de
FantasyPros sin derechos de redistribución, y la vía limpia (su API en HOF) es
mono-fuente y con cláusula de no-competencia. Conclusión registrada: **no se
construye consenso**; la brecha queda documentada, y el sustituto factual
disponible es el ADP de FFC como línea de mercado — que es un precio, no una
opinión, y por eso encaja mejor con la filosofía del proyecto (la lección de
la línea de cierre, aplicada al draft).

## 6. Identidad de jugador: el mapa queda así

- EXACT ID MATCH: nflverse GSIS (canónico); Sleeper (gsis_id en línea).
- VERIFIED CROSSWALK: ff_playerids para ESPN/Yahoo/FantasyPros/MFL/Sportradar.
- AMBIGUOUS: cualquier fuente sólo-nombres (FFC ADP) → mapeo curado, ambiguo
  fuera.
- UNMATCHED: se dice UNMATCHED. La regla de siempre: ante la duda no se
  empareja (los dos B.Robinson de ATL).
