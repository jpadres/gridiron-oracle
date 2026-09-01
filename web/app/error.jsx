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

import { useEffect } from "react";

export default function Error({ error, reset }) {
  useEffect(() => {
    // A la consola y no a un servicio: el sitio no tiene backend y no va a
    // adquirir uno para esto. Quien depure, lo tiene delante.
    console.error("Page failed to render:", error);
  }, [error]);

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
        Two things can cause this. Either the page failed while unpacking the model
        data — retrying fixes that — or the league setup saved in <em>this browser</em>{" "}
        is incomplete, and then retrying reads the same bad setup and fails again.
      </p>
      <p className="state-actions">
        <button type="button" className="retry" onClick={reset}>
          Retry
        </button>
        <button type="button" className="retry retry--alt" onClick={resetSetup}>
          Reset league setup on this device
        </button>
      </p>
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
