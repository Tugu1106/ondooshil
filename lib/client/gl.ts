'use client';

/**
 * A minimal fullscreen-quad WebGL runner.
 *
 * No library. A background is one fragment shader over two triangles, and three.js or OGL
 * would be several hundred kilobytes to do that — on a page whose whole point is to stream
 * audio on an office connection.
 *
 * Everything here is built for a background rather than for a scene: half resolution, a
 * frame cap, no depth or stencil buffer, and it stops entirely when the tab is hidden.
 * Nobody is looking closely at this, and the YouTube iframe next to it has the real work
 * to do.
 *
 * `null` on any failure — no WebGL, a driver that refuses, a shader that will not compile.
 * The caller falls back to CSS. A background must never be able to break the station.
 */

const VERTEX_SOURCE = `
attribute vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

type Options = {
  /** Fraction of device pixels to render at. Backgrounds do not need 1:1. */
  resolutionScale?: number;
  /** Frame cap. 30 is indistinguishable from 60 for something this slow. */
  fps?: number;
  /** Draw one frame and stop — what `prefers-reduced-motion` gets. */
  still?: boolean;
};

export type ShaderRun = { destroy: () => void };

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    // Worth seeing while iterating on the shader; harmless in production.
    console.warn('shader failed to compile:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function runFullscreenShader(
  canvas: HTMLCanvasElement,
  fragmentSource: string,
  options: Options = {},
): ShaderRun | null {
  const { resolutionScale = 0.5, fps = 30, still = false } = options;

  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: 'low-power',
  });
  if (!gl) return null;

  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();

  if (!vertex || !fragment || !program) return null;

  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('shader failed to link:', gl.getProgramInfoLog(program));
    return null;
  }

  gl.useProgram(program);

  // Two triangles covering clip space. The vertex shader does nothing else.
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );

  const position = gl.getAttribLocation(program, 'aPosition');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const uResolution = gl.getUniformLocation(program, 'uResolution');
  const uTime = gl.getUniformLocation(program, 'uTime');

  function resize() {
    // Capped device pixel ratio: a 3x phone screen would otherwise render nine times
    // the pixels for a blurred gradient.
    const ratio = Math.min(window.devicePixelRatio || 1, 2) * resolutionScale;
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));

    if (canvas.width === width && canvas.height === height) return;

    canvas.width = width;
    canvas.height = height;
    gl!.viewport(0, 0, width, height);
  }

  let frame = 0;
  let stopped = false;
  const started = performance.now();
  let lastDraw = 0;
  const minInterval = 1000 / fps;

  function draw(elapsedMs: number) {
    resize();
    gl!.uniform2f(uResolution, canvas.width, canvas.height);
    gl!.uniform1f(uTime, elapsedMs / 1000);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
  }

  function loop(now: number) {
    if (stopped) return;
    frame = requestAnimationFrame(loop);

    if (now - lastDraw < minInterval) return;
    lastDraw = now;
    draw(now - started);
  }

  // A hidden tab has its rAF throttled anyway; stopping outright also drops the GPU work.
  function onVisibility() {
    if (stopped || still) return;
    if (document.visibilityState === 'visible') {
      if (!frame) frame = requestAnimationFrame(loop);
    } else if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  }

  if (still) {
    draw(0);
  } else {
    frame = requestAnimationFrame(loop);
    document.addEventListener('visibilitychange', onVisibility);
  }

  window.addEventListener('resize', resize);

  return {
    destroy() {
      stopped = true;
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);

      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      // Frees the drawing buffer immediately rather than at the next GC.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
