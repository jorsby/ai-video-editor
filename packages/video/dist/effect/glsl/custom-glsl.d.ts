export declare const ROTATION_MOVEMENT_FRAGMENT = "\nin vec2 vTextureCoord;\nin vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform float uTime;\nuniform float rotationCount; \n\nvoid main(void)\n{\n    vec2 center = vec2(0.35, 0.35);\n    vec2 uvs = vTextureCoord.xy - center;\n    \n    // Rotaci\u00F3n en funci\u00F3n de la cantidad de vueltas\n    float angle = uTime * rotationCount * 6.28318530718;\n    \n    float cosAngle = cos(angle);\n    float sinAngle = sin(angle);\n    mat2 rotation = mat2(cosAngle, -sinAngle, sinAngle, cosAngle);\n    \n    uvs = rotation * uvs;\n    uvs += center;\n    \n    if (uvs.x < 0.0 || uvs.x > 1.0 || uvs.y < 0.0 || uvs.y > 1.0) {\n        discard;\n    }\n    \n    vec4 fg = texture2D(uTexture, uvs);\n    gl_FragColor = fg;\n}\n";
export declare const ROTATION_MOVEMENT_UNIFORMS: Record<string, {
    value: any;
    type: string;
}>;
export declare const RED_GRADIENT_FRAGMENT = "\nin vec2 vTextureCoord;\nin vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform float uTime;\n\nvoid main(void)\n{\n    vec2 uvs = vTextureCoord.xy;\n\n    vec4 fg = texture2D(uTexture, vTextureCoord);\n\n    fg.r = uvs.y + sin(uTime);\n\n    gl_FragColor = fg;\n\n}\n";
export declare const RED_GRADIENT_UNIFORMS: Record<string, {
    value: any;
    type: string;
}>;
export declare const BUBBLE_SPARKLES_FRAGMENT = "\nin vec2 vTextureCoord;\nin vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform float uTime;\nuniform vec3 bubbleColor;\nuniform float bubbleCount;\n\nfloat rand(vec2 co){\n    return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);\n}\n\nfloat softCircle(vec2 uv, vec2 c, float r, float g) {\n    float d = distance(uv, c);\n    float base = 1.0 - smoothstep(r * 0.9, r, d);\n    float halo = (1.0 - smoothstep(r, r * (1.0 + g), d));\n    return base + halo * 0.5;\n}\n\nvec2 bubblePos(float id) {\n    float fx = rand(vec2(id, 1.234));\n    float fy = rand(vec2(id, 9.345));\n    return vec2(fx, fy);\n}\n\nfloat bubbleRadius(float id) {\n    return mix(0.015, 0.025, rand(vec2(id, 44.123)));\n}\n\nvoid main(void)\n{\n    vec2 uvs = vTextureCoord.xy;\n    vec4 fg = texture2D(uTexture, uvs);\n\n    float bubbles = 0.0;\n\n    for(float i = 0.0; i < 200.0; i++) {\n\n        if(i >= bubbleCount) break;\n        float spawnSpeed = 8.0; \n        float spawnTime = (i / bubbleCount) / spawnSpeed;\n        float t = uTime - spawnTime;\n\n        if(t < 0.0) continue;\n\n        float grow = pow(clamp(t, 0.0, 1.0), 0.35);\n\n        vec2 pos = bubblePos(i);\n        vec2 bubbleCenter = pos;\n\n        float baseR = bubbleRadius(i);\n\n        float r = baseR * grow;\n\n        float phase = rand(vec2(i, 999.0)) * 6.28318;\n        float pulse = sin(t * 1.6 + phase) * 0.5 + 0.5;\n        float opacity = mix(0.2, 1.0, pulse);\n\n        bubbles += softCircle(uvs, bubbleCenter, r, 0.8) * opacity;\n    }\n\n    fg.rgb += bubbleColor * bubbles;\n    gl_FragColor = fg;\n}\n";
export declare const BUBBLE_SPARKLES_UNIFORMS: Record<string, {
    value: any;
    type: string;
}>;
export declare const SEPIA_FRAGMENT = "\nin vec2 vTextureCoord;\nin vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform float uTime;      \nuniform float maxIntensity; \n\nvoid main(void)\n{\n    vec2 uvs = vTextureCoord.xy;\n    vec4 color = texture2D(uTexture, uvs);\n\n    float intensity = (sin(uTime) * 0.5 + 0.5) * maxIntensity;\n\n    vec3 sepiaColor;\n    sepiaColor.r = dot(color.rgb, vec3(0.393, 0.769, 0.189));\n    sepiaColor.g = dot(color.rgb, vec3(0.349, 0.686, 0.168));\n    sepiaColor.b = dot(color.rgb, vec3(0.272, 0.534, 0.131));\n\n    color.rgb = mix(color.rgb, sepiaColor, intensity);\n\n    gl_FragColor = color;\n}\n";
export declare const SEPIA_UNIFORMS: Record<string, {
    value: any;
    type: string;
}>;
export declare const UV_GRADIENT_FRAGMENT = "\nin vec2 vTextureCoord;\nin vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform vec3 colorStart;  \nuniform vec3 colorEnd;    \nuniform int direction;  \n\nvoid main(void)\n{\n    vec2 uvs = vTextureCoord.xy;\n    vec4 fg = texture2D(uTexture, uvs);\n\n    float t = 0.0;\n    if(direction == 0) {\n        t = uvs.x; \n    } else if(direction == 1) {\n        t = uvs.y;\n    } else {\n        t = (uvs.x + uvs.y) * 0.5;\n    }\n\n    vec3 gradientColor = mix(colorStart, colorEnd, t);\n\n    fg.rgb = fg.rgb * gradientColor; \n\n    gl_FragColor = fg;\n}\n";
export declare const UV_GRADIENT_UNIFORMS: Record<string, {
    value: any;
    type: string;
}>;
export declare const RAINBOW_FRAGMENT = "\nin vec2 vTextureCoord;\nin vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform float intensity;\nuniform int direction;   \n\nvec3 rainbow(float t) {\n    float r = 0.5 + 0.5 * sin(6.28318 * (t + 0.0));\n    float g = 0.5 + 0.5 * sin(6.28318 * (t + 0.33));\n    float b = 0.5 + 0.5 * sin(6.28318 * (t + 0.66));\n    return vec3(r, g, b);\n}\n\nvoid main(void)\n{\n    vec2 uvs = vTextureCoord.xy;\n    vec4 fg = texture2D(uTexture, uvs);\n\n    float t = 0.0;\n    if(direction == 0) {\n        t = uvs.x; \n    } else if(direction == 1) {\n        t = uvs.y; \n    } else {\n        t = (uvs.x + uvs.y) * 0.5; \n    }\n\n    vec3 rainbowColor = rainbow(t);\n\n    fg.rgb = fg.rgb * rainbowColor*intensity;\n\n    gl_FragColor = fg;\n}\n";
export declare const RAINBOW_UNIFORMS: Record<string, {
    value: any;
    type: string;
}>;
export declare const GLITCH_FRAGMENT = "\nin vec2 vTextureCoord;\nin vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform float uTime;     \nuniform float intensity;  \nuniform float sliceCount;   \nuniform float rgbShift;     \n\nfloat rand(float n) { return fract(sin(n) * 43758.5453123); }\nfloat rand2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }\n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord.xy;\n\n    float sliceId = floor(uv.y * sliceCount);\n    float sliceShift = (rand(sliceId + uTime * 10.0) - 0.5) * 0.2 * intensity;\n\n    uv.x += sliceShift;\n\n    float rShift = rgbShift * intensity;\n    float gShift = -rgbShift * 0.5 * intensity;\n    float bShift = rgbShift * 0.75 * intensity;\n\n    vec3 col;\n    col.r = texture2D(uTexture, uv + vec2(rShift, 0.0)).r;\n    col.g = texture2D(uTexture, uv + vec2(gShift, 0.0)).g;\n    col.b = texture2D(uTexture, uv + vec2(bShift, 0.0)).b;\n\n    float noise = rand2(vec2(uTime * 50.0, uv.y * 100.0));\n    float noiseIntensity = noise * 0.15 * intensity;\n\n    col += noiseIntensity;\n\n    gl_FragColor = vec4(col, 1.0);\n}\n";
export declare const GLITCH_UNIFORMS: Record<string, {
    value: any;
    type: string;
}>;
export declare const PIXELATE_FRAGMENT = "\nin vec2 vTextureCoord;\nin vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform float pixelSize;\nuniform float uTime;\nuniform float jitterStrength;\n\nfloat hash(vec2 p) {\n    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);\n}\n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord.xy;\n\n    vec2 pixelUV = floor(uv / pixelSize) * pixelSize;\n\n    float n1 = hash(pixelUV + uTime * 1.5);\n    float n2 = hash(pixelUV * 2.3 + uTime * 1.7);\n\n    vec2 jitter = (vec2(n1, n2) - 0.5) * jitterStrength * pixelSize;\n\n    vec2 finalUV = pixelUV + jitter;\n\n    finalUV = clamp(finalUV, 0.0, 1.0);\n    vec4 color = texture2D(uTexture, finalUV);\n\n    gl_FragColor = color;\n}\n";
export declare const PIXELATE_UNIFORMS: {
    pixelSize: {
        value: number;
        type: string;
    };
    uTime: {
        value: number;
        type: string;
    };
    jitterStrength: {
        value: number;
        type: string;
    };
};
export declare const RGB_GLITCH_FRAGMENT = "\nprecision highp float;\n\nvarying vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float uTime;\nuniform float glitchStrength;\nuniform float glitchSpeed;\n\nfloat hash(vec2 p) {\n    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);\n}\n\nfloat rand2(vec2 p) {\n    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);\n}\n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord;\n\n    vec4 base = texture2D(uTexture, uv);\n    if (base.a < 0.01) {\n        gl_FragColor = base;\n        return;\n    }\n\n    float lineNoise =\n        hash(vec2(floor(uv.y * 300.0), uTime * glitchSpeed));\n\n    float rOffset =\n        (hash(vec2(uTime, 1.0)) - 0.5) * glitchStrength;\n\n    float gOffset =\n        (hash(vec2(uTime, 2.0)) - 0.5) * glitchStrength * 0.5;\n\n    float bOffset =\n        (hash(vec2(uTime, 3.0)) - 0.5) * glitchStrength;\n\n    float rShift = rOffset * lineNoise;\n    float gShift = gOffset * lineNoise;\n    float bShift = bOffset * lineNoise;\n\n    vec2 uvR = clamp(uv + vec2(rShift, 0.0), 0.0, 1.0);\n    vec2 uvG = clamp(uv + vec2(gShift, 0.0), 0.0, 1.0);\n    vec2 uvB = clamp(uv + vec2(bShift, 0.0), 0.0, 1.0);\n\n    vec3 col;\n    col.r = texture2D(uTexture, uvR).r;\n    col.g = texture2D(uTexture, uvG).g;\n    col.b = texture2D(uTexture, uvB).b;\n\n    float noise =\n        (rand2(vec2(uTime * 50.0, uv.y * 100.0)) - 0.5) * 0.15;\n\n    col += noise;\n\n    gl_FragColor = vec4(col, base.a);\n}\n";
export declare const RGB_GLITCH_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    glitchStrength: {
        value: number;
        type: string;
    };
    glitchSpeed: {
        value: number;
        type: string;
    };
};
export declare const RGB_SHIFT_FRAGMENT = "\nprecision highp float;\n\nvarying vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float shiftAmount;\nuniform float angle;\nuniform float uTime;\nuniform float wobbleAmount;\nuniform float wobbleSpeed;\n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord;\n\n    vec4 base = texture2D(uTexture, uv);\n\n    if (base.a < 0.01) {\n        gl_FragColor = base;\n        return;\n    }\n\n    vec2 dir = vec2(cos(angle), sin(angle));\n    float wobble = sin(uTime * wobbleSpeed) * wobbleAmount;\n\n    vec2 rUV = uv + dir * shiftAmount + vec2(wobble, 0.0);\n    vec2 gUV = uv;\n    vec2 bUV = uv - dir * shiftAmount - vec2(wobble, 0.0);\n\n    rUV = clamp(rUV, 0.0, 1.0);\n    gUV = clamp(gUV, 0.0, 1.0);\n    bUV = clamp(bUV, 0.0, 1.0);\n\n    float r = texture2D(uTexture, rUV).r;\n    float g = texture2D(uTexture, gUV).g;\n    float b = texture2D(uTexture, bUV).b;\n\n    gl_FragColor = vec4(r, g, b, base.a);\n}\n";
export declare const RGB_SHIFT_UNIFORMS: {
    shiftAmount: {
        value: number;
        type: string;
    };
    angle: {
        value: number;
        type: string;
    };
    uTime: {
        value: number;
        type: string;
    };
    wobbleAmount: {
        value: number;
        type: string;
    };
    wobbleSpeed: {
        value: number;
        type: string;
    };
};
export declare const HALFTONE_FRAGMENT = "\nin vec2 vTextureCoord;\nin vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform float dotSize;       \nuniform float intensity;     \nuniform float angle;         \nuniform float uTime;        \nuniform float vibrateStrength;\n\nfloat luminance(vec3 c) {\n    return dot(c, vec3(0.299, 0.587, 0.114));\n}\n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord.xy;\n\n    float ca = cos(angle);\n    float sa = sin(angle);\n    mat2 rot = mat2(ca, -sa, sa, ca);\n    vec2 rotatedUV = rot * (uv - 0.5) + 0.5;\n    vec2 grid = rotatedUV / dotSize;\n    vec2 cell = floor(grid) + 0.5;\n\n    vec2 cellCenter = cell * dotSize;\n\n    float jitter = sin(uTime * 10.0 + cell.x * 12.989 + cell.y * 78.233) * 0.5;\n    float dist = distance(rotatedUV, cellCenter + jitter * vibrateStrength * dotSize);\n    vec4 texColor = texture2D(uTexture, uv);\n    float lum = luminance(texColor.rgb);\n    float radius = (1.0 - lum) * dotSize * 0.5;\n    float mask = smoothstep(radius, radius * 0.8, dist);\n\n    vec3 halftone = texColor.rgb * mask;\n    texColor.rgb = mix(texColor.rgb, halftone, intensity);\n\n    gl_FragColor = texColor;\n}\n";
export declare const HALFTONE_UNIFORMS: {
    dotSize: {
        value: number;
        type: string;
    };
    intensity: {
        value: number;
        type: string;
    };
    angle: {
        value: number;
        type: string;
    };
    uTime: {
        value: number;
        type: string;
    };
    vibrateStrength: {
        value: number;
        type: string;
    };
};
export declare const SINEWAVE_FRAGMENT = "\nin vec2 vTextureCoord;\nin vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform float uTime;     \nuniform float amplitude; \nuniform float frequency;  \nuniform float speed;    \nuniform int direction;    \n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord.xy;\n\n    vec2 offset = vec2(0.0);\n\n    if(direction == 0) {\n        offset.y = sin((uv.x + uTime * speed) * frequency * 6.2831853) * amplitude;\n    } else {\n        offset.x = sin((uv.y + uTime * speed) * frequency * 6.2831853) * amplitude;\n    }\n\n    vec4 color = texture2D(uTexture, uv + offset);\n    gl_FragColor = color;\n}\n";
export declare const SINEWAVE_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    amplitude: {
        value: number;
        type: string;
    };
    frequency: {
        value: number;
        type: string;
    };
    speed: {
        value: number;
        type: string;
    };
    direction: {
        value: number;
        type: string;
    };
};
export declare const SHINE_FRAGMENT = "\nin vec2 vTextureCoord;\nin vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform float uTime;          // tiempo para animaci\u00F3n\nuniform vec3 shineColor;      // color de los rayos\nuniform float rayWidth;       // grosor del rayo\nuniform float rayCount;       // cantidad de rayos\nuniform float rotationSpeed;  // velocidad de rotaci\u00F3n\n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord.xy;\n    vec2 center = vec2(0.3, 0.35);\n\n    vec2 dir = uv - center;\n\n    float angle = atan(dir.y, dir.x);\n\n    angle += uTime * rotationSpeed;\n\n    float normAngle = fract(angle / 6.28318530718); // 2\u03C0\n\n    float rays = sin(normAngle * rayCount * 6.28318530718);\n\n    float intensity = smoothstep(0.0, rayWidth, rays) - smoothstep(rayWidth, rayWidth*1.5, rays);\n\n    vec4 color = texture2D(uTexture, uv);\n\n    color.rgb += shineColor * intensity;\n\n    gl_FragColor = color;\n}\n";
export declare const SHINE_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    shineColor: {
        value: number[];
        type: string;
    };
    rayWidth: {
        value: number;
        type: string;
    };
    rayCount: {
        value: number;
        type: string;
    };
    rotationSpeed: {
        value: number;
        type: string;
    };
};
export declare const BLINK_FRAGMENT = "\nin vec2 vTextureCoord;\nin vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform float uTime;    \nuniform float blinkSpeed;  \nuniform float minIntensity; \nuniform float maxIntensity; \n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord.xy;\n    vec4 color = texture2D(uTexture, uv);\n    float t = sin(uTime * blinkSpeed * 6.2831853) * 0.5 + 0.5;\n    float intensity = mix(minIntensity, maxIntensity, t);\n\n    color.rgb *= intensity;\n\n    gl_FragColor = color;\n}\n";
export declare const BLINK_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    blinkSpeed: {
        value: number;
        type: string;
    };
    minIntensity: {
        value: number;
        type: string;
    };
    maxIntensity: {
        value: number;
        type: string;
    };
};
export declare const SPRING_FRAGMENT = "\nin vec2 vTextureCoord;\nin vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform float uTime;         \nuniform float frequency;      \nuniform float damping;      \nuniform float strength;      \n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord.xy;\n\n    float spring = exp(-damping * uTime) *\n                   sin(uTime * frequency * 6.2831853);\n\n    uv.x += spring * strength;\n    uv.y += spring * strength * 0.5; \n\n    vec4 color = texture2D(uTexture, uv);\n\n    gl_FragColor = color;\n}\n";
export declare const SPRING_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    frequency: {
        value: number;
        type: string;
    };
    damping: {
        value: number;
        type: string;
    };
    strength: {
        value: number;
        type: string;
    };
};
export declare const DUOTONE_FRAGMENT = "\nin vec2 vTextureCoord;\nin vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform vec3 colorA;     \nuniform vec3 colorB;    \nuniform float intensity; \n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord.xy;\n\n    vec4 tex = texture2D(uTexture, uv);\n    float gray = dot(tex.rgb, vec3(0.299, 0.587, 0.114));\n    vec3 duo = mix(colorA, colorB, gray);\n    tex.rgb = mix(tex.rgb, duo, intensity);\n    gl_FragColor = tex;\n}\n";
export declare const DUOTONE_UNIFORMS: {
    colorA: {
        value: number[];
        type: string;
    };
    colorB: {
        value: number[];
        type: string;
    };
    intensity: {
        value: number;
        type: string;
    };
};
export declare const TRITONE_FRAGMENT = "\nin vec2 vTextureCoord;\nin vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform vec3 colorShadow;   \nuniform vec3 colorMid;       \nuniform vec3 colorHighlight;\n\nuniform float intensity;    \n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord.xy;\n    vec4 tex = texture2D(uTexture, uv);\n    float gray = dot(tex.rgb, vec3(0.299, 0.587, 0.114));\n\n\n    vec3 duoA = mix(colorShadow, colorMid, smoothstep(0.0, 0.5, gray));\n    vec3 duoB = mix(colorMid, colorHighlight, smoothstep(0.5, 1.0, gray));\n    vec3 tritone = mix(duoA, duoB, smoothstep(0.33, 0.66, gray));\n    tex.rgb = mix(tex.rgb, tritone, intensity);\n\n    gl_FragColor = tex;\n}\n";
export declare const TRITONE_UNIFORMS: {
    colorShadow: {
        value: number[];
        type: string;
    };
    colorMid: {
        value: number[];
        type: string;
    };
    colorHighlight: {
        value: number[];
        type: string;
    };
    intensity: {
        value: number;
        type: string;
    };
};
export declare const HUE_SHIFT_FRAGMENT = "\nin vec2 vTextureCoord;\nin vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform float uTime;    \nuniform float amount;    \n\nvec3 hueShift(vec3 color, float angle) {\n    float cosA = cos(angle);\n    float sinA = sin(angle);\n    mat3 rot = mat3(\n        0.299 + 0.701 * cosA + 0.168 * sinA,\n        0.587 - 0.587 * cosA + 0.330 * sinA,\n        0.114 - 0.114 * cosA - 0.497 * sinA,\n\n        0.299 - 0.299 * cosA - 0.328 * sinA,\n        0.587 + 0.413 * cosA + 0.035 * sinA,\n        0.114 - 0.114 * cosA + 0.292 * sinA,\n\n        0.299 - 0.300 * cosA + 1.250 * sinA,\n        0.587 - 0.588 * cosA - 1.050 * sinA,\n        0.114 + 0.886 * cosA - 0.203 * sinA\n    );\n\n    return color * rot;\n}\n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord.xy;\n    vec4 tex = texture2D(uTexture, uv);\n\n    vec3 shifted = hueShift(tex.rgb, uTime*2.5);\n\n    tex.rgb = mix(tex.rgb, shifted, amount);\n\n    gl_FragColor = tex;\n}\n";
export declare const HUE_SHIFT_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    amount: {
        value: number;
        type: string;
    };
};
export declare const WARP_TRANSITION_FRAGMENT = "\nin vec2 vTextureCoord;\nin vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform float uTime;       \nuniform float uStrength;  \nuniform float swirl;      \n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord.xy;\n    vec2 center = vec2(0.5, 0.5);\n    vec2 dir = uv - center;\n    float dist = length(dir);\n    float warpAmount = pow(dist, 2.0) * uStrength * uTime;\n    float angle = swirl * uTime * 6.283185; \n\n    float s = sin(angle * dist);\n    float c = cos(angle * dist);\n\n    mat2 rot = mat2(c, -s, s, c);\n    vec2 warpedUV = center + rot * dir * (1.0 - warpAmount);\n    vec4 color = texture2D(uTexture, warpedUV);\n\n    gl_FragColor = color;\n}\n";
export declare const WARP_TRANSITION_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    uStrength: {
        value: number;
        type: string;
    };
    swirl: {
        value: number;
        type: string;
    };
};
export declare const SLIT_SCAN_FRAGMENT = "\nin vec2 vTextureCoord;\nin vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform float uTime;      \nuniform float uStrength;  \nuniform int direction;     \n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord.xy;\n    float offset;\n    if(direction == 0) {\n        offset = (uv.y - 0.5) * uStrength * uTime;\n        uv.x += offset;\n    } else {\n        offset = (uv.x - 0.5) * uStrength * uTime;\n        uv.y += offset;\n    }\n\n    vec4 color = texture2D(uTexture, uv);\n\n    gl_FragColor = color;\n}\n";
export declare const SLIT_SCAN_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    uStrength: {
        value: number;
        type: string;
    };
    direction: {
        value: number;
        type: string;
    };
};
export declare const SLIT_SCAN_GLITCH_FRAGMENT = "\nin vec2 vTextureCoord;\nin vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform float uTime;\nuniform float uStrength;\nuniform float uNoise;\nuniform int direction;\n\nfloat hash(float n) {\n    return fract(sin(n) * 43758.5453);\n}\n\nfloat hash(vec2 p) {\n    return fract(sin(dot(p ,vec2(12.9898,78.233))) * 43758.5453);\n}\n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord.xy;\n\n    float offset;\n    if(direction == 0) {\n        offset = (uv.y - 0.5) * uStrength * uTime;\n        uv.x += offset;\n    } else {\n        offset = (uv.x - 0.5) * uStrength * uTime;\n        uv.y += offset;\n    }\n\n    float jitter = (hash(floor(uv * 100.0) + uTime) - 0.5) * uNoise;\n    if(direction == 0) {\n        uv.x += jitter;\n    } else {\n        uv.y += jitter;\n    }\n\n    float rOffset = (hash(uv + 1.0) - 0.5) * uNoise * 0.5;\n    float gOffset = (hash(uv + 2.0) - 0.5) * uNoise * 0.5;\n    float bOffset = (hash(uv + 3.0) - 0.5) * uNoise * 0.5;\n\n    vec4 texR = texture2D(uTexture, uv + vec2(rOffset, 0.0));\n    vec4 texG = texture2D(uTexture, uv + vec2(gOffset, 0.0));\n    vec4 texB = texture2D(uTexture, uv + vec2(bOffset, 0.0));\n\n    gl_FragColor = vec4(texR.r, texG.g, texB.b, 1.0);\n}\n";
export declare const SLIT_SCAN_GLITCH_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    uStrength: {
        value: number;
        type: string;
    };
    uNoise: {
        value: number;
        type: string;
    };
    direction: {
        value: number;
        type: string;
    };
};
export declare const PIXELATE_TRANSITION_FRAGMENT = "\nin vec2 vTextureCoord;\nin vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform float uTime;       \nuniform float maxPixelSize; \n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord.xy;\n    float pixelSize = maxPixelSize * uTime;\n    pixelSize = max(pixelSize, 0.001);\n    vec2 pixelUV = floor(uv / pixelSize) * pixelSize;\n\n    vec4 color = texture2D(uTexture, pixelUV);\n\n    gl_FragColor = color;\n}\n";
export declare const PIXELATE_TRANSITION_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    maxPixelSize: {
        value: number;
        type: string;
    };
};
export declare const FOCUS_TRANSITION_FRAGMENT = "\nin vec2 vTextureCoord;\nin vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform float uTime;       \nuniform float maxBlur;    \n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord.xy;\n    vec4 color = vec4(0.0);\n    float blur = maxBlur * (1.0 - uTime);\n\n    if(blur < 0.001) {\n        color = texture2D(uTexture, uv);\n    } else {\n        vec2 offsets[9];\n        offsets[0] = vec2(-blur, -blur);\n        offsets[1] = vec2(0.0, -blur);\n        offsets[2] = vec2(blur, -blur);\n        offsets[3] = vec2(-blur, 0.0);\n        offsets[4] = vec2(0.0, 0.0);\n        offsets[5] = vec2(blur, 0.0);\n        offsets[6] = vec2(-blur, blur);\n        offsets[7] = vec2(0.0, blur);\n        offsets[8] = vec2(blur, blur);\n\n        for(int i = 0; i < 9; i++) {\n            color += texture2D(uTexture, uv + offsets[i]);\n        }\n\n        color /= 9.0;\n    }\n\n    gl_FragColor = color;\n}\n";
export declare const FOCUS_TRANSITION_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    maxBlur: {
        value: number;
        type: string;
    };
};
export declare const INVERT_FRAGMENT = "\nprecision highp float;\n\nvarying vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float amount;\n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord;\n    vec4 tex = texture2D(uTexture, uv);\n\n    vec3 inverted = vec3(1.0) - tex.rgb;\n\n    float strength = amount * tex.a;\n\n    tex.rgb = mix(tex.rgb, inverted, strength);\n\n    gl_FragColor = tex;\n}\n";
export declare const INVERT_UNIFORMS: {
    amount: {
        value: number;
        type: string;
    };
};
export declare const GRAYSCALE_FRAGMENT = "\nin vec2 vTextureCoord;\nin vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform float amount; \n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord.xy;\n    vec4 tex = texture2D(uTexture, uv);\n    float gray = dot(tex.rgb, vec3(0.299, 0.587, 0.114));\n    vec3 grayscale = vec3(gray);\n\n    tex.rgb = mix(tex.rgb, grayscale, amount);\n\n    gl_FragColor = tex;\n}\n";
export declare const GRAYSCALE_UNIFORMS: {
    amount: {
        value: number;
        type: string;
    };
};
export declare const VIGNETTE_FRAGMENT = "\nin vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float uIntensity;  \nuniform float uSoftness;  \n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord.xy;\n\n    vec2 centered = uv - vec2(0.5);\n    float dist = length(centered);\n    float vignette = smoothstep(0.5, 0.5 - uSoftness, dist);\n    vec4 color = texture(uTexture, uv);\n    color.rgb *= 1.0 - (vignette * uIntensity);\n\n    gl_FragColor = color;\n}\n";
export declare const VIGNETTE_UNIFORMS: {
    uIntensity: {
        value: number;
        type: string;
    };
    uSoftness: {
        value: number;
        type: string;
    };
};
export declare const CHROMATIC_FRAGMENT = "\nin vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float uIntensity; \nuniform vec2 uDirection;  \n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord;\n    vec2 offset = uDirection * uIntensity;\n    float r = texture(uTexture, uv + offset).r;\n    float g = texture(uTexture, uv).g;\n    float b = texture(uTexture, uv - offset).b;\n    vec4 color = vec4(r, g, b, 1.0);\n\n    gl_FragColor = color;\n}\n";
export declare const CHROMATIC_UNIFORMS: {
    uIntensity: {
        value: number;
        type: string;
    };
    uDirection: {
        value: number[];
        type: string;
    };
};
export declare const SWIRL_MOVEMENT_FRAGMENT = "\nin vec2 vTextureCoord;\nin vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform float uTime;\nuniform float rotationCount;\n\nuniform float swirlStrength; \nuniform float swirlRadius;   \nuniform float rainbowIntensity;\n\nvec3 hsv2rgb(vec3 c)\n{\n    vec3 rgb = clamp( abs(mod(c.x*6.0 + vec3(0.0,4.0,2.0), 6.0) - 3.0) - 1.0,\n                      0.0,\n                      1.0 );\n    return c.z * mix(vec3(1.0), rgb, c.y);\n}\n\nfloat flamePattern(float dist, float angle, float time) {\n    return pow(sin(dist * 10.0 - time * 5.0 + angle * 5.0) * 0.5 + 0.5, 2.0);\n}\n\nvoid main(void)\n{\n    vec2 center = vec2(0.3, 0.45);\n    vec2 uvs = vTextureCoord - center;\n\n    // fade del rainbow (0 cuando uTime >= 0.75)\n    float fadeRainbow = clamp(1.0 - smoothstep(0.7, 0.75, uTime), 0.0, 1.0);\n\n    // fade de swirl, wave y blur (disminuye entre 0.8 y 1.0)\n    float fadeMotion = clamp(1.0 - smoothstep(0.8, 1.0, uTime), 0.0, 1.0);\n\n    // \u00E1ngulo total acumulado para mantener la direcci\u00F3n del giro\n    float angleTotal = uTime * rotationCount * 6.2831853; \n\n    float cosA = cos(angleTotal);\n    float sinA = sin(angleTotal);\n    mat2 rotation = mat2(cosA, -sinA, sinA, cosA);\n    vec2 rotatedUV = rotation * uvs + center;\n\n    float dist = distance(rotatedUV, center);\n    float d = clamp(dist / swirlRadius, 0.0, 1.0);\n\n    // swirl disminuye suavemente sin invertir la direcci\u00F3n\n    float swirlAngle = swirlStrength * d * d * 6.2831853 * fadeMotion;\n    float cosS = cos(swirlAngle);\n    float sinS = sin(swirlAngle);\n\n    vec2 dir = rotatedUV - center;\n    rotatedUV = vec2(\n        dir.x * cosS - dir.y * sinS,\n        dir.x * sinS + dir.y * cosS\n    ) + center;\n\n    float wave = sin(dist * 12.0 - uTime * 4.0) * 0.015 * fadeMotion; \n    rotatedUV += wave * normalize(dir);\n\n    // blur de la textura\n    vec4 color = vec4(0.0);\n    float blurAmount = (0.004 + rotationCount * 0.001) * fadeMotion; \n\n    for (int i = -3; i <= 3; i++) {\n        float offset = float(i) * blurAmount;\n        vec2 blurUV = rotatedUV + vec2(offset * cosA, offset * sinA);\n        color += texture2D(uTexture, blurUV);\n    }\n    color /= 7.0;\n\n    // rainbow\n    float rainbowScale = 0.05;\n    float ang = atan(dir.y, dir.x);\n    float hue = (ang / 6.2831853) + 0.5 + dist * rainbowScale;\n    hue += uTime * 0.2 + rotationCount * 0.05;\n\n    vec3 rainbow = hsv2rgb(vec3(hue, 0.35, 1.0));\n    color.rgb = mix(color.rgb, rainbow, rainbowIntensity * fadeRainbow);\n\n    // Flame disminuye con fadeMotion\n    float flame = flamePattern(dist, ang, uTime) * fadeMotion;\n    vec3 flameColor = vec3(1.0, 0.5, 0.0) * flame;\n    flameColor = mix(flameColor, vec3(1.0,1.0,0.2), flame * 0.5);\n    color.rgb += flameColor * 0.3;\n\n    if (rotatedUV.x < 0.0 || rotatedUV.x > 1.0 || rotatedUV.y < 0.0 || rotatedUV.y > 1.0) {\n        discard;\n    }\n\n    gl_FragColor = color;\n}\n\n";
export declare const SWIRL_MOVEMENT_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    rotationCount: {
        value: number;
        type: string;
    };
    swirlStrength: {
        value: number;
        type: string;
    };
    swirlRadius: {
        value: number;
        type: string;
    };
    rainbowIntensity: {
        value: number;
        type: string;
    };
};
export declare const HEART_SPARKLES_FRAGMENT = "\nin vec2 vTextureCoord;\nin vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform float uTime;\nuniform vec3 heartColor;\nuniform float heartCount;\n\nfloat rand(vec2 co){\n    return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);\n}\n\nfloat heartShape(vec2 p) {\n    p = (p - 0.5) * 2.0;   \n    p.y = -p.y;           \n    p.y += 0.25;          \n    float x = p.x;\n    float y = p.y;\n    float val = pow(x*x + y*y - 1.0, 3.0) - x*x * y*y*y;\n    return smoothstep(0.0, 0.02, -val);\n}\n\nvec2 heartPos(float id) {\n    float fx = rand(vec2(id, 1.234)) * 0.85 - 0.025; \n    float fy = rand(vec2(id, 1.345)) * 0.85 + 0.025;\n    return vec2(fx, fy);\n}\n\nfloat heartSize(float id) {\n    return mix(0.02, 0.05, rand(vec2(id, 44.123))); \n}\n\nvoid main() {\n    vec2 uv = vTextureCoord.xy;\n    vec4 base = texture2D(uTexture, uv);\n\n    float hearts = 0.0;\n\n    for(float i = 0.0; i < 200.0; i++) {\n        if(i >= heartCount) break;\n\n        vec2 pos = heartPos(i);\n        float size = heartSize(i);\n\n        float vibX = (rand(vec2(i, uTime)) - 0.5) * 0.02;\n        float vibY = (rand(vec2(i+1.0, uTime)) - 0.5) * 0.02;\n\n        vec2 heartUV = (uv - (pos + vec2(vibX, vibY))) / size + 0.5;\n\n        float h = heartShape(heartUV);\n\n        float pulse = sin(uTime * 4.0 + i) * 0.2 + 1.0;\n        h *= pulse;\n\n        hearts += h;\n    }\n\n    base.rgb += heartColor * hearts;\n    gl_FragColor = base;\n}\n";
export declare const HEART_SPARKLES_UNIFORMS: Record<string, {
    value: any;
    type: string;
}>;
export declare const BUTTERFLY_SPARKLES_FRAGMENT = "\nin vec2 vTextureCoord;\nin vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform float uTime;\nuniform vec3 butterflyColor;\nuniform float butterflyCount;\n\nfloat rand(vec2 co){\n    return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);\n}\n\nfloat wing(vec2 p) {\n    float d = pow(p.x, 2.0) + pow(p.y * 1.2, 2.0);\n    return smoothstep(0.3, 0.0, d);\n}\n\nfloat butterflyShape(vec2 uv) {\n    vec2 p = (uv - 0.5) * 2.0;\n\n    float body = smoothstep(0.12, 0.05, abs(p.x)) \n               * smoothstep(0.4, 0.0, abs(p.y));\n\n    float wL = wing(vec2(p.x * 1.2 + 0.6, p.y));\n    float wR = wing(vec2(p.x * 1.2 - 0.6, p.y));\n\n    return clamp(wL + wR + body, 0.0, 1.0);\n}\nvec2 butterflyPos(float id) {\n    float fx = rand(vec2(id, 1.234)) * 0.85 - 0.025;\n    float fy = rand(vec2(id, 1.345)) * 0.85 + 0.025;\n    return vec2(fx, fy);\n}\n\nfloat butterflySize(float id) {\n    return mix(0.03, 0.08, rand(vec2(id, 44.123)));\n}\n\nvoid main() {\n    vec2 uv = vTextureCoord.xy;\n    vec4 base = texture2D(uTexture, uv);\n\n    float butterflies = 0.0;\n\n    for(float i = 0.0; i < 200.0; i++) {\n        if(i >= butterflyCount) break;\n\n        vec2 pos = butterflyPos(i);\n        float size = butterflySize(i);\n\n        float vibX = (rand(vec2(i, uTime)) - 0.5) * 0.02;\n        float vibY = (rand(vec2(i+1.0, uTime)) - 0.5) * 0.02;\n\n        vec2 bUV = (uv - (pos + vec2(vibX, vibY))) / size + 0.5;\n\n        float b = butterflyShape(bUV);\n\n        float pulse = sin(uTime * 3.0 + i) * 0.25 + 1.0;\n        b *= pulse;\n\n        butterflies += b;\n    }\n\n    base.rgb += butterflyColor * butterflies;\n    gl_FragColor = base;\n}\n";
export declare const BUTTERFLY_SPARKLES_UNIFORMS: Record<string, {
    value: any;
    type: string;
}>;
export declare const DISTORT_EFFECT_FRAGMENT = "\nin vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float amplitude; \nuniform float speed;     \nuniform float uTime;  \n\nvoid main() {\n    vec2 p = vTextureCoord;\n    vec2 center = vec2(0.28, 0.45);\n\n    vec2 dir = p - center;\n    float dist = length(dir);\n\n    vec2 offset = vec2(0.0);\n\n    if (dist <= uTime) {\n        offset = dir * sin(dist * amplitude - uTime * speed);\n    }\n\n    gl_FragColor = texture2D(uTexture, p + offset);\n}\n";
export declare const DISTORT_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    amplitude: {
        value: number;
        type: string;
    };
    speed: {
        value: number;
        type: string;
    };
};
export declare const PERSPECTIVE_SINGLE_FRAGMENT = "\nprecision mediump float;\n\nuniform sampler2D uTexture;\nuniform float persp;      \nuniform float unzoom;     \nuniform float reflection; \nuniform float floating;   \nuniform float uTime;\n\nvarying vec2 vTextureCoord;\n\nbool inBounds(vec2 p) {\n    return all(greaterThanEqual(p, vec2(0.0))) &&\n           all(lessThanEqual(p, vec2(1.0)));\n}\n\nvec2 project(vec2 p) {\n    return p * vec2(1.0, -1.2) + vec2(0.0, -floating / 100.0);\n}\n\nvec2 xskew(vec2 p, float persp, float center) {\n    float x = mix(p.x, 1.0 - p.x, center);\n\n    return (\n        (\n            vec2(\n                x,\n                (p.y - 0.5*(1.0-persp) * x) /\n                (1.0+(persp-1.0)*x)\n            )\n            - vec2(0.5 - abs(center - 0.5), 0.0)\n        )\n        * vec2(\n            0.5 / abs(center - 0.5) * (center < 0.5 ? 1.0 : -1.0),\n            1.0\n        )\n        + vec2(center < 0.5 ? 0.0 : 1.0, 0.0)\n    );\n}\n\nvoid main() {\n    vec2 p = vTextureCoord;\n\n    float uz = unzoom * sin(uTime * 0.5);\n    p = -uz * 0.5 + (1.0 + uz) * p;\n\n    vec2 warped = xskew(p, persp, 0.0);\n\n    vec4 baseColor = vec4(0.0);\n\n    if (inBounds(warped)) {\n        baseColor = texture2D(uTexture, warped);\n    }\n\n    vec2 proj = project(warped);\n    if (inBounds(proj)) {\n        vec4 refl = texture2D(uTexture, proj);\n        refl.rgb *= reflection * (1.0 - proj.y);\n        baseColor += refl;\n    }\n\n    gl_FragColor = baseColor;\n}\n\n";
export declare const PERSPECTIVE_SINGLE_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    persp: {
        value: number;
        type: string;
    };
    unzoom: {
        value: number;
        type: string;
    };
    reflection: {
        value: number;
        type: string;
    };
    floating: {
        value: number;
        type: string;
    };
};
export declare const DISTORT_SPIN_FRAGMENT = "\nin vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float uTime;        \nuniform float radius;       \nuniform float spinPower;    \nuniform float speed;       \n\nvoid main() {\n    vec2 uv = vTextureCoord;\n    vec2 center = vec2(0.28, 0.45);\n\n    vec2 pos = uv - center;\n\n    float dist = length(pos);\n\n    if (dist < radius) {\n        float percent = (radius - dist) / radius;\n\n        float theta = percent * percent * spinPower * sin(uTime * speed);\n\n        float s = sin(theta);\n        float c = cos(theta);\n\n        pos = vec2(\n            pos.x * c - pos.y * s,\n            pos.x * s + pos.y * c\n        );\n    }\n\n    uv = pos + center;\n\n    gl_FragColor = texture2D(uTexture, uv);\n}\n";
export declare const DISTORT_SPIN_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    radius: {
        value: number;
        type: string;
    };
    spinPower: {
        value: number;
        type: string;
    };
    speed: {
        value: number;
        type: string;
    };
};
export declare const DISTORT_GRID_FRAGMENT = "\nin vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float uTime;\n\nuniform float speed;        \nuniform float intensity;    \nuniform int endx;\nuniform int endy;\n\n#define PI 3.14159265358979323\n\nfloat rand(vec2 v) {\n    return fract(sin(dot(v.xy , vec2(12.9898,78.233))) * 43758.5453);\n}\n\nvec2 rotate2d(vec2 v, float a) {\n    mat2 rm = mat2(cos(a), -sin(a),\n                   sin(a),  cos(a));\n    return rm * v;\n}\n\nvoid main() {\n    vec2 uv = vTextureCoord;\n\n    vec2 p = uv - 0.5;\n\n    float t = sin(uTime * speed) * 0.5 + 0.5;\n\n    float warp = 1.0 + intensity * abs(t - 0.5);\n\n    vec2 rp = p * warp;\n    float tx = float(endx) + 0.5;\n    float ty = float(endy) + 0.5;\n\n    vec2 shifted = mix(vec2(0.5, 0.5), vec2(tx, ty), t*t);\n\n    vec2 tiled = fract(rp + shifted);\n\n    vec2 cell = floor(rp + shifted);\n\n    bool isEnd = int(cell.x) == endx && int(cell.y) == endy;\n\n    if (!isEnd) {\n        float rnd = rand(cell);\n        float angle = float(int(rnd * 4.0)) * 0.5 * PI;\n        tiled = vec2(0.5) + rotate2d(tiled - vec2(0.5), angle);\n    }\n    gl_FragColor = texture2D(uTexture, tiled);\n}\n";
export declare const DISTORT_GRID_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    speed: {
        value: number;
        type: string;
    };
    intensity: {
        value: number;
        type: string;
    };
    endx: {
        value: number;
        type: string;
    };
    endy: {
        value: number;
        type: string;
    };
};
export declare const DISTORT_RIP_FRAGMENT = "\nprecision highp float;\n\nin vec2 vTextureCoord;\nuniform sampler2D uTexture;\nuniform float uTime;\n\nuniform float intensity;    \nuniform float speed;        \nuniform int slices;         \nuniform float randomness;   \n\n#define PI 3.141592653589793\nfloat rand(float x) {\n    return fract(sin(x * 12.9898) * 43758.5453);\n}\n\nvoid main() {\n    vec2 uv = vTextureCoord;\n\n    float sliceHeight = 1.0 / float(slices);\n    float sliceIndex = floor(uv.y / sliceHeight);\n\n    float offsetX = (rand(sliceIndex + uTime * speed) - 0.5) * intensity;\n\n    float offsetY = sin(uTime * speed + sliceIndex * 1.5) * 0.01 * randomness;\n\n    uv.x += offsetX;\n    uv.y += offsetY;\n    vec4 color = texture(uTexture, uv);\n\n    gl_FragColor = color;\n}\n\n";
export declare const DISTORT_RIP_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    intensity: {
        value: number;
        type: string;
    };
    speed: {
        value: number;
        type: string;
    };
    slices: {
        value: number;
        type: string;
    };
    randomness: {
        value: number;
        type: string;
    };
};
export declare const TWO_CURTAIN_FRAGMENT = "\nprecision highp float;\n\nin vec2 vTextureCoord;\nuniform sampler2D uTexture;\nuniform float uTime;      \nuniform float softness;   \n\nvoid main() {\n    vec2 uv = vTextureCoord;\n\n    float t_raw = clamp(uTime, 0.0, 1.0);\n    float t = pow(t_raw, 0.55);\n\n    float mid = 0.5;\n\n    float leftEdge = mid - t * mid;\n    float rightEdge = mid + t * mid;\n\n    float mask = smoothstep(leftEdge, leftEdge + softness, uv.x) *\n                 (1.0 - smoothstep(rightEdge - softness, rightEdge, uv.x));\n\n    vec4 color = texture(uTexture, uv);\n\n    gl_FragColor = vec4(color.rgb * mask, color.a * mask);\n}\n";
export declare const TWO_CURTAIN_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    softness: {
        value: number;
        type: string;
    };
};
export declare const TRIANGLE_PATTERN_EFFECT_FRAGMENT = "\nprecision highp float;\n\nin vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float uTime;\nuniform float softness;\nuniform float zoom;\n\n#define PI 3.141592653589793\n\nvec2 rotate2D(vec2 st, float angle) {\n    st -= 0.5;\n    st = mat2(cos(angle), -sin(angle),\n              sin(angle),  cos(angle)) * st;\n    st += 0.5;\n    return st;\n}\n\nvec2 tile(vec2 st, float zoom) {\n    st *= zoom;\n    return fract(st);\n}\n\nvec2 rotateTile(vec2 st) {\n    st *= 2.0;\n\n    float index = 0.0;\n    if (fract(st.x * 0.5) > 0.5) index += 1.0;\n    if (fract(st.y * 0.5) > 0.5) index += 2.0;\n\n    st = fract(st);\n\n    if (index == 1.0)      st = rotate2D(st, PI * 0.5);\n    else if (index == 2.0) st = rotate2D(st, PI * -0.5);\n    else if (index == 3.0) st = rotate2D(st, PI);\n\n    return st;\n}\n\nfloat triangleShape(vec2 st, float smoothness) {\n    vec2 p0 = vec2(0.3, -0.5);\n    vec2 p1 = vec2(0.7, -0.5);\n    vec2 p2 = vec2(0.5, 1.0);\n\n    vec3 e0, e1, e2;\n\n    e0.xy = normalize(p1 - p0).yx * vec2(+1.0, -1.0);\n    e1.xy = normalize(p2 - p1).yx * vec2(+1.0, -1.0);\n    e2.xy = normalize(p0 - p2).yx * vec2(+1.0, -1.0);\n\n    e0.z = dot(e0.xy, p0) - smoothness;\n    e1.z = dot(e1.xy, p1) - smoothness;\n    e2.z = dot(e2.xy, p2) - smoothness;\n\n    float a = max(0.0, dot(e0.xy, st) - e0.z);\n    float b = max(0.0, dot(e1.xy, st) - e1.z);\n    float c = max(0.0, dot(e2.xy, st) - e2.z);\n\n    return smoothstep(smoothness * 2.0, 1e-7, length(vec3(a, b, c)));\n}\n\nvoid main() {\n    vec2 uv = vTextureCoord;\n    vec2 st = uv;\n    st = tile(st, zoom);\n    st = rotateTile(st);\n    st = rotate2D(st, -PI * 0.25 * uTime);\n\n    float mask = triangleShape(st, softness);\n\n    vec4 tex = texture(uTexture, uv);\n    gl_FragColor = vec4(tex.rgb * mask, tex.a * mask);\n}\n";
export declare const TRIANGLE_PATTERN_EFFECT_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    softness: {
        value: number;
        type: string;
    };
    zoom: {
        value: number;
        type: string;
    };
};
export declare const MIRROR_TILE_FRAGMENT = "\nprecision highp float;\n\nin vec2 vTextureCoord;\nuniform sampler2D uTexture;\nuniform float uTime;\n\nvec2 mirrorTile(vec2 st, float zoom) {\n    st *= zoom;\n\n    if (fract(st.y * 0.5) > 0.5) {\n        st.x = st.x + 0.5;\n        st.y = 1.0 - st.y;\n    }\n\n    return fract(st);\n}\n\nfloat zigzag(vec2 st) {\n    float x = st.x * 2.0;\n    float a = floor(1.0 + sin(x * 3.14159));\n    float b = floor(1.0 + sin((x + 1.0) * 3.14159));\n    float f = fract(x);\n    return mix(a, b, f);\n}\n\nvoid main() {\n    vec2 st = vTextureCoord;\n\n    st = mirrorTile(st * vec2(1.0, 2.0), 5.0);\n\n    float zz = zigzag(st);\n\n    st.y += zz * 0.03;\n\n    vec4 tex = texture(uTexture, st);\n\n    gl_FragColor = tex;\n}\n";
export declare const MIRROR_TILE_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
};
export declare const FLASH_LOOP_FRAGMENT = "\nprecision highp float;\n\nin vec2 vTextureCoord;\nin vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform float uTime;\nuniform float speed;      \nuniform float intensity;  \n\nvoid main(void)\n{\n    vec4 tex = texture2D(uTexture, vTextureCoord);\n    float t = fract(uTime * speed);\n    float wave = sin(t * 3.141592);\n    float base = 0.6;\n    float brightness = mix(base, 1.0, wave);\n    float flash = 1.0 + brightness * intensity;\n\n    vec3 color = tex.rgb * flash;\n\n    gl_FragColor = vec4(color, tex.a);\n}\n";
export declare const FLASH_LOOP_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    speed: {
        value: number;
        type: string;
    };
    intensity: {
        value: number;
        type: string;
    };
};
export declare const FILM_STRIP_PRO_FRAGMENT = "\nprecision highp float;\n\nin vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float uTime;\n\nuniform float framesPerScreen;\nuniform float scrollSpeed;\nuniform float gateWeave;\n\nvoid main() {\n    vec2 uv = vTextureCoord;\n\n    vec3 color = vec3(0.0);\n\n    uv.y += uTime * scrollSpeed;\n    uv.y += sin(uTime * 2.0) * 0.003 * gateWeave;\n\n    float stripLeft  = 0.025;\n    float stripRight = 0.5;\n\n    if (uv.x < stripLeft || uv.x > stripRight) {\n        gl_FragColor = vec4(color, 1.0);\n        return;\n    }\n\n    vec2 stripUV;\n    stripUV.x = (uv.x - stripLeft) / (stripRight - stripLeft);\n    stripUV.y = fract(uv.y);\n\n    float holeZone = 0.06; \n    float frameZone = 1.0 - holeZone * 2.0;\n\n    float frameH = 1.0 / framesPerScreen;\n    float localY = fract(stripUV.y / frameH);\n\n    bool inFrameX =\n        stripUV.x > holeZone &&\n        stripUV.x < holeZone + frameZone;\n\n    float marginX = 0.08;\n    float marginY = 0.10;\n\n\n    bool insideFrame =\n        inFrameX &&\n        stripUV.x > holeZone + marginX &&\n        stripUV.x < holeZone + frameZone - marginX &&\n        localY > marginY &&\n        localY < 1.0 - marginY;\n\n    float frameZoneX = frameZone - marginX * 4.0;\n    float centerOffset = (1.0 - frameZoneX - holeZone * 2.0) * 0.5;\n\n    vec2 frameUV;\n    frameUV.x = (stripUV.x - (holeZone + marginX * 2.0) - centerOffset) / frameZoneX;\n    frameUV.y = (localY - marginY) / (1.0 - marginY * 2.0);\n\n    float holeH = 0.01;\n    float holeSpacing = frameH * 0.1;\n\n    float holeRow = step(mod(stripUV.y, holeSpacing), holeH);\n\n    bool leftHole  = stripUV.x < holeZone * 0.8;\n    bool rightHole = stripUV.x > 1.0 - holeZone * 0.8;\n\n    bool isHole = holeRow > 0.5 && (leftHole || rightHole);\n    if (isHole) {\n        color = vec3(1.0);\n    }\n    else if (insideFrame) {\n        color = texture2D(uTexture, frameUV).rgb;\n    }\n    else {\n        color = vec3(0.0);\n    }\n\n    gl_FragColor = vec4(color, 1.0);\n}\n";
export declare const FILM_STRIP_PRO_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    framesPerScreen: {
        value: number;
        type: string;
    };
    scrollSpeed: {
        value: number;
        type: string;
    };
    gateWeave: {
        value: number;
        type: string;
    };
};
export declare const BAD_SIGNAL_FRAGMENT = "\nprecision highp float;\n\nin vec2 vTextureCoord;\nin vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform float uTime;\nfloat rand(vec2 co) {\n    return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453);\n}\n\nfloat noise(float y) {\n    return rand(vec2(y, uTime));\n}\n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord;\n    float flicker = 0.9 + 0.1 * sin(uTime * 30.0);\n    float lineNoise = noise(floor(uv.y * 200.0));\n    uv.x += (lineNoise - 0.5) * 0.03;\n    uv.x += sin(uv.y * 40.0 + uTime * 10.0) * 0.005;\n    float rgbShift = 0.004 * sin(uTime * 5.0);\n\n    vec4 colR = texture2D(uTexture, uv + vec2(rgbShift, 0.0));\n    vec4 colG = texture2D(uTexture, uv);\n    vec4 colB = texture2D(uTexture, uv - vec2(rgbShift, 0.0));\n\n    vec4 color;\n    color.r = colR.r;\n    color.g = colG.g;\n    color.b = colB.b;\n    color.a = colG.a;\n    float staticNoise = rand(uv * uTime) * 0.08;\n    color.rgb += staticNoise;\n    float scanline = sin(uv.y * 800.0) * 0.04;\n    color.rgb -= scanline;\n    color.rgb *= flicker;\n\n    gl_FragColor = color;\n}\n\n";
export declare const BAD_SIGNAL_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
};
export declare const OMNIFLEXION_FRAGMENT = "\nprecision highp float;\n\nin vec2 vTextureCoord;\nin vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform float uTime;\n\n/* Configuraci\u00F3n */\nuniform float strength;   // fuerza de la omniflexi\u00F3n\nuniform float frequency;  // frecuencia de ondas\nuniform float speed;      // velocidad animaci\u00F3n\n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord;\n    vec2 center = vec2(0.5);\n\n    vec2 dir = uv - center;\n    float dist = length(dir);\n    float wave =\n        sin(dist * frequency - uTime * speed) *\n        strength;\n\n    float lens = dist * dist;\n\n    vec2 flexUV = uv + normalize(dir) * wave * lens;\n    vec4 color = texture2D(uTexture, flexUV);\n\n    gl_FragColor = color;\n}\n\n";
export declare const OMNIFLEXION_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    strength: {
        value: number;
        type: string;
    };
    frequency: {
        value: number;
        type: string;
    };
    speed: {
        value: number;
        type: string;
    };
};
export declare const INVERSE_APERTURE_FRAGMENT = "\nprecision highp float;\n\nin vec2 vTextureCoord;\nin vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform float uTime;\n\nuniform float feather;\n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord;\n\n    vec2 center = vec2(0.28, 0.48);\n\n    float dist = distance(uv, center);\n\n    float maxRadius = 0.8;\n\n    float radius = mix(maxRadius, 0.0, uTime);\n\n    float mask = smoothstep(\n        radius - feather,\n        radius + feather,\n        dist\n    );\n\n    vec4 color = texture2D(uTexture, uv);\n\n    gl_FragColor = vec4(color.rgb * mask, color.a);\n}\n\n";
export declare const INVERSE_APERTURE_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    feather: {
        value: number;
        type: string;
    };
};
export declare const CURTAIN_OPEN_FRAGMENT = "\nprecision highp float;\n\nin vec2 vTextureCoord;\nin vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform float uTime;\n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord;\n\n    float openPhase = smoothstep(0.0, 0.6, uTime);\n    float zoomPhase = smoothstep(0.6, 1.0, uTime);\n\n    float zoom =\n        1.0 +\n        sin(zoomPhase * 3.141592) * 0.2;\n\n    vec2 center = vec2(0.28, 0.35);\n    vec2 zoomUV = (uv - center) / zoom + center;\n\n    vec4 tex = texture2D(uTexture, zoomUV);\n\n    float centerY = 0.48;\n    float halfOpen = openPhase * 0.5;\n\n    float mask = step(abs(zoomUV.y - centerY), halfOpen);\n\n    gl_FragColor = vec4(tex.rgb * mask, tex.a);\n}\n\n";
export declare const CURTAIN_OPEN_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
};
export declare const CURTAIN_BLUR_FRAGMENT = "\nprecision highp float;\n\nin vec2 vTextureCoord;\nin vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform float uTime;\n\nvec4 blur9(sampler2D tex, vec2 uv, vec2 resolution, float radius)\n{\n    vec4 color = vec4(0.0);\n    vec2 off = radius / resolution;\n\n    color += texture2D(tex, uv + off * vec2(-1.0, -1.0)) * 0.0625;\n    color += texture2D(tex, uv + off * vec2( 0.0, -1.0)) * 0.125;\n    color += texture2D(tex, uv + off * vec2( 1.0, -1.0)) * 0.0625;\n\n    color += texture2D(tex, uv + off * vec2(-1.0,  0.0)) * 0.125;\n    color += texture2D(tex, uv)                             * 0.25;\n    color += texture2D(tex, uv + off * vec2( 1.0,  0.0)) * 0.125;\n\n    color += texture2D(tex, uv + off * vec2(-1.0,  1.0)) * 0.0625;\n    color += texture2D(tex, uv + off * vec2( 0.0,  1.0)) * 0.125;\n    color += texture2D(tex, uv + off * vec2( 1.0,  1.0)) * 0.0625;\n\n    return color;\n}\n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord;\n\n    float openPhase = smoothstep(0.0, 0.3, uTime);\n    float zoomPhase = smoothstep(0.3, 1.0, uTime);\n\n    float zoom =\n        1.0 +\n        sin(zoomPhase * 3.141592) * 0.2;\n\n    vec2 center = vec2(0.28, 0.35);\n    vec2 zoomUV = (uv - center) / zoom + center;\n\n    float blurAmount = mix(10.0, 0.0, openPhase);\n\n    vec4 blurred =\n        blur9(uTexture, zoomUV, vec2(1024.0, 1024.0), blurAmount);\n\n    float pulse =\n    (sin(uTime * 2.0) * 0.5 + 0.5) * 0.8;\n    blurred.rgb *= (1.0 + pulse);\n    float centerY = 0.48;\n    float halfOpen = openPhase * 0.5;\n\n    float mask = step(abs(zoomUV.y - centerY), halfOpen);\n\n    gl_FragColor = vec4(blurred.rgb * mask, blurred.a);\n}\n\n";
export declare const CURTAIN_BLUR_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
};
export declare const DISTORT_V2_FRAGMENT = "\nprecision highp float;\n\nin vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float uTime;\n\nuniform float strength;\n\nuniform float frequency;\n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord;\n\n    float waveX = sin((uv.y + uTime * 0.6) * frequency) * strength;\n    float waveY = cos((uv.x + uTime * 0.4) * frequency) * strength;\n\n    vec2 distortedUV = uv + vec2(waveX, waveY);\n\n    distortedUV = clamp(distortedUV, 0.0, 1.0);\n\n    vec4 color = texture2D(uTexture, distortedUV);\n\n    gl_FragColor = color;\n}\n";
export declare const DISTORT_V2_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    strength: {
        value: number;
        type: string;
    };
    frequency: {
        value: number;
        type: string;
    };
};
export declare const LIGHTNING_FRAGMENT = "\nprecision mediump float;\n\nvarying vec2 vTextureCoord;\nvarying vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform float uTime;\n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord;\n    vec2 center = vec2(0.28, 0.45);\n\n    float dist = distance(uv, center);\n\n    float speed = 0.7;\n    float progress = mod(uTime * speed, 1.0);\n\n    float width = mix(0.01, 0.07, progress);\n\n    float lightning = smoothstep(progress + width, progress, dist);\n\n    float noise = sin((uv.x + uv.y) * 30.0 + uTime * 12.0);\n    lightning *= noise * 0.5 + 0.5;\n\n    float explosion = smoothstep(0.85, 1.0, progress);\n    float burst = explosion * smoothstep(0.25, 0.0, dist);\n\n    vec3 lightningColor = vec3(1.0, 0.9, 0.6) * lightning * 2.5;\n    vec3 explosionColor = vec3(1.0, 0.4, 0.2) * burst * 4.0;\n\n    vec4 base = texture2D(uTexture, uv);\n\n    gl_FragColor = vec4(base.rgb + lightningColor + explosionColor, base.a);\n}\n";
export declare const LIGHTNING_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
};
export declare const LIGHTNING_VEINS_FRAGMENT = "\nprecision mediump float;\n\nvarying vec2 vTextureCoord;\nvarying vec4 vColor;\n\nuniform sampler2D uTexture;\nuniform float uTime;\n\nfloat hash(vec2 p) {\n    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);\n}\n\nfloat noise(vec2 p) {\n    vec2 i = floor(p);\n    vec2 f = fract(p);\n\n    float a = hash(i);\n    float b = hash(i + vec2(1.0, 0.0));\n    float c = hash(i + vec2(0.0, 1.0));\n    float d = hash(i + vec2(1.0, 1.0));\n\n    vec2 u = f * f * (3.0 - 2.0 * f);\n\n    return mix(a, b, u.x) +\n           (c - a) * u.y * (1.0 - u.x) +\n           (d - b) * u.x * u.y;\n}\n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord;\n    vec2 center = vec2(0.5);\n\n    vec2 dir = uv - center;\n    float dist = length(dir);\n    float t = uTime * 1.5;\n\n    float veinNoise =\n        noise(dir * 6.0 + t) * 0.6 +\n        noise(dir * 12.0 - t * 1.3) * 0.3;\n\n    float warpedDist = dist + veinNoise * 0.08;\n\n    float thickness = 0.04 + veinNoise * 0.02;\n\n    float lightning =\n        smoothstep(thickness, 0.0, warpedDist);\n\n    float branches =\n        smoothstep(0.02, 0.0,\n            abs(noise(dir * 20.0 + t) - 0.5));\n\n    lightning += branches * 0.35;\n\n    float pulse = sin(uTime * 10.0) * 0.3 + 0.7;\n    lightning *= pulse;\n\n    vec3 veinColor =\n        vec3(0.6, 0.85, 1.0) * lightning * 2.5;\n\n    vec4 base = texture2D(uTexture, uv);\n\n    gl_FragColor =\n        vec4(base.rgb + veinColor, base.a);\n}\n";
export declare const LIGHTNING_VEINS_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
};
export declare const PIXEL_ERROR_FRAGMENT = "\nprecision mediump float;\n\nvarying vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float uTime;\n\nfloat rand(float x)\n{\n    return fract(sin(x) * 43758.5453123);\n}\n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord;\n\n    float pixelRows = 120.0;\n    float row = floor(uv.y * pixelRows) / pixelRows;\n\n    float offset =\n        sin(row * 40.0 + uTime * 3.0) *\n        0.015;\n\n    offset += (rand(row * 10.0) - 0.5) * 0.01;\n\n    vec2 distortedUV = vec2(uv.x + offset, uv.y);\n\n    distortedUV = clamp(distortedUV, 0.0, 1.0);\n\n    vec4 color = texture2D(uTexture, distortedUV);\n\n    gl_FragColor = color;\n}\n";
export declare const PIXEL_ERROR_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
};
export declare const NEON_FLASH_FRAGMENT = "\nprecision highp float;\n\nin vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float uTime;\nuniform float uIntensity;\n\nuniform float neonR;\nuniform float neonG;\nuniform float neonB;\n\nvoid main(void)\n{\n    vec4 base = texture2D(uTexture, vTextureCoord);\n\n    float speed = 4.2;                 \n    float t = fract(uTime * speed);    \n\n    float rise = smoothstep(0.0, 0.25, t);\n    float fall = smoothstep(0.85, 0.55, t);\n    float flash = rise * fall;\n\n    flash = mix(0.25, 1.0, flash);\n\n    flash *= uIntensity;\n\n    base.r += base.r * neonR * flash;\n    base.g += base.g * neonG * flash;\n    base.b += base.b * neonB * flash;\n\n    gl_FragColor = base;\n}\n";
export declare const NEON_FLASH_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    uIntensity: {
        value: number;
        type: string;
    };
    neonR: {
        value: number;
        type: string;
    };
    neonG: {
        value: number;
        type: string;
    };
    neonB: {
        value: number;
        type: string;
    };
};
export declare const WAVE_DISTORT_FRAGMENT = "\nprecision highp float;\n\nin vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float uTime;\nuniform float uStrength;\nuniform float uSpeed;\n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord;\n    float time = uTime * uSpeed;\n\n    float wave = sin((uv.y * 18.0) - time);\n\n    float offsetX = wave * uStrength;\n\n    vec2 distortedUV = uv + vec2(offsetX, 0.0);\n\n    distortedUV = clamp(distortedUV, 0.0, 1.0);\n\n    vec4 color = texture2D(uTexture, distortedUV);\n\n    gl_FragColor = color;\n}\n";
export declare const WAVE_DISTORT_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    uStrength: {
        value: number;
        type: string;
    };
    uSpeed: {
        value: number;
        type: string;
    };
};
export declare const BOUNCING_BALLS_FRAGMENT = "\nprecision highp float;\n\nin vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float uTime;\n\nconst int BALL_COUNT = 10;\nfloat radius = 0.05;\nfloat border = 0.006;\n\nvec2 bounce(vec2 p)\n{\n    return abs(fract(p) * 2.0 - 1.0);\n}\n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord;\n\n    /* Textura base */\n    vec4 color = texture2D(uTexture, uv);\n\n    float ballsAlpha = 0.0;\n\n    for (int i = 0; i < BALL_COUNT; i++)\n    {\n        float id = float(i) + 1.0;\n\n        vec2 speed = vec2(\n            0.3 + id * 0.12,\n            0.25 + id * 0.15\n        );\n\n        vec2 pos = bounce(vec2(\n            uTime * speed.x + id * 0.17,\n            uTime * speed.y + id * 0.29\n        ));\n\n        float d = distance(uv, pos);\n\n        float edge =\n            smoothstep(radius, radius - border, d) -\n            smoothstep(radius - border, radius - border - 0.01, d);\n\n        ballsAlpha += edge;\n    }\n\n    ballsAlpha = clamp(ballsAlpha, 0.0, 1.0);\n    color.rgb = mix(color.rgb, vec3(1.0), ballsAlpha);\n\n    gl_FragColor = color;\n}\n";
export declare const BOUNCING_BALLS_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
};
export declare const WATER_REFLECTION_FRAGMENT = "\nprecision highp float;\n\nin vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float uTime;\nuniform float uWaveStrength;\nuniform float uWaveSpeed;\n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord;\n\n    if (uv.y < 0.5)\n    {\n        gl_FragColor = texture2D(uTexture, uv);\n        return;\n    }\n\n    vec2 reflectUV = uv;\n    reflectUV.y = 1.0 - uv.y;\n\n    float wave =\n        sin(reflectUV.y * 30.0 + uTime * uWaveSpeed) *\n        uWaveStrength;\n\n    reflectUV.x += wave;\n    reflectUV = clamp(reflectUV, 0.0, 1.0);\n\n    vec4 reflectColor = texture2D(uTexture, reflectUV);\n\n    float fade = smoothstep(0.5, 1.0, uv.y);\n\n    reflectColor.rgb *= (1.0 - fade) * 0.85;\n    reflectColor.a *= (1.0 - fade);\n\n    gl_FragColor = reflectColor;\n}\n";
export declare const WATER_REFLECTION_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    uWaveStrength: {
        value: number;
        type: string;
    };
    uWaveSpeed: {
        value: number;
        type: string;
    };
};
export declare const DARK_ERROR_FRAGMENT = "\nprecision highp float;\n\nin vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float uTime;\nuniform float uStrength;\n\nfloat rand(vec2 co)\n{\n    return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453);\n}\n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord;\n\n    float t = floor(uTime * 6.0);\n\n    float blockSize = 0.08;\n    float blockY = floor(uv.y / blockSize) * blockSize;\n\n    float noise = rand(vec2(blockY, t));\n\n    float shift =\n        step(0.65, noise) *\n        (rand(vec2(blockY, t + 1.0)) - 0.5) *\n        uStrength;\n\n    vec2 glitchUV = uv + vec2(shift, 0.0);\n    glitchUV = clamp(glitchUV, 0.0, 1.0);\n\n    vec4 color = texture2D(uTexture, glitchUV);\n    float darkPulse =\n        step(0.75, noise) *\n        (0.4 + rand(vec2(uv.x, t)) * 0.6);\n\n    color.rgb *= 1.0 - darkPulse;\n    float pixelNoise = rand(uv * t);\n    color.rgb *= 1.0 - step(0.96, pixelNoise) * 0.8;\n\n    gl_FragColor = color;\n}\n";
export declare const DARK_ERROR_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    uStrength: {
        value: number;
        type: string;
    };
};
export declare const SCALE_MOVE_BLUR_FRAGMENT = "\nprecision highp float;\n\nin vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float uTime;\n\nvec4 blur5(sampler2D tex, vec2 uv, float strength)\n{\n    vec4 col = vec4(0.0);\n    float s = strength;\n\n    col += texture2D(tex, uv + vec2(-s, -s)) * 0.05;\n    col += texture2D(tex, uv + vec2( 0.0, -s)) * 0.10;\n    col += texture2D(tex, uv + vec2( s, -s)) * 0.05;\n\n    col += texture2D(tex, uv + vec2(-s,  0.0)) * 0.10;\n    col += texture2D(tex, uv)                * 0.40;\n    col += texture2D(tex, uv + vec2( s,  0.0)) * 0.10;\n\n    col += texture2D(tex, uv + vec2(-s,  s)) * 0.05;\n    col += texture2D(tex, uv + vec2( 0.0,  s)) * 0.10;\n    col += texture2D(tex, uv + vec2( s,  s)) * 0.05;\n\n    return col;\n}\n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord;\n    vec2 center = vec2(0.5, 0.5);\n\n    float t = clamp(uTime, 0.0, 1.0);\n    float zoomPhase = smoothstep(0.0, 0.5, t) *\n                      (1.0 - smoothstep(0.5, 1.0, t));\n\n    float scale = 1.0 + zoomPhase * 0.5;\n\n    vec2 offset = vec2(0.0);\n\n    if (t < 0.33)\n    {\n        offset = vec2(0.12 * (t / 0.33), 0.0);\n    }\n    else if (t < 0.66)\n    {\n        offset = vec2(\n            0.12 * (1.0 - (t - 0.33) / 0.33),\n            0.0\n        );\n    }\n    else\n    {\n        offset = vec2(\n            0.08 * ((t - 0.66) / 0.34),\n           -0.08 * ((t - 0.66) / 0.34)\n        );\n    }\n\n    offset *= zoomPhase;\n    vec2 transformedUV =\n        (uv - center) / scale +\n        center -\n        offset;\n\n    transformedUV = clamp(transformedUV, 0.0, 1.0);\n    float blurStrength = zoomPhase * 0.015;\n\n    vec4 color = blur5(uTexture, transformedUV, blurStrength);\n\n    gl_FragColor = color;\n}\n";
export declare const SCALE_MOVE_BLUR_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
};
export declare const PAPER_BREAK_REVEAL_FRAGMENT = "\nprecision highp float;\n\nin vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float uTime;\nuniform float uCutPos;\n\n\nfloat noise(float x)\n{\n    return sin(x * 28.0) * 0.035;\n}\n\nvec4 blur5(sampler2D tex, vec2 uv, float s)\n{\n    vec4 c = vec4(0.0);\n    c += texture2D(tex, uv + vec2(-s, -s)) * 0.05;\n    c += texture2D(tex, uv + vec2( 0.0, -s)) * 0.10;\n    c += texture2D(tex, uv + vec2( s, -s)) * 0.05;\n    c += texture2D(tex, uv + vec2(-s,  0.0)) * 0.10;\n    c += texture2D(tex, uv)                * 0.40;\n    c += texture2D(tex, uv + vec2( s,  0.0)) * 0.10;\n    c += texture2D(tex, uv + vec2(-s,  s)) * 0.05;\n    c += texture2D(tex, uv + vec2( 0.0,  s)) * 0.10;\n    c += texture2D(tex, uv + vec2( s,  s)) * 0.05;\n    return c;\n}\n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord;\n    vec2 center = vec2(0.5);\n    float movePhase  = smoothstep(0.0, 0.45, uTime);\n    float settle     = smoothstep(0.45, 0.6, uTime);\n    float cutPhase   = smoothstep(0.7, 0.9, uTime);\n    float cleanPhase = smoothstep(0.9, 1.0, uTime);\n    float scale = mix(1.5, 1.0, settle);\n\n    float moveAlive = 1.0 - settle;\n\n    vec2 movement = vec2(\n        sin(uTime * 6.0) * 0.18 * moveAlive,\n        0.0\n    );\n\n    vec2 uvScaled =\n        (uv - center) / scale +\n        center -\n        movement;\n\n    uvScaled = clamp(uvScaled, 0.0, 1.0);\n\n    float blurStrength = (1.0 - cleanPhase) * 0.025;\n    vec4 blurred = blur5(uTexture, uvScaled, blurStrength);\n    vec4 clean = texture2D(uTexture, uv);\n\n    float tearLine =\n        mix(\n            uCutPos,\n            uCutPos + noise(uv.y + uTime * 3.0),\n            cutPhase\n        );\n\n    tearLine = clamp(tearLine, uCutPos - 0.05, uCutPos + 0.05);\n\n    float split = cutPhase * 0.35;\n\n    vec2 leftUV  = uv;\n    vec2 rightUV = uv;\n\n    leftUV.x  -= split * step(uv.x, tearLine);\n    rightUV.x += split * step(tearLine, uv.x);\n\n    leftUV  = clamp(leftUV,  0.0, 1.0);\n    rightUV = clamp(rightUV, 0.0, 1.0);\n\n    vec4 left  = texture2D(uTexture, leftUV);\n    vec4 right = texture2D(uTexture, rightUV);\n\n    float cutMask =\n        smoothstep(tearLine - 0.02, tearLine + 0.02, uv.x);\n\n    vec4 broken = mix(left, right, cutMask);\n\n    float edge =\n        smoothstep(0.0, 0.02, abs(uv.x - tearLine)) *\n        (1.0 - smoothstep(0.02, 0.05, abs(uv.x - tearLine)));\n\n    vec3 edgeColor = vec3(1.0) * edge * cutPhase;\n\n    broken.rgb += edgeColor;\n\n    vec4 result = mix(blurred, broken, cutPhase);\n    result = mix(result, clean, cleanPhase);\n\n    gl_FragColor = result;\n}\n";
export declare const PAPER_BREAK_REVEAL_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    uCutPos: {
        value: number;
        type: string;
    };
};
export declare const GRAFFITI_FRAGMENT = "\n#ifdef GL_ES\nprecision mediump float;\n#endif\n\nvarying vec2 vTextureCoord;\n\nuniform float uTime;\nuniform sampler2D uTexture;\n\nfloat rand(vec2 st)\n{\n    return fract(sin(dot(st, vec2(12.9898,78.233))) * 43758.5453123);\n}\n\nfloat noise(vec2 st)\n{\n    vec2 i = floor(st);\n    vec2 f = fract(st);\n\n    float a = rand(i);\n    float b = rand(i + vec2(1.0, 0.0));\n    float c = rand(i + vec2(0.0, 1.0));\n    float d = rand(i + vec2(1.0, 1.0));\n\n    vec2 u = f * f * (3.0 - 2.0 * f);\n\n    return mix(a, b, u.x) +\n           (c - a) * u.y * (1.0 - u.x) +\n           (d - b) * u.x * u.y;\n}\n\nfloat spray(vec2 st, float radius)\n{\n    float dist = length(st - vec2(0.28, 0.5));\n    float base = smoothstep(radius, radius - 0.06, dist);\n\n    float speckle =\n        noise(st * 45.0 + uTime * 3.0) *\n        noise(st * 90.0);\n\n    return clamp(base + speckle * 0.7, 0.0, 1.0);\n}\n\nfloat drips(vec2 st, float mask)\n{\n    float column = noise(vec2(st.x * 25.0, 0.0));\n\n    float drip =\n        smoothstep(0.3, 0.7, column) *\n        smoothstep(0.1, 1.0, 1.0 - st.y);\n\n    float flow =\n        noise(vec2(st.x * 35.0, st.y * 6.0 + uTime * 2.5));\n\n    return drip * flow * mask;\n}\n\nvoid main(void)\n{\n    vec2 uv = vTextureCoord;\n\n    vec4 base = texture2D(uTexture, uv);\n\n    vec3 graffitiColor = vec3(1.0, 0.0, 0.5);\n\n    float reveal = smoothstep(0.0, 1.0, uTime);\n\n    float sprayMask =\n        spray(uv, 0.35 * reveal);\n\n    float dripMask =\n        drips(uv, sprayMask) * reveal;\n\n    float graffitiMask =\n        clamp(sprayMask + dripMask * 1.3, 0.0, 1.0);\n\n    vec3 graffiti =\n        graffitiColor * graffitiMask;\n\n    vec3 Color =\n        base.rgb + graffiti;\n\n    gl_FragColor = vec4(Color, base.a);\n}\n";
export declare const GRAFFITI_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
};
export declare const LASER_FRAGMENT = "\nprecision highp float;\n\nvarying vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float uTime;\nuniform vec3 uColor;\nuniform float uThickness;\nuniform float uIntensity;\n\nfloat noise(float x) {\n    return sin(x * 40.0) * 0.005;\n}\n\nvoid main() {\n    vec2 uv = vTextureCoord;\n\n    vec4 baseColor = texture2D(uTexture, uv);\n\n    float beamY = 0.48 + noise(uv.x + uTime * 5.0);\n\n    float dist = abs(uv.y - beamY);\n\n    float core = smoothstep(uThickness, 0.0, dist);\n\n    float glow = smoothstep(uThickness * 4.0, uThickness, dist);\n\n    float pulse = 0.6 + 0.4 * sin(uTime * 10.0);\n\n    float laserMask = (core + glow * uIntensity) * pulse;\n\n    vec3 laserColor = uColor * laserMask;\n\n    vec3 color = baseColor.rgb + laserColor;\n\n    gl_FragColor = vec4(color, baseColor.a);\n}\n";
export declare const LASER_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    uColor: {
        value: number[];
        type: string;
    };
    uThickness: {
        value: number;
        type: string;
    };
    uIntensity: {
        value: number;
        type: string;
    };
};
export declare const WAVE_FRAGMENT = "\nprecision highp float;\n\nvarying vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float uTime;\nuniform float uStrength;\nuniform float uFrequency;\nuniform float uSpeed;\n\nvoid main() {\n    vec2 uv = vTextureCoord;\n\n    vec2 center = vec2(0.5, 0.5);\n\n    float dist = distance(uv, center);\n\n    float wave =\n        sin(dist * uFrequency - uTime * uSpeed) *\n        uStrength *\n        smoothstep(1.0, 0.0, dist);\n\n    vec2 dir = normalize(uv - center);\n\n    vec2 distortedUV = uv + dir * wave;\n\n    vec4 color = texture2D(uTexture, distortedUV);\n\n    gl_FragColor = color;\n}\n";
export declare const WAVE_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    uStrength: {
        value: number;
        type: string;
    };
    uFrequency: {
        value: number;
        type: string;
    };
    uSpeed: {
        value: number;
        type: string;
    };
};
export declare const SPARKS_FRAGMENT = "\nprecision highp float;\n\nvarying vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float uTime;\nuniform float uDensity;\nuniform float uSpeed;\nuniform float uSize;\n\nfloat hash(vec2 p) {\n    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);\n}\nvec3 randomColor(float h) {\n    return vec3(\n        0.5 + 0.5 * sin(h * 6.2831),\n        0.5 + 0.5 * sin(h * 6.2831 + 2.1),\n        0.5 + 0.5 * sin(h * 6.2831 + 4.2)\n    );\n}\n\nvoid main() {\n    vec2 uv = vTextureCoord;\n\n    vec4 base = texture2D(uTexture, uv);\n\n    vec3 sparkColor = vec3(0.0);\n    float sparkAlpha = 0.0;\n\n    vec2 grid = floor(uv * uDensity);\n    vec2 id = grid;\n\n    float h = hash(id);\n\n    vec2 sparkPos = fract(vec2(\n        h,\n        h + uTime * uSpeed\n    ));\n\n    float d = distance(fract(uv * uDensity), sparkPos);\n\n    float spark = smoothstep(uSize, 0.0, d);\n\n    vec3 color = randomColor(h) * spark;\n\n    sparkColor += color;\n    sparkAlpha += spark;\n\n    vec3 colorValue = base.rgb + sparkColor;\n\n    gl_FragColor = vec4(colorValue, max(base.a, sparkAlpha));\n}\n";
export declare const SPARKS_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    uDensity: {
        value: number;
        type: string;
    };
    uSpeed: {
        value: number;
        type: string;
    };
    uSize: {
        value: number;
        type: string;
    };
};
export declare const HOLOGRAM_SCAN_FRAGMENT = "\nprecision highp float;\n\nvarying vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float uTime;\nuniform vec3 uColor;      \nuniform float uScanWidth; \nuniform float uIntensity; \n\nfloat noise(float x) {\n    return sin(x * 120.0) * 0.02;\n}\n\nvoid main() {\n    vec2 uv = vTextureCoord;\n\n    vec4 base = texture2D(uTexture, uv);\n\n    float scanPos = fract(uTime * 0.5);\n    float scanLine = smoothstep(\n        uScanWidth,\n        0.0,\n        abs(uv.y - scanPos)\n    );\n\n    float lines = 0.5 + 0.5 * sin(uv.y * 300.0 + uTime * 10.0);\n\n    float flicker = 0.9 + 0.1 * sin(uTime * 50.0);\n\n    float holo =\n        scanLine +\n        lines * 0.2 +\n        noise(uv.x + uTime) * 0.5;\n\n    holo *= uIntensity * flicker;\n\n    vec3 holoColor = uColor * holo;\n\n    vec3 colorValue = base.rgb + holoColor;\n\n    gl_FragColor = vec4(colorValue, base.a);\n}\n";
export declare const HOLOGRAM_SCAN_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    uColor: {
        value: number[];
        type: string;
    };
    uScanWidth: {
        value: number;
        type: string;
    };
    uIntensity: {
        value: number;
        type: string;
    };
};
export declare const RETRO_70S_FRAGMENT = "\nprecision highp float;\n\nvarying vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float uTime;\nuniform float uGrain;     \nuniform float uFade;      \nuniform float uVignette;  \n\nfloat noise(vec2 p) {\n    return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime) * 43758.5453);\n}\n\nvoid main() {\n    vec2 uv = vTextureCoord;\n\n    vec4 color = texture2D(uTexture, uv);\n\n    vec3 faded = mix(color.rgb, vec3(\n        dot(color.rgb, vec3(0.393, 0.769, 0.189)),\n        dot(color.rgb, vec3(0.349, 0.686, 0.168)),\n        dot(color.rgb, vec3(0.272, 0.534, 0.131))\n    ), uFade);\n\n    float grain = (noise(uv * 500.0) - 0.5) * uGrain;\n    faded += grain;\n\n    float flicker = 0.97 + 0.03 * sin(uTime * 60.0);\n    faded *= flicker;\n\n    float dist = distance(uv, vec2(0.5));\n    float vignette = smoothstep(0.8, uVignette, dist);\n    faded *= 1.0 - vignette;\n\n    gl_FragColor = vec4(faded, color.a);\n}\n";
export declare const RETRO_70S_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    uGrain: {
        value: number;
        type: string;
    };
    uFade: {
        value: number;
        type: string;
    };
    uVignette: {
        value: number;
        type: string;
    };
};
export declare const IG_OUTLINE_FRAGMENT = "\nprecision highp float;\n\nvarying vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float uThickness;\nuniform vec3 uOutlineColor;\n\nvoid main() {\n    vec2 uv = vTextureCoord;\n\n    vec2 px = vec2(uThickness) / vec2(1024.0, 1024.0);\n\n    vec4 centerTex = texture2D(uTexture, uv);\n    vec3 center = centerTex.rgb;\n\n    vec3 up     = texture2D(uTexture, uv + vec2(0.0,  px.y)).rgb;\n    vec3 down   = texture2D(uTexture, uv - vec2(0.0,  px.y)).rgb;\n    vec3 left   = texture2D(uTexture, uv - vec2(px.x, 0.0)).rgb;\n    vec3 right  = texture2D(uTexture, uv + vec2(px.x, 0.0)).rgb;\n\n    float edge =\n        length(center - up) +\n        length(center - down) +\n        length(center - left) +\n        length(center - right);\n\n    edge = smoothstep(0.15, 0.4, edge);\n\n    vec3 colorValue = mix(center, uOutlineColor, edge);\n    gl_FragColor = vec4(colorValue, centerTex.a);\n}\n\n";
export declare const IG_OUTLINE_UNIFORMS: {
    uThickness: {
        value: number;
        type: string;
    };
    uOutlineColor: {
        value: number[];
        type: string;
    };
};
export declare const RANDOM_ACCENTS_FRAGMENT = "\nprecision highp float;\n\nvarying vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float uTime;\nuniform float uDensity;\nuniform float uSize;\nuniform float uIntensity;\nuniform vec3 uColorA;\nuniform vec3 uColorB;\n\nfloat hash(vec2 p) {\n    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);\n}\n\nvec3 accentColor(float h) {\n    return mix(uColorA, uColorB, fract(h * 7.0));\n}\n\nvoid main() {\n    vec2 uv = vTextureCoord;\n\n    vec4 base = texture2D(uTexture, uv);\n\n    vec2 gridUV = floor(uv * uDensity);\n    float h = hash(gridUV);\n\n    vec2 offset = vec2(\n        fract(h * 13.3),\n        fract(h * 7.7)\n    );\n\n    vec2 accentUV = fract(uv * uDensity) - offset;\n\n    float dist = length(accentUV);\n\n    float accent = smoothstep(uSize, 0.0, dist);\n\n    accent *= 0.6 + 0.4 * sin(uTime * 10.0 + h * 6.28);\n\n    vec3 color = accentColor(h) * accent * uIntensity;\n\n    float alpha = accent;\n\n    gl_FragColor = vec4(color + base.rgb, max(base.a, alpha));\n}\n";
export declare const RANDOM_ACCENTS_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    uDensity: {
        value: number;
        type: string;
    };
    uSize: {
        value: number;
        type: string;
    };
    uIntensity: {
        value: number;
        type: string;
    };
    uColorA: {
        value: number[];
        type: string;
    };
    uColorB: {
        value: number[];
        type: string;
    };
};
export declare const SOLUTION_EFFECT_FRAGMENT = "\nprecision highp float;\n\nvarying vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float uTime;\nuniform vec3 uColorA;\nuniform vec3 uColorB;\nuniform float uIntensity;\n\nfloat noise(vec2 st) {\n    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);\n}\n\nvec2 swirl(vec2 uv, float t) {\n    vec2 center = vec2(0.5);\n    vec2 diff = uv - center;\n    float angle = 0.5 * t * length(diff);\n    float s = sin(angle);\n    float c = cos(angle);\n    return center + vec2(c*diff.x - s*diff.y, s*diff.x + c*diff.y);\n}\n\nvoid main() {\n    vec2 uv = vTextureCoord;\n\n    vec2 uvSwirl = swirl(uv, uTime);\n\n    vec4 base = texture2D(uTexture, uvSwirl);\n\n    float n = noise(uv * 20.0 + uTime * 2.0);\n    vec3 liquid = mix(uColorA, uColorB, n);\n\n    vec3 colorValue = mix(base.rgb, liquid, uIntensity * n);\n\n    gl_FragColor = vec4(colorValue, base.a);\n}\n";
export declare const SOLUTION_EFFECT_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    uColorA: {
        value: number[];
        type: string;
    };
    uColorB: {
        value: number[];
        type: string;
    };
    uIntensity: {
        value: number;
        type: string;
    };
};
export declare const TV_SCANLINES_FRAGMENT = "\nprecision highp float;\n\nvarying vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float uTime;\nuniform float uLineThickness;\nuniform float uLineIntensity;\nuniform float uNoiseIntensity;\nuniform vec3 uLineColor;\n\nfloat rand(vec2 p){\n    return fract(sin(dot(p ,vec2(12.9898,78.233))) * 43758.5453);\n}\n\nvoid main() {\n    vec2 uv = vTextureCoord;\n\n    vec4 tex = texture2D(uTexture, uv);\n    vec3 base = tex.rgb;\n\n    float line = sin(uv.y * 800.0 * uLineThickness) * 0.5 + 0.5;\n    line = mix(1.0, line, uLineIntensity);\n\n    float noise =\n        (rand(vec2(uTime, uv.y * 1000.0)) - 0.5) * uNoiseIntensity;\n\n    vec3 colorValue = base * line + noise;\n\n    gl_FragColor = vec4(colorValue, tex.a);\n}\n";
export declare const TV_SCANLINES_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    uLineThickness: {
        value: number;
        type: string;
    };
    uLineIntensity: {
        value: number;
        type: string;
    };
    uNoiseIntensity: {
        value: number;
        type: string;
    };
    uLineColor: {
        value: number[];
        type: string;
    };
};
export declare const HDR_FRAGMENT = "\nprecision highp float;\n\nvarying vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float uExposure;\nuniform float uSaturation;\nuniform float uContrast;\n\nvec3 adjustSaturation(vec3 color, float sat) {\n    float grey = dot(color, vec3(0.299, 0.587, 0.114));\n    return mix(vec3(grey), color, sat);\n}\n\nvec3 adjustContrast(vec3 color, float contrast) {\n    return (color - 0.5) * contrast + 0.5;\n}\n\nvoid main() {\n    vec2 uv = vTextureCoord;\n\n    vec4 tex = texture2D(uTexture, uv);\n    vec3 color = tex.rgb;\n    color *= uExposure;\n\n    color = adjustSaturation(color, uSaturation);\n\n    color = adjustContrast(color, uContrast);\n\n    color = color / (color + vec3(1.0));\n\n    gl_FragColor = vec4(color, tex.a);\n}\n";
export declare const HDR_UNIFORMS: {
    uExposure: {
        value: number;
        type: string;
    };
    uSaturation: {
        value: number;
        type: string;
    };
    uContrast: {
        value: number;
        type: string;
    };
};
export declare const BLACK_FLASH_FRAGMENT = "\nprecision highp float;\n\nvarying vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float uTime;\nuniform float uIntensity;\nuniform float uDuration;\n\nvoid main() {\n    vec2 uv = vTextureCoord;\n    vec4 base = texture2D(uTexture, uv);\n\n    float flash = smoothstep(0.0, uDuration * 0.5, mod(uTime, uDuration)) *\n                  (1.0 - smoothstep(uDuration * 0.5, uDuration, mod(uTime, uDuration)));\n\n    flash *= uIntensity;\n\n    vec3 color = mix(base.rgb, vec3(0.0), flash);\n\n    gl_FragColor = vec4(color, base.a);\n}\n";
export declare const BLACK_FLASH_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    uIntensity: {
        value: number;
        type: string;
    };
    uDuration: {
        value: number;
        type: string;
    };
};
export declare const BRIGHT_PULSE_FRAGMENT = "\nprecision highp float;\n\nvarying vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float uTime;\nuniform float uPulseScale;  \nuniform float uBlurStrength; \nuniform float uGlowBoost; \n\nvec4 blur3(sampler2D tex, vec2 uv, float s) {\n    vec4 c = vec4(0.0);\n    c += texture2D(tex, uv + vec2(-s, -s)) * 0.0625;\n    c += texture2D(tex, uv + vec2( 0.0, -s)) * 0.125;\n    c += texture2D(tex, uv + vec2( s, -s)) * 0.0625;\n    c += texture2D(tex, uv + vec2(-s,  0.0)) * 0.125;\n    c += texture2D(tex, uv) * 0.25;\n    c += texture2D(tex, uv + vec2( s,  0.0)) * 0.125;\n    c += texture2D(tex, uv + vec2(-s,  s)) * 0.0625;\n    c += texture2D(tex, uv + vec2( 0.0,  s)) * 0.125;\n    c += texture2D(tex, uv + vec2( s,  s)) * 0.0625;\n    return c * uGlowBoost;\n}\n\nvoid main() {\n    vec2 uv = vTextureCoord;\n\n    float scale = 1.0 + uPulseScale * (0.5 + 0.5 * sin(uTime * 3.0));\n    vec2 center = vec2(0.28,0.48); \n    vec2 uvScaled = (uv - center) / scale + center;\n    uvScaled = clamp(uvScaled, 0.0, 1.0);\n    vec4 base = texture2D(uTexture, uvScaled);\n    vec4 blurred = blur3(uTexture, uvScaled, uBlurStrength);\n    vec4 colorValue = mix(base, blurred, 0.8);\n\n    gl_FragColor = colorValue;\n}\n";
export declare const BRIGHT_PULSE_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    uPulseScale: {
        value: number;
        type: string;
    };
    uBlurStrength: {
        value: number;
        type: string;
    };
    uGlowBoost: {
        value: number;
        type: string;
    };
};
export declare const NEGATIVE_DIVISION_FRAGMENT = "\nprecision highp float;\n\nvarying vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float uIntensity; // 0 \u2192 original, 1 \u2192 negativo completo\nuniform float uContrast;  // fuerza de contraste\n\nvoid main() {\n    vec2 uv = vTextureCoord;\n    vec4 color = texture2D(uTexture, uv);\n    vec3 negative = 1.0 - color.rgb;\n\n    vec3 contrasted = (negative - 0.5) * uContrast + 0.5;\n\n    float maskedIntensity = uIntensity * color.a;\n\n    vec3 colorValue =\n        mix(color.rgb, contrasted, maskedIntensity);\n\n    gl_FragColor = vec4(colorValue, color.a);\n}\n";
export declare const NEGATIVE_DIVISION_UNIFORMS: {
    uIntensity: {
        value: number;
        type: string;
    };
    uContrast: {
        value: number;
        type: string;
    };
};
export declare const CAMERA_MOVE_FRAGMENT = "\nprecision highp float;\n\nvarying vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float uTime;\nuniform float uIntensity;\nuniform float uSpeed;\n\nfloat rand(float x){\n    return fract(sin(x * 12.9898) * 43758.5453);\n}\n\nvec2 shakeOffset(float time){\n    float x = (rand(time * 0.7) - 0.5) * uIntensity;\n    float y = (rand(time * 1.3 + 10.0) - 0.5) * uIntensity;\n    return vec2(x, y);\n}\n\nvoid main() {\n    vec2 uv = vTextureCoord;\n\n    vec2 offset = shakeOffset(uTime * uSpeed);\n\n    vec2 uvMoved = clamp(uv + offset, 0.0, 1.0);\n\n    vec4 color = texture2D(uTexture, uvMoved);\n\n    gl_FragColor = color;\n}\n\n";
export declare const CAMERA_MOVE_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    uIntensity: {
        value: number;
        type: string;
    };
    uSpeed: {
        value: number;
        type: string;
    };
};
export declare const HDR_V2_FRAGMENT = "\nprecision highp float;\n\nvarying vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float uExposure;\nuniform float uBloom;\nuniform float uContrast;\n\nvec3 tonemapReinhard(vec3 color){\n    return color / (color + vec3(1.0));\n}\n\nvoid main() {\n    vec2 uv = vTextureCoord;\n    vec4 tex = texture2D(uTexture, uv);\n\n    if (tex.a < 0.01) {\n        gl_FragColor = tex;\n        return;\n    }\n\n    vec3 color = tex.rgb;\n\n    vec3 bright = max(color - 0.6, 0.0) * uBloom;\n    bright = tonemapReinhard(bright);\n\n    vec3 hdrColor = color + bright * 0.6;\n\n    hdrColor *= uExposure;\n\n    hdrColor = (hdrColor - 0.5) * uContrast + 0.5;\n\n    hdrColor = clamp(hdrColor, 0.0, 1.0);\n\n    gl_FragColor = vec4(hdrColor, tex.a);\n}\n";
export declare const HDR_V2_UNIFORMS: {
    uExposure: {
        value: number;
        type: string;
    };
    uBloom: {
        value: number;
        type: string;
    };
    uContrast: {
        value: number;
        type: string;
    };
};
export declare const FAST_ZOOM_FRAGMENT = "\nprecision highp float;\n\nvarying vec2 vTextureCoord;\n\nuniform sampler2D uTexture;\nuniform float uTime;       \nuniform float uZoomSpeed;  \nuniform float uMaxZoom;    \nuniform float uBlurStrength; \n\nvec4 blur3(sampler2D tex, vec2 uv, float s) {\n    vec4 c = vec4(0.0);\n    c += texture2D(tex, uv + vec2(-s, -s)) * 0.0625;\n    c += texture2D(tex, uv + vec2( 0.0, -s)) * 0.125;\n    c += texture2D(tex, uv + vec2( s, -s)) * 0.0625;\n    c += texture2D(tex, uv + vec2(-s,  0.0)) * 0.125;\n    c += texture2D(tex, uv) * 0.25;\n    c += texture2D(tex, uv + vec2( s,  0.0)) * 0.125;\n    c += texture2D(tex, uv + vec2(-s,  s)) * 0.0625;\n    c += texture2D(tex, uv + vec2( 0.0,  s)) * 0.125;\n    c += texture2D(tex, uv + vec2( s,  s)) * 0.0625;\n    return c;\n}\n\nvoid main() {\n    vec2 uv = vTextureCoord;\n    vec2 center = vec2(0.28,0.48); \n\n    float zoom = 1.0 + (uMaxZoom - 1.0) * smoothstep(0.0, 1.0, sin(uTime * uZoomSpeed));\n\n    vec2 uvZoomed = (uv - center) / zoom + center;\n\n    uvZoomed = clamp(uvZoomed, 0.0, 1.0);\n\n    vec4 color = texture2D(uTexture, uvZoomed);\n\n    if (uBlurStrength > 0.0) {\n        vec4 blurred = blur3(uTexture, uvZoomed, uBlurStrength);\n        color = mix(color, blurred, 0.5);\n    }\n\n    gl_FragColor = color;\n}\n";
export declare const FAST_ZOOM_UNIFORMS: {
    uTime: {
        value: number;
        type: string;
    };
    uZoomSpeed: {
        value: number;
        type: string;
    };
    uMaxZoom: {
        value: number;
        type: string;
    };
    uBlurStrength: {
        value: number;
        type: string;
    };
};
