"use client";

import { useEffect, useRef } from "react";

interface SmartOrbProps {
  volume?: number;
  features?: {
    energy: number;
    bass: number;
    mid: number;
    treble: number;
    centroid: number;
    onset: number;
  };
  status?: "idle" | "listening" | "thinking" | "speaking";
  compact?: boolean;
}

const vertexShaderSource = `
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const fragmentShaderSource = `
precision highp float;

varying vec2 v_uv;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_volume;
uniform vec4 u_bands;
uniform float u_onset;
uniform float u_status;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p *= 2.02;
    a *= 0.52;
  }
  return v;
}

vec3 palette(float t, float status) {
  vec3 cyan = vec3(0.22, 0.96, 1.0);
  vec3 mint = vec3(0.54, 1.0, 0.78);
  vec3 violet = vec3(0.55, 0.32, 1.0);
  vec3 rose = vec3(1.0, 0.34, 0.82);
  vec3 amber = vec3(1.0, 0.74, 0.24);
  vec3 white = vec3(1.0);

  vec3 active = mix(cyan, violet, smoothstep(0.28, 0.92, t));
  active = mix(active, rose, smoothstep(0.55, 0.82, t) * 0.55);
  active = mix(active, white, exp(-pow((t - 0.5) * 7.0, 2.0)) * 0.45);

  vec3 thinking = mix(violet, rose, smoothstep(0.18, 0.82, t));
  thinking = mix(thinking, amber, exp(-pow((t - 0.32) * 6.0, 2.0)) * 0.3);

  vec3 speaking = mix(mint, cyan, smoothstep(0.18, 0.72, t));
  speaking = mix(speaking, rose, smoothstep(0.58, 0.92, t) * 0.32);

  vec3 idle = mix(vec3(0.5, 0.68, 0.78), vec3(0.28, 0.2, 0.55), smoothstep(0.3, 0.9, t));

  vec3 color = mix(idle, active, step(0.5, status));
  color = mix(color, thinking, step(1.5, status) * (1.0 - step(2.5, status)));
  color = mix(color, speaking, step(2.5, status));
  return color;
}

float waveCurve(vec2 p, float layer, float amp, float freq, float speed) {
  float envelope = exp(-pow(abs(p.x) * 1.42, 2.0));
  float detail = fbm(vec2(p.x * 2.0 + layer * 7.0, u_time * 0.18 + layer));
  float phase = u_time * speed + layer * 2.3;
  float y =
    sin(p.x * freq + phase) * amp +
    sin(p.x * (freq * 0.53) - phase * 0.8) * amp * 0.52 +
    (detail - 0.5) * amp * 0.72;
  return y * envelope;
}

float ribbonField(vec2 p, float layer, float energy) {
  float envelope = exp(-pow(abs(p.x) * (0.9 + layer * 0.05), 2.0));
  float phase = u_time * (0.34 + layer * 0.07) + layer * 4.1;
  float upper =
    sin(p.x * (3.1 + layer * 0.42) + phase) * 0.16 +
    sin(p.x * (7.4 + layer * 0.31) - phase * 0.72) * 0.055;
  upper += (fbm(vec2(p.x * 1.7 + layer * 5.0, u_time * 0.12 + layer)) - 0.5) * 0.11;
  upper *= envelope * energy;

  float lower =
    sin(p.x * (2.7 + layer * 0.38) - phase * 0.94) * 0.14 +
    sin(p.x * (6.8 + layer * 0.26) + phase * 0.62) * 0.05;
  lower += (fbm(vec2(p.x * 1.5 - layer * 4.0, -u_time * 0.1 + layer)) - 0.5) * 0.1;
  lower *= envelope * energy;

  float width = 0.018 + layer * 0.018;
  float top = smoothstep(width * 4.0, 0.0, abs(p.y - upper));
  float bottom = smoothstep(width * 4.0, 0.0, abs(p.y + lower));
  float fill = smoothstep(0.0, width * 11.0, upper + lower - abs(p.y) * 1.12);
  return max(max(top, bottom) * 0.74, fill * 0.52) * envelope;
}

void main() {
  vec2 uv = v_uv;
  vec2 p = uv * 2.0 - 1.0;
  p.x *= u_resolution.x / u_resolution.y;

  float active = step(0.5, u_status);
  float volume = smoothstep(0.02, 0.82, clamp(u_volume, 0.0, 1.0));
  float bass = smoothstep(0.04, 0.86, clamp(u_bands.x, 0.0, 1.0));
  float midBand = smoothstep(0.05, 0.86, clamp(u_bands.y, 0.0, 1.0));
  float treble = smoothstep(0.08, 0.9, clamp(u_bands.z, 0.0, 1.0));
  float centroid = clamp(u_bands.w, 0.0, 1.0);
  float onset = smoothstep(0.05, 0.8, clamp(u_onset, 0.0, 1.0));
  float breath = 0.5 + 0.5 * sin(u_time * (active > 0.5 ? 0.82 : 0.42));
  float energy = mix(0.24, 0.6, active) + volume * 0.45 + bass * 0.15 + onset * 0.16;
  energy = clamp(energy, 0.18, 0.96);

  vec3 color = vec3(0.0);
  float alpha = 0.0;
  float xNorm = clamp(uv.x, 0.0, 1.0);
  float centerFade = exp(-pow(p.x * 0.52, 2.0));

  vec3 auraColor = mix(vec3(0.0, 0.84, 0.9), vec3(0.72, 0.34, 1.0), smoothstep(0.15, 0.92, uv.x + centroid * 0.18));
  float aura = exp(-pow(p.x * 0.82, 2.0) - pow(p.y * 2.35, 2.0));
  aura += exp(-pow((p.x - 0.62) * 1.62, 2.0) - pow((p.y + 0.03) * 2.55, 2.0)) * 0.5;
  aura += exp(-pow((p.x + 0.46) * 2.0, 2.0) - pow((p.y - 0.02) * 2.8, 2.0)) * 0.34;
  color += auraColor * aura * (0.12 + energy * 0.2);
  alpha += aura * (0.14 + energy * 0.14);

  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float ribbonEnergy = energy + bass * 0.22 + midBand * (0.14 + fi * 0.035);
    float ribbon = ribbonField(p, fi, ribbonEnergy);
    vec3 ribbonColor = palette(xNorm + fi * 0.1 + centroid * 0.2 + sin(u_time * 0.11 + fi) * 0.04, u_status);
    float interior = ribbon * (0.36 + fi * 0.06);
    color += ribbonColor * interior;
    color += vec3(1.0, 0.94, 1.0) * pow(ribbon, 2.4) * 0.28;
    alpha += ribbon * (0.12 + fi * 0.028);
  }

  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float amp = (0.052 + bass * 0.095 + midBand * 0.075 + fi * 0.014) * energy;
    float freq = 3.45 + fi * (0.66 + centroid * 0.58) + treble * 1.18;
    float speed = mix(0.22, 0.78, active) + fi * 0.055 + centroid * 0.28;
    float y = waveCurve(p, fi, amp, freq, speed);
    float d = abs(p.y - y);
    float width = 0.008 + fi * 0.0035 + volume * 0.005 + bass * 0.004;
    float core = smoothstep(width, 0.0, d);
    float glow = smoothstep(width * 12.0, 0.0, d) * centerFade;
    vec3 waveColor = palette(xNorm + fi * 0.04, u_status);
    color += waveColor * (core * (0.48 + fi * 0.04) + glow * (0.1 + energy * 0.11));
    color += vec3(1.0) * core * 0.1;
    alpha += core * 0.3 + glow * 0.12;
  }

  float mid = abs(p.y);
  float axis = smoothstep(0.008, 0.0, mid) * smoothstep(1.75, 0.1, abs(p.x));
  vec3 axisColor = mix(vec3(0.55, 0.95, 1.0), vec3(1.0, 0.72, 1.0), smoothstep(0.28, 0.8, uv.x));
  color += axisColor * axis * (0.44 + breath * 0.2 + treble * 0.26);
  alpha += axis * (0.3 + treble * 0.13);

  vec2 grid = vec2(floor((uv.x * 900.0) / 6.0), floor((uv.y * 260.0) / 6.0));
  float rnd = hash(grid);
  float sparkleBand = exp(-pow(p.y * 10.0, 2.0)) * smoothstep(1.9, 0.15, abs(p.x));
  float sparkle = step(0.976 - treble * 0.042 - onset * 0.024, rnd) * sparkleBand;
  float twinkle = 0.35 + 0.65 * sin(u_time * (2.0 + rnd * 4.0) + rnd * 18.0);
  color += palette(uv.x + rnd * 0.2 + centroid * 0.18, u_status) * sparkle * twinkle * (0.38 + energy + treble * 0.35);
  alpha += sparkle * twinkle * (0.18 + treble * 0.16);

  vec2 haloP = p;
  haloP.x *= 0.52;
  float shell = abs(length(haloP) - (0.32 + breath * 0.02 + onset * 0.035));
  float shellGlow = smoothstep(0.08, 0.0, shell) * exp(-pow(p.x * 0.82, 2.0));
  color += palette(uv.x + 0.12, u_status) * shellGlow * 0.055 * energy;
  alpha += shellGlow * 0.02 * energy;

  float vignette = smoothstep(1.75, 0.0, length(p * vec2(0.62, 1.15)));
  color *= vignette;
  alpha *= vignette;

  color = 1.0 - exp(-color * 1.18);
  color = pow(color, vec3(0.96));
  gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
}
`;

function statusToNumber(status: SmartOrbProps["status"]) {
  switch (status) {
    case "listening":
      return 1;
    case "thinking":
      return 2;
    case "speaking":
      return 3;
    default:
      return 0;
  }
}

function createShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

const DEFAULT_FEATURES = {
  energy: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  centroid: 0.35,
  onset: 0,
};

export function SmartOrb({ volume = 0, features = DEFAULT_FEATURES, status = "idle", compact = false }: SmartOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const featuresRef = useRef({ ...DEFAULT_FEATURES, ...features, energy: volume || features.energy });
  const statusRef = useRef(statusToNumber(status));

  useEffect(() => {
    featuresRef.current = { ...DEFAULT_FEATURES, ...features, energy: volume || features.energy };
  }, [features, volume]);

  useEffect(() => {
    statusRef.current = statusToNumber(status);
  }, [status]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      powerPreference: "high-performance",
    });
    if (!gl) return;

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    if (!vertexShader || !fragmentShader) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
      return;
    }

    const positionLocation = gl.getAttribLocation(program, "a_position");
    const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
    const timeLocation = gl.getUniformLocation(program, "u_time");
    const volumeLocation = gl.getUniformLocation(program, "u_volume");
    const bandsLocation = gl.getUniformLocation(program, "u_bands");
    const onsetLocation = gl.getUniformLocation(program, "u_onset");
    const statusLocation = gl.getUniformLocation(program, "u_status");

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    gl.useProgram(program);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    let frameId = 0;
    let start = performance.now();
    let renderedFeatures = featuresRef.current;
    let renderedStatus = statusRef.current;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.floor(rect.width * ratio));
      const height = Math.max(1, Math.floor(rect.height * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
    };

    const render = (now: number) => {
      resize();
      const target = featuresRef.current;
      renderedFeatures = {
        energy: renderedFeatures.energy + (target.energy - renderedFeatures.energy) * 0.085,
        bass: renderedFeatures.bass + (target.bass - renderedFeatures.bass) * 0.065,
        mid: renderedFeatures.mid + (target.mid - renderedFeatures.mid) * 0.075,
        treble: renderedFeatures.treble + (target.treble - renderedFeatures.treble) * 0.12,
        centroid: renderedFeatures.centroid + (target.centroid - renderedFeatures.centroid) * 0.05,
        onset: renderedFeatures.onset + (target.onset - renderedFeatures.onset) * 0.12,
      };
      renderedStatus += (statusRef.current - renderedStatus) * 0.18;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
      gl.uniform1f(timeLocation, (now - start) / 1000);
      gl.uniform1f(volumeLocation, renderedFeatures.energy);
      gl.uniform4f(
        bandsLocation,
        renderedFeatures.bass,
        renderedFeatures.mid,
        renderedFeatures.treble,
        renderedFeatures.centroid
      );
      gl.uniform1f(onsetLocation, renderedFeatures.onset);
      gl.uniform1f(statusLocation, renderedStatus);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      frameId = requestAnimationFrame(render);
    };

    frameId = requestAnimationFrame((now) => {
      start = now;
      render(now);
    });

    return () => {
      cancelAnimationFrame(frameId);
      gl.deleteBuffer(positionBuffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
    };
  }, []);

  return (
    <div
      className={
        compact
          ? "relative h-[46vmin] min-h-[360px] max-h-[560px] w-[88vmin] min-w-[720px] max-w-[1080px]"
          : "relative h-[320px] w-[820px]"
      }
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div className="pointer-events-none absolute inset-x-[8%] top-1/2 h-px -translate-y-1/2 bg-linear-to-r from-transparent via-white/18 to-transparent" />
    </div>
  );
}
