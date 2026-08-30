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

  return (
    <div className="state">
      <h1>This page could not load</h1>
      <p>
        The problem is on our side, not your connection. The model data ships inside
        the page itself, so retrying usually works: if it failed while unpacking the
        payload, the second attempt goes through.
      </p>
      <p>
        <button type="button" className="retry" onClick={reset}>
          Retry
        </button>
      </p>
      <p className="caption">
        If it keeps happening the published payload is corrupt and needs regenerating
        with <code>scripts/export_web_data.py</code>. Every other page should still
        work.
      </p>
    </div>
  );
}
