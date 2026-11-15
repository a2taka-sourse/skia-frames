const IDENTITY = 'identity';
const CLAMP = 'clamp';
const EXTEND = 'extend';

const assertExtrapolate = (name, value) => {
  if (value !== IDENTITY && value !== CLAMP && value !== EXTEND) {
    throw new Error(
      `Invalid ${name} "${value}". Use "extend", "clamp" or "identity".`
    );
  }
};

const lerp = (from, to, progress) => from + (to - from) * progress;

/**
 * Remotion-style interpolate.
 *
 * Maps `input` from `inputRange` onto `outputRange`, supporting extrapolation
 * and an optional easing function applied to the normalized progress.
 */
export function interpolate(input, inputRange, outputRange, options = {}) {
  if (!Array.isArray(inputRange) || !Array.isArray(outputRange)) {
    throw new TypeError('inputRange and outputRange must be arrays');
  }
  if (inputRange.length !== outputRange.length) {
    throw new Error('inputRange and outputRange must have the same length');
  }
  if (inputRange.length < 2) {
    throw new Error('inputRange and outputRange must contain at least 2 values');
  }
  for (let i = 1; i < inputRange.length; i++) {
    if (inputRange[i] < inputRange[i - 1]) {
      throw new Error('inputRange must be monotonically non-decreasing');
    }
  }

  const {
    easing = Easing.linear,
    extrapolateLeft = EXTEND,
    extrapolateRight = EXTEND,
  } = options;
  assertExtrapolate('extrapolateLeft', extrapolateLeft);
  assertExtrapolate('extrapolateRight', extrapolateRight);

  const first = 0;
  const last = inputRange.length - 1;

  if (input < inputRange[first]) {
    if (extrapolateLeft === IDENTITY) return input;
    if (extrapolateLeft === CLAMP) return outputRange[first];
    const span = inputRange[1] - inputRange[0];
    const progress = span === 0 ? 1 : (input - inputRange[0]) / span;
    return lerp(outputRange[0], outputRange[1], easing(progress));
  }

  if (input > inputRange[last]) {
    if (extrapolateRight === IDENTITY) return input;
    if (extrapolateRight === CLAMP) return outputRange[last];
    const span = inputRange[last] - inputRange[last - 1];
    const progress = span === 0 ? 1 : (input - inputRange[last - 1]) / span;
    return lerp(outputRange[last - 1], outputRange[last], easing(progress));
  }

  for (let i = 1; i <= last; i++) {
    if (input > inputRange[i]) continue;
    const span = inputRange[i] - inputRange[i - 1];
    const progress = span === 0 ? 1 : (input - inputRange[i - 1]) / span;
    return lerp(outputRange[i - 1], outputRange[i], easing(progress));
  }

  return outputRange[last];
}

/**
 * Damped harmonic oscillator (Remotion-compatible spring). Returns 0 at
 * frame 0 and approaches 1 as the animation settles.
 */
export function spring({
  frame,
  fps,
  damping = 10,
  mass = 1,
  stiffness = 100,
}) {
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error('spring() requires a positive fps');
  }
  if (!(mass > 0)) throw new Error('spring() requires mass > 0');
  if (!(stiffness > 0)) throw new Error('spring() requires stiffness > 0');
  if (!(damping >= 0)) throw new Error('spring() requires damping >= 0');

  const t = Math.max(0, frame) / fps;
  const omega0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));

  if (zeta < 1) {
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
    return (
      1 -
      Math.exp(-zeta * omega0 * t) *
        (Math.cos(omegaD * t) + ((zeta * omega0) / omegaD) * Math.sin(omegaD * t))
    );
  }

  if (zeta === 1) {
    return 1 - Math.exp(-omega0 * t) * (1 + omega0 * t);
  }

  const s = Math.sqrt(zeta * zeta - 1);
  const r1 = -omega0 * (zeta - s);
  const r2 = -omega0 * (zeta + s);
  const c2 = -r1 / (r2 - r1);
  const c1 = 1 - c2;
  return 1 - (c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t));
}

export const Easing = {
  linear: (t) => t,
  inOutCubic: (t) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
};

export { lerp };
