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

const CONTAINER = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

export function chromiumPath() {
  const wanted = process.env.PW_CHROMIUM;
  if (wanted) {
    if (!existsSync(wanted)) throw new Error(`PW_CHROMIUM apunta a ${wanted} y no existe`);
    return wanted;
  }
  return existsSync(CONTAINER) ? CONTAINER : undefined;
}

export async function launch(options = {}) {
  const executablePath = chromiumPath();
  return chromium.launch(executablePath ? { executablePath, ...options } : options);
}
