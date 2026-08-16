import { Callout } from "../ui.jsx";

export const metadata = {
  title: "Gridiron Oracle — el modelo",
  description: "Qué hace distinto a este modelo, y qué decisiones metodológicas lo sostienen.",
};

export default function Modelo() {
  return (
    <>
      <h1>El modelo</h1>
      <p className="lede">
        Siete decisiones que separan esto de un Elo con adornos. Ninguna es gratis: cada una
        se eligió midiendo, y varias empeoraron el resultado antes de mejorarlo.
      </p>

      <h2>1. Distribución discreta con números clave, no una normal</h2>
      <p>
        El margen en la NFL no es continuo. Se acumula brutalmente en 3 y en 7, porque así es
        como se puntúa. Convertir «margen esperado 2.8» en probabilidad con una normal comete
        errores grandes y <em>sistemáticos</em> justo en las líneas donde se juega el dinero.
      </p>
      <p>
        La densidad se factoriza como <code>P(margen = k) ∝ w(k) · N(k; pred, σ)</code>, donde{" "}
        <code>w(k)</code> es el cociente entre la frecuencia observada de cada margen y su
        versión suavizada por kernel. Sale ~1.9 en k=3, ~1.5 en k=7 y ~0.55 en k=2 y k=5,{" "}
        <strong>sin que nadie se lo diga</strong>. Que aparezca sin pedirlo es la comprobación
        de que mide algo real, y de ahí salen probabilidades de <em>push</em> correctas.
      </p>

      <h2>2. Parametrización sobre el residuo del mercado</h2>
      <p>
        El modelo de producción no predice el margen con la línea como una feature más. Predice{" "}
        <code>margen − línea</code>: en qué se equivoca el mercado. El objetivo tiene media casi
        cero, así que la regularización empuja por defecto hacia «el mercado tiene razón» y sólo
        se separa con evidencia. Es la diferencia entre un modelo que respeta al mercado y uno
        que pelea con él por ruido.
      </p>

      <h2>3. Ratings de eficiencia ajustados por rival, en línea</h2>
      <p>
        El EPA bruto mide resultado, no calidad: un ataque con 0.15 EPA/jugada puede ser bueno o
        haber jugado contra las tres peores defensas de la liga. El ajuste es iterativo y online,
        sin mirar al futuro, con encogimiento por partidos jugados (la semana 1 no puede tener
        opiniones fuertes) y arrastre parcial entre temporadas.
      </p>

      <h2>4. El quarterback como corrección explícita</h2>
      <p>
        Ningún rating de equipo captura que el titular ha cambiado.{" "}
        <code>qb_vs_offense</code> mide la diferencia entre el rating del QB anunciado y el nivel
        reciente del ataque: captura suplentes y lesiones sin necesidad de un feed de partes
        médicos de pago. En la NFL eso vale entre 2 y 7 puntos de spread.
      </p>

      <h2>5. Ventaja local adaptativa</h2>
      <p>
        La ventaja local cayó de ~2.7 puntos a mediados de los 2000 a ~1.5 en 2020-22, y ha
        vuelto a subir. Fijarla en una constante es un error sistemático de medio punto durante
        temporadas enteras, así que se estima de forma recursiva a partir de los residuos de los
        partidos en casa.
      </p>

      <h2>6. Viaje, husos horarios y altitud reales</h2>
      <p>
        Coordenadas de las 32 sedes más las internacionales (Wembley, Tottenham, Azteca, Múnich,
        São Paulo, Dublín, Madrid, Melbourne, Berlín). Distancia haversine, cambio de huso
        horario <em>con signo</em> —viajar al este pesa más que al oeste— y desnivel de altitud
        respecto a la sede propia: Denver no tiene ventaja por jugar alto, la tiene por jugar más
        alto que el rival.
      </p>

      <h2>7. Validación walk-forward, sin excepciones</h2>
      <p>
        No hay validación cruzada aleatoria en este proyecto. Barajar partidos de 2015 y 2023 en
        el mismo fold filtra futuro a través de los ratings de equipo y sobreestima el
        rendimiento de forma masiva. Para predecir la temporada S sólo se usan temporadas
        anteriores: modelo, distribución, calibración y pesos de ensamblado se reajustan en cada
        paso.
      </p>

      <Callout title="El error que ya se cometió, y cómo está corregido">
        <p>
          Durante el desarrollo, los pesos del ensamblado se ajustaban con las predicciones de
          los componentes <em>dentro de muestra</em>: la fuga de stacking clásica. Costaba 0,6
          puntos de MAE y hacía que el modelo combinado fuese <strong>peor que cualquiera de sus
          partes</strong> — que es la señal de alarma más clara que existe.
        </p>
        <p>
          Está corregido con cross-fitting temporal: las predicciones con las que se ajustan los
          pesos se generan por bloques temporales disjuntos y en ventana expansiva. Nunca en
          muestra, y nunca con futuro.
        </p>
      </Callout>

      <h2>Gestión de riesgo</h2>
      <p>
        El módulo de apuestas usa Kelly fraccionado (0.25) <strong>más</strong> un encogimiento
        explícito del 50% del edge estimado, tope duro del 2% del bankroll por apuesta y umbral
        mínimo de edge del 1.5%. Kelly completo con probabilidades estimadas produce drawdowns
        del 60-80%: no es una opción defendible.
      </p>
      <p>
        El de-vig usa el método de Shin, no la normalización proporcional. Las cuotas de los no
        favoritos sobrestiman su probabilidad real, y en moneylines desequilibradas la diferencia
        entre ambos métodos es de 1-2 puntos porcentuales — exactamente el tamaño del edge que se
        busca detectar.
      </p>
    </>
  );
}
