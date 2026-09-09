# Draft day — informe de contexto

Generado por `scripts/draft_day_brief.py` desde el payload publicado.
**Es research, no un ranking**: ningún número del board cambia por nada de lo que hay aquí.

## Relojes

| Sección | Fecha del dato |
|---|---|
| model | 2026-08-17 |
| fantasy | 2026-08-17 |
| rosters | 2026-09-08 |
| markets | 2026-09-09 |
| research | 2026-09-04 |
| ADP (ventana) | 2026-09-01 |
| ADP (descarga) | 2026-09-09T00:15:23Z |
| prensa leída, más nueva | 2026-09-09T03:25:00Z |

La descarga **no** fecha el dato: el ADP se bajó hoy y su ventana sigue siendo la del 2026-09-01, con la misma muestra de 5144 drafts.

## Prensa leída hoy

- 48 de 63 fuentes respondieron.
- 2113 entradas, 5 sin fecha de publicación (no se cuelgan de nadie).
- 535 menciones enlazadas a 179 jugadores del board, por nombre completo único **y** corroboración de equipo.

## Board contra mercado

188 de 552 filas del board tienen ADP. El umbral de «desacuerdo grande» es el percentil 90 de la brecha (203 puestos), elegido sobre la distribución y no a ojo.

**16 de los 19 desacuerdos grandes son NOVATOS**, y en 19 de los 19 el board va por DEBAJO del mercado.

Eso no es una sorpresa ni un fallo nuevo: es la brecha de escala que este repositorio ya
midió (E25, +108,9 puntos a favor del novato a igual proyección, 123 pares) y que publica
**sin corregir** porque no hay corrección validada. Donde el board y el mercado más se
separan es exactamente donde el propio repositorio dice que su escala no es comparable.

| brecha | board | ADP | jugador | pos | eq | marcas |
|---:|---:|---:|---|---|---|---|
| 762 | 917 | 154.8 | Cyrus Allen | WR | KC | ROOKIE |
| 757 | 907 | 149.8 | Fernando Mendoza | QB | LV | ROOKIE |
| 756 | 903 | 147.2 | Emmett Johnson | RB | KC | ROOKIE |
| 748 | 904 | 156.4 | Nicholas Singleton | RB | TEN | ROOKIE |
| 728 | 879 | 151.5 | Zachariah Branch | WR | ATL | ROOKIE |
| 719 | 880 | 160.9 | Ja'Kobi Lane | WR | BAL | ROOKIE |
| 716 | 884 | 167.6 | Chris Bell | WR | MIA | ROOKIE |
| 714 | 878 | 164.3 | Caleb Douglas | WR | MIA | ROOKIE |
| 706 | 877 | 170.5 | Malachi Fields | WR | NYG | ROOKIE |
| 677 | 829 | 151.9 | Mike Washington Jr. | RB | LV | ROOKIE |
| 671 | 828 | 156.6 | Jonah Coleman | RB | DEN | ROOKIE |
| 532 | 697 | 165.1 | Kaelon Black | RB | SF | ROOKIE |
| 471 | 595 | 124.0 | De'Zhaun Stribling | WR | SF | ROOKIE |
| 457 | 596 | 139.1 | Denzel Boston | WR | CLE | ROOKIE |
| 432 | 597 | 164.8 | Germie Bernard | WR | PIT | ROOKIE |
| 387 | 559 | 171.6 | Cam Ward | QB | TEN | — |
| 299 | 469 | 169.6 | Kenyon Sadiq | TE | NYJ | QUESTIONABLE (RISK) · ROOKIE |
| 213 | 375 | 162.0 | Malik Willis | QB | MIA | GB -> MIA |
| 203 | 257 | 53.6 | Bhayshul Tuten | RB | JAX | — |

### Donde el board va por ENCIMA del mercado

Si sigues el board aquí, alcanzas respecto a la sala. Ni bueno ni malo: es el dato.

| brecha | board | ADP | jugador | pos | eq | marcas |
|---:|---:|---:|---|---|---|---|
| 84 | 96 | 180.0 | Dalton Schultz | TE | HOU | — |
| 83 | 79 | 161.6 | Tyrone Tracy Jr. | RB | NYG | QUESTIONABLE (RISK) |
| 78 | 67 | 145.5 | Zach Charbonnet | RB | SEA | RESERVE LIST · RESERVE/PUP (OUT) |
| 76 | 60 | 135.8 | Jake Ferguson | TE | DAL | — |
| 65 | 81 | 145.8 | Dalton Kincaid | TE | BUF | — |
| 62 | 92 | 154.1 | Juwan Johnson | TE | NO | — |
| 59 | 107 | 165.7 | Tank Dell | WR | HOU | RESERVE LIST · IR (OUT) |
| 56 | 46 | 101.7 | Sam LaPorta | TE | DET | QUESTIONABLE (RISK) |
| 55 | 38 | 92.6 | Josh Jacobs | RB | GB | EXEMPT LIST · EXEMPT LIST (OUT) |
| 53 | 51 | 104.3 | Patrick Mahomes | QB | KC | QUESTIONABLE (RISK) |
| 51 | 36 | 87.1 | Wan'Dale Robinson | WR | TEN | NYG -> TEN |
| 51 | 39 | 90.0 | George Kittle | TE | SF | QUESTIONABLE (RISK) |
| 51 | 127 | 177.6 | Chig Okonkwo | TE | WAS | TEN -> WAS |
| 50 | 117 | 167.5 | T.J. Hockenson | TE | MIN | — |
| 48 | 95 | 143.3 | Jauan Jennings | WR | MIN | SF -> MIN |

## Top 50: 15 filas con algo que mirar

| # | jugador | pos | eq | qué |
|---:|---|---|---|---|
| 2 | Puka Nacua | WR | LAR | QUESTIONABLE (RISK) |
| 3 | Ja'Marr Chase | WR | CIN | QUESTIONABLE (RISK) |
| 15 | Breece Hall | RB | NYJ | QUESTIONABLE (RISK) |
| 22 | A.J. Brown | WR | NE | PHI -> NE |
| 24 | Zay Flowers | WR | BAL | QUESTIONABLE (RISK) |
| 27 | Tee Higgins | WR | CIN | QUESTIONABLE (RISK) |
| 29 | Kenneth Walker III | RB | KC | SEA -> KC |
| 30 | Ashton Jeanty | RB | LV | QUESTIONABLE (RISK) |
| 36 | Wan'Dale Robinson | WR | TEN | NYG -> TEN |
| 37 | Malik Nabers | WR | NYG | QUESTIONABLE (RISK) |
| 38 | Josh Jacobs | RB | GB | EXEMPT LIST · EXEMPT LIST (OUT) |
| 39 | George Kittle | TE | SF | QUESTIONABLE (RISK) |
| 44 | Travis Etienne | RB | NO | JAX -> NO |
| 46 | Sam LaPorta | TE | DET | QUESTIONABLE (RISK) |
| 49 | Jaylen Waddle | WR | DEN | MIA -> DEN |

## Pateadores: 23 de 32 activos en su equipo

El board de especialistas sale de quien más pateó la temporada PASADA, así que un cambio
de puesto no lo ve solo. Estos 9 NO tienen hoy el puesto que el board les
supone — cuatro sin equipo, dos en el equipo de prácticas y tres ACTIVOS EN OTRO EQUIPO,
que es el caso que más se parece a un pateador normal:

| pateador | board | registro de plantillas |
|---|---|---|
| Zane Gonzalez | ATL | NOT ON A ROSTER |
| Matt Prater | BUF | NOT ON A ROSTER |
| Brandon McManus | GB | NOT ON A ROSTER |
| Blake Grupe | IND | ACTIVE ROSTER (NYJ) |
| Daniel Carlson | LV | ACTIVE ROSTER (NO) |
| Charlie Smyth | NO | PRACTICE SQUAD (NO) |
| Younghoe Koo | NYG | NOT ON A ROSTER |
| Nick Folk | NYJ | ACTIVE ROSTER (ATL) |
| Jake Moody | WAS | PRACTICE SQUAD (BAL) |

Y el orden entre pateadores sigue siendo `KICKER_ORDINAL_RANKING` = REJECTED: el hueco es un hecho de tu liga, el orden K1…K12 no.

## Sin equipo NFL: 142 filas del board

No se borran —el modelo los clasifica ahí y esconderlos sería mentir sobre el board— pero no encabezan la lista corta y salen marcados.

| # | jugador | pos | board dice | ADP |
|---:|---|---|---|---|
| 59 | Tyreek Hill | WR | MIA | — |
| 119 | Brandon Aiyuk | WR | SF | — |
| 126 | Joe Mixon | RB | HOU | — |
| 152 | Phil Mafah | RB | DAL | — |
| 158 | Kevin Harris | RB | NE | — |
| 161 | Zach Evans | RB | LAR | — |
| 164 | Tyrion Davis-Price | RB | PHI | — |
| 169 | Amari Cooper | WR | BUF | — |
| 173 | Ulysses Bentley IV | RB | IND | — |
| 175 | Jashaun Corbin | RB | NYG | — |
| 176 | Zach Ertz | TE | WAS | — |
| 177 | Jase McClellan | RB | ATL | — |
