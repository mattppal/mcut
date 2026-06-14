/**
 * WGSL for the WebGPU backend. All composite work happens in full-frame
 * passes over a ping-pong pair of offscreen textures: each pass samples the
 * accumulated frame (dst) and one prepared layer texture (src), maps the
 * fragment back into the layer's local space with the inverse chrome
 * transform, and blends by mode — one blend.wgsl with a mode switch,
 * correctness over micro-optimization.
 *
 * Layer textures hold PREMULTIPLIED alpha (canvas uploads premultiply;
 * VideoFrames are effectively opaque). Blend formulas operate on straight
 * color, so src/dst unpremultiply around the math.
 */

/** Fullscreen triangle; uv covers [0,1]² across the target. */
export const FULLSCREEN_VERTEX = /* wgsl */ `
struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> VertexOut {
  var out: VertexOut;
  let pos = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  let p = pos[index];
  out.position = vec4f(p, 0.0, 1.0);
  out.uv = vec2f((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5);
  return out;
}
`

/** Blend mode ids — keep in sync with BLEND_MODE_IDS below. */
export const BLEND_WGSL_HELPERS = /* wgsl */ `
fn lum(c: vec3f) -> f32 {
  return dot(c, vec3f(0.3, 0.59, 0.11));
}

fn clip_color(c_in: vec3f) -> vec3f {
  var c = c_in;
  let l = lum(c);
  let n = min(min(c.r, c.g), c.b);
  let x = max(max(c.r, c.g), c.b);
  if (n < 0.0) {
    c = vec3f(l) + (c - vec3f(l)) * l / max(l - n, 1e-6);
  }
  if (x > 1.0) {
    c = vec3f(l) + (c - vec3f(l)) * (1.0 - l) / max(x - l, 1e-6);
  }
  return c;
}

fn set_lum(c: vec3f, l: f32) -> vec3f {
  return clip_color(c + vec3f(l - lum(c)));
}

fn sat(c: vec3f) -> f32 {
  return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
}

fn set_sat(c: vec3f, s: f32) -> vec3f {
  let mn = min(min(c.r, c.g), c.b);
  let mx = max(max(c.r, c.g), c.b);
  var out = vec3f(0.0);
  if (mx > mn) {
    out = (c - vec3f(mn)) * s / (mx - mn);
  }
  return out;
}

fn hard_light_channel(s: f32, d: f32) -> f32 {
  if (s <= 0.5) { return 2.0 * s * d; }
  return 1.0 - 2.0 * (1.0 - s) * (1.0 - d);
}

fn soft_light_channel(s: f32, d: f32) -> f32 {
  if (s <= 0.5) {
    return d - (1.0 - 2.0 * s) * d * (1.0 - d);
  }
  var dd: f32;
  if (d <= 0.25) {
    dd = ((16.0 * d - 12.0) * d + 4.0) * d;
  } else {
    dd = sqrt(d);
  }
  return d + (2.0 * s - 1.0) * (dd - d);
}

fn color_dodge_channel(s: f32, d: f32) -> f32 {
  if (d <= 0.0) { return 0.0; }
  if (s >= 1.0) { return 1.0; }
  return min(1.0, d / (1.0 - s));
}

fn color_burn_channel(s: f32, d: f32) -> f32 {
  if (d >= 1.0) { return 1.0; }
  if (s <= 0.0) { return 0.0; }
  return 1.0 - min(1.0, (1.0 - d) / s);
}

// W3C compositing-and-blending-1 B(Cb, Cs); straight (unpremultiplied) color.
fn blend_colors(mode: u32, src: vec3f, dst: vec3f) -> vec3f {
  switch (mode) {
    case 1u: { return src * dst; }                                    // multiply
    case 2u: { return src + dst - src * dst; }                        // screen
    case 3u: {                                                        // overlay
      return vec3f(
        hard_light_channel(dst.r, src.r),
        hard_light_channel(dst.g, src.g),
        hard_light_channel(dst.b, src.b),
      );
    }
    case 4u: { return min(src, dst); }                                // darken
    case 5u: { return max(src, dst); }                                // lighten
    case 6u: {                                                        // color-dodge
      return vec3f(
        color_dodge_channel(src.r, dst.r),
        color_dodge_channel(src.g, dst.g),
        color_dodge_channel(src.b, dst.b),
      );
    }
    case 7u: {                                                        // color-burn
      return vec3f(
        color_burn_channel(src.r, dst.r),
        color_burn_channel(src.g, dst.g),
        color_burn_channel(src.b, dst.b),
      );
    }
    case 8u: {                                                        // hard-light
      return vec3f(
        hard_light_channel(src.r, dst.r),
        hard_light_channel(src.g, dst.g),
        hard_light_channel(src.b, dst.b),
      );
    }
    case 9u: {                                                        // soft-light
      return vec3f(
        soft_light_channel(src.r, dst.r),
        soft_light_channel(src.g, dst.g),
        soft_light_channel(src.b, dst.b),
      );
    }
    case 10u: { return abs(src - dst); }                              // difference
    case 11u: { return src + dst - 2.0 * src * dst; }                 // exclusion
    case 12u: { return set_lum(set_sat(src, sat(dst)), lum(dst)); }   // hue
    case 13u: { return set_lum(set_sat(dst, sat(src)), lum(dst)); }   // saturation
    case 14u: { return set_lum(src, lum(dst)); }                      // color
    case 15u: { return set_lum(dst, lum(src)); }                      // luminosity
    default: { return src; }                                          // normal
  }
}
`

/**
 * The composite pass: dst = blend(layer at inverse-transformed position,
 * dst). Pixels outside the layer's quad pass dst through untouched.
 */
export const COMPOSITE_SHADER = /* wgsl */ `
${FULLSCREEN_VERTEX}

struct CompositeUniforms {
  // local = inv * (frame - center)
  inv: vec4f,          // m00, m01, m10, m11
  center: vec2f,
  halfSize: vec2f,     // dw/2, dh/2
  frameSize: vec2f,
  cornerRadius: f32,
  opacity: f32,
  mode: u32,
  identity: u32,       // 1 = raster layer: sample at uv directly
  _pad: vec2f,
}

@group(0) @binding(0) var dstTex: texture_2d<f32>;
@group(0) @binding(1) var srcTex: texture_2d<f32>;
@group(0) @binding(2) var srcSampler: sampler;
@group(0) @binding(3) var<uniform> u: CompositeUniforms;

${BLEND_WGSL_HELPERS}

// Signed distance to a centered rounded rect of half-size b, radius r.
fn rounded_rect_sdf(p: vec2f, b: vec2f, r: f32) -> f32 {
  let q = abs(p) - b + vec2f(r);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  let dst = textureSampleLevel(dstTex, srcSampler, in.uv, 0.0);

  var src: vec4f;
  if (u.identity == 1u) {
    src = textureSampleLevel(srcTex, srcSampler, in.uv, 0.0);
  } else {
    let frame = in.uv * u.frameSize;
    let local = vec2f(
      u.inv.x * (frame.x - u.center.x) + u.inv.y * (frame.y - u.center.y),
      u.inv.z * (frame.x - u.center.x) + u.inv.w * (frame.y - u.center.y),
    );
    if (abs(local.x) > u.halfSize.x || abs(local.y) > u.halfSize.y) {
      return dst;
    }
    let uv = (local + u.halfSize) / (u.halfSize * 2.0);
    src = textureSampleLevel(srcTex, srcSampler, uv, 0.0);
    if (u.cornerRadius > 0.0) {
      let d = rounded_rect_sdf(local, u.halfSize, u.cornerRadius);
      // ~1px feather in local units (no derivatives needed for our scales).
      src = src * clamp(0.5 - d, 0.0, 1.0);
    }
  }

  src = src * u.opacity;

  // Premultiplied src-over for normal; spec blending otherwise.
  if (u.mode == 0u) {
    return src + dst * (1.0 - src.a);
  }

  let sa = src.a;
  let da = dst.a;
  var sc = vec3f(0.0);
  if (sa > 0.0) { sc = src.rgb / sa; }
  var dc = vec3f(0.0);
  if (da > 0.0) { dc = dst.rgb / da; }
  let blended = blend_colors(u.mode, sc, dc);
  // Cs' = (1 - ab) * Cs + ab * B(Cb, Cs), then source-over composite.
  let mixed = mix(sc, blended, da);
  let outA = sa + da * (1.0 - sa);
  let outRgb = mixed * sa + dc * da * (1.0 - sa);
  return vec4f(outRgb, outA);
}
`

/** Prepare pass: sample (and crop) the source image into a layer texture. */
export const PREPARE_SHADER = (external: boolean): string => /* wgsl */ `
${FULLSCREEN_VERTEX}

struct PrepareUniforms {
  cropOrigin: vec2f,   // normalized crop origin in the source
  cropSize: vec2f,     // normalized crop size
}

@group(0) @binding(0) var src: ${external ? 'texture_external' : 'texture_2d<f32>'};
@group(0) @binding(1) var srcSampler: sampler;
@group(0) @binding(2) var<uniform> u: PrepareUniforms;

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  let uv = u.cropOrigin + in.uv * u.cropSize;
  ${
    external
      ? 'let color = textureSampleBaseClampToEdge(src, srcSampler, uv);'
      : 'let color = textureSampleLevel(src, srcSampler, uv, 0.0);'
  }
  return color;
}
`

/**
 * Fused color pass: applies the ordered op list (brightness/contrast/
 * saturate/grayscale/sepia/hue-rotate/invert/chroma-key/curves) in one
 * fragment invocation. Curves sample a 256×1 LUT texture.
 */
export const COLOR_SHADER = /* wgsl */ `
${FULLSCREEN_VERTEX}

struct ColorOp {
  kind: vec4u,         // x = op kind
  a: vec4f,            // params 0..3
  b: vec4f,            // params 4..7
}

struct ColorUniforms {
  count: vec4u,
  ops: array<ColorOp, 16>,
}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;
@group(0) @binding(2) var<uniform> u: ColorUniforms;
@group(0) @binding(3) var curvesTex: texture_2d<f32>;

const LUMA = vec3f(0.2126, 0.7152, 0.0722);

fn apply_op(op: ColorOp, color_in: vec4f) -> vec4f {
  var color = color_in;
  switch (op.kind.x) {
    case 1u: { // brightness
      color = vec4f(color.rgb * op.a.x, color.a);
    }
    case 2u: { // contrast
      color = vec4f((color.rgb - 0.5) * op.a.x + 0.5, color.a);
    }
    case 3u: { // saturate
      let l = dot(color.rgb, LUMA);
      color = vec4f(mix(vec3f(l), color.rgb, op.a.x), color.a);
    }
    case 4u: { // grayscale
      let l = dot(color.rgb, LUMA);
      color = vec4f(mix(color.rgb, vec3f(l), op.a.x), color.a);
    }
    case 5u: { // sepia
      let s = vec3f(
        dot(color.rgb, vec3f(0.393, 0.769, 0.189)),
        dot(color.rgb, vec3f(0.349, 0.686, 0.168)),
        dot(color.rgb, vec3f(0.272, 0.534, 0.131)),
      );
      color = vec4f(mix(color.rgb, s, op.a.x), color.a);
    }
    case 6u: { // hue-rotate (radians)
      let angle = op.a.x;
      let c = cos(angle);
      let s = sin(angle);
      // CSS filter hue-rotation matrix.
      let m = mat3x3f(
        vec3f(0.213 + c * 0.787 - s * 0.213, 0.213 - c * 0.213 + s * 0.143, 0.213 - c * 0.213 - s * 0.787),
        vec3f(0.715 - c * 0.715 - s * 0.715, 0.715 + c * 0.285 + s * 0.140, 0.715 - c * 0.715 + s * 0.715),
        vec3f(0.072 - c * 0.072 + s * 0.928, 0.072 - c * 0.072 - s * 0.283, 0.072 + c * 0.928 + s * 0.072),
      );
      color = vec4f(clamp(m * color.rgb, vec3f(0.0), vec3f(1.0)), color.a);
    }
    case 7u: { // invert
      color = vec4f(mix(color.rgb, vec3f(1.0) - color.rgb, op.a.x), color.a);
    }
    case 8u: { // chroma key: a = key rgb + tolerance, b = softness, spill
      let key = op.a.rgb;
      // Distance in the CbCr plane — luma-independent keying.
      let cb = -0.169 * color.r - 0.331 * color.g + 0.5 * color.b;
      let cr = 0.5 * color.r - 0.419 * color.g - 0.081 * color.b;
      let kcb = -0.169 * key.r - 0.331 * key.g + 0.5 * key.b;
      let kcr = 0.5 * key.r - 0.419 * key.g - 0.081 * key.b;
      let distance = length(vec2f(cb - kcb, cr - kcr));
      let tolerance = op.a.w;
      let softness = max(op.b.x, 1e-4);
      let keyAlpha = clamp((distance - tolerance) / softness, 0.0, 1.0);
      // Spill suppression: pull the dominant key channel toward the others.
      var rgb = color.rgb;
      let spill = op.b.y;
      if (spill > 0.0 && keyAlpha > 0.0) {
        let isGreen = key.g >= key.r && key.g >= key.b;
        if (isGreen) {
          let limit = max(rgb.r, rgb.b);
          rgb.g = mix(rgb.g, min(rgb.g, limit), spill);
        } else {
          let limit = max(rgb.g, rgb.b);
          rgb.r = mix(rgb.r, min(rgb.r, limit), spill);
        }
      }
      color = vec4f(rgb * keyAlpha, color.a * keyAlpha);
    }
    case 9u: { // curves via 256×1 LUT texture (rgb channels)
      let r = textureSampleLevel(curvesTex, srcSampler, vec2f(color.r * (255.0 / 256.0) + 0.5 / 256.0, 0.5), 0.0).r;
      let g = textureSampleLevel(curvesTex, srcSampler, vec2f(color.g * (255.0 / 256.0) + 0.5 / 256.0, 0.5), 0.0).g;
      let b = textureSampleLevel(curvesTex, srcSampler, vec2f(color.b * (255.0 / 256.0) + 0.5 / 256.0, 0.5), 0.0).b;
      color = vec4f(r, g, b, color.a);
    }
    default: {}
  }
  return color;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  var color = textureSampleLevel(src, srcSampler, in.uv, 0.0);
  // Work in straight alpha for color math.
  let alpha = color.a;
  if (alpha > 0.0) {
    color = vec4f(color.rgb / alpha, alpha);
  }
  for (var i = 0u; i < u.count.x; i = i + 1u) {
    color = apply_op(u.ops[i], color);
  }
  return vec4f(color.rgb * color.a, color.a);
}
`

/** Separable Gaussian blur, one direction per pass (weights in a storage buffer). */
export const BLUR_SHADER = /* wgsl */ `
${FULLSCREEN_VERTEX}

struct BlurUniforms {
  direction: vec2f,    // (1,0) then (0,1), in texels
  texelSize: vec2f,
  halfTaps: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;
@group(0) @binding(2) var<uniform> u: BlurUniforms;
@group(0) @binding(3) var<storage, read> weights: array<f32>;

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  var sum = vec4f(0.0);
  let half = i32(u.halfTaps);
  for (var i = -half; i <= half; i = i + 1) {
    let w = weights[i + half];
    let offset = u.direction * u.texelSize * f32(i);
    sum = sum + textureSampleLevel(src, srcSampler, in.uv + offset, 0.0) * w;
  }
  return sum;
}
`

/**
 * Drop-shadow compose: out = layer over (shadowColor × blurredAlpha at
 * offset). Both textures are layer-sized; the offset arrives in layer UVs.
 */
export const SHADOW_SHADER = /* wgsl */ `
${FULLSCREEN_VERTEX}

struct ShadowUniforms {
  color: vec4f,        // straight alpha
  offsetUv: vec2f,
  _pad: vec2f,
}

@group(0) @binding(0) var layerTex: texture_2d<f32>;
@group(0) @binding(1) var blurredTex: texture_2d<f32>;
@group(0) @binding(2) var srcSampler: sampler;
@group(0) @binding(3) var<uniform> u: ShadowUniforms;

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  let layer = textureSampleLevel(layerTex, srcSampler, in.uv, 0.0);
  let shadowUv = in.uv - u.offsetUv;
  var shadowAlpha = 0.0;
  if (shadowUv.x >= 0.0 && shadowUv.x <= 1.0 && shadowUv.y >= 0.0 && shadowUv.y <= 1.0) {
    shadowAlpha = textureSampleLevel(blurredTex, srcSampler, shadowUv, 0.0).a;
  }
  let shadow = vec4f(u.color.rgb, 1.0) * (u.color.a * shadowAlpha);
  return layer + shadow * (1.0 - layer.a);
}
`

/**
 * 3D LUT grade: trilinear sample of a size³ table flattened into a 2D
 * texture (slices side by side: width = size², height = size).
 */
export const LUT3D_SHADER = /* wgsl */ `
${FULLSCREEN_VERTEX}

struct LutUniforms {
  size: f32,
  intensity: f32,
  _pad: vec2f,
}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;
@group(0) @binding(2) var lutTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> u: LutUniforms;

fn sample_lut(rgb: vec3f, size: f32) -> vec3f {
  let scaled = clamp(rgb, vec3f(0.0), vec3f(1.0)) * (size - 1.0);
  let slice0 = floor(scaled.b);
  let slice1 = min(slice0 + 1.0, size - 1.0);
  let f = scaled.b - slice0;
  let uvBase = vec2f((scaled.r + 0.5) / (size * size), (scaled.g + 0.5) / size);
  let uv0 = vec2f(uvBase.x + slice0 / size, uvBase.y);
  let uv1 = vec2f(uvBase.x + slice1 / size, uvBase.y);
  let c0 = textureSampleLevel(lutTex, srcSampler, uv0, 0.0).rgb;
  let c1 = textureSampleLevel(lutTex, srcSampler, uv1, 0.0).rgb;
  return mix(c0, c1, f);
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  var color = textureSampleLevel(src, srcSampler, in.uv, 0.0);
  let alpha = color.a;
  var rgb = color.rgb;
  if (alpha > 0.0) { rgb = rgb / alpha; }
  let graded = sample_lut(rgb, u.size);
  rgb = mix(rgb, graded, u.intensity);
  return vec4f(rgb * alpha, alpha);
}
`

/** Final present: stretch the accumulated frame onto the canvas texture. */
export const PRESENT_SHADER = /* wgsl */ `
${FULLSCREEN_VERTEX}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  return textureSampleLevel(src, srcSampler, in.uv, 0.0);
}
`

/** Blend mode name → shader id (0 = normal). Keep in sync with blend_colors. */
export const BLEND_MODE_IDS: Record<string, number> = {
  normal: 0,
  multiply: 1,
  screen: 2,
  overlay: 3,
  darken: 4,
  lighten: 5,
  'color-dodge': 6,
  'color-burn': 7,
  'hard-light': 8,
  'soft-light': 9,
  difference: 10,
  exclusion: 11,
  hue: 12,
  saturation: 13,
  color: 14,
  luminosity: 15,
}
