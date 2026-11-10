/**
 * UN SOLO sitio que sabe dónde está Chromium.
 *
 * Los laboratorios llevaban la ruta del contenedor de desarrollo escrita a
 * mano en 26 ficheros, y CI no la tiene: `npx playwright install chromium`
 * deja el navegador en la caché de Playwright. Se prueba en orden: la ruta
 * que diga `PW_CHROMIUM`, la del contenedor si existe, y si no, el que
 * Playwright resuelva solo. Sin `|| true`, sin silencios: si no hay navegador,
 * el laboratorio falla diciendo por qué.
 */
import { existsSync } from "node:fs";
import { chromium } from "playwright";

/* LAS RUTAS DEL CONTENEDOR, EN ORDEN. La primera es la ESTABLE: el entorno la
   publica sin número de versión y sobrevive a que cambien el Chromium. La
   segunda era la única que había —con la revisión escrita— y dejó de existir
   el día que el contenedor pasó a otra: `launch()` caía entonces al Chromium
   por defecto de Playwright, que aquí no está instalado, y los 28 laboratorios
   fallaban con «Executable doesn't exist» sin que ninguno estuviera roto. Una
   ruta con versión dentro es una fecha escrita a mano. */
const CONTAINER = [
  "/opt/pw-browsers/chromium",
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
];

export function chromiumPath() {
  const wanted = process.env.PW_CHROMIUM;
  if (wanted) {
    if (!existsSync(wanted)) throw new Error(`PW_CHROMIUM apunta a ${wanted} y no existe`);
    return wanted;
  }
  // Ninguna: `undefined` deja a Playwright usar el suyo, que es lo que pasa
  // en CI (`npx playwright install`).
  return CONTAINER.find((ruta) => existsSync(ruta));
}

export async function launch(options = {}) {
  const executablePath = chromiumPath();
  return chromium.launch(executablePath ? { executablePath, ...options } : options);
}
