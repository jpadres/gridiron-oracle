# Inteligencia de fuentes — contrato

Escrito para que «250 fuentes» no se convierta nunca en una métrica de vanidad.

## 1. Qué es una fuente

Cuatro tipos de entidad que **no se suman entre sí**:

| Tipo | Qué es | Ejemplo |
|---|---|---|
| `ORGANIZATION` | Un medio o entidad que publica | un periódico local |
| `AUTHOR` | Una persona que informa | un reportero de equipo |
| `FEED` | Un canal concreto (RSS, endpoint) | el RSS de fantasy de un medio |
| `PROVIDER` | Un proveedor de datos estructurados | nflverse |

32 subpáginas de un mismo medio son **un** `ORGANIZATION` y 32 `FEED`. Sumarlas
para llegar a una cifra redonda es exactamente lo que este documento prohíbe.
`tests/test_source_registry.py` lo comprueba.

## 2. Un informe repetido no es corroboración

    MÚLTIPLES ARTÍCULOS != MÚLTIPLES FUENTES INDEPENDIENTES.

`src/oracle/sources/lineage.py` resuelve el ORIGEN y cuenta orígenes distintos.
Devuelve tres cifras y sólo la primera se puede publicar como «confirmado por
varias fuentes»:

    independent_origins   orígenes distintos y CONOCIDOS
    unknown_origin        afirmaciones cuyo linaje no se pudo establecer
    total_claims          artículos

**El linaje desconocido NO cuenta como independiente.** Convertir «no sé de
dónde viene» en «viene de otro sitio» infla el número que más engaña.

«Según X» sólo hace raíz a X si X **no aparece en el catálogo repitiendo a
otro**. Un podcast que cita a un medio que a su vez cita al informante tiene el
mismo origen que el informante; contarlo aparte fabricaba un segundo origen a
partir de un solo informe.

Tampoco aportan origen: un nodo incoherente (dice originar Y citar), un
originador sin fuente identificable, y una afirmación con id ambiguo. Los ids se
comparan normalizados, porque `ESPN`, `espn` y `espn ` son el mismo medio.

La raíz es **quién** origina, no **qué** artículo: un reportero que publica lo
mismo en su medio y en un podcast son dos artículos y un originador. Y un ciclo
—dos medios que se citan mutuamente— no demuestra ninguna raíz: devuelve
desconocido.

## 3. Las cuatro marcas de tiempo ya existen

No se duplican: viven en `freshness.py` (`published_at`, `event_at`,
`effective_at`, `retrieved_at`) con su clasificación de frescura. Este paquete
se apoya en ellas.

## 4. Una cadencia declarada exige su fecha de verificación

Decir «se actualiza cada 6 horas» es una afirmación sobre el mundo, y las
fuentes cambian sin avisar. Toda entrada con `freshness_expectation` lleva
`cadence_verified_at` y, cuando existe, `cadence_source`. Es la regla 5 aplicada
al propio catálogo, y hay un test que lo exige.

## 5. Lo verificado el 5 de septiembre de 2026

Comprobado en la documentación primaria de nflverse, no en un resumen:

| Dataset | Cadencia en temporada | Uso |
|---|---|---|
| **Snap counts** (PFR) | 4×/día (0/6/12/18 UTC) | **Cierra el hueco de snaps, en vivo** |
| **Participation** (FTN, 2023+) | **NO actualiza**: tras los playoffs | Sólo validación HISTÓRICA |
| FTN charting | 4×/día | En temporada — y **no es** `participation` |
| NGS weekly | cada noche 3-5 ET | En temporada |
| Rosters / depth charts | diario 7 UTC | En temporada |
| Schedules (líneas) | **cada 5 minutos** | Ya en producción |

Dos consecuencias que importan:

- **Las rutas no pueden alimentar una proyección semanal.** La fuente sólo se
  publica cuando la temporada ha terminado. Usarla en vivo sería fuga.
- La fuente de participación anterior a 2023 (NGS) **murió** durante 2023, así
  que la serie tiene una costura de proveedor en medio.

Los tres ficheros responden HTTP 200 desde este entorno y desde CI.

## 6. Lo que puede entrar en un modelo

Nada de este paquete entra en un cálculo por defecto. La regla 8 del proyecto
sigue en pie: la prensa marca, no calcula. Un campo derivado de fuentes sólo
puede alimentar un modelo si está **declarado explícitamente** y validado; todo
lo demás es de PANTALLA.
