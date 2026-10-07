/**
 * UN LABORATORIO QUE SE ENGANCHA AL SERVIDOR DE OTRO PRUEBA OTRA COSA.
 *
 * `tools/lab/server.mjs` existe desde el 13 de septiembre de 2026 y se NIEGA a
 * lanzar si el puerto ya contesta: un `next start` huérfano responde al primer
 * intento, el laboratorio da el arranque por bueno y mide un build que no es el
 * suyo — y esa lectura equivocada culpa al PRODUCTO, no al laboratorio.
 *
 * Llegó sólo a dos de los doce. El 7 de octubre esa cobertura a medias produjo
 * un rojo de `headshot-shots` («4 filas sin subordinar») que al reproducirlo no
 * existía: el laboratorio había medido el build anterior servido por un
 * huérfano de `controles`. Es la enésima vez que un arreglo cubre una
 * superficie y no las otras, y la primera en la que el síntoma fue acusar al
 * producto de un fallo inventado.
 *
 * Así que la comprobación es la promesa: UNA definición del arranque.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";

const DIR = new URL("../tools/lab/", import.meta.url);
const LABS = readdirSync(DIR).filter((f) => f.endsWith(".mjs") && f !== "server.mjs");

test("hay laboratorios que mirar", () => {
  // El `conAjuste.length > 0`: con la lista vacía, los dos tests de abajo
  // pasarían sin comprobar un solo fichero.
  assert.ok(LABS.length >= 10, `sólo ${LABS.length} laboratorios encontrados`);
});

test("ningún laboratorio arranca su propio next start", () => {
  const culpables = [];
  for (const f of LABS) {
    const texto = readFileSync(new URL(f, DIR), "utf8");
    // Sin comentarios: la prosa que EXPLICA este fallo lo casa igual que el
    // código, y ya costó una versión en `Briefs.jsx` y otra en `reloj.mjs`.
    const codigo = texto
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, ""))
      .join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    if (/"next",\s*"start"/.test(codigo)) culpables.push(f);
  }
  assert.deepEqual(culpables, [],
    `${culpables.join(", ")} arrancan su propio servidor: medirían el build de otro`);
});

test("el que arranca se niega a usar un puerto ocupado", () => {
  /* LA CONDICIÓN, NO EL MENSAJE.
     La primera versión exigía que el texto «ya está ocupado» estuviera en el
     fichero. El simulacro sustituyó `if (await ocupado(base))` por `if (false)`
     —o sea, quitó la negativa entera— y siguió VERDE, porque el mensaje vive
     DENTRO del `throw` y el `throw` seguía ahí. Es «el nombre sigue
     apareciendo» por SEXTA vez en este repositorio, y la escribí sabiéndolo.
     Lo que decide si se comprueba el puerto es la condición. */
  const server = readFileSync(new URL("server.mjs", DIR), "utf8");
  const codigo = server
    .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  /* ANTES DEL SPAWN. Y esta es la SEGUNDA versión del arreglo: pedir
     `if (await ocupado(base))` en cualquier parte del fichero seguía pasando
     con la negativa quitada, porque el BUCLE DE ESPERA usa la misma llamada una
     docena de líneas más abajo. El patrón casaba otra ocurrencia — el mismo
     fallo que acabo de anotar, cometido en su propio arreglo. Lo que decide que
     no se mida el servidor de otro es que la comprobación y el `throw` ocurran
     ANTES de arrancar el proceso. */
  const antesDelSpawn = codigo.split("spawn(")[0];
  assert.match(antesDelSpawn, /await\s+ocupado\(\s*base\s*\)/,
    "server.mjs ya no comprueba el puerto ANTES de arrancar: es el mismo bucle "
    + "que se enganchaba al huérfano");
  assert.match(antesDelSpawn, /throw new Error\(/,
    "comprobar el puerto y no levantar es no comprobarlo");
  assert.match(codigo, /ya está ocupado/,
    "y el mensaje tiene que decir por qué, o la próxima vez se lee como un fallo del producto");
  assert.match(codigo, /detached: true/,
    "sin detached + kill del grupo, `next` sobrevive y se convierte en el huérfano");
});

test("todo laboratorio de navegador usa el arranque compartido", () => {
  const faltan = [];
  for (const f of LABS) {
    const texto = readFileSync(new URL(f, DIR), "utf8");
    // Sólo los que abren un navegador necesitan servidor.
    if (!texto.includes("browser.mjs")) continue;
    if (!texto.includes("startServer")) faltan.push(f);
  }
  assert.deepEqual(faltan, [],
    `${faltan.join(", ")} abren un navegador y no usan startServer`);
});
