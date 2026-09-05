# La rama canónica — verificado el 5 de septiembre de 2026

Esta pregunta se ha reabierto tres veces con instrucciones que daban por muerta
la rama viva. Aquí está la evidencia para no volver a discutirla de memoria.

## La respuesta

    claude/gridiron-oracle-setup-98d7ob

Es la ÚNICA rama de trabajo. Todo lo demás es un puntero viejo.

## La evidencia, comprobada y no recordada

| Comprobación | Resultado |
|---|---|
| `git remote show origin` → HEAD branch | `claude/gridiron-oracle-setup-98d7ob` |
| Upstream configurado (`@{u}`) | `origin/claude/gridiron-oracle-setup-98d7ob` |
| Commits únicos en `setup-98d7ob` | **81** |
| Commits únicos en `instrucciones-28an59` | **0** |
| Vercel `githubCommitRef` de producción | `claude/gridiron-oracle-setup-98d7ob` |
| Alias de esa producción | `gridiron-oracle-five.vercel.app` |

`claude/instrucciones-28an59` está **contenida entera** en la rama activa: cero
commits propios. Su última punta remota es del 1 de septiembre.

## El commit que parecía varado, y no lo estaba

La rama LOCAL `instrucciones-28an59` aparece «ahead 1» sobre su remoto, en
`7ed866f` («Harness: quitar el survivorship y medir donde se decide»).

Eso NO es trabajo perdido: `git branch --contains 7ed866f` lo sitúa también en
`claude/gridiron-oracle-setup-98d7ob` y en su remoto. El «ahead 1» es respecto a
un remoto que lleva cuatro días parado, no respecto al trabajo real.

**No hay nada que rescatar y no hace falta ningún rebase, merge ni force push.**

## Por qué importa, y no es burocracia

Vercel publica producción desde la rama por defecto. Empujar a
`instrucciones-28an59` no habría sido un detalle de organización: el trabajo
**no se habría desplegado**, y el sitio habría seguido sirviendo lo de antes sin
dar ningún error — el modo de fallo que este proyecto persigue en todas partes.

## La regla

Si una instrucción futura vuelve a nombrar otra rama como la activa, se
comprueba antes de obedecer: `git remote show origin`, los commits únicos de
cada lado, y el `githubCommitRef` del último despliegue de producción. Si la
evidencia contradice a la instrucción, **manda la evidencia** — y se anota aquí
con fecha.
