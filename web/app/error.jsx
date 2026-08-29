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
    console.error("Fallo al renderizar la página:", error);
  }, [error]);

  return (
    <div className="state">
      <h1>Esta página no se pudo mostrar</h1>
      <p>
        El fallo está en el sitio, no en tu conexión. Los datos del modelo viajan
        dentro de la página, así que reintentar suele bastar: si el problema fue al
        descomprimir el payload, la segunda vez funciona.
      </p>
      <p>
        <button type="button" className="retry" onClick={reset}>
          Reintentar
        </button>
      </p>
      <p className="caption">
        Si se repite, es que el payload publicado está corrupto y hay que regenerarlo
        con <code>scripts/export_web_data.py</code>. El resto de las páginas deberían
        seguir funcionando.
      </p>
    </div>
  );
}
