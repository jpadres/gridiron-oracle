/**
 * LOS LABORATORIOS QUE CI EXIGE, uno detrás de otro, con la puerta bien puesta.
 *
 * Corre los laboratorios de navegador deterministas contra un `next start`
 * ya construido y falla si CUALQUIERA falla. Y falla también por lo que un
 * laboratorio roto no diría solo:
 *
 *   · cero comprobaciones ejecutadas (un selector que ya no casa con nada,
 *     una página que no cargó): «0 ok, 0 FALLA» es rojo, no verde;
 *   · una excepción del propio laboratorio (código de salida distinto de 0
 *     sin línea de veredicto);
 *   · un veredicto que no sea TODO VERDE / SIN FALLOS.
 *
 * No hay `|| true`. Lo que se ejecuta por commit es lo crítico y determinista;
 * el resto va en `labs-nightly.yml` (ver docs/CI.md).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// `minChecks` es la MITAD de lo que cada laboratorio ejecuta cuando la página
// carga (medido el 2026-09-05: 63 / 42 / 21 / 168 / 16). Por debajo de eso no es
// que haya menos que comprobar: es que algo no cargó, y eso es rojo.
const REQUIRED = [
  // Draft Assistant (board + Draft Room con cuenta), fotos, marcas de estado
  { file: "headshot-shots.mjs", minChecks: 30 },
  // las doce páginas en 390/768/1440: responden, h1, sin desbordes, menús
  { file: "smoke.mjs", minChecks: 20 },
  // betting: NO BET dicho y con motivo, signo del handicap, plan de la semana
  { file: "apuestas.mjs", minChecks: 10 },
  // geometría móvil en las rutas críticas, claro/oscuro
  { file: "movil.mjs", minChecks: 80 },
  // control por control, con y sin cuenta: nombres, 44 px, deshabilitados
  { file: "controles.mjs", minChecks: 8 },
];
const only = (process.env.LABS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

let failed = 0;
for (const lab of REQUIRED) {
  if (only.length && !only.includes(lab.file)) continue;
  const t0 = Date.now();
  const run = spawnSync("node", [path.join(HERE, lab.file)], {
    env: { ...process.env, SKIP_BUILD: "1" }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  const out = (run.stdout ?? "") + (run.stderr ?? "");
  const oks = (out.match(/^\s*ok\s/gm) ?? []).length;
  const fails = (out.match(/^\s*FALL[AO]/gm) ?? []).length;
  const verdict = /TODO VERDE|SIN FALLOS/.test(out);
  const secs = Math.round((Date.now() - t0) / 1000);
  let status = "ok";
  if (run.status !== 0) status = `exit ${run.status}`;
  else if (fails > 0) status = `${fails} FALLA`;
  else if (!verdict) status = "sin veredicto";
  else if (oks < lab.minChecks) status = `sólo ${oks} comprobaciones (mínimo ${lab.minChecks}): ¿no cargó nada?`;
  if (status !== "ok") failed += 1;
  console.log(`${status === "ok" ? "ok   " : "FALLA"} ${lab.file.padEnd(22)} ${oks} ok · ${fails} falla · ${secs}s${status === "ok" ? "" : " · " + status}`);
  if (status !== "ok") console.log(out.split("\n").filter((l) => /FALL|Error|error/.test(l)).slice(0, 12).map((l) => "      " + l).join("\n"));
}
console.log(failed ? `\n${failed} LABORATORIO(S) EN ROJO` : "\nTODO VERDE");
process.exit(failed ? 1 : 0);
