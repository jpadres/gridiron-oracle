# Contrato de datos multi-liga

Auditoría y diseño. **No está implementado**: la implementación toca navegación
y tablas, o sea UI, y la pasada visual 1–7 está activa.

## Dónde asume el código de hoy que hay una sola liga

Verificado leyendo el código, no supuesto.

| sitio | supuesto | consecuencia |
|---|---|---|
| `research/league.json` | **un** fichero | no hay forma de tener dos ligas |
| `fantasy_build.py::_synced_league` | lee ese único fichero | el board es de una liga |
| `payload.fantasy.*` | un `scoring`, un `teams`, un `starters` | el sitio publica un board |
| `payload.fantasy_weekly.scoring` | cadena suelta, `"ppr"` | no dice de qué liga |
| `DraftMode.jsx` | un `league` en el estado del navegador | un draft a la vez |
| `LeagueSettings` | una tupla de titulares | correcto, pero instanciado una vez |
| `WeeklyCalibration` | multiplicadores globales | **correcto así**: son del modelo, no de la liga |

Y dos supuestos que **no** están, pese a lo que dice el README:

- PPR **no** está cableado como constante global. `ScoringRules` es un parámetro
  explícito en todo el camino. La única excepción viva era `_bust_training`, y se
  corrigió en esta sesión.
- El tamaño de liga tampoco: `LeagueSettings.teams` se propaga bien.

## El contrato

```
USUARIO
  └── ligas: [Liga]                       # N, no 1

LIGA                                       (identidad + reglas)
  id_privado        no se versiona         # league_id de la plataforma
  nombre_privado    no se versiona         # suele llevar nombres de personas
  plataforma        "sleeper"
  temporada
  reglas            ScoringRules           # incluida la recepción por posición
  titulares         LeagueSettings
  equipos           int
  posiciones_roster [str]                  # para flex, superflex, IDP

JUGADOR                                    (identidad GLOBAL, una sola vez)
  player_id         gsis_id de nflverse    # la misma clave que usa Sleeper
  nombre, posición, equipo, edad, rookie

INTELIGENCIA_DE_JUGADOR                    (GLOBAL, una sola vez)
  proyección_por_reglas(reglas) -> puntos  # función, no dato almacenado
  riesgo, volatilidad, ausencia, bust
  noticias, dossier

JUGADOR × LIGA                             (la única tabla que se multiplica)
  player_id, liga_id
  propiedad         MÍO | RIVAL | LIBRE
  ranura            TITULAR | BANQUILLO | NINGUNA
  relevancia_waiver, relevancia_traspaso

EVENTO_DE_INTELIGENCIA                     (GLOBAL, uno solo)
  id, tipo, jugadores[], fuente, publicado_en, evidence_type

IMPACTO_EN_USUARIO                         (N por evento, uno por liga)
  evento_id, liga_id, urgencia, acción_sugerida
```

## Las tres reglas que hacen que esto no se duplique

1. **La inteligencia de un jugador es global; su valor es una función de las
   reglas.** No se almacena «los puntos de Bijan en la liga A» y «en la liga B»:
   se almacena su producción proyectada por componentes y se puntúa con las
   reglas de cada liga al leer. Por eso el payload tiene que publicar
   **componentes proyectados** (recepciones, yardas, touchdowns) y no un total
   de puntos — hoy publica el total, y ése es el bloqueo duro de todo esto.

2. **Un evento de prensa es uno solo.** «Nacua no entrena» es un hecho, no tres.
   Lo que se multiplica es `IMPACTO_EN_USUARIO`: en la liga donde es titular es
   urgente, en la que no lo tienes es una oportunidad de waiver, y en la tercera
   no es nada. Sin esa separación, una noticia genera ocho alertas iguales.

3. **Sólo `JUGADOR × LIGA` crece con el número de ligas.** Si algo más se
   multiplica, está mal modelado.

## Bloqueos, en orden

1. **El payload publica puntos, no componentes.** Sin componentes no se puede
   repuntuar para una segunda liga con reglas distintas, y todo lo demás depende
   de esto. Es la primera tarea.
2. **`research/league.json` es un fichero.** Pasa a `research/leagues/<slug>.json`
   más `research/leagues_private.json` (que no se versiona). La separación
   pública/privada ya está hecha en esta sesión.
3. **La navegación no tiene concepto de liga activa.** Es UI y va después de la
   fase 7.
4. **Sleeper no es alcanzable desde CI ni desde aquí.** Todo lo que dependa de
   leer rosters y matchups en vivo está bloqueado por fuente externa, no por
   diseño.
