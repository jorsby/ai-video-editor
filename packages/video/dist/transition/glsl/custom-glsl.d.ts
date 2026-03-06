export declare const RADIAL_SWIPE_FRAGMENT = "\nconst float PI = 3.141592653589;\n\nvec4 transition(vec2 p) {\n  vec2 rp = p * 2.0 - 1.0;\n  float angle = atan(rp.y, rp.x);\n  float threshold = (progress - 0.5) * PI * 2.5;\n  float mix_factor = smoothstep(0.0, 0.1, angle - threshold);\n  return mix(getToColor(p), getFromColor(p), mix_factor);\n}\n";
/**
 * GridFlip transition configuration
 * Custom fragment shader and uniforms for GridFlip transition
 */
export declare const GRIDFLIP_FRAGMENT = "\nuniform vec2 gridSize;\nuniform float pause;\nuniform float dividerWidth;\nuniform vec4 bgColor;\nuniform float randomness;\n\nfloat rand(vec2 co) { \n  return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);\n}\n\nfloat getDelta(vec2 p) { \n  vec2 rectanglePos = floor(gridSize * p); \n  vec2 rectangleSize = vec2(1.0 / gridSize.x, 1.0 / gridSize.y); \n  float top = rectangleSize.y * (rectanglePos.y + 1.0); \n  float bottom = rectangleSize.y * rectanglePos.y; \n  float left = rectangleSize.x * rectanglePos.x; \n  float right = rectangleSize.x * (rectanglePos.x + 1.0); \n  float minX = min(abs(p.x - left), abs(p.x - right)); \n  float minY = min(abs(p.y - top), abs(p.y - bottom)); \n  return min(minX, minY);\n}\n\nfloat getDividerSize() { \n  vec2 rectangleSize = vec2(1.0 / gridSize.x, 1.0 / gridSize.y); \n  return min(rectangleSize.x, rectangleSize.y) * dividerWidth;\n}\n\nvec4 transition(vec2 p) { \n  if (progress < pause) { \n    float currentProg = progress / pause; \n    float a = 1.0; \n    if (getDelta(p) < getDividerSize()) { \n      a = 1.0 - currentProg; \n    } \n    return mix(bgColor, getFromColor(p), a); \n  } \n\n  if (progress < 1.0 - pause) { \n    if (getDelta(p) < getDividerSize()) { \n      return bgColor; \n    } \n\n    float currentProg = (progress - pause) / (1.0 - pause * 2.0); \n    vec2 rectanglePos = floor(gridSize * p); \n    float r = rand(rectanglePos) - randomness; \n    float cp = smoothstep(0.0, 1.0 - r, currentProg); \n    float rectangleSize = 1.0 / gridSize.x; \n    float delta = rectanglePos.x * rectangleSize; \n    float offset = rectangleSize * 0.5 + delta; \n\n    vec2 warped = p; \n    warped.x = (warped.x - offset) / max(abs(cp - 0.5), 0.001) * 0.5 + offset; \n\n    float s = step(abs(gridSize.x * (p.x - delta) - 0.5), abs(cp - 0.5)); \n    vec4 mixColor = mix(getToColor(warped), getFromColor(warped), step(cp, 0.5)); \n    return mix(bgColor, mixColor, s); \n  } \n\n  float currentProg = (progress - 1.0 + pause) / pause; \n  float a = 1.0; \n  if (getDelta(p) < getDividerSize()) { \n    a = currentProg; \n  } \n  return mix(bgColor, getToColor(p), a);\n}\n";
export declare const GRIDFLIP_UNIFORMS: Record<string, {
    value: any;
    type: string;
}>;
/**
 * Circle transition configuration
 * Custom fragment shader and uniforms for Circle transition
 */
export declare const CIRCLE_FRAGMENT = "\nuniform vec3 backColor;\n\nvec4 transition(vec2 uv) { \n  float distance = length(uv - center); \n  float radius = sqrt(8.0) * abs(progress - 0.5); \n\n  if (distance > radius) { \n    return vec4(backColor, 1.0); \n  } else { \n    if (progress < 0.5) return getFromColor(uv); \n    else return getToColor(uv); \n  }\n}\n";
/**
 * Directional transition configuration
 * Custom fragment shader and uniforms for Directional transition
 */
export declare const DIRECTIONAL_FRAGMENT = "\nuniform vec2 direction;\n\nvec4 transition(vec2 uv) { \n  vec2 p = uv + progress * sign(direction); \n  vec2 f = fract(p); \n  return mix( \n    getToColor(f), \n    getFromColor(f), \n    step(0.0, p.y) * step(p.y, 1.0) * step(0.0, p.x) * step(p.x, 1.0) \n  );\n}\n";
export declare const DIRECTIONAL_UNIFORMS: Record<string, {
    value: any;
    type: string;
}>;
/**
 * UndulatingBurnOut transition configuration
 * Custom fragment shader and uniforms for UndulatingBurnOut transition
 */
export declare const UNDULATING_BURN_OUT_FRAGMENT = "\nuniform float smoothness;\nuniform vec3 color;\n\nconst float M_PI = 3.14159265358979323846;\n\nfloat quadraticInOut(float t) { \n  float p = 2.0 * t * t; \n  return t < 0.5 ? p : -p + (4.0 * t) - 1.0;\n}\n\nfloat getGradient(float r, float dist) { \n  float d = r - dist; \n  return mix( \n    smoothstep(-smoothness, 0.0, r - dist * (1.0 + smoothness)), \n    -1.0 - step(0.005, d), \n    step(-0.005, d) * step(d, 0.01) \n  );\n}\n\nfloat getWave(vec2 p){ \n  vec2 _p = p - center; // offset from center \n  float rads = atan(_p.y, _p.x); \n  float degs = degrees(rads) + 180.0; \n  vec2 range = vec2(0.0, M_PI * 30.0); \n  vec2 domain = vec2(0.0, 360.0); \n  float ratio = (M_PI * 30.0) / 360.0; \n  degs = degs * ratio; \n  float x = progress; \n  float magnitude = mix(0.02, 0.09, smoothstep(0.0, 1.0, x)); \n  float offset = mix(40.0, 30.0, smoothstep(0.0, 1.0, x)); \n  float ease_degs = quadraticInOut(sin(degs)); \n  float deg_wave_pos = (ease_degs * magnitude) * sin(x * offset); \n  return x + deg_wave_pos;\n}\n\nvec4 transition(vec2 p) { \n  float dist = distance(center, p); \n  float m = getGradient(getWave(p), dist); \n  vec4 cfrom = getFromColor(p); \n  vec4 cto = getToColor(p); \n  return mix(mix(cfrom, cto, m), mix(cfrom, vec4(color, 1.0), 0.75), step(m, -2.0));\n}\n";
export declare const UNDULATING_BURN_OUT_UNIFORMS: Record<string, {
    value: any;
    type: string;
}>;
/**
 * SquaresWire transition configuration
 * Custom fragment shader and uniforms for SquaresWire transition
 */
export declare const SQUARESWIRE_FRAGMENT = "\nuniform ivec2 squares;\nuniform vec2 direction;\nuniform float smoothness;\n\nvec4 transition (vec2 p) { \n  vec2 v = normalize(direction); \n  v /= abs(v.x)+abs(v.y); \n  float d = v.x * center.x + v.y * center.y; \n  float offset = smoothness; \n  float pr = smoothstep(-offset, 0.0, v.x * p.x + v.y * p.y - (d-0.5+progress*(1.+offset))); \n  vec2 squarep = fract(p*vec2(squares)); \n  vec2 squaremin = vec2(pr/2.0); \n  vec2 squaremax = vec2(1.0 - pr/2.0); \n  float a = (1.0 - step(progress, 0.0)) * step(squaremin.x, squarep.x) * step(squaremin.y, squarep.y) * step(squarep.x, squaremax.x) * step(squarep.y, squaremax.y); \n  return mix(getFromColor(p), getToColor(p), a);\n}\n";
export declare const SQUARESWIRE_UNIFORMS: Record<string, {
    value: any;
    type: string;
}>;
/**
 * RotateScaleFade transition configuration
 * Custom fragment shader and uniforms for RotateScaleFade transition
 */
export declare const ROTATE_SCALE_FADE_FRAGMENT = "\n#define PI 3.14159265359\n\nuniform float rotations;\nuniform float scale;\nuniform vec4 backColor;\n\nvec4 transition (vec2 uv) { \n  vec2 difference = uv - center; \n  vec2 dir = normalize(difference); \n  float dist = length(difference); \n\n  float angle = 2.0 * PI * rotations * progress; \n\n  float c = cos(angle); \n  float s = sin(angle); \n\n  float currentScale = mix(scale, 1.0, 2.0 * abs(progress - 0.5)); \n\n  vec2 rotatedDir = vec2(dir.x * c - dir.y * s, dir.x * s + dir.y * c); \n  vec2 rotatedUv = center + rotatedDir * dist / currentScale; \n\n  if (rotatedUv.x < 0.0 || rotatedUv.x > 1.0 || \n      rotatedUv.y < 0.0 || rotatedUv.y > 1.0) \n    return backColor; \n\n  return mix(getFromColor(rotatedUv), getToColor(rotatedUv), progress);\n}\n";
export declare const ROTATE_SCALE_FADE_UNIFORMS: Record<string, {
    value: any;
    type: string;
}>;
/**
 * RandomSquares transition configuration
 * Custom fragment shader and uniforms for RandomSquares transition
 */
export declare const RANDOMSQUARES_FRAGMENT = "\nuniform ivec2 size;\nuniform float smoothness;\n\nfloat rand (vec2 co) { \n  return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);\n}\n\nvec4 transition(vec2 p) { \n  float r = rand(floor(vec2(size) * p)); \n  float m = smoothstep(0.0, -smoothness, r - (progress * (1.0 + smoothness))); \n  return mix(getFromColor(p), getToColor(p), m);\n}\n";
export declare const RANDOMSQUARES_UNIFORMS: Record<string, {
    value: any;
    type: string;
}>;
/**
 * PolarFunction transition configuration
 * Custom fragment shader and uniforms for PolarFunction transition
 */
export declare const POLAR_FUNCTION_FRAGMENT = "\n#define PI 3.14159265359\n\nuniform int segments;\n\nvec4 transition (vec2 uv) { \n  float angle = atan(uv.y - 0.5, uv.x - 0.5) - 0.5 * PI; \n  float normalized = (angle + 1.5 * PI) * (2.0 * PI); \n\n  float radius = (cos(float(segments) * angle) + 4.0) / 4.0; \n  float difference = length(uv - vec2(0.5, 0.5)); \n\n  if (difference > radius * progress) \n    return getFromColor(uv); \n  else \n    return getToColor(uv);\n}\n";
export declare const POLAR_FUNCTION_UNIFORMS: Record<string, {
    value: any;
    type: string;
}>;
/**
 * Pixelize transition configuration
 * Custom fragment shader and uniforms for Pixelize transition
 */
export declare const PIXELIZE_FRAGMENT = "\nuniform ivec2 squaresMin;\nuniform int steps;\n\nvec4 transition(vec2 uv) { \n  float d = min(progress, 1.0 - progress);\n  float dist = steps>0 ? ceil(d * float(steps)) / float(steps) : d;\n  vec2 squareSize = 2.0 * dist / vec2(squaresMin);\n  \n  vec2 p = dist>0.0 ? (floor(uv / squareSize) + 0.5) * squareSize : uv; \n  return mix(getFromColor(p), getToColor(p), progress);\n}\n";
export declare const PIXELIZE_UNIFORMS: Record<string, {
    value: any;
    type: string;
}>;
/**
 * Perlin transition configuration
 * Custom fragment shader and uniforms for Perlin transition
 */
export declare const PERLIN_FRAGMENT = "\nuniform float scale;\nuniform float smoothness;\nuniform float seed;\n\n// http://byteblacksmith.com/improvements-to-the-canonical-one-liner-glsl-rand-for-opengl-es-2-0/\nfloat random(vec2 co)\n{ \n  float a = seed; \n  float b = 78.233; \n  float c = 43758.5453; \n  float dt = dot(co.xy, vec2(a, b)); \n  float sn = mod(dt, 3.14); \n  return fract(sin(sn) * c);\n}\n\n// 2D Noise based on Morgan McGuire @morgan3d\n// https://www.shadertoy.com/view/4dS3Wd\nfloat noise(vec2 st) { \n  vec2 i = floor(st); \n  vec2 f = fract(st); \n\n  // Four corners in 2D of a tile \n  float a = random(i); \n  float b = random(i + vec2(1.0, 0.0)); \n  float c = random(i + vec2(0.0, 1.0)); \n  float d = random(i + vec2(1.0, 1.0)); \n\n  //Smooth Interpolation \n\n  // Cubic Hermine Curve. Same as SmoothStep() \n  vec2 u = f*f*(3.0-2.0*f); \n  // u = smoothstep(0.,1.,f); \n\n  // Mix 4 coorners percentages \n  return mix(a, b, u.x) + \n         (c - a)* u.y * (1.0 - u.x) + \n         (d - b) * u.x * u.y;\n}\n\nvec4 transition (vec2 uv) { \n  vec4 from = getFromColor(uv); \n  vec4 to = getToColor(uv); \n  float n = noise(uv * scale); \n\n  float p = mix(-smoothness, 1.0 + smoothness, progress); \n  float lower = p - smoothness; \n  float higher = p + smoothness; \n\n  float q = smoothstep(lower, higher, n); \n\n  return mix( \n    from, \n    to, \n    1.0 - q \n  );\n}\n";
export declare const PERLIN_UNIFORMS: Record<string, {
    value: any;
    type: string;
}>;
/**
 * Luma transition configuration
 * Custom fragment shader and uniforms for Luma transition
 * Creates a counter-clockwise spiral effect that fragments the image
 */
export declare const LUMA_FRAGMENT = "\n\n#define PI 3.14159265358979323846\n\nuniform float spiralTurns;\nuniform float spiralWidth;\n\nvec4 transition(vec2 uv) {\n\n    vec2 p = uv - center;\n\n    float r = length(p);\n    float angle = atan(p.y, p.x);\n\n    float normalizedAngle = (angle + PI) / (2.0 * PI);\n\n    float spiral = normalizedAngle + r * spiralTurns;\n    spiral = fract(spiral);\n\n    float factor = smoothstep(\n        progress - spiralWidth,\n        progress + spiralWidth,\n        spiral\n    );\n    return mix(\n        getToColor(uv),       // ahora aparece primero\n        getFromColor(uv),     // aparece despu\u00E9s\n        factor\n    );\n}\n\n\n";
export declare const LUMA_UNIFORMS: Record<string, {
    value: any;
    type: string;
}>;
/**
 * LuminanceMelt transition configuration
 * Custom fragment shader and uniforms for LuminanceMelt transition
 * Creates a melting effect based on luminance threshold
 */
export declare const LUMINANCE_MELT_FRAGMENT = "\n//direction of movement : 0 : up, 1, down\nuniform float direction; // = 1.0 (using float instead of bool for WebGPU)\n\n//luminance threshold\nuniform float l_threshold; // = 0.8\n\n//does the movement take effect above or below luminance threshold ?\nuniform float above; // = 0.0 (false) (using float instead of bool for WebGPU)\n\n//Random function borrowed from everywhere\nfloat rand(vec2 co){ \n  return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);\n}\n\n// Simplex noise:\n// Description : Array and textureless GLSL 2D simplex noise function.\n// Author: Ian McEwan, Ashima Arts.\n// Maintainer : ijm\n// Lastmod: 20110822 (ijm)\n// License: MIT\n// 2011 Ashima Arts. All rights reserved.\n// Distributed under the MIT License. See LICENSE file.\n// https://github.com/ashima/webgl-noise\n\nvec3 mod289(vec3 x) { \n  return x - floor(x * (1.0 / 289.0)) * 289.0;\n}\n\nvec2 mod289(vec2 x) { \n  return x - floor(x * (1.0 / 289.0)) * 289.0;\n}\n\nvec3 permute(vec3 x) { \n  return mod289(((x*34.0)+1.0)*x);\n}\n\nfloat snoise(vec2 v) \n{ \n  const vec4 C = vec4(0.211324865405187, // (3.0-sqrt(3.0))/6.0 \n                      0.366025403784439, // 0.5*(sqrt(3.0)-1.0) \n                      -0.577350269189626, // -1.0 + 2.0 * C.x \n                      0.024390243902439); // 1.0 / 41.0\n  // First corner \n  vec2 i = floor(v + dot(v, C.yy) ); \n  vec2 x0 = v - i + dot(i, C.xx);\n\n  // Other corners \n  vec2 i1; \n  //i1.x = step( x0.y, x0.x ); // x0.x > x0.y ? 1.0 : 0.0 \n  //i1.y = 1.0 - i1.x; \n  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0); \n  // x0 = x0 - 0.0 + 0.0 * C.xx ; \n  // x1 = x0 - i1 + 1.0 * C.xx ; \n  // x2 = x0 - 1.0 + 2.0 * C.xx ; \n  vec4 x12 = x0.xyxy + C.xxzz; \n  x12.xy -= i1;\n\n  //Permutations \n  i = mod289(i); // Avoid truncation effects in permutation \n  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) \n                    + i.x + vec3(0.0, i1.x, 1.0 )); \n\n  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0); \n  m = m*m ; \n  m = m*m ;\n\n  // Gradients: 41 points uniformly over a line, mapped onto a diamond.\n  // The ring size 17*17 = 289 is close to a multiple of 41 (41*7 = 287) \n\n  vec3 x = 2.0 * fract(p * C.www) - 1.0; \n  vec3 h = abs(x) - 0.5; \n  vec3 ox = floor(x + 0.5); \n  vec3 a0 = x - ox;\n\n  // Normalize gradients implicitly by scaling m\n  // Approximation of: m *= inversesqrt( a0*a0 + h*h ); \n  m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );\n\n  // Compute final noise value at P \n  vec3 g; \n  g.x = a0.x * x0.x + h.x * x0.y; \n  g.yz = a0.yz * x12.xz + h.yz * x12.yw; \n  return 130.0 * dot(m, g);\n}\n\n// Simplex noise -- end\n\nfloat luminance(vec4 color){ \n  //(0.299*R + 0.587*G + 0.114*B) \n  return color.r*0.299+color.g*0.587+color.b*0.114;\n}\n\nvec4 transition(vec2 uv) { \n  vec2 p = uv.xy / vec2(1.0).xy; \n  vec2 center = vec2(1.0, direction);\n  \n  if (progress == 0.0) { \n    return getFromColor(p); \n  } else if (progress == 1.0) { \n    return getToColor(p); \n  } else { \n    float x = progress; \n    float dist = distance(center, p) - progress*exp(snoise(vec2(p.x, 0.0))); \n    float r = x - rand(vec2(p.x, 0.1)); \n    float m; \n    if(above > 0.5){ \n      m = dist <= r && luminance(getFromColor(p))>l_threshold ? 1.0 : (progress*progress*progress); \n    } \n    else{ \n      m = dist <= r && luminance(getFromColor(p))<l_threshold ? 1.0 : (progress*progress*progress); \n    } \n    return mix(getFromColor(p), getToColor(p), m); \n  }\n}\n";
export declare const LUMINANCE_MELT_UNIFORMS: Record<string, {
    value: any;
    type: string;
}>;
/**
 * Hexagonalize transition configuration
 * Custom fragment shader and uniforms for Hexagonalize transition
 * Creates a hexagonal pixelation effect
 */
export declare const HEXAGONALIZE_FRAGMENT = "\nuniform int steps; // = 50\nuniform float horizontalHexagons; // = 20.0\n\nstruct Hexagon { \n  float q; \n  float r; \n  float s;\n};\n\nHexagon createHexagon(float q, float r){ \n  Hexagon hex; \n  hex.q = q; \n  hex.r = r; \n  hex.s = -q - r; \n  return hex;\n}\n\nHexagon roundHexagon(Hexagon hex){ \n  float q = floor(hex.q + 0.5); \n  float r = floor(hex.r + 0.5); \n  float s = floor(hex.s + 0.5); \n\n  float deltaQ = abs(q - hex.q); \n  float deltaR = abs(r - hex.r); \n  float deltaS = abs(s - hex.s); \n\n  if (deltaQ > deltaR && deltaQ > deltaS) \n    q = -r - s; \n  else if (deltaR > deltaS) \n    r = -q - s; \n  else \n    s = -q - r; \n\n  return createHexagon(q, r);\n}\n\nHexagon hexagonFromPoint(vec2 point, float size) { \n  point.y /= ratio; \n  point = (point - 0.5) / size; \n\n  float q = (sqrt(3.0) / 3.0) * point.x + (-1.0 / 3.0) * point.y; \n  float r = 0.0 * point.x + 2.0/3.0 * point.y; \n\n  Hexagon hex = createHexagon(q, r); \n  return roundHexagon(hex);\n}\n\nvec2 pointFromHexagon(Hexagon hex, float size) { \n  float x = (sqrt(3.0) * hex.q + (sqrt(3.0) / 2.0) * hex.r) * size + 0.5; \n  float y = (0.0 * hex.q + (3.0/2.0) * hex.r) * size + 0.5; \n\n  return vec2(x, y * ratio);\n}\n\nvec4 transition (vec2 uv) { \n  float dist = 2.0 * min(progress, 1.0 - progress); \n  dist = steps > 0 ? ceil(dist * float(steps)) / float(steps) : dist; \n\n  float size = (sqrt(3.0) / 3.0) * dist / horizontalHexagons; \n\n  vec2 point = dist > 0.0 ? pointFromHexagon(hexagonFromPoint(uv, size), size) : uv; \n\n  return mix(getFromColor(point), getToColor(point), progress);\n}\n";
export declare const HEXAGONALIZE_UNIFORMS: Record<string, {
    value: any;
    type: string;
}>;
/**
 * Heart transition configuration
 * Custom fragment shader and uniforms for Heart transition
 * Creates a heart-shaped reveal effect
 */
export declare const HEART_FRAGMENT = "\nfloat inHeart (vec2 p, vec2 center, float size) { \n  if (size==0.0) return 0.0; \n  vec2 o = (p-center)/(1.6*size); \n  o.y = -o.y;\n  float a = o.x*o.x+o.y*o.y-0.3; \n  return step(a*a*a, o.x*o.x*o.y*o.y*o.y);\n}\n\nvec4 transition (vec2 uv) { \n  return mix( \n    getFromColor(uv), \n    getToColor(uv), \n    inHeart(uv, vec2(0.5, 0.5), progress) \n  );\n}\n";
export declare const HEART_UNIFORMS: Record<string, {
    value: any;
    type: string;
}>;
/**
 * Displacement transition configuration
 * Custom fragment shader and uniforms for Displacement transition
 * Creates a displacement effect using a displacement map
 */
export declare const DISPLACEMENT_FRAGMENT = "\nuniform sampler2D displacementMap;\nuniform float strength; // = 0.5\n\nvec4 transition (vec2 uv) { \n  float displacement = texture2D(displacementMap, uv).r * strength; \n\n  vec2 uvFrom = vec2(uv.x + progress * displacement, uv.y); \n  vec2 uvTo = vec2(uv.x - (1.0 - progress) * displacement, uv.y); \n\n  return mix( \n    getFromColor(uvFrom), \n    getToColor(uvTo), \n    progress \n  );\n}\n";
export declare const DISPLACEMENT_UNIFORMS: Record<string, {
    value: any;
    type: string;
}>;
/**
 * DirectionalWipe transition configuration
 * Custom fragment shader and uniforms for DirectionalWipe transition
 * Creates a directional wipe effect
 */
export declare const DIRECTIONALWIPE_FRAGMENT = "\nuniform vec2 direction; // = vec2(1.0, -1.0)\nuniform float smoothness; // = 0.5\n\n// Note: center is already defined as a uniform in the fragment wrapper\n\nvec4 transition (vec2 uv) {\n  vec2 v = normalize(direction);\n  v /= abs(v.x)+abs(v.y);\n  float d = v.x * center.x + v.y * center.y;\n  float m = \n    (1.0-step(progress, 0.0)) * // there is something wrong with our formula that makes m not equals 0.0 with progress is 0.0 \n    (1.0 - smoothstep(-smoothness, 0.0, v.x * uv.x + v.y * uv.y - (d-0.5+progress*(1.+smoothness)))); \n  return mix(getFromColor(uv), getToColor(uv), m);\n}\n";
export declare const DIRECTIONALWIPE_UNIFORMS: Record<string, {
    value: any;
    type: string;
}>;
/**
 * DirectionalWarp transition configuration
 * Custom fragment shader and uniforms for DirectionalWarp transition
 * Creates a directional warp effect
 */
export declare const DIRECTIONALWARP_FRAGMENT = "\nuniform vec2 direction; // = vec2(-1.0, 1.0)\n\nconst float smoothness = 0.5;\n// Note: center is already defined as a uniform in the fragment wrapper\n\nvec4 transition (vec2 uv) { \n  vec2 v = normalize(direction); \n  v /= abs(v.x) + abs(v.y); \n  float d = v.x * center.x + v.y * center.y; \n  float m = 1.0 - smoothstep(-smoothness, 0.0, v.x * uv.x + v.y * uv.y - (d - 0.5 + progress * (1.0 + smoothness))); \n  return mix(getFromColor((uv - 0.5) * (1.0 - m) + 0.5), getToColor((uv - 0.5) * m + 0.5), m);\n}\n";
export declare const DIRECTIONALWARP_UNIFORMS: Record<string, {
    value: any;
    type: string;
}>;
/**
 * Crosshatch transition configuration
 * Custom fragment shader and uniforms for Crosshatch transition
 * Creates a crosshatch pattern transition effect
 */
export declare const CROSSHATCH_FRAGMENT = "\nuniform float threshold; // = 3.0\nuniform float fadeEdge; // = 0.1\n\n// Note: center is already defined as a uniform in the fragment wrapper\n\nfloat rand(vec2 co) { \n  return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);\n}\n\nvec4 transition(vec2 p) { \n  float dist = distance(center, p) / threshold; \n  float r = progress - min(rand(vec2(p.y, 0.0)), rand(vec2(0.0, p.x))); \n  return mix(getFromColor(p), getToColor(p), mix(0.0, mix(step(dist, r), 1.0, smoothstep(1.0-fadeEdge, 1.0, progress)), smoothstep(0.0, fadeEdge, progress)));\n}\n";
export declare const CROSSHATCH_UNIFORMS: Record<string, {
    value: any;
    type: string;
}>;
/**
 * CircleOpen transition configuration
 * Custom fragment shader and uniforms for CircleOpen transition
 * Creates a circular opening/closing transition effect
 */
export declare const CIRCLEOPEN_FRAGMENT = "\nuniform float smoothness; // = 0.3\nuniform float opening; // = 1.0 (using float instead of bool for WebGPU: 1.0 = true, 0.0 = false)\n\n// Note: center is already defined as a uniform in the fragment wrapper\nconst float SQRT_2 = 1.414213562373;\n\nvec4 transition (vec2 uv) { \n  float x = opening > 0.5 ? progress : 1.0 - progress; \n  float m = smoothstep(-smoothness, 0.0, SQRT_2*distance(center, uv) - x*(1.0+smoothness)); \n  return mix(getFromColor(uv), getToColor(uv), opening > 0.5 ? 1.0 - m : m);\n}\n";
export declare const CIRCLEOPEN_UNIFORMS: Record<string, {
    value: any;
    type: string;
}>;
/**
 * CannabisLeaf transition configuration
 * Custom fragment shader and uniforms for CannabisLeaf transition
 * Creates a cannabis leaf-shaped reveal effect
 */
export declare const CANNABISLEAF_FRAGMENT = "\nvec4 transition (vec2 uv) {\n  if(progress == 0.0){\n    return getFromColor(uv);\n  }\n  vec2 leaf_uv = (uv - vec2(0.5))/10.0/pow(progress,3.5);\n  leaf_uv.y = -leaf_uv.y;\n  leaf_uv.y += 0.35;\n  float r = 0.18;\n  float o = atan(leaf_uv.y, leaf_uv.x);\n  return mix(getFromColor(uv), getToColor(uv), 1.0-step(1.0 - length(leaf_uv)+r*(1.0+sin(o))*(1.0+0.9 * cos(8.0*o))*(1.0+0.1*cos(24.0*o))*(0.9+0.05*cos(200.0*o)), 1.0));\n}\n";
export declare const CANNABISLEAF_UNIFORMS: Record<string, {
    value: any;
    type: string;
}>;
/**
 * StereoViewer transition configuration
 * Custom fragment shader and uniforms for StereoViewer transition
 * Creates a stereo viewer effect with rounded corners and cross rotation
 */
export declare const STEREOVIEWER_FRAGMENT = "\nuniform float zoom; // = 0.88\nuniform float corner_radius; // = 0.22\n\nconst vec4 black = vec4(0.0, 0.0, 0.0, 1.0);\nconst vec2 c00 = vec2(0.0, 0.0);\nconst vec2 c01 = vec2(0.0, 1.0);\nconst vec2 c11 = vec2(1.0, 1.0);\nconst vec2 c10 = vec2(1.0, 0.0);\n\nbool in_corner(vec2 p, vec2 corner, vec2 radius) { \n  vec2 axis = (c11 - corner) - corner; \n  p = p - (corner + axis * radius); \n  p *= axis / radius; \n  return (p.x > 0.0 && p.y > -1.0) || (p.y > 0.0 && p.x > -1.0) || dot(p, p) < 1.0;\n}\n\nbool test_rounded_mask(vec2 p, vec2 corner_size) { \n  return \n    in_corner(p, c00, corner_size) && \n    in_corner(p, c01, corner_size) && \n    in_corner(p, c10, corner_size) && \n    in_corner(p, c11, corner_size);\n}\n\nvec4 screen(vec4 a, vec4 b) { \n  return 1.0 - (1.0 - a) * (1.0 - b);\n}\n\nvec4 unscreen(vec4 c) { \n  return 1.0 - sqrt(1.0 - c);\n}\n\nvec4 sample_with_corners_from(vec2 p, vec2 corner_size) { \n  p = (p - 0.5) / zoom + 0.5; \n  if (!test_rounded_mask(p, corner_size)) { \n    return black; \n  } \n  return unscreen(getFromColor(p));\n}\n\nvec4 sample_with_corners_to(vec2 p, vec2 corner_size) { \n  p = (p - 0.5) / zoom + 0.5; \n  if (!test_rounded_mask(p, corner_size)) { \n    return black; \n  } \n  return unscreen(getToColor(p));\n}\n\nvec4 simple_sample_with_corners_from(vec2 p, vec2 corner_size, float zoom_amt) { \n  p = (p - 0.5) / (1.0 - zoom_amt + zoom * zoom_amt) + 0.5; \n  if (!test_rounded_mask(p, corner_size)) { \n    return black; \n  } \n  return getFromColor(p);\n}\n\nvec4 simple_sample_with_corners_to(vec2 p, vec2 corner_size, float zoom_amt) { \n  p = (p - 0.5) / (1.0 - zoom_amt + zoom * zoom_amt) + 0.5; \n  if (!test_rounded_mask(p, corner_size)) { \n    return black; \n  } \n  return getToColor(p);\n}\n\nmat3 rotate2d(float angle, float ratio) { \n  float s = sin(angle); \n  float c = cos(angle); \n  return mat3( \n    c, s, 0.0, \n    -s, c, 0.0, \n    0.0, 0.0, 1.0);\n}\n\nmat3 translate2d(float x, float y) { \n  return mat3( \n    1.0, 0.0, 0.0, \n    0.0, 1.0, 0.0, \n    -x, -y, 1.0);\n}\n\nmat3 scale2d(float x, float y) { \n  return mat3( \n    x, 0.0, 0.0, \n    0.0, y, 0.0, \n    0.0, 0.0, 1.0);\n}\n\n// Split an image and rotate one up and one down along off screen pivot points\nvec4 get_cross_rotated(vec3 p3, float angle, vec2 corner_size, float ratio) { \n  angle = angle * angle; // easing \n  angle /= 2.4; // works out to be a good number of radians \n\n  mat3 center_and_scale = translate2d(-0.5, -0.5) * scale2d(1.0, ratio); \n  mat3 unscale_and_uncenter = scale2d(1.0, 1.0/ratio) * translate2d(0.5, 0.5); \n  mat3 slide_left = translate2d(-2.0, 0.0); \n  mat3 slide_right = translate2d(2.0, 0.0); \n  mat3 rotate = rotate2d(angle, ratio); \n\n  mat3 op_a = center_and_scale * slide_right * rotate * slide_left * unscale_and_uncenter; \n  mat3 op_b = center_and_scale * slide_left * rotate * slide_right * unscale_and_uncenter; \n\n  vec4 a = sample_with_corners_from((op_a * p3).xy, corner_size); \n  vec4 b = sample_with_corners_from((op_b * p3).xy, corner_size); \n\n  return screen(a, b);\n}\n\n// Image stays put, but this time moves two masks\nvec4 get_cross_masked(vec3 p3, float angle, vec2 corner_size, float ratio) { \n  angle = 1.0 - angle; \n  angle = angle * angle; // easing \n  angle /= 2.4; \n\n  vec4 img; \n\n  mat3 center_and_scale = translate2d(-0.5, -0.5) * scale2d(1.0, ratio); \n  mat3 unscale_and_uncenter = scale2d(1.0 / zoom, 1.0 / (zoom * ratio)) * translate2d(0.5, 0.5); \n  mat3 slide_left = translate2d(-2.0, 0.0); \n  mat3 slide_right = translate2d(2.0, 0.0); \n  mat3 rotate = rotate2d(angle, ratio); \n\n  mat3 op_a = center_and_scale * slide_right * rotate * slide_left * unscale_and_uncenter; \n  mat3 op_b = center_and_scale * slide_left * rotate * slide_right * unscale_and_uncenter; \n\n  bool mask_a = test_rounded_mask((op_a * p3).xy, corner_size); \n  bool mask_b = test_rounded_mask((op_b * p3).xy, corner_size); \n\n  if (mask_a || mask_b) { \n    img = sample_with_corners_to(p3.xy, corner_size); \n    return screen(mask_a ? img : black, mask_b ? img : black); \n  } else { \n    return black; \n  }\n}\n\nvec4 transition(vec2 uv) { \n  float a; \n  vec2 p = uv.xy / vec2(1.0).xy; \n  vec3 p3 = vec3(p.xy, 1.0); \n\n  vec2 corner_size = vec2(corner_radius / ratio, corner_radius); \n\n  if (progress <= 0.0) { \n    return getFromColor(p); \n  } else if (progress < 0.1) { \n    a = progress / 0.1; \n    return simple_sample_with_corners_from(p, corner_size * a, a); \n  } else if (progress < 0.48) { \n    a = (progress - 0.1) / 0.38; \n    return get_cross_rotated(p3, a, corner_size, ratio); \n  } else if (progress < 0.9) { \n    return get_cross_masked(p3, (progress - 0.52) / 0.38, corner_size, ratio); \n  } else if (progress < 1.0) { \n    a = (1.0 - progress) / 0.1; \n    return simple_sample_with_corners_to(p, corner_size * a, a); \n  } else { \n    return getToColor(p); \n  }\n}\n";
export declare const STEREOVIEWER_UNIFORMS: Record<string, {
    value: any;
    type: string;
}>;
/**
 * GlitchDisplace transition configuration
 * Custom fragment shader for GlitchDisplace transition
 */
export declare const GLITCH_DISPLACE_FRAGMENT = "\nfloat random(vec2 co) { \n  float a = 12.9898; \n  float b = 78.233; \n  float c = 43758.5453; \n  float dt = dot(co.xy, vec2(a, b)); \n  float sn = mod(dt, 3.14); \n  return fract(sin(sn) * c);\n}\n\nfloat voronoi(vec2 x) { \n  vec2 p = floor(x); \n  vec2 f = fract(x); \n  float res = 8.0; \n  for(float j = -1.; j <= 1.; j++) \n    for(float i = -1.; i <= 1.; i++) { \n      vec2 b = vec2(i, j); \n      vec2 r = b - f + random(p + b); \n      float d = dot(r, r); \n      res = min(res, d); \n    } \n  return sqrt(res);\n}\n\nvec2 displace(vec4 tex, vec2 texCoord, float dotDepth, float textureDepth, float strength) { \n  float b = voronoi(.003 * texCoord + 2.0); \n  float g = voronoi(0.2 * texCoord); \n  float r = voronoi(texCoord - 1.0); \n  vec4 dt = tex * 1.0; \n  vec4 dis = dt * dotDepth + 1.0 - tex * textureDepth; \n\n  dis.x = dis.x - 1.0 + textureDepth * dotDepth; \n  dis.y = dis.y - 1.0 + textureDepth * dotDepth; \n  dis.x *= strength; \n  dis.y *= strength; \n  vec2 res_uv = texCoord; \n  res_uv.x = res_uv.x + dis.x - 0.0; \n  res_uv.y = res_uv.y + dis.y; \n  return res_uv;\n}\n\nfloat ease1(float t) { \n  return t == 0.0 || t == 1.0 \n    ? t \n    : t < 0.5 \n    ? +0.5 * pow(2.0, (20.0 * t) - 10.0) \n    : -0.5 * pow(2.0, 10.0 - (t * 20.0)) + 1.0;\n}\n\nfloat ease2(float t) { \n  return t == 1.0 ? t : 1.0 - pow(2.0, -10.0 * t);\n}\n\nvec4 transition(vec2 uv) { \n  vec2 p = uv.xy / vec2(1.0).xy; \n  vec4 color1 = getFromColor(p); \n  vec4 color2 = getToColor(p); \n  vec2 disp = displace(color1, p, 0.33, 0.7, 1.0 - ease1(progress)); \n  vec2 disp2 = displace(color2, p, 0.33, 0.5, ease2(progress)); \n  vec4 dColor1 = getToColor(disp); \n  vec4 dColor2 = getFromColor(disp2); \n  float val = ease1(progress); \n  vec3 gray = vec3(dot(min(dColor2, dColor1).rgb, vec3(0.299, 0.587, 0.114))); \n  dColor2 = vec4(gray, 1.0); \n  dColor2 *= 2.0; \n  color1 = mix(color1, dColor2, smoothstep(0.0, 0.5, progress)); \n  color2 = mix(color2, dColor1, smoothstep(1.0, 0.5, progress)); \n  return mix(color1, color2, val); \n}\n";
/**
 * CrossZoom transition configuration
 * Custom fragment shader and uniforms for CrossZoom transition
 */
export declare const CROSSZOOM_FRAGMENT = "\nuniform float strength; // = 0.4\n\nconst float PI = 3.141592653589793;\n\nfloat Linear_ease(float begin, float change, float duration, float time) { \n  return change * time / duration + begin;\n}\n\nfloat Exponential_easeInOut(float begin, float change, float duration, float time) { \n  if (time == 0.0) \n    return begin; \n  else if (time == duration) \n    return begin + change; \n  time = time / (duration / 2.0); \n  if (time < 1.0) \n    return change / 2.0 * pow(2.0, 10.0 * (time - 1.0)) + begin; \n  return change / 2.0 * (-pow(2.0, -10.0 * (time - 1.0)) + 2.0) + begin;\n}\n\nfloat Sine_easeInOut(float begin, float change, float duration, float time) { \n  return -change / 2.0 * (cos(PI * time / duration) - 1.0) + begin;\n}\n\nfloat rand(vec2 co) { \n  return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);\n}\n\nvec3 crossFade(vec2 uv, float dissolve) { \n  return mix(getFromColor(uv).rgb, getToColor(uv).rgb, dissolve);\n}\n\nvec4 transition(vec2 uv) { \n  vec2 texCoord = uv.xy / vec2(1.0).xy; \n\n  // Linear interpolate center across center half of the image \n  vec2 center = vec2(Linear_ease(0.25, 0.5, 1.0, progress), 0.5); \n  float dissolve = Exponential_easeInOut(0.0, 1.0, 1.0, progress); \n\n  // Mirrored sine loop. 0->strength then strength->0 \n  float strengthValue = Sine_easeInOut(0.0, strength, 0.5, progress); \n\n  vec3 color = vec3(0.0); \n  float total = 0.0; \n  vec2 toCenter = center - texCoord; \n\n  /* randomize the lookup values to hide the fixed number of samples */ \n  float offset = rand(uv); \n\n  for (float t = 0.0; t <= 40.0; t++) { \n    float percent = (t + offset) / 40.0; \n    float weight = 4.0 * (percent - percent * percent); \n    color += crossFade(texCoord + toCenter * percent * strengthValue, dissolve) * weight; \n    total += weight; \n  } \n  return vec4(color / total, 1.0);\n}\n";
export declare const CROSSZOOM_UNIFORMS: Record<string, {
    value: any;
    type: string;
}>;
/**
 * CrazyParametricFun transition configuration
 * Custom fragment shader and uniforms for CrazyParametricFun transition
 */
export declare const CRAZY_PARAMETRIC_FUN_FRAGMENT = "\nuniform float a; // = 4\nuniform float b; // = 1\nuniform float amplitude; // = 120\nuniform float smoothness; // = 0.1\n\nvec4 transition(vec2 uv) { \n  vec2 p = uv.xy / vec2(1.0).xy; \n  vec2 dir = p - vec2(.5); \n  float dist = length(dir); \n  float x = (a - b) * cos(progress) + b * cos(progress * ((a / b) - 1.)); \n  float y = (a - b) * sin(progress) - b * sin(progress * ((a / b) - 1.)); \n  vec2 offset = dir * vec2(sin(progress * dist * amplitude * x), sin(progress * dist * amplitude * y)) / smoothness; \n  return mix(getFromColor(p + offset), getToColor(p), smoothstep(0.2, 1.0, progress));\n}\n";
export declare const CRAZY_PARAMETRIC_FUN_UNIFORMS: Record<string, {
    value: any;
    type: string;
}>;
/**
 * ColourDistance transition configuration
 * Custom fragment shader and uniforms for ColourDistance transition
 */
export declare const COLOUR_DISTANCE_FRAGMENT = "\nuniform float power; // = 5.0\n\nvec4 transition(vec2 p) { \n  vec4 fTex = getFromColor(p); \n  vec4 tTex = getToColor(p); \n  float m = step(distance(fTex, tTex), progress); \n  return mix( \n    mix(fTex, tTex, m), \n    tTex, \n    pow(progress, power) \n  );\n}\n";
export declare const COLOUR_DISTANCE_UNIFORMS: Record<string, {
    value: any;
    type: string;
}>;
export declare const BOW_TIE_HORIZONTAL_FRAGMENT = "\n// License: MIT\n\nvec2 bottom_left = vec2(0.0, 1.0);\nvec2 bottom_right = vec2(1.0, 1.0);\nvec2 top_left = vec2(0.0, 0.0);\nvec2 top_right = vec2(1.0, 0.0);\n\nfloat check(vec2 p1, vec2 p2, vec2 p3)\n{\n  return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);\n}\n\nbool PointInTriangle (vec2 pt, vec2 p1, vec2 p2, vec2 p3)\n{\n    bool b1, b2, b3;\n    b1 = check(pt, p1, p2) < 0.0;\n    b2 = check(pt, p2, p3) < 0.0;\n    b3 = check(pt, p3, p1) < 0.0;\n    return ((b1 == b2) && (b2 == b3));\n}\n\nbool in_left_triangle(vec2 p){\n  vec2 vertex1, vertex2, vertex3;\n  vertex1 = vec2(progress, 0.5);\n  vertex2 = vec2(0.0, 0.5-progress);\n  vertex3 = vec2(0.0, 0.5+progress);\n  if (PointInTriangle(p, vertex1, vertex2, vertex3))\n  {\n    return true;\n  }\n  return false;\n}\n\nbool in_right_triangle(vec2 p){\n  vec2 vertex1, vertex2, vertex3;\n  vertex1 = vec2(1.0-progress, 0.5);\n  vertex2 = vec2(1.0, 0.5-progress);\n  vertex3 = vec2(1.0, 0.5+progress);\n  if (PointInTriangle(p, vertex1, vertex2, vertex3))\n  {\n    return true;\n  }\n  return false;\n}\n\nfloat blur_edge(vec2 bot1, vec2 bot2, vec2 top, vec2 testPt)\n{\n  vec2 lineDir = bot1 - top;\n  vec2 perpDir = vec2(lineDir.y, -lineDir.x);\n  vec2 dirToPt1 = bot1 - testPt;\n  float dist1 = abs(dot(normalize(perpDir), dirToPt1));\n  \n  lineDir = bot2 - top;\n  perpDir = vec2(lineDir.y, -lineDir.x);\n  dirToPt1 = bot2 - testPt;\n  float min_dist = min(abs(dot(normalize(perpDir), dirToPt1)), dist1);\n  \n  if (min_dist < 0.005) {\n    return min_dist / 0.005;\n  }\n  else  {\n    return 1.0;\n  };\n}\n\n\nvec4 transition (vec2 uv) {\n  if (in_left_triangle(uv))\n  {\n    if (progress < 0.1)\n    {\n      return getFromColor(uv);\n    }\n    if (uv.x < 0.5)\n    {\n      vec2 vertex1 = vec2(progress, 0.5);\n      vec2 vertex2 = vec2(0.0, 0.5-progress);\n      vec2 vertex3 = vec2(0.0, 0.5+progress);\n      return mix(\n        getFromColor(uv),\n        getToColor(uv),\n        blur_edge(vertex2, vertex3, vertex1, uv)\n      );\n    }\n    else\n    {\n      if (progress > 0.0)\n      {\n        return getToColor(uv);\n      }\n      else\n      {\n        return getFromColor(uv);\n      }\n    }    \n  }\n  else if (in_right_triangle(uv))\n  {\n    if (uv.x >= 0.5)\n    {\n      vec2 vertex1 = vec2(1.0-progress, 0.5);\n      vec2 vertex2 = vec2(1.0, 0.5-progress);\n      vec2 vertex3 = vec2(1.0, 0.5+progress);\n      return mix(\n        getFromColor(uv),\n        getToColor(uv),\n        blur_edge(vertex2, vertex3, vertex1, uv)\n      );  \n    }\n    else\n    {\n      return getFromColor(uv);\n    }\n  }\n  else {\n    return getFromColor(uv);\n  }\n}\n";
export declare const POLKA_DOTS_CURTAIN_FRAGMENT = "\n\nconst float SQRT_2 = 1.414213562373;\nuniform float dots;// = 20.0;\n\nvec4 transition(vec2 uv) {\n  bool nextImage = distance(fract(uv * dots), vec2(0.5, 0.5)) < ( progress / distance(uv, center));\n  return nextImage ? getToColor(uv) : getFromColor(uv);\n}\n";
