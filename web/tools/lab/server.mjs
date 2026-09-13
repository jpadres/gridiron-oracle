/**
 * EL SERVIDOR DE UN LABORATORIO, Y LA GARANTÍA DE QUE ES EL SUYO.
 *
 *     UN LABORATORIO QUE SE ENGANCHA AL SERVIDOR DE OTRO PRUEBA OTRA COSA.
 *
 * Cada laboratorio hacía `spawn("next start", -p SUYO)` y esperaba con un bucle
 * que rompía al primer `fetch` que respondiera. Eso es correcto mientras el
 * puerto esté libre, y MIENTE cuando no: si un `next start` viejo quedó
 * escuchando ahí, el laboratorio lo encuentra al primer intento, da el arranque
 * por bueno y mide un BUILD QUE NO ES EL SUYO.
 *
 * Pasó el 13 de septiembre de 2026. Un `reloj.mjs` anterior dejó su servidor
 * vivo, después se recompiló `.next` por debajo, y el proceso viejo empezó a
 * servir trozos inconsistentes: `/betting` salía sin `.bk-head` y el
 * laboratorio lo reportó como «la página no carga» con el producto SANO. Es el
 * fallo del doble que miente en un campo, aplicado al servidor en vez de a los
 * datos — y la lectura equivocada culpa al producto.
 *
 * Así que el puerto se comprueba ANTES: si algo responde, no se adivina de quién
 * es, se para con un mensaje que lo dice. Fallar ruidosamente cuesta un minuto;
 * medir el build de otro cuesta una hipótesis equivocada.
 */
import { spawn } from "node:child_process";

/** ¿Contesta algo en este puerto? */
async function ocupado(base) {
  try {
    await fetch(base, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Arranca `next start` en `port` y devuelve `{ base, stop }`.
 *
 * `cwd` es la raíz de la web. Lanza si el puerto está ocupado o si el servidor
 * no llega a contestar.
 */
export async function startServer({ port, cwd, timeoutMs = 60000 }) {
  const base = `http://127.0.0.1:${port}`;
  if (await ocupado(base)) {
    throw new Error(
      `El puerto ${port} ya está ocupado. Este laboratorio mediría OTRO servidor `
      + `—probablemente un 'next start' que quedó vivo— y su resultado no diría `
      + `nada de este build. Mátalo y vuelve a lanzar.`
    );
  }
  // Detached + matar el GRUPO: `kill()` sobre `npx` deja a `next` escuchando, que
  // es exactamente cómo aparece el servidor huérfano que este módulo existe para
  // no confundir con el propio.
  const proc = spawn("npx", ["next", "start", "-p", String(port)],
                     { cwd, stdio: "ignore", detached: true });
  const stop = () => { try { process.kill(-proc.pid); } catch { /* ya no está */ } };
  process.on("exit", stop);

  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    if (await ocupado(base)) return { base, stop };
    await new Promise((r) => setTimeout(r, 400));
  }
  stop();
  throw new Error(`El servidor de este laboratorio no contestó en ${timeoutMs} ms`);
}
