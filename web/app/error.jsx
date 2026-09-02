"use client";

/**
 * Qué se ve cuando una página falla.
 *
 * Sin esto, un fallo cae a la pantalla genérica de Next.js: fondo blanco,
 * «Application error», y ninguna pista de qué hacer. Para una herramienta que se
 * consulta veinte minutos antes de un kickoff, eso es peor que un error — es un
 * callejón sin salida.
 *
 * Tiene que ser componente de cliente: React necesita un límite de error real, y
 * los límites de error no existen en el servidor.
 */

import { useEffect, useState } from "react";

/**
 * Lo que se enseña del error: mensaje y las primeras líneas de la pila.
 *
 * Antes la página escondía la excepción y sólo la mandaba a la consola, así
 * que un fallo que dependía del estado guardado en UN navegador era imposible
 * de diagnosticar desde fuera: el dueño veía «could not load» y nadie más
 * veía nada. El sitio no tiene backend al que mandarlo; lo que sí puede es
 * enseñarlo y dejar copiarlo.
 */
function details(error) {
  const message = String(error?.message ?? error ?? "unknown error");
  const stack = String(error?.stack ?? "").split("\n").slice(1, 7).join("\n");
  const digest = error?.digest ? `digest ${error.digest}` : "";
  return [message, digest, stack].filter(Boolean).join("\n");
}

export default function Error({ error, reset }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    // A la consola y no a un servicio: el sitio no tiene backend y no va a
    // adquirir uno para esto. Quien depure, lo tiene delante.
    console.error("Page failed to render:", error);
  }, [error]);

  const copy = async () => {
    const text = `${details(error)}\nbuild ${process.env.NEXT_PUBLIC_BUILD_SHA ?? ""} · ${window.location.pathname}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  /**
   * La segunda salida, que faltaba.
   *
   * Este texto sólo contaba UNA causa —el payload— y por tanto sólo ofrecía
   * reintentar. Pero las pantallas de draft derivan todo de lo que hay en ESTE
   * navegador, así que una configuración de liga a medias las tumba igual, y
   * ahí «Retry» vuelve a leer lo mismo y vuelve a fallar: un botón que no puede
   * funcionar es peor que ninguno, porque hace perder el tiempo que no hay.
   *
   * Se borran la liga activa y las preferencias —baratas de volver a teclear— y
   * NO los picks registrados: perder el draft a medias para arreglar un menú
   * sería cambiar un problema por otro peor.
   */
  const resetSetup = () => {
    try {
      window.localStorage.removeItem("gridiron-room-league-v1");
      window.localStorage.removeItem("gridiron-draft-prefs-v1");
    } catch { /* modo privado: no había nada que borrar */ }
    window.location.reload();
  };

  return (
    <div className="state">
      <h1>This page could not load</h1>
      <p>
        Three things can cause this. The page failed while unpacking the model data —
        retrying fixes that. The league setup saved in <em>this browser</em> is
        incomplete — then retrying reads the same bad setup and fails again. Or this
        browser blocks site storage (Chrome with all cookies blocked, a company policy,
        some private modes) — the details below say <code>SecurityError</code>; allow
        storage for this site or use another browser.
      </p>
      <p className="state-actions">
        <button type="button" className="retry" onClick={reset}>
          Retry
        </button>
        <button type="button" className="retry retry--alt" onClick={resetSetup}>
          Reset league setup on this device
        </button>
      </p>
      <details className="state-details" open>
        <summary>What failed</summary>
        <pre>{details(error)}</pre>
        <button type="button" className="link" onClick={copy}>
          {copied ? "copied" : "copy details"}
        </button>
      </details>
      <p className="caption">
        Resetting clears your league settings and Sleeper connection on this device
        only — <strong>recorded picks are kept</strong>, and you can set the league up
        again in under a minute. Every other page should still work; if they are all
        broken, the published payload needs regenerating with{" "}
        <code>scripts/export_web_data.py</code>.
      </p>
    </div>
  );
}
