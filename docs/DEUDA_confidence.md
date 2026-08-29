# Deuda técnica — LEGACY CONFIDENCE FALLBACK

**Estado:** abierta a propósito. Decisión del dueño el 29/8/2026: no mezclar este
cambio con la fase 2.

## Qué pasa

`research._clean` degrada a `"rumor"` cualquier valor de `confidence` que no
reconozca, en silencio y sin fallar:

```python
"confidence": item.get("confidence")
    if item.get("confidence") in ("confirmado", "informado", "rumor")
    else "rumor"
```

La web hace lo mismo: `CONFIDENCE[item.confidence] ?? CONFIDENCE.rumor`.

## Por qué no se arregló ya

El campo nuevo e importante es `evidence_type`, y **ése sí se comporta bien**:
un valor no reconocido queda en `None`, no en un valor por defecto. La mina está
desactivada donde importaba.

Tocar `confidence` ahora cambiaría cómo se clasifican fichas nuevas y mezclaría
una decisión de semántica histórica con una tanda de trabajo que no va de eso.

## Las tres salidas, para cuando toque decidir

1. **`unknown → null`.** Coherente con `evidence_type` y con UNKNOWN > INVENTED.
   Rompe la web, que asume que siempre hay etiqueta.
2. **Conservar el fallback.** Cero trabajo, pero deja una vía por la que un valor
   nuevo se degrada sin avisar — exactamente lo que costó una iteración con
   `evidence_type`.
3. **Migrar `confidence` entero al esquema nuevo** y quitarlo. `evidence_type` no
   lo sustituye: miden ejes distintos (procedencia contra certeza), así que esto
   exige decidir antes si la certeza se sigue midiendo o se abandona.

**Antes de elegir hay que auditar el impacto**: cuántas fichas del archivo tienen
hoy un `confidence` que llegó por el fallback y no por clasificación real. Ese
número no se conoce, y es el que decide.
