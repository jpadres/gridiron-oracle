# Preregistro — activar la curva de edad

Fijado **antes** de ejecutar nada. La curva está implementada desde hace tiempo
en `draft._age_factor` pero **inactiva**: `ages` llega vacío y el factor devuelve
1.0 para todo el mundo.

Ahora existe el dato (`birth_date`, cobertura 82-100% por temporada). Eso no es
razón suficiente para activarla. La pregunta es si **mejora la proyección fuera
de muestra**, y si no la mejora, no se activa.

## Qué se mide

Proyección de pretemporada frente a puntos reales de la temporada, walk-forward
(cada temporada proyectada sólo con las anteriores), sobre 2019-2025, con y sin
el factor de edad. Mismo pipeline, mismo todo, sólo cambia el multiplicador.

## Cómo se calcula la edad

**A 1 de septiembre de la temporada proyectada**, no hoy. Calcular «edad actual»
y aplicarla a la proyección de 2019 daría a cada jugador siete años de más, que
es un error sistemático con pinta de dato.

`birth_date` es un atributo estático conocido desde antes de que el jugador
existiera para la NFL, así que leerlo de cualquier fichero de plantilla no es
fuga. Lo que **sí** sería fuga es tomar de un fichero futuro cualquier otra cosa
—el equipo, por ejemplo— y por eso sólo se lee esa columna.

## Umbral de aceptación

Dos condiciones, **las dos**:

1. **El MAE global mejora.** Sin esto no hay nada que discutir.
2. **El MAE de running back mejora.** Es la condición que de verdad importa: el
   acantilado del corredor a partir de los 25,5 años es la justificación central
   de la curva y su parámetro más agresivo (5,5% anual). Si la curva no ayuda
   justo donde afirma ser más fuerte, lo que hay es una función bien escrita
   sobre una hipótesis que estos datos no sostienen.

## Qué pasa si no pasa

No se activa. Se documenta el resultado con sus números y la web **mantiene** la
limitación conocida tal como está — que hoy dice que la curva está implementada
pero inactiva, y seguiría siendo verdad.

No se ajustarán los parámetros de la curva para que pase. Los valores actuales
son la hipótesis; retocarlos hasta que mejore es ajustar al conjunto de prueba.

## Qué pasa si pasa

Se activa, se quita la limitación de la web, y se publica cuánto mejoró.

Fecha: 2026-08-29.
