# Draft day — informe de contexto

Generado por `scripts/draft_day_brief.py` desde el payload publicado.
**Es research, no un ranking**: ningún número del board cambia por nada de lo que hay aquí.

## Relojes

| Sección | Fecha del dato |
|---|---|
| model | 2026-08-17 |
| fantasy | 2026-08-17 |
| rosters | 2026-09-05 |
| markets | 2026-09-05 |
| research | 2026-09-04 |
| ADP (ventana) | 2026-08-29 |
| ADP (descarga) | 2026-09-06T09:27:16Z |
| prensa leída, más nueva | 2026-09-06T17:34:00Z |

La descarga **no** fecha el dato: el ADP se bajó hoy y su ventana sigue siendo la del 2026-08-29, con la misma muestra de 7430 drafts.

## Prensa leída hoy

- 48 de 63 fuentes respondieron.
- 2111 entradas, 3 sin fecha de publicación (no se cuelgan de nadie).
- 519 menciones enlazadas a 182 jugadores del board, por nombre completo único **y** corroboración de equipo.

## Board contra mercado

192 de 552 filas del board tienen ADP. El umbral de «desacuerdo grande» es el percentil 90 de la brecha (203 puestos), elegido sobre la distribución y no a ojo.

**17 de los 20 desacuerdos grandes son NOVATOS**, y en 20 de los 20 el board va por DEBAJO del mercado.

Eso no es una sorpresa ni un fallo nuevo: es la brecha de escala que este repositorio ya
midió (E25, +108,9 puntos a favor del novato a igual proyección, 123 pares) y que publica
**sin corregir** porque no hay corrección validada. Donde el board y el mercado más se
separan es exactamente donde el propio repositorio dice que su escala no es comparable.

| brecha | board | ADP | jugador | pos | eq | marcas |
|---:|---:|---:|---|---|---|---|
| 763 | 917 | 153.9 | Cyrus Allen | WR | KC | ROOKIE |
| 754 | 907 | 152.7 | Fernando Mendoza | QB | LV | ROOKIE |
| 754 | 903 | 149.0 | Emmett Johnson | RB | KC | ROOKIE |
| 748 | 904 | 156.4 | Nicholas Singleton | RB | TEN | ROOKIE |
| 728 | 879 | 151.5 | Zachariah Branch | WR | ATL | ROOKIE |
| 718 | 884 | 166.3 | Chris Bell | WR | MIA | ROOKIE |
| 717 | 880 | 162.6 | Ja'Kobi Lane | WR | BAL | ROOKIE |
| 713 | 878 | 165.2 | Caleb Douglas | WR | MIA | ROOKIE |
| 712 | 883 | 171.3 | Zavion Thomas | WR | CHI | ROOKIE |
| 709 | 877 | 167.8 | Malachi Fields | WR | NYG | ROOKIE |
| 678 | 829 | 150.8 | Mike Washington Jr. | RB | LV | ROOKIE |
| 674 | 828 | 153.9 | Jonah Coleman | RB | DEN | ROOKIE |
| 533 | 697 | 163.8 | Kaelon Black | RB | SF | ROOKIE |
| 471 | 595 | 124.3 | De'Zhaun Stribling | WR | SF | ROOKIE |
| 460 | 596 | 136.1 | Denzel Boston | WR | CLE | ROOKIE |
| 431 | 597 | 166.4 | Germie Bernard | WR | PIT | ROOKIE |
| 389 | 559 | 170.2 | Cam Ward | QB | TEN | — |
| 306 | 469 | 163.0 | Kenyon Sadiq | TE | NYJ | QUESTIONABLE (RISK) · ROOKIE |
| 213 | 375 | 161.8 | Malik Willis | QB | MIA | GB -> MIA |
| 203 | 257 | 54.0 | Bhayshul Tuten | RB | JAX | — |

### Donde el board va por ENCIMA del mercado

Si sigues el board aquí, alcanzas respecto a la sala. Ni bueno ni malo: es el dato.

| brecha | board | ADP | jugador | pos | eq | marcas |
|---:|---:|---:|---|---|---|---|
| 82 | 79 | 160.7 | Tyrone Tracy Jr. | RB | NYG | QUESTIONABLE (RISK) |
| 74 | 96 | 170.4 | Dalton Schultz | TE | HOU | — |
| 73 | 60 | 133.3 | Jake Ferguson | TE | DAL | — |
| 72 | 67 | 139.5 | Zach Charbonnet | RB | SEA | RESERVE LIST · RESERVE/PUP (OUT) |
| 66 | 81 | 147.1 | Dalton Kincaid | TE | BUF | — |
| 63 | 92 | 154.8 | Juwan Johnson | TE | NO | — |
| 61 | 46 | 106.7 | Sam LaPorta | TE | DET | QUESTIONABLE (RISK) |
| 57 | 107 | 164.0 | Tank Dell | WR | HOU | RESERVE LIST · IR (OUT) |
| 53 | 51 | 104.4 | Patrick Mahomes | QB | KC | QUESTIONABLE (RISK) |
| 52 | 117 | 169.0 | T.J. Hockenson | TE | MIN | — |
| 51 | 39 | 90.1 | George Kittle | TE | SF | QUESTIONABLE (RISK) |
| 51 | 36 | 86.6 | Wan'Dale Robinson | WR | TEN | NYG -> TEN |
| 49 | 95 | 144.4 | Jauan Jennings | WR | MIN | SF -> MIN |
| 48 | 64 | 111.8 | Bo Nix | QB | DEN | — |
| 46 | 127 | 173.4 | Chig Okonkwo | TE | WAS | TEN -> WAS |

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
| 119 | Brandon Aiyuk | WR | SF | 136.8 |
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
