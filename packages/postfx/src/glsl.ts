// GLSL for the screen effects. The print pass and the smoke field are ported from hedronite.com
// (src/components/fx/CrystalFx.tsx and NoiseField.tsx); the brand inks became uniforms fed by the
// token preset. Passes read the frame from `tDiffuse` (three's ShaderPass convention) in linear HDR.

export const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Sine-free hash (Dave Hoskins, hash12): stays finite on devices that run mediump as fp16.
const hash = /* glsl */ `
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

const precision = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

/**
 * The print pass. Stylization level s: 0 the clean render, 1 dither, 2 ASCII. Each effect sets the
 * uniforms that raise s somewhere: everywhere (uBase), during the intro (uIntro), in the scan band
 * (uScan) or inside the lens (uLens). Levels dissolve cell by cell instead of cross-fading.
 */
export const printFragment = /* glsl */ `
${precision}
uniform sampler2D tDiffuse;
uniform sampler2D uAtlas;
uniform float uCount;
uniform vec2 uResolution;
uniform float uDpr;
uniform float uTime;
uniform float uBase;
uniform float uIntro;
uniform float uAppear;
uniform float uScan;
uniform float uScanDepth;
uniform vec2 uMouse;
uniform float uLens;
uniform float uLensRadius;
uniform float uLensDepth;
uniform float uGrain;
uniform float uDitherPx;
uniform float uAsciiPx;
uniform vec3 uCool0;
uniform vec3 uCool1;
uniform vec3 uCool2;
uniform vec3 uWarm0;
uniform vec3 uWarm1;
uniform vec3 uWarm2;
uniform vec3 uHot;
uniform vec3 uRule;
uniform float uChroma;
varying vec2 vUv;

float bayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }
${hash}

// The input is linear HDR; squash it into a printable 0..1 tone.
float tone(vec3 c) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return 1.0 - exp(-l * 1.7);
}

vec4 ditherPrint(vec2 uv) {
  float px = uDitherPx * uDpr;
  vec2 grid = uv * uResolution / px;
  vec2 cell = floor(grid);
  vec4 s = texture2D(tDiffuse, (cell + 0.5) * px / uResolution);
  // An empty stage stays empty; covered pixels get a small lift so dark faces still print.
  float raw = tone(s.rgb);
  if (s.a < 0.04 && raw < 0.12) return vec4(0.0);
  float t = clamp(raw * 1.1 + 0.16 * s.a, 0.0, 1.0);
  float level = floor(t * 3.6 + bayer8(cell));
  if (level < 1.0) return vec4(0.0);
  bool warm = s.r > s.b * 1.08;
  vec3 col;
  if (level >= 4.0) col = uHot;
  else if (level >= 3.0) col = warm ? uWarm2 : uCool2;
  else if (level >= 2.0) col = warm ? uWarm1 : uCool1;
  else col = warm ? uWarm0 : uCool0;
  vec2 f = fract(grid);
  float mark = step(f.x, 0.78) * step(f.y, 0.78);
  return vec4(col * mark, mark);
}

vec4 asciiPrint(vec2 uv) {
  float cs = uAsciiPx * uDpr;
  vec2 grid = uv * uResolution / cs;
  vec2 cell = floor(grid);
  vec4 s = texture2D(tDiffuse, (cell + 0.5) * cs / uResolution);
  float raw = tone(s.rgb);
  if (s.a < 0.04 && raw < 0.12) return vec4(0.0);
  float t = clamp(pow(raw, 0.7) * 1.25 + 0.2 * s.a, 0.0, 0.999);
  float idx = floor(t * uCount);
  if (idx < 1.0) return vec4(0.0);
  vec2 f = fract(grid);
  float g = texture2D(uAtlas, vec2((idx + f.x) / uCount, f.y)).r;
  float m = max(max(s.r, s.g), s.b);
  vec3 chroma = m > 1e-4 ? s.rgb / m : vec3(0.0);
  vec3 ink = s.r > s.b * 1.08 ? mix(uWarm1, uWarm2, t) : mix(uCool1, uCool2, t);
  // Two-ink prints lean a little toward the source's own color; a one-ink print keeps to its ink.
  vec3 col = mix(mix(ink, chroma, uChroma) * (0.7 + 0.6 * t), uHot, smoothstep(0.82, 1.0, t));
  return vec4(col * g, g);
}

void main() {
  vec4 inputColor = texture2D(tDiffuse, vUv);
  vec2 px = vUv * uResolution;

  float s = max(uBase, 2.0 * (1.0 - uIntro));

  // The scan band, led by a hairline across the frame so the sweep reads as an instrument.
  float hairline = 0.0;
  if (uScan > -0.5) {
    float d = abs(vUv.y - uScan);
    s = max(s, uScanDepth * (1.0 - smoothstep(0.0, 0.11, d)));
    float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
    float life = smoothstep(1.15, 0.95, uScan) * smoothstep(-0.15, 0.05, uScan);
    hairline = (1.0 - smoothstep(0.0, 1.2 * uDpr, abs(px.y - uScan * uResolution.y))) * edge * life * 0.8;
  }

  // The loupe: the pointer peeks behind the surface, printing inside a hairline ring.
  float ring = 0.0;
  if (uLens > 0.001) {
    float r = uLensRadius * uDpr;
    float d = distance(px, uMouse * uResolution);
    float inside = 1.0 - smoothstep(r * 0.88, r, d);
    ring = (1.0 - smoothstep(0.0, 1.4 * uDpr, abs(d - r))) * uLens;
    s = max(s, inside * uLens * uLensDepth);
  }

  float rule = max(ring, hairline);
  if (s < 0.001 && rule < 0.001) { gl_FragColor = inputColor; return; }

  float n = hash(floor(px / (5.0 * uDpr)));
  vec4 col;
  if (s <= 1.0) col = n < s ? ditherPrint(vUv) : inputColor;
  else col = n < s - 1.0 ? asciiPrint(vUv) : ditherPrint(vUv);

  // Intro scatter: ASCII cells pop in at random before the shape holds.
  if (uAppear < 0.999) col *= step(hash(floor(px / (8.0 * uDpr)) + 7.0), uAppear);

  if (s > 0.001) col.rgb += (hash(px + fract(uTime) * 91.0) - 0.5) * uGrain * col.a;

  col.rgb = mix(col.rgb, uRule, rule);
  col.a = max(col.a, rule);
  gl_FragColor = col;
}
`;

/** Film grain over the whole frame: over what's drawn, and as faint light specks where nothing is. */
export const grainFragment = /* glsl */ `
${precision}
uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform float uTime;
uniform float uAmount;
varying vec2 vUv;
${hash}
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  float n = hash(vUv * uResolution + fract(uTime) * 91.0) - 0.5;
  // On what's drawn, grain darkens and lightens; where nothing is, it adds faint light specks.
  // Output is premultiplied, as the canvas composites it.
  float speck = max(n, 0.0) * uAmount;
  c.rgb += n * uAmount * c.a + speck * (1.0 - c.a);
  c.a += speck * (1.0 - c.a);
  gl_FragColor = c;
}
`;

/**
 * The smoke field: domain-warped fBm in the cool ink with warm embers, composited behind whatever the
 * scene drew (using its alpha).
 */
export const smokeFragment = /* glsl */ `
${precision}
uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform float uTime;
uniform float uIntensity;
uniform vec3 uCool;
uniform vec3 uWarm;
varying vec2 vUv;
${hash}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = r * p * 2.02; a *= 0.5; }
  return v;
}
void main() {
  vec4 scene = texture2D(tDiffuse, vUv);
  vec2 p = vUv * vec2(uResolution.x / uResolution.y, 1.0) * 1.8;
  float t = uTime * 0.03;
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p + 3.6 * q + vec2(1.7, 9.2) + t * 1.4), fbm(p + 3.6 * q + vec2(8.3, 2.8) - t * 0.9));
  float f = fbm(p + 3.2 * r);
  float body = smoothstep(0.55, 0.95, f);
  float filament = pow(smoothstep(0.62, 0.86, f) * (1.0 - smoothstep(0.86, 1.0, f)), 1.6);
  float warm = smoothstep(0.35, 1.05, vUv.x * 0.7 + (1.0 - vUv.y) * 0.55 + (r.x - 0.5) * 0.6);
  vec3 smoke = mix(uCool, uWarm, warm * 0.7);
  // hedronite.com's blend, which it also drew at 90% opacity.
  float a = clamp((body * 0.2 + filament * 0.42) * 0.9 * uIntensity, 0.0, 1.0);
  // The canvas composites premultiplied color, so the smoke goes out premultiplied by its alpha.
  gl_FragColor = vec4(scene.rgb * scene.a + smoke * a * (1.0 - scene.a), scene.a + a * (1.0 - scene.a));
}
`;
