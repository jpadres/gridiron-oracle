import "./globals.css";
// DESPUÉS de globals.css a propósito: `system.css` redirige los tokens de la
// Fase 1 a la paleta de campo, y para eso tiene que ganar la cascada.
import "./system.css";

// El color de la barra del navegador en móvil. Sin esto, Safari y Chrome pintan
// su propio gris encima de la cabecera y el sitio parece recortado.
export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#101216" },
  ],
};

export const metadata = {
  title: "Gridiron Oracle",
  description:
    "NFL forecasting model and fantasy rankings built on public data, with walk-forward validation and results reported without spin.",
};

// Las páginas del MENÚ. Todas estáticas, con los datos horneados.
//
// Trece secciones eran demasiadas para un menú y dos sobraban por motivos
// distintos:
//
//   - `/validacion` se fusionó dentro de `/modelo`: explicar una decisión y
//     publicar el número que la juzga son la misma lectura, y separadas
//     obligaban a saltar de una a otra para contrastar cada afirmación.
//   - `/fantasy/leagues` SIGUE EXISTIENDO y no ha perdido nada — simplemente ya
//     no hace falta buscarla en el menú: la barra de liga la enlaza («All
//     leagues») desde el semanal, el resto de temporada y el analizador, que
//     son las tres pantallas desde las que se quiere cambiar de liga.
//
// Una pantalla que no está en el menú NI enlazada desde ninguna parte no la
// encuentra nadie: es lo que le pasó al resto de temporada dentro del semanal.
// El laboratorio de humo comprueba las dos cosas.
const PAGES = [
  { href: "/", label: "Overview" },
  { href: "/modelo", label: "Model" },
  { href: "/predicciones", label: "Predictions" },
  { href: "/betting", label: "Betting" },
  // «Draft» y «Room» no decían qué hacía cada una: las dos son del draft y una
  // se llamaba por su mueble. Ahora se nombran por su trabajo — el board es
  // valor por liga, el asistente es la pantalla que se mira DURANTE el draft.
  { href: "/fantasy", label: "Board" },
  { href: "/fantasy/draft", label: "Draft Assistant" },
  { href: "/fantasy/semanal", label: "Weekly" },
  { href: "/fantasy/resto", label: "Rest of Season" },
  { href: "/fantasy/analisis", label: "Analyzer" },
  { href: "/survivor", label: "Survivor" },
  { href: "/research", label: "Research" },
];

/**
 * Sello de build: qué commit sirve esta página y cuándo se horneó.
 *
 * No es telemetría ni adorno. Sin esto, «no veo lo nuevo» y «lo estoy viendo
 * cacheado» son indistinguibles desde fuera — y esa duda costó tres rondas de
 * verificación contra la API de Vercel sin poder concluir nada, porque el
 * servidor y el navegador estaban mirando cosas distintas y la página no decía
 * cuál. Es el mismo motivo por el que las tarjetas de la portada llevan la
 * fecha del último barrido: un dato que no dice de cuándo es no sirve para
 * decidir.
 *
 * Aquí SÍ va un reloj de pared, al revés que en `out/research.json`, donde se
 * quitó a propósito. La diferencia es que aquel fichero **se versiona** y su
 * marca de tiempo hacía que el payload cambiase cada día aunque el contenido
 * fuese idéntico, llenando el repo de commits de ruido. Esto no se versiona: se
 * calcula en cada build y muere en el HTML generado. No hay nada que ensuciar.
 *
 * Las variables las pone Vercel en build time. En local no existen y sale
 * «local», que es exactamente lo que hay que ver en local.
 */
function BuildStamp() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  const built = new Date().toLocaleString("en-US", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false,
  });
  return (
    <p className="build">
      Build <code>{sha ? sha.slice(0, 7) : "local"}</code> · built {built} UTC
    </p>
  );
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {/* Primer tabulador de la página. Sin esto, llegar al contenido con
            teclado exige pasar por los ocho enlaces del menú en cada carga. */}
        <a className="skip" href="#contenido">Skip to content</a>
        <div className="shell">
          {/* DOS PRESENTACIONES DEL MISMO MENÚ, una lista sola.
              En escritorio caben las doce secciones en dos líneas y se enseñan.
              En el teléfono no: en una tira que se desplaza las cinco últimas
              quedaban a tres arrastres y en la práctica no existían —de ahí
              «no encuentro el resto de temporada»—, y desplegadas costaban 187
              px de cromo ANTES del título en todas las páginas, lo que sacaba
              del primer viewport la lista de candidatos del asistente, que es
              la pantalla que se mira contra reloj. Un desplegable cuesta una
              línea y deja todo a un toque.

              Se pintan las dos y CSS enseña una: los enlaces salen del MISMO
              array, así que no pueden divergir. Es la lección de los dos
              traductores aplicada a la navegación. Sin JavaScript: `<details>`
              es HTML, y estas ocho páginas son estáticas. */}
          <nav className="top" aria-label="Sections">
            <span className="brand">Gridiron Oracle</span>
            <span className="top-links">
              {PAGES.map((page) => (
                <a key={page.href} href={page.href}>{page.label}</a>
              ))}
            </span>
            <details className="top-menu">
              <summary aria-label="Sections menu">Sections</summary>
              <span className="top-menu-links">
                {PAGES.map((page) => (
                  <a key={page.href} href={page.href}>{page.label}</a>
                ))}
              </span>
            </details>
          </nav>
          <main id="contenido" tabIndex={-1}>{children}</main>
          <footer>
            <p>
              Data from nflverse (public domain). Code under the MIT license. A sports
              research and analysis project: none of this is financial advice, and betting
              carries a risk of loss.
            </p>
            <p>
              Static site: no accounts, no database. The only network requests at runtime
              go to Sleeper: its public API for the draft sync and the linked-account view on
              Leagues, only if you turn them on, and its CDN for player photos on the fantasy
              pages. Nothing else is requested.
            </p>
            <BuildStamp />
          </footer>
        </div>
      </body>
    </html>
  );
}
