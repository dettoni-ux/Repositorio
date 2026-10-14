/** Utilidades estadísticas para no declarar ganadores con muestras pequeñas. */

/** Intervalo de Wilson al 95 % para una proporción. */
export function wilson(successes: number, trials: number, z = 1.96): { low: number; high: number; p: number } | null {
  if (trials <= 0) return null;
  const p = successes / trials;
  const denom = 1 + (z * z) / trials;
  const center = (p + (z * z) / (2 * trials)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials))) / denom;
  return { p, low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

/** Prueba z de dos proporciones; devuelve el valor p bilateral. */
export function twoProportionP(s1: number, n1: number, s2: number, n2: number): number | null {
  if (n1 <= 0 || n2 <= 0) return null;
  const p = (s1 + s2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (se === 0) return null;
  const z = (s1 / n1 - s2 / n2) / se;
  return 2 * (1 - normCdf(Math.abs(z)));
}

/**
 * Compara tasas de conversión por unidad de gasto (proceso de Poisson):
 * condicionado al total, x1 ~ Binomial(x1+x2, e1/(e1+e2)). Valor p bilateral
 * con aproximación normal (exacto no es necesario para decisiones operativas).
 */
export function poissonRateP(x1: number, exposure1: number, x2: number, exposure2: number): number | null {
  const n = x1 + x2;
  if (n === 0 || exposure1 <= 0 || exposure2 <= 0) return null;
  const p0 = exposure1 / (exposure1 + exposure2);
  const se = Math.sqrt(n * p0 * (1 - p0));
  if (se === 0) return null;
  const z = (x1 - n * p0) / se;
  return 2 * (1 - normCdf(Math.abs(z)));
}

/**
 * Probabilidad de observar 0 conversiones con un gasto dado si el CPA real
 * fuera el objetivo: P(0) = exp(-gasto/CPA). Se usa para decidir si la falta
 * de resultados ya es evidencia o todavía es azar.
 */
export function probZeroConversionsAtTarget(spend: number, targetCpa: number): number | null {
  if (targetCpa <= 0) return null;
  return Math.exp(-spend / targetCpa);
}

export function confidenceFromP(p: number | null, n: number, minN: number): "baja" | "media" | "alta" {
  if (p === null || n < minN) return "baja";
  if (p < 0.01) return "alta";
  if (p < 0.1) return "media";
  return "baja";
}

/** CDF normal estándar (aproximación de Abramowitz-Stegun 7.1.26). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}
