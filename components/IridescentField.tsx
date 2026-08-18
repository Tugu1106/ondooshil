'use client';

import { useEffect, useRef, useState } from 'react';

import { runFullscreenShader } from '@/lib/client/gl';

import styles from './IridescentField.module.css';

/**
 * The Iridescent theme's background: a ribbon of refracted light flowing down a pale field.
 *
 * **Generated, not warped.** Distorting a reference image was the other option, but a
 * procedural field flows forever with no seam, no smear at the edges, and no image to
 * ship — and it resizes to any viewport instead of being stretched to it.
 *
 * The look decomposes into four parts, which is all the shader below is:
 *
 * 1. A soft blue-to-lavender field with slow cloudy variation.
 * 2. An S-curve running top to bottom. Two sine waves at unrelated rates plus low
 *    frequency noise — one sine alone reads unmistakably as a sine.
 * 3. Thin-film banding keyed on the *distance* to that curve, through a cosine palette.
 *    This is the part that reads as iridescence rather than as a rainbow: the colour is a
 *    function of how far off the ribbon you are, exactly as film thickness works.
 * 4. A white-hot core along the curve, and two warm blooms.
 *
 * Plus grain, which is not decoration — eight-bit displays band visibly across gradients
 * this wide, and a little noise is what hides it.
 */

const FRAGMENT_SOURCE = `
/* highp is optional in a WebGL1 fragment shader. Asking for it unconditionally is how a
   shader fails to compile on an older laptop GPU and nothing renders at all. */
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 uResolution;
uniform float uTime;

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

/* Gradient noise. Cheap, smooth, and good enough under this much blur. */
float gnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(dot(hash2(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0)),
        dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
    mix(dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
        dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x),
    u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * gnoise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}

/*
 * Cosine palette. Full spectrum, then lifted hard toward white — a saturated rainbow reads
 * as a pride flag, and what this needs is pale light bent through something.
 */
vec3 spectrum(float t) {
  vec3 c = 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
  return mix(c, vec3(1.0), 0.34);
}

/* Where the ribbon sits at a given height. */
float ribbonX(float y, float t) {
  float x = 0.5;
  x += sin(y * 2.6 + t * 0.16) * 0.17;
  x += sin(y * 1.3 - t * 0.10) * 0.09;
  x += fbm(vec2(y * 1.4, t * 0.045)) * 0.14;
  return x;
}

void main() {
  vec2 frag = gl_FragCoord.xy / uResolution;

  /* Aspect-corrected, so the noise does not stretch into streaks on a wide monitor. */
  vec2 p = vec2(frag.x * (uResolution.x / uResolution.y), frag.y);
  float t = uTime;

  /* --- the field the ribbon sits in --- */
  float cloud = fbm(p * 1.6 + vec2(t * 0.020, t * 0.015));

  vec3 high = vec3(0.62, 0.73, 0.94);
  vec3 low = vec3(0.85, 0.83, 0.94);
  vec3 color = mix(low, high, frag.y);
  color = mix(color, vec3(0.72, 0.85, 0.97), 0.30 + 0.35 * cloud);
  /* A pink wash gathering at the bottom, as in the reference. */
  color = mix(color, vec3(0.96, 0.86, 0.93), (1.0 - smoothstep(0.0, 0.55, frag.y)) * 0.38);

  /* --- the ribbon --- */
  float d = frag.x - ribbonX(frag.y, t);
  float ad = abs(d);

  /*
   * The band index is the signed distance, warped so the bands are not parallel rules.
   * Drifting t through it is what makes the colours travel along the ribbon.
   */
  float band = d * 7.0 + fbm(p * 2.2 + t * 0.05) * 0.9 + t * 0.02;
  vec3 iri = spectrum(band);

  float glow = exp(-ad * 7.0);
  float core = exp(-ad * 30.0);
  float hot = exp(-ad * 95.0);

  color = mix(color, iri, glow * 0.55);
  color = mix(color, iri * 1.05, core * 0.60);
  color = mix(color, vec3(1.0), hot * 0.78);

  /* --- blooms, where the light gathers --- */
  color = mix(color, vec3(1.0, 0.98, 0.93), exp(-distance(frag, vec2(0.56, 0.86)) * 7.0) * 0.55);
  color = mix(color, vec3(1.0, 0.97, 0.95), exp(-distance(frag, vec2(0.30, 0.96)) * 12.0) * 0.30);

  /* --- grain, so a gradient this wide does not band on an 8-bit panel --- */
  float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  color += (grain - 0.5) * 0.022;

  gl_FragColor = vec4(color, 1.0);
}
`;

export default function IridescentField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const run = runFullscreenShader(canvas, FRAGMENT_SOURCE, {
      // A blurred gradient gains nothing from native resolution or from 60fps, and this
      // page is already streaming video on an office connection.
      resolutionScale: 0.5,
      fps: 30,
      still,
    });

    if (!run) {
      // No WebGL, or a driver that refused. The CSS underneath stands in.
      setFailed(true);
      return;
    }
    return () => run.destroy();
  }, []);

  return (
    <div className={styles.field} data-fallback={failed} aria-hidden>
      <canvas ref={canvasRef} className={styles.canvas} />
    </div>
  );
}
