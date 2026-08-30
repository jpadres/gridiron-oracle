# Preregistro — E14: aislamiento del estado de draft entre ligas

Escrito **antes** de ejecutar el primer test. 30/8/2026.

## La afirmación

El estado de draft de una liga **no puede** contaminar a otra.

No es una hipótesis sobre el mundo, es una propiedad de corrección del programa.
Por eso no lleva baseline ni intervalo de confianza: lleva un conjunto de
escenarios adversarios y un umbral de cero.

## Por qué hace falta preregistrarlo

El registro de capacidades exige que un estado `VALIDATED` tenga un experimento
detrás, y tiene razón: un estado sin medición es una opinión con formato de dato.
La tentación aquí era marcar la capacidad como validada «porque hay tests», que
es exactamente saltarse la regla. Así que los escenarios se fijan antes.

## Escenarios (fijados antes de medir)

1. Dos ligas distintas nunca comparten clave.
2. Dos temporadas de la misma liga no colisionan (caso dynasty).
3. Dos drafts de la misma liga y temporada no colisionan.
4. Una identidad incompleta no produce clave — no se persiste nada.
5. Un jugador cogido en la liga A sigue libre en la B.
6. La plantilla de A no aparece en B.
7. A → B → A devuelve cada estado intacto.
8. Un draft terminado no se mezcla con el siguiente de la misma liga.
9. Veinte ligas a la vez: escribir en una no toca las otras diecinueve.
10. Un almacenamiento corrupto devuelve estado vacío, no revienta.
11. Se filtra lo que no sea un id de texto.
12. El blob global v1 **no** se atribuye a ninguna liga.
13. El blob global v1 aterriza en el tablero manual de la temporada.
14. La liga del blob v1 se conserva como preferencia, no como estado.
15. La clave v1 se borra tras migrar.
16. Migrar dos veces no duplica ni pisa.
17. Un v1 ilegible se descarta sin romper el arranque.
18. Sin clave no se escribe nada.
19. El tablero manual tiene ámbito propio por temporada.

## Umbral de aceptación

**19 de 19.** Cero fugas. Un solo escenario que falle invalida la capacidad
entera: no hay «casi aislado», igual que no hay «casi único» en una clave
primaria.

## Qué NO demuestra

Que el board esté personalizado a la liga. Eso es `LEAGUE_SPECIFIC_VALUE` y
sigue BLOCKED: el VOR publicado usa 12 equipos y PPR pase lo que pase. Aislar el
estado y personalizar el valor son dos cosas distintas, y confundirlas sería
justo el tipo de afirmación de más que este registro existe para impedir.
