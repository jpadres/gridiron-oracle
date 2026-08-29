/**
 * Lo que se ve mientras carga una página.
 *
 * Las ocho páginas son estáticas y se sirven prerrenderizadas, así que en la
 * práctica esto casi nunca aparece: sólo en la primera navegación con la red
 * lenta. Existe igualmente porque su ausencia es visible —un salto en blanco— y
 * porque el día que una ruta deje de ser estática, ya está.
 *
 * Es un esqueleto y no un texto de «cargando»: reserva la altura aproximada del
 * contenido y evita que la página salte cuando llega. Un mensaje centrado no
 * reserva nada.
 */
export default function Loading() {
  return (
    <div className="skeleton" aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando…</span>
      <div className="sk sk--title" />
      <div className="sk sk--lede" />
      <div className="sk sk--block" />
      <div className="sk sk--row" />
      <div className="sk sk--row" />
      <div className="sk sk--row" />
    </div>
  );
}
