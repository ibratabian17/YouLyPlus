const ENABLE_APPLE_MUSIC_MESH = false;

// Apple Music Android

const ANDROID_LAYER_SCALES = new Float32Array([1.4, 1.26, 1.26]);
const ANDROID_LAYER_BASE_POSITIONS = [0, 0, 0.75, -0.75, -0.75, 0.75];
const ANDROID_LAYER_ABS_BASE_X = new Float32Array([
    Math.abs(ANDROID_LAYER_BASE_POSITIONS[0]),
    Math.abs(ANDROID_LAYER_BASE_POSITIONS[2]),
    Math.abs(ANDROID_LAYER_BASE_POSITIONS[4])
]);
const ANDROID_LAYER_ABS_BASE_Y = new Float32Array([
    Math.abs(ANDROID_LAYER_BASE_POSITIONS[1]),
    Math.abs(ANDROID_LAYER_BASE_POSITIONS[3]),
    Math.abs(ANDROID_LAYER_BASE_POSITIONS[5])
]);

let blurHProgram = null;
let blurVPostProgram = null;
let blurHVAO = null;
let blurVPostVAO = null;

let a_blurH_pos = -1;
let u_blurH_image = null;
let u_blurH_step = null;

let a_blurVPost_pos = -1;
let u_blurVPost_image = null;
let u_blurVPost_step = null;
let u_blurVPost_brightness = null;
let u_blurVPost_saturate = null;
let u_blurVPost_contrast = null;
let u_blurVPost_hueRotate = null;
let u_blurVPost_opacity = null;
let u_blurVPost_blackScrim = null;
let u_blurVPost_whiteScrim = null;

function buildBlurVPostFragmentShaderSource(kernel) {
    return `
    #ifdef GL_ES
    precision mediump float;
    #endif

    #ifdef GL_FRAGMENT_PRECISION_HIGH
    #define HP highp
    #else
    #define HP mediump
    #endif

    varying vec2 v_texCoord;
    uniform sampler2D u_image;
    uniform vec2 u_step;
    uniform float u_brightness;
    uniform float u_saturate;
    uniform float u_contrast;
    uniform float u_hueRotate;
    uniform float u_opacity;
    uniform float u_blackScrim;
    uniform float u_whiteScrim;

    float interleavedGradientNoise(HP vec2 uv) {
        return fract(52.9829189 * fract(dot(uv, vec2(0.06711056, 0.00583715))));
    }

    vec3 rgb2hsl(vec3 c) {
        float maxC = max(c.r, max(c.g, c.b));
        float minC = min(c.r, min(c.g, c.b));
        float l = (maxC + minC) * 0.5;
        float d = maxC - minC;
        if (d < 0.0001) return vec3(0.0, 0.0, l);
        float s = d / (1.0 - abs(2.0 * l - 1.0));
        float h;
        if (maxC == c.r)      h = mod((c.g - c.b) / d, 6.0);
        else if (maxC == c.g) h = (c.b - c.r) / d + 2.0;
        else                  h = (c.r - c.g) / d + 4.0;
        h *= 0.16666667;
        return vec3(h, s, l);
    }

    vec3 hsl2rgb(vec3 hsl) {
        float h = hsl.x, s = hsl.y, l = hsl.z;
        if (s < 0.0001) return vec3(l);
        float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
        float p = 2.0 * l - q;
        vec3 t = fract(vec3(h + 0.33333333, h, h - 0.33333333));
        vec3 rgb = clamp(abs(t * 6.0 - 3.0) - 1.0, 0.0, 1.0);
        return p + (q - p) * rgb;
    }

    void main() {
${_blurTapsGLSL(kernel)}
        float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = clamp(mix(vec3(luma), c, u_saturate), 0.0, 1.0);
        c = mix(c, vec3(0.0), u_blackScrim);
        c = mix(c, vec3(1.0), u_whiteScrim);
        c *= u_brightness;
        c = (c - 0.5) * u_contrast + 0.5;
        if (abs(u_hueRotate) > 0.0001) {
            vec3 hsl = rgb2hsl(clamp(c, 0.0, 1.0));
            hsl.x = fract(hsl.x + u_hueRotate * 0.15915494);
            c = hsl2rgb(hsl);
        }

        HP vec2 fc = gl_FragCoord.xy;
        float n = interleavedGradientNoise(fc) + interleavedGradientNoise(fc + vec2(5.588238, 5.588238)) - 1.0;
        c += n * 0.0039215686;

        c = clamp(c, 0.0, 1.0);
        gl_FragColor = vec4(c, u_opacity);
    }
`;
}

const _androidPipeline = {
    layerScales: ANDROID_LAYER_SCALES,
    layerAbsBaseX: ANDROID_LAYER_ABS_BASE_X,
    layerAbsBaseY: ANDROID_LAYER_ABS_BASE_Y,

    getCanvasBaseSize() {
        return CANVAS_SIZE;
    },

    applyDefaultPostParams(out) {
        out.brightness = 1.0;
        out.saturate = 2.5;
        out.preSaturate = 1.0;
        out.contrast = 1.0;
        out.hueRotate = 0.0;
        out.opacity = 1.0;
        out.blackScrim = 0.5;
        out.whiteScrim = 13.0 / 255.0;
        out.darkFactor = 0.20;
        out.lightFactor = 0.0;
        out.floor = 0.07;
        out.ceiling = 0.97;
        out.meshWarpTimeScale = 1.75;
    },

    getPreSaturate() {
        return 1.0;
    },

    resetState() {
        blurHProgram = null;
        blurVPostProgram = null;
        blurHVAO = null;
        blurVPostVAO = null;
    },

    initStaticPrograms() {
        return true;
    },

    initVAOs() {},

    isProgramsReady() {
        return !!(blurHProgram && blurVPostProgram);
    },

    rebuildBlurPrograms(quadVS, passFS, kernel) {
        const vPostFS = createShader(gl, gl.FRAGMENT_SHADER, buildBlurVPostFragmentShaderSource(kernel));
        if (!vPostFS) return false;

        const newH = createProgram(gl, quadVS, passFS);
        const newVPost = createProgram(gl, quadVS, vPostFS);
        gl.deleteShader(vPostFS);
        if (!newH || !newVPost) return false;

        if (blurHProgram) gl.deleteProgram(blurHProgram);
        if (blurVPostProgram) gl.deleteProgram(blurVPostProgram);
        blurHProgram = newH;
        blurVPostProgram = newVPost;

        a_blurH_pos = gl.getAttribLocation(blurHProgram, 'a_position');
        u_blurH_image = gl.getUniformLocation(blurHProgram, 'u_image');
        u_blurH_step = gl.getUniformLocation(blurHProgram, 'u_step');

        a_blurVPost_pos = gl.getAttribLocation(blurVPostProgram, 'a_position');
        u_blurVPost_image      = gl.getUniformLocation(blurVPostProgram, 'u_image');
        u_blurVPost_step       = gl.getUniformLocation(blurVPostProgram, 'u_step');
        u_blurVPost_brightness = gl.getUniformLocation(blurVPostProgram, 'u_brightness');
        u_blurVPost_saturate   = gl.getUniformLocation(blurVPostProgram, 'u_saturate');
        u_blurVPost_contrast   = gl.getUniformLocation(blurVPostProgram, 'u_contrast');
        u_blurVPost_hueRotate  = gl.getUniformLocation(blurVPostProgram, 'u_hueRotate');
        u_blurVPost_opacity    = gl.getUniformLocation(blurVPostProgram, 'u_opacity');
        u_blurVPost_blackScrim = gl.getUniformLocation(blurVPostProgram, 'u_blackScrim');
        u_blurVPost_whiteScrim = gl.getUniformLocation(blurVPostProgram, 'u_whiteScrim');

        if (vaoExt) {
            if (blurHVAO) vaoExt.deleteVertexArrayOES(blurHVAO);
            if (blurVPostVAO) vaoExt.deleteVertexArrayOES(blurVPostVAO);

            blurHVAO = vaoExt.createVertexArrayOES();
            vaoExt.bindVertexArrayOES(blurHVAO);
            gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
            gl.enableVertexAttribArray(a_blurH_pos);
            gl.vertexAttribPointer(a_blurH_pos, 2, gl.FLOAT, false, 0, 0);

            blurVPostVAO = vaoExt.createVertexArrayOES();
            vaoExt.bindVertexArrayOES(blurVPostVAO);
            gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
            gl.enableVertexAttribArray(a_blurVPost_pos);
            gl.vertexAttribPointer(a_blurVPost_pos, 2, gl.FLOAT, false, 0, 0);
            vaoExt.bindVertexArrayOES(null);
        }

        gl.useProgram(blurHProgram);
        gl.uniform1i(u_blurH_image, 0);
        gl.useProgram(blurVPostProgram);
        gl.uniform1i(u_blurVPost_image, 0);
        return true;
    },

    applyViewportUniforms() {
        gl.useProgram(blurHProgram);
        gl.uniform2f(u_blurH_step, 1.0 / blurDimensions.width, 0.0);
        gl.useProgram(blurVPostProgram);
        gl.uniform2f(u_blurVPost_step, 0.0, 1.0 / blurDimensions.height);
    },

    renderFrame() {
        gl.useProgram(blurHProgram);
        if (vaoExt) {
            vaoExt.bindVertexArrayOES(blurHVAO);
        } else {
            gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
            gl.vertexAttribPointer(a_blurH_pos, 2, gl.FLOAT, false, 0, 0);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, blurFramebuffer);
        gl.bindTexture(gl.TEXTURE_2D, renderTexture);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        gl.useProgram(blurVPostProgram);
        if (vaoExt) {
            vaoExt.bindVertexArrayOES(blurVPostVAO);
        } else {
            gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
            gl.vertexAttribPointer(a_blurVPost_pos, 2, gl.FLOAT, false, 0, 0);
        }

        if (_appliedPostUniformsDirty) {
            gl.uniform1f(u_blurVPost_brightness, _postParams.brightness);
            gl.uniform1f(u_blurVPost_saturate,   _postParams.saturate);
            gl.uniform1f(u_blurVPost_contrast,   _postParams.contrast);
            gl.uniform1f(u_blurVPost_hueRotate,  _postParams.hueRotate);
            gl.uniform1f(u_blurVPost_opacity,    _postParams.opacity);
            gl.uniform1f(u_blurVPost_blackScrim, _postParams.blackScrim);
            gl.uniform1f(u_blurVPost_whiteScrim, _postParams.whiteScrim);
            _appliedPostUniformsDirty = false;
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvasDimensions.width, canvasDimensions.height);
        gl.bindTexture(gl.TEXTURE_2D, blurTextureA);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
};

function _getActivePipeline() {
    return ENABLE_APPLE_MUSIC_MESH ? _meshPipeline : _androidPipeline;
}

let gl = null;
let glProgram = null;
let webglCanvas = null;
let blurContainerElem = null;
let needsAnimation = false;

let vaoExt = null;
let mainVAO = null;
let a_main_pos = -1;

let u_main_artworkTexture = null;
let u_main_transitionProgress = null;
let u_main_layerTransform = null;
let u_main_aspect = null;
let u_main_renderHeight = null;
let u_main_preSaturate = null;
let _viewportAspect = 1.0;
const _layerSizeFactor = new Float32Array([1, 1, 1]);
let _activeLightweight = null;
let _needsRedraw = false;
let _viewportObserver = null;
let _intersectionObserver = null;

const MIN_ASPECT = 0.4;
const MAX_ASPECT = 3.5;
const CANVAS_SIZE = 256;
const RENDER_SIZE = 128;
const RENDER_SIZE_LIGHTWEIGHT = 64;
const ARTWORK_TEX_SIZE = 128;
const BLUR_SIGMA_UV = 0.08;
const BLUR_KERNEL_SIGMAS = 3.0;
const TARGET_FPS = 40;
const FRAME_INTERVAL = 1000 / TARGET_FPS;
const THROTTLED_FPS = 20;
const THROTTLED_FRAME_INTERVAL = 1000 / THROTTLED_FPS;
let _bgThrottleUntil = 0;

// Cached post-process values
const _postParams = {};
let _postParamsDirty = true;
let _appliedPostUniformsDirty = true;

// WebGL objects
let quadBuffer = null;
let currentArtworkTexture = null;
let previousArtworkTexture = null;
let renderFramebuffer = null;
let blurFramebuffer = null;
let renderTexture = null;
let blurTextureA = null;

function LYPLUS_throttleBackground(ms) {
    const until = performance.now() + ms;
    if (until > _bgThrottleUntil) _bgThrottleUntil = until;
}

const ARTWORK_TRANSITION_SPEED = 0.02;
const ARTWORK_TRANSITION_STEP = ARTWORK_TRANSITION_SPEED * 1.5;
const TWO_PI = Math.PI * 2;
const DEG_TO_RAD = Math.PI / 180.0;
const DEFAULT_TEX_PIXEL = new Uint8Array([30, 30, 40, 255]);
const QUAD_VERTICES = new Float32Array([
    -1, -1,
     1, -1,
    -1,  1,
    -1,  1,
     1, -1,
     1,  1
]);

// Reusable offscreen 2D canvases for artwork downscaling (zero DOM allocation per song change)
const _scratchCanvases = [null, null];
const _scratchCtxs = [null, null];

function _getScratchCanvas(idx, w, h) {
    let c = _scratchCanvases[idx];
    if (!c) {
        c = document.createElement('canvas');
        _scratchCanvases[idx] = c;
        _scratchCtxs[idx] = c.getContext('2d');
    }
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    const cx = _scratchCtxs[idx];
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = 'high';
    return { canvas: c, ctx: cx };
}

// Animation State
const blurDimensions = { width: 0, height: 0 };
const canvasDimensions = { width: 0, height: 0 };
const DEFAULT_PALETTE = {
    background: { r: 78, g: 44, b: 28 },
    primary: { r: 255, g: 255, b: 255 },
    secondary: { r: 200, g: 200, b: 200 }
};
let currentTargetMasterArtworkPalette = DEFAULT_PALETTE;

let LYPLUS_bgConfig = {
    dynamicPlayerSelectors: [],
    blurContainerParentSelector: 'body',
    mutationObserverRootSelector: 'body',
    artworkSelector: ''
};

function LYPLUS_setBgConfig(config) {
    Object.assign(LYPLUS_bgConfig, config);
}

// Layer Config & Precalculated Constants
const ROTATION_POWER = 0.8;
const ROTATION_SPEEDS = [-0.10, 0.10, 0.25];
const EFFECTIVE_ROT_SPEEDS = new Float32Array([
    ROTATION_SPEEDS[0] * ROTATION_POWER,
    ROTATION_SPEEDS[1] * ROTATION_POWER,
    ROTATION_SPEEDS[2] * ROTATION_POWER
]);
const INITIAL_ROTATIONS = new Float32Array([0.3, -2.1, 2.4]);
const PERIMETER_SPEEDS = [0.09, 0.006, 0.01];
const PERIMETER_DIRECTION = [-1, 1, 1];
const EFFECTIVE_PERIM_VEL = new Float32Array([
    PERIMETER_DIRECTION[0] * PERIMETER_SPEEDS[0],
    PERIMETER_DIRECTION[1] * PERIMETER_SPEEDS[1],
    PERIMETER_DIRECTION[2] * PERIMETER_SPEEDS[2]
]);
const LAYER_OFFSETS = new Float32Array([0.0, 0.33, 0.66]);

// Dynamic State
let artworkTransitionProgress = 1.0;
let globalAnimationId = null;
let startTime = 0;
let lastDrawTime = 0;
let bgObserver = null;
const BEAT_ROT_BOOST = new Float32Array([0.28, -0.18, 0.02]);
const BEAT_SPD_BOOST = new Float32Array([0.8, 0.2, 0.5]);
const BEAT_SCALE_BOOST = new Float32Array([0.2, 0.34, 0.39]);
const BEAT_SCALE_DECAY = 2;
const layerPerimTime = new Float64Array([0, 0, 0]);
const layerBeatScale = new Float32Array([0, 0, 0]);
const layerBeatRot = new Float32Array([0, 0, 0]);
let beatEnergyBaseline = 0;

// Precalculated per-frame layer transform cache [rot, scale, px, py] for 3 layers
const _cachedLayerRots = new Float32Array(3);
const _cachedLayerScales = new Float32Array(3);
const _cachedLayerPosX = new Float32Array(3);
const _cachedLayerPosY = new Float32Array(3);

const LYPLUS_FFT_SIZE = 2048;
const LYPLUS_connectedElements = new WeakSet();
let _audioDataArray = null;

const LYPLUS_MEDIA_SELECTORS = [
    'video.video-stream.html5-main-video',
    'video#video-one',
    'audio',
    'video',
];
let _cachedMediaElement = null;
let _lastMediaSearchTime = 0;

function _resolveMediaElement() {
    if (_cachedMediaElement && _cachedMediaElement.isConnected) return _cachedMediaElement;
    const now = performance.now();
    if (now - _lastMediaSearchTime < 250) return null;
    _lastMediaSearchTime = now;
    for (let i = 0; i < LYPLUS_MEDIA_SELECTORS.length; i++) {
        const el = document.querySelector(LYPLUS_MEDIA_SELECTORS[i]);
        if (el) { _cachedMediaElement = el; return el; }
    }
    _cachedMediaElement = null;
    return null;
}

let LYPLUS_audioState = {
    ctx: null,
    analyser: null,
    element: null,
    resumeContextHandler: null,
    beatPulse: 0,
};

function processAudioPulse() {
    if (typeof currentSettings === 'undefined' || !currentSettings.audioBeatSync) {
        LYPLUS_audioState.beatPulse = LYPLUS_audioState.beatPulse > 0.0001 ? LYPLUS_audioState.beatPulse * 0.9 : 0;
        return;
    }

    const currentElement = _resolveMediaElement();

    if (!LYPLUS_audioState.ctx && currentElement) {
        try {
            const ac = new (window.AudioContext || window.webkitAudioContext)();

            if (ac.state === 'suspended') {
                LYPLUS_audioState.resumeContextHandler = () => {
                    LYPLUS_audioState.ctx?.resume();
                    document.removeEventListener('click', LYPLUS_audioState.resumeContextHandler);
                    document.removeEventListener('keydown', LYPLUS_audioState.resumeContextHandler);
                    LYPLUS_audioState.resumeContextHandler = null;
                };
                document.addEventListener('click', LYPLUS_audioState.resumeContextHandler);
                document.addEventListener('keydown', LYPLUS_audioState.resumeContextHandler);
            }

            const an = ac.createAnalyser();
            an.fftSize = LYPLUS_FFT_SIZE;
            an.smoothingTimeConstant = 0.8;

            LYPLUS_audioState.ctx = ac;
            LYPLUS_audioState.analyser = an;

            if (!LYPLUS_connectedElements.has(currentElement)) {
                const src = ac.createMediaElementSource(currentElement);
                src.connect(an);
                src.connect(ac.destination);
                LYPLUS_connectedElements.add(currentElement);
            }
            LYPLUS_audioState.element = currentElement;

        } catch (e) {
            console.warn('LYPLUS: init failed', e);
            LYPLUS_audioState.ctx = { failed: true };
        }

    } else if (
        LYPLUS_audioState.ctx && !LYPLUS_audioState.ctx.failed &&
        currentElement && currentElement !== LYPLUS_audioState.element
    ) {
        try {
            if (!LYPLUS_connectedElements.has(currentElement)) {
                const src = LYPLUS_audioState.ctx.createMediaElementSource(currentElement);
                src.connect(LYPLUS_audioState.analyser);
                src.connect(LYPLUS_audioState.ctx.destination);
                LYPLUS_connectedElements.add(currentElement);
            }
            LYPLUS_audioState.element = currentElement;
        } catch (e) {
            console.warn('LYPLUS: reconnect failed', e);
        }
    }

    const s = LYPLUS_audioState;
    if (s.ctx && !s.ctx.failed && s.analyser && s.element && !s.element.paused) {
        const bufferLength = s.analyser.frequencyBinCount;

        if (!_audioDataArray || _audioDataArray.length !== bufferLength) {
            _audioDataArray = new Uint8Array(bufferLength);
        }
        const dataArray = _audioDataArray;
        s.analyser.getByteTimeDomainData(dataArray);

        const vol = s.element.volume;
        const volumeMultiplier = vol > 0.005 ? 1 / vol : 1;

        let minVal = 128;
        let maxVal = 128;
        for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i];
            if (v < minVal) minVal = v;
            else if (v > maxVal) maxVal = v;
        }
        const maxDiff = (128 - minVal) > (maxVal - 128) ? (128 - minVal) : (maxVal - 128);

        s.beatPulse = (maxDiff * 0.0078125) * volumeMultiplier;
    } else {
        s.beatPulse = s.beatPulse > 0.0001 ? s.beatPulse * 0.9 : 0;
    }
}

// Artwork Processing
let isProcessingArtwork = false;
let pendingArtworkUrl = null;
let currentProcessingArtworkIdentifier = null;
let lastAppliedArtworkIdentifier = null;
let artworkCheckTimeoutId = null;
let artworkRetryCount = 0;
const MAX_ARTWORK_RETRIES = 5;
const ARTWORK_RECHECK_DELAY = 300;
const NO_ARTWORK_IDENTIFIER = 'LYPLUS_NO_ARTWORK';

// Shader Sources

const vertexShaderSource = `
    attribute vec2 a_position;
    
    // [rotation(rad), scale, offsetX, offsetY]
    uniform vec4 u_layerTransform; 
    
    uniform float u_aspect;
    uniform float u_renderHeight;
    
    varying vec2 v_uv;
    varying float v_edgePx;
    
    void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        
        float rotation = u_layerTransform.x;
        float scale = u_layerTransform.y;
        vec2 offset = u_layerTransform.zw * vec2(u_aspect, 1.0);
        
        vec2 centered = vec2(a_position.x * 0.5 * u_aspect, -a_position.y * 0.5) - offset;
        
        float s = sin(-rotation);
        float c = cos(-rotation);
        centered = vec2(centered.x * c - centered.y * s, centered.x * s + centered.y * c);
        
        v_uv = (centered / scale) + 0.5;
        v_edgePx = scale * u_renderHeight;
    }
`;

const quadVertexShaderSource = `
    attribute vec2 a_position;
    varying vec2 v_texCoord;
    
    void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_position * 0.5 + 0.5;
    }
`;

const fragmentShaderSource = `
    #ifdef GL_ES
    precision mediump float;
    #endif
    
    varying vec2 v_uv;
    varying float v_edgePx;
    uniform sampler2D u_artworkTexture;
    uniform float u_transitionProgress;
    uniform float u_preSaturate;
    
    void main() {
        vec2 e = min(v_uv, 1.0 - v_uv);
        float aa = clamp(min(e.x, e.y) * v_edgePx + 0.5, 0.0, 1.0);
        if (aa <= 0.0) discard;
        vec4 color = texture2D(u_artworkTexture, v_uv);
        float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
        vec3 satRgb = clamp(mix(vec3(luma), color.rgb, u_preSaturate), 0.0, 1.0);
        gl_FragColor = vec4(satRgb, color.a * u_transitionProgress * aa);
    }
`;

function _buildGaussianKernel(sigma, radiusSigmas) {
    const radius = Math.max(1, Math.ceil(sigma * radiusSigmas));
    const g = new Float64Array(radius + 1);
    const invTwoSigmaSq = 1.0 / (2.0 * sigma * sigma);
    let sum = 0;
    for (let k = 0; k <= radius; k++) {
        const w = Math.exp(-(k * k) * invTwoSigmaSq);
        g[k] = w;
        sum += k === 0 ? w : 2.0 * w;
    }
    const invSum = 1.0 / sum;
    for (let k = 0; k <= radius; k++) g[k] *= invSum;

    const taps = [];
    for (let k = 1; k <= radius; k += 2) {
        if (k + 1 <= radius) {
            const w0 = g[k];
            const w1 = g[k + 1];
            const w = w0 + w1;
            taps.push({ offset: (k * w0 + (k + 1) * w1) / w, weight: w });
        } else {
            taps.push({ offset: k, weight: g[k] });
        }
    }
    return { center: g[0], taps };
}

function _glslFloat(v) {
    return v.toFixed(8);
}

function _blurTapsGLSL(kernel) {
    let src = `    vec3 c = texture2D(u_image, v_texCoord).rgb * ${_glslFloat(kernel.center)};\n`;
    for (let i = 0; i < kernel.taps.length; i++) {
        const t = kernel.taps[i];
        const off = _glslFloat(t.offset);
        src += `    c += (texture2D(u_image, v_texCoord + u_step * ${off}).rgb` +
               ` + texture2D(u_image, v_texCoord - u_step * ${off}).rgb) * ${_glslFloat(t.weight)};\n`;
    }
    return src;
}

function buildBlurPassFragmentShaderSource(kernel) {
    return `
    #ifdef GL_ES
    precision mediump float;
    #endif

    varying vec2 v_texCoord;
    uniform sampler2D u_image;
    uniform vec2 u_step;

    void main() {
${_blurTapsGLSL(kernel)}
        gl_FragColor = vec4(c, 1.0);
    }
`;
}

const POST_PROCESS_REGEX = /([\w-]+)\(([^)]+)\)/g;

function _parsePostProcess(str, out) {
    _getActivePipeline().applyDefaultPostParams(out);

    if (!str || !str.trim()) return out;
    POST_PROCESS_REGEX.lastIndex = 0;
    let m;
    while ((m = POST_PROCESS_REGEX.exec(str)) !== null) {
        const fn = m[1].toLowerCase();
        const raw = m[2].trim();
        const num = parseFloat(raw);
        if (!isNaN(num)) {
            const val = raw.endsWith('%') ? num * 0.01 : num;
            if      (fn === 'brightness')          out.brightness = val;
            else if (fn === 'saturate')            out.saturate = val;
            else if (fn === 'pre-saturate')        out.preSaturate = val;
            else if (fn === 'contrast')            out.contrast = val;
            else if (fn === 'opacity')             out.opacity = val;
            else if (fn === 'black-scrim')         out.blackScrim = val;
            else if (fn === 'white-scrim')         out.whiteScrim = val;
            else if (fn === 'dark-factor')         out.darkFactor = val;
            else if (fn === 'light-factor')        out.lightFactor = val;
            else if (fn === 'floor')               out.floor = val;
            else if (fn === 'ceiling')             out.ceiling = val;
            else if (fn === 'mesh-warp-timescale') out.meshWarpTimeScale = val;
            else if (fn === 'hue-rotate')          out.hueRotate = raw.endsWith('rad') ? num : num * DEG_TO_RAD;
        }
    }
    return out;
}

function _readPostParamsFromCSS() {
    if (!blurContainerElem) return;
    const raw = getComputedStyle(blurContainerElem).getPropertyValue('--webgl-post-process');
    _parsePostProcess(raw, _postParams);
    _postParamsDirty = false;
    _appliedPostUniformsDirty = true;
}

function handleContextLost(event) {
    event.preventDefault();
    console.warn("LYPLUS: WebGL context lost.");
    if (globalAnimationId) {
        cancelAnimationFrame(globalAnimationId);
        globalAnimationId = null;
    }
    gl = null;
    vaoExt = null;
    mainVAO = null;
    glProgram = null;
    _activeLightweight = null;
    _kernelBaseSize = 0;
    _androidPipeline.resetState();
    _meshPipeline.resetState();
}

function handleContextRestored() {
    console.log("LYPLUS: WebGL context restored.");
    LYPLUS_setupBlurEffect();

    let targetUrl = pendingArtworkUrl || lastAppliedArtworkIdentifier;
    lastAppliedArtworkIdentifier = null;
    currentProcessingArtworkIdentifier = null;
    pendingArtworkUrl = null;
    isProcessingArtwork = false;

    if (targetUrl && targetUrl !== NO_ARTWORK_IDENTIFIER) {
        LYPLUS_requestProcessNewArtwork(targetUrl);
    } else {
        const el = LYPLUS_bgConfig.artworkSelector ? document.querySelector(LYPLUS_bgConfig.artworkSelector) : null;
        if (el) LYPLUS_requestProcessNewArtwork(el.src);
    }
}

function createShader(glCtx, type, source) {
    const shader = glCtx.createShader(type);
    glCtx.shaderSource(shader, source);
    glCtx.compileShader(shader);
    if (!glCtx.getShaderParameter(shader, glCtx.COMPILE_STATUS)) {
        console.error('LYPLUS: Shader compile error:', glCtx.getShaderInfoLog(shader));
        glCtx.deleteShader(shader);
        return null;
    }
    return shader;
}

function createProgram(glCtx, vs, fs) {
    const program = glCtx.createProgram();
    glCtx.attachShader(program, vs);
    glCtx.attachShader(program, fs);
    glCtx.linkProgram(program);
    if (!glCtx.getProgramParameter(program, glCtx.LINK_STATUS)) {
        console.error('LYPLUS: Program link error:', glCtx.getProgramInfoLog(program));
        glCtx.deleteProgram(program);
        return null;
    }
    return program;
}

function LYPLUS_setupBlurEffect() {
    console.log("LYPLUS: Setting up Optimized WebGL...");
    const pipeline = _getActivePipeline();

    canvasDimensions.width = 0;
    canvasDimensions.height = 0;
    blurDimensions.width = 0;
    blurDimensions.height = 0;

    if (typeof currentSettings !== 'undefined' && currentSettings.dynamicPlayer) {
        for (let i = 0; i < LYPLUS_bgConfig.dynamicPlayerSelectors.length; i++) {
            document.querySelector(LYPLUS_bgConfig.dynamicPlayerSelectors[i])?.classList.add("dynamic-player");
        }
    }
    const existingContainer = document.querySelector('.lyplus-blur-container');
    if (existingContainer) existingContainer.remove();

    blurContainerElem = document.createElement('div');
    blurContainerElem.classList.add('lyplus-blur-container');
    webglCanvas = document.createElement('canvas');
    webglCanvas.id = 'lyplus-webgl-canvas';
    blurContainerElem.appendChild(webglCanvas);
    (document.querySelector(LYPLUS_bgConfig.blurContainerParentSelector) || document.body).prepend(blurContainerElem);

    blurContainerElem.style.transition = '--webgl-post-process-tick 0.001ms step-start';
    blurContainerElem.addEventListener('transitionstart', (e) => {
        if (e.propertyName === '--webgl-post-process-tick') _postParamsDirty = true;
    });

    const ctxAttribs = {
        alpha: false,
        depth: false,
        stencil: false,
        antialias: false,
        preserveDrawingBuffer: false,
        powerPreference: 'low-power'
    };
    try {
        gl = webglCanvas.getContext('webgl', ctxAttribs) || webglCanvas.getContext('experimental-webgl', ctxAttribs);
    } catch (e) { }

    if (!gl) return null;

    _androidPipeline.resetState();
    _meshPipeline.resetState();
    _activeLightweight = null;
    _kernelBaseSize = 0;

    if (bgObserver) bgObserver.disconnect();
    bgObserver = new MutationObserver(() => {
        if (blurContainerElem && !blurContainerElem.isConnected) {
            checkBg();
        }
    });

    const parent = document.querySelector(LYPLUS_bgConfig.mutationObserverRootSelector) || document.body;
    bgObserver.observe(parent, { childList: true, subtree: parent === document.body });

    vaoExt = gl.getExtension('OES_vertex_array_object');

    webglCanvas.addEventListener('webglcontextlost', handleContextLost, false);
    webglCanvas.addEventListener('webglcontextrestored', handleContextRestored, false);

    // Main Rotating Layers Shader Compilation
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const mainFragShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    if (!vertexShader || !mainFragShader) return null;

    glProgram = createProgram(gl, vertexShader, mainFragShader);
    gl.deleteShader(vertexShader);
    gl.deleteShader(mainFragShader);
    if (!glProgram) return null;

    if (!pipeline.initStaticPrograms()) return null;

    pipeline.applyDefaultPostParams(_postParams);

    // Locations - Main
    a_main_pos = gl.getAttribLocation(glProgram, 'a_position');
    u_main_artworkTexture = gl.getUniformLocation(glProgram, 'u_artworkTexture');
    u_main_transitionProgress = gl.getUniformLocation(glProgram, 'u_transitionProgress');
    u_main_layerTransform = gl.getUniformLocation(glProgram, 'u_layerTransform');
    u_main_aspect = gl.getUniformLocation(glProgram, 'u_aspect');
    u_main_renderHeight = gl.getUniformLocation(glProgram, 'u_renderHeight');
    u_main_preSaturate = gl.getUniformLocation(glProgram, 'u_preSaturate');

    gl.useProgram(glProgram);
    gl.uniform1i(u_main_artworkTexture, 0);
    gl.uniform1f(u_main_preSaturate, pipeline.getPreSaturate());

    // Position-only Quad Buffer [x, y]
    quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTICES, gl.STATIC_DRAW);

    // VAO Setup
    if (vaoExt) {
        mainVAO = vaoExt.createVertexArrayOES();
        vaoExt.bindVertexArrayOES(mainVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.enableVertexAttribArray(a_main_pos);
        gl.vertexAttribPointer(a_main_pos, 2, gl.FLOAT, false, 0, 0);
        vaoExt.bindVertexArrayOES(null);
    } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.enableVertexAttribArray(a_main_pos);
        gl.vertexAttribPointer(a_main_pos, 2, gl.FLOAT, false, 0, 0);
    }

    pipeline.initVAOs();

    _postParamsDirty = true;
    _appliedPostUniformsDirty = true;

    // Textures & Framebuffers
    currentArtworkTexture = createDefaultTexture();
    previousArtworkTexture = createDefaultTexture();
    renderFramebuffer = gl.createFramebuffer();
    blurFramebuffer = gl.createFramebuffer();

    const confTex = (tex) => {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    };

    renderTexture = gl.createTexture(); confTex(renderTexture);
    blurTextureA = gl.createTexture(); confTex(blurTextureA);

    gl.bindFramebuffer(gl.FRAMEBUFFER, renderFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, renderTexture, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, blurFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, blurTextureA, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    handleResize();
    if (!pipeline.isProgramsReady()) return null;
    window.removeEventListener('resize', handleResize);
    window.addEventListener('resize', handleResize, { passive: true });
    if (_viewportObserver) _viewportObserver.disconnect();
    if (typeof ResizeObserver !== 'undefined') {
        _viewportObserver = new ResizeObserver(handleResize);
        _viewportObserver.observe(webglCanvas);
    }

    startTime = performance.now() / 1000;

    if (_intersectionObserver) _intersectionObserver.disconnect();
    _intersectionObserver = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
            if (!globalAnimationId) globalAnimationId = requestAnimationFrame(animateWebGLBackground);
        } else if (globalAnimationId) {
            cancelAnimationFrame(globalAnimationId);
            globalAnimationId = null;
        }
    }, { threshold: 0.01 });
    _intersectionObserver.observe(webglCanvas);

    return blurContainerElem;
}

function _isLightweightMode() {
    return typeof currentSettings !== 'undefined' && !!currentSettings.lightweight;
}

let _kernelBaseSize = 0;
function _rebuildBlurPrograms(renderSize) {
    const kernel = _buildGaussianKernel(BLUR_SIGMA_UV * renderSize, BLUR_KERNEL_SIGMAS);

    const quadVS = createShader(gl, gl.VERTEX_SHADER, quadVertexShaderSource);
    const passFS = createShader(gl, gl.FRAGMENT_SHADER, buildBlurPassFragmentShaderSource(kernel));
    if (!quadVS || !passFS) return false;

    const ok = _getActivePipeline().rebuildBlurPrograms(quadVS, passFS, kernel);
    gl.deleteShader(quadVS);
    gl.deleteShader(passFS);
    if (!ok) return false;

    _kernelBaseSize = renderSize;
    _appliedPostUniformsDirty = true;
    return true;
}

function _applyViewportUniforms() {
    _getActivePipeline().applyViewportUniforms();

    gl.useProgram(glProgram);
    _layerSizeFactor[0] = Math.sqrt(_viewportAspect * _viewportAspect + 1) * Math.SQRT1_2;
    _layerSizeFactor[1] = _layerSizeFactor[2] = Math.sqrt(_viewportAspect);
    gl.uniform1f(u_main_aspect, _viewportAspect);
    gl.uniform1f(u_main_renderHeight, blurDimensions.height);
}

function _getViewportAspect() {
    let w = 0, h = 0;
    if (webglCanvas) { w = webglCanvas.clientWidth; h = webglCanvas.clientHeight; }
    if (!(w > 0 && h > 0) && blurContainerElem) { w = blurContainerElem.clientWidth; h = blurContainerElem.clientHeight; }
    if (!(w > 0 && h > 0)) { w = window.innerWidth; h = window.innerHeight; }
    if (!(w > 0 && h > 0)) return 1.0;
    return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, w / h));
}

function handleResize() {
    if (!gl || !webglCanvas) return;
    const pipeline = _getActivePipeline();
    const lightweight = _isLightweightMode();
    const base = lightweight ? RENDER_SIZE_LIGHTWEIGHT : RENDER_SIZE;
    const aspect = _getViewportAspect();
    const rt = Math.sqrt(aspect);

    const rw = Math.max(8, Math.round(base * rt));
    const rh = Math.max(8, Math.round(base / rt));
    const canvasBase = pipeline.getCanvasBaseSize();
    const cw = Math.max(8, Math.round(canvasBase * rt));
    const ch = Math.max(8, Math.round(canvasBase / rt));

    const sizeChanged = rw !== blurDimensions.width || rh !== blurDimensions.height ||
                        cw !== canvasDimensions.width || ch !== canvasDimensions.height;
    if (!sizeChanged && lightweight === _activeLightweight) return;

    if (cw !== canvasDimensions.width || ch !== canvasDimensions.height) {
        canvasDimensions.width = cw;
        canvasDimensions.height = ch;
        webglCanvas.width = cw;
        webglCanvas.height = ch;
    }
    if (rw !== blurDimensions.width || rh !== blurDimensions.height) {
        blurDimensions.width = rw;
        blurDimensions.height = rh;
        gl.bindTexture(gl.TEXTURE_2D, renderTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, rw, rh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindTexture(gl.TEXTURE_2D, blurTextureA);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, rw, rh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }

    if (!pipeline.isProgramsReady() || _kernelBaseSize !== base) {
        if (!_rebuildBlurPrograms(base)) {
            console.error('LYPLUS: failed to build blur programs');
            return;
        }
    }
    _viewportAspect = aspect;
    _applyViewportUniforms();
    _activeLightweight = lightweight;

    _needsRedraw = true;
    if (!globalAnimationId) globalAnimationId = requestAnimationFrame(animateWebGLBackground);
}

function createDefaultTexture() {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, DEFAULT_TEX_PIXEL);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return texture;
}

function _createArtworkTexture(img) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    try {
        const size = ARTWORK_TEX_SIZE;
        let src = img;
        let cw = img.naturalWidth || img.width;
        let ch = img.naturalHeight || img.height;
        let pingPong = 0;

        while (cw > size * 2 || ch > size * 2) {
            const nw = Math.max(size, (cw + 1) >> 1);
            const nh = Math.max(size, (ch + 1) >> 1);
            const step = _getScratchCanvas(pingPong, nw, nh);
            step.ctx.drawImage(src, 0, 0, nw, nh);
            src = step.canvas;
            cw = nw;
            ch = nh;
            pingPong ^= 1;
        }
        const outStep = _getScratchCanvas(pingPong, size, size);
        outStep.ctx.drawImage(src, 0, 0, size, size);

        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, outStep.canvas);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } catch (e) {
        console.warn('LYPLUS: artwork prefilter failed, uploading directly', e);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    return tex;
}

function _isBaseUrl(url) {
    return url === "https://music.youtube.com/" ||
           url === "https://www.youtube.com/" ||
           url === "https://music.youtube.com" ||
           url === "https://www.youtube.com";
}

function LYPLUS_requestProcessNewArtwork(url) {
    if (!glProgram && !LYPLUS_setupBlurEffect()) return;
    if (artworkCheckTimeoutId) { clearTimeout(artworkCheckTimeoutId); artworkCheckTimeoutId = null; }

    let target;
    const isString = typeof url === 'string';
    const isBase = isString && _isBaseUrl(url);
    const isEmpty = !url || (isString && (url.trim() === "" || url === "null" || url === "undefined"));

    if (isString && url.startsWith('data:')) {
        target = url;
        artworkRetryCount = 0;
    } else if (isString && url.startsWith('http') && !isBase) {
        target = url;
        artworkRetryCount = 0;
    } else if (isBase || isEmpty) {
        if (artworkRetryCount < MAX_ARTWORK_RETRIES) {
            artworkRetryCount++;
            artworkCheckTimeoutId = setTimeout(() => {
                const el = LYPLUS_bgConfig.artworkSelector ? document.querySelector(LYPLUS_bgConfig.artworkSelector) : null;
                LYPLUS_requestProcessNewArtwork(el ? el.src : null);
            }, ARTWORK_RECHECK_DELAY * artworkRetryCount);
            return;
        } else {
            target = NO_ARTWORK_IDENTIFIER;
            artworkRetryCount = 0;
        }
    } else {
        target = NO_ARTWORK_IDENTIFIER;
        artworkRetryCount = 0;
    }

    if (target === lastAppliedArtworkIdentifier && artworkTransitionProgress >= 1.0) return;
    if (target === currentProcessingArtworkIdentifier || target === pendingArtworkUrl) return;

    pendingArtworkUrl = target;
    if (!isProcessingArtwork) processNextArtworkFromQueue();
}

function processNextArtworkFromQueue() {
    if (isProcessingArtwork || !pendingArtworkUrl) return;
    isProcessingArtwork = true;
    currentProcessingArtworkIdentifier = pendingArtworkUrl;
    pendingArtworkUrl = null;

    const finalize = (tex, pal) => {
        if (previousArtworkTexture && previousArtworkTexture !== currentArtworkTexture) {
            gl.deleteTexture(previousArtworkTexture);
        }
        previousArtworkTexture = currentArtworkTexture;
        currentArtworkTexture = tex;
        currentTargetMasterArtworkPalette = pal;
        artworkTransitionProgress = 0.0;
        needsAnimation = true;
        if (!globalAnimationId) globalAnimationId = requestAnimationFrame(animateWebGLBackground);

        lastAppliedArtworkIdentifier = currentProcessingArtworkIdentifier;
        isProcessingArtwork = false;
        currentProcessingArtworkIdentifier = null;
        if (pendingArtworkUrl) processNextArtworkFromQueue();
    };

    if (currentProcessingArtworkIdentifier === NO_ARTWORK_IDENTIFIER) {
        finalize(createDefaultTexture(), DEFAULT_PALETTE);
        return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
        const pal = (typeof ColorTunes !== 'undefined') ? ColorTunes.getSongPalette(img) : currentTargetMasterArtworkPalette;
        finalize(_createArtworkTexture(img), pal);
    };

    const pBrowser = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);

    img.onerror = () => {
        if (pBrowser && pBrowser.runtime) {
            console.warn("LYPLUS: Direct img.src failed, retrying via background fetch...");
            pBrowser.runtime.sendMessage({ type: 'FETCH_IMAGE', url: currentProcessingArtworkIdentifier }, (response) => {
                if (pBrowser.runtime.lastError || !response || !response.success || !response.dataUrl) {
                    console.warn("LYPLUS: Background fetch also failed", pBrowser.runtime.lastError || (response && response.error));
                    finalize(createDefaultTexture(), currentTargetMasterArtworkPalette);
                    return;
                }
                img.onerror = () => finalize(createDefaultTexture(), currentTargetMasterArtworkPalette);
                img.src = response.dataUrl;
            });
        } else {
            finalize(createDefaultTexture(), currentTargetMasterArtworkPalette);
        }
    };

    img.src = currentProcessingArtworkIdentifier;
}

// Draw a single artwork texture with 3 layers using precalculated transforms
function _renderLayerQuads(tex, progress) {
    if (progress <= 0.001) return;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1f(u_main_transitionProgress, progress);

    for (let i = 0; i < 3; i++) {
        gl.uniform4f(
            u_main_layerTransform,
            _cachedLayerRots[i],
            _cachedLayerScales[i],
            _cachedLayerPosX[i],
            _cachedLayerPosY[i]
        );
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
}

function animateWebGLBackground(timestamp) {
    if (!gl) { globalAnimationId = null; return; }

    const interval = (timestamp < _bgThrottleUntil && artworkTransitionProgress >= 1.0)
        ? THROTTLED_FRAME_INTERVAL
        : FRAME_INTERVAL;
    const elapsed = timestamp - lastDrawTime;
    if (elapsed < interval) {
        globalAnimationId = requestAnimationFrame(animateWebGLBackground);
        return;
    }
    const elapsedSec = Math.min(elapsed * 0.001, 0.1);
    lastDrawTime = timestamp - (elapsed % interval);

    const currentTime = lastDrawTime * 0.001 - startTime;

    const isTransitioning = artworkTransitionProgress < 1.0;
    if (isTransitioning) {
        artworkTransitionProgress = Math.min(1.0, artworkTransitionProgress + ARTWORK_TRANSITION_STEP);
        if (artworkTransitionProgress >= 1.0) needsAnimation = false;
    }

    processAudioPulse();
    const pulse = LYPLUS_audioState.beatPulse;
    const isLightweight = _isLightweightMode();

    const shouldRender =
        !isLightweight ||
        isTransitioning ||
        needsAnimation ||
        _needsRedraw ||
        (currentSettings.audioBeatSync && pulse > 0.001);

    if (!shouldRender) {
        globalAnimationId = null;
        return;
    }

    if (isLightweight !== _activeLightweight) handleResize();

    const pipeline = _getActivePipeline();
    if (!pipeline.isProgramsReady()) {
        globalAnimationId = requestAnimationFrame(animateWebGLBackground);
        return;
    }

    if (_postParamsDirty) _readPostParamsFromCSS();

    beatEnergyBaseline += (pulse - beatEnergyBaseline) * Math.min(1.0, 0.8 * elapsedSec);
    const relativePulse = pulse > beatEnergyBaseline ? pulse - beatEnergyBaseline : 0.0;

    const layerScales = pipeline.layerScales;
    const layerAbsBaseX = pipeline.layerAbsBaseX;
    const layerAbsBaseY = pipeline.layerAbsBaseY;

    if (isLightweight) {
        for (let i = 0; i < 3; i++) {
            _cachedLayerRots[i] = 0.0;
            _cachedLayerScales[i] = layerScales[i] * _layerSizeFactor[i];
            _cachedLayerPosX[i] = 0.0;
            _cachedLayerPosY[i] = 0.0;
        }
    } else {
        for (let i = 0; i < 3; i++) {
            const tPerim = (layerPerimTime[i] += elapsedSec * (1.0 + pulse * BEAT_SPD_BOOST[i]));

            let bs = layerBeatScale[i];
            const speed = relativePulse > bs ? 12.0 : BEAT_SCALE_DECAY;
            const delta = Math.min(1.0, speed * elapsedSec);
            bs += (relativePulse - bs) * delta;
            layerBeatScale[i] = bs;

            let br = layerBeatRot[i];
            br += (relativePulse - br) * delta;
            layerBeatRot[i] = br;

            const smoothBS = bs * bs * (3.0 - 2.0 * bs);
            const smoothBR = br * br * (3.0 - 2.0 * br);

            const angle = ((LAYER_OFFSETS[i] + EFFECTIVE_PERIM_VEL[i] * tPerim) % 1.0) * TWO_PI;

            _cachedLayerRots[i] = INITIAL_ROTATIONS[i] + EFFECTIVE_ROT_SPEEDS[i] * currentTime + smoothBR * BEAT_ROT_BOOST[i];
            _cachedLayerScales[i] = (layerScales[i] + smoothBS * BEAT_SCALE_BOOST[i]) * _layerSizeFactor[i];
            _cachedLayerPosX[i] = layerAbsBaseX[i] * Math.cos(angle);
            _cachedLayerPosY[i] = layerAbsBaseY[i] * Math.sin(angle);
        }
    }

    const bw = blurDimensions.width;
    const bh = blurDimensions.height;

    // --- PASS 1: Render 3 rotating artwork layers to renderFramebuffer ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, renderFramebuffer);
    gl.viewport(0, 0, bw, bh);

    const bgCol = currentTargetMasterArtworkPalette?.background || DEFAULT_PALETTE.background;
    gl.clearColor((bgCol.r || 0) / 255.0, (bgCol.g || 0) / 255.0, (bgCol.b || 0) / 255.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(glProgram);
    gl.uniform1f(u_main_preSaturate, pipeline.getPreSaturate());
    if (vaoExt) {
        vaoExt.bindVertexArrayOES(mainVAO);
    } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.vertexAttribPointer(a_main_pos, 2, gl.FLOAT, false, 0, 0);
    }

    gl.enable(gl.BLEND);

    if (artworkTransitionProgress < 1.0) {
        _renderLayerQuads(previousArtworkTexture, 1.0 - artworkTransitionProgress);
    }
    _renderLayerQuads(currentArtworkTexture, artworkTransitionProgress);

    gl.disable(gl.BLEND);

    pipeline.renderFrame(currentTime, isLightweight);

    _needsRedraw = false;

    globalAnimationId = requestAnimationFrame(animateWebGLBackground);
}

let bgCheckRetryTimeout = null;

function checkBg() {
    if (!blurContainerElem) return;
    if (bgCheckRetryTimeout) {
        clearTimeout(bgCheckRetryTimeout);
        bgCheckRetryTimeout = null;
    }

    if (!blurContainerElem.isConnected) {
        const parent = document.querySelector(LYPLUS_bgConfig.blurContainerParentSelector) || document.body;
        if (parent) {
            parent.prepend(blurContainerElem);
            if (!globalAnimationId) globalAnimationId = requestAnimationFrame(animateWebGLBackground);
        } else {
            bgCheckRetryTimeout = setTimeout(checkBg, 100);
        }
    }
}

function LYPLUS_getSongPalette() {
    const c = currentTargetMasterArtworkPalette?.primary || DEFAULT_PALETTE.primary;
    return { r: c.r, g: c.g, b: c.b, a: 255 };
}

window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const type = event.data?.type;
    if (type === 'LYPLUS_updateFullScreenAnimatedBg') {
        const el = LYPLUS_bgConfig.artworkSelector ? document.querySelector(LYPLUS_bgConfig.artworkSelector) : null;
        checkBg();
        const targetUrl = event.data?.artworkUrl || (el ? el.src : null);
        LYPLUS_requestProcessNewArtwork(targetUrl);
    } else if (type === 'LYPLUS_reattachBg') {
        checkBg();
    }
});

// Apple Music Mac

const MESH_PRESET_INDEX = -1; // -1 = dynamic morphing, 0..2 = fixed preset index
const DISABLE_GAUSSIAN_BLUR = false; // true = MPSImageGaussianBlur sigma 0

const MESH_LAYER_SCALES = new Float32Array([1.02, 0.74, 0.62]);
const MESH_LAYER_BASE_POSITIONS = [0, 0, 0.42, -0.42, -0.42, 0.42];
const MESH_LAYER_ABS_BASE_X = new Float32Array([
    Math.abs(MESH_LAYER_BASE_POSITIONS[0]),
    Math.abs(MESH_LAYER_BASE_POSITIONS[2]),
    Math.abs(MESH_LAYER_BASE_POSITIONS[4])
]);
const MESH_LAYER_ABS_BASE_Y = new Float32Array([
    Math.abs(MESH_LAYER_BASE_POSITIONS[1]),
    Math.abs(MESH_LAYER_BASE_POSITIONS[3]),
    Math.abs(MESH_LAYER_BASE_POSITIONS[5])
]);

// PinchEncoder Mesh Constants (6x6 control grid -> 3 subdivision steps -> 41x41 = 1681 vertices, 9600 indices)
const MESH_CTRL_N = 6;
const MESH_SUBDIV_N = 41;
const MESH_VERTEX_COUNT = MESH_SUBDIV_N * MESH_SUBDIV_N;
const MESH_FLOATS_PER_VERTEX = 14;
const MESH_INDEX_COUNT = (MESH_SUBDIV_N - 1) * (MESH_SUBDIV_N - 1) * 6;

// Normalized to NDC [-1.04, 1.04] (dividing the raw Metal aspect-space dump by aspect ~1.42)
// so the mesh does not over-zoom the artwork while preserving the S-curve pinch folds.
const MESH_CONTROL_PRESETS = [
    new Float32Array([
        -1.0400, -1.0400,  -0.3400, -1.0800,   0.4200, -1.0300,   0.6800, -0.9600,   1.0100, -0.8200,   1.0500, -0.7000,
        -1.0200, -0.5800,  -0.5200, -0.6800,   0.3400, -0.5200,   0.6600, -0.4400,   0.9400, -0.3800,   1.0400, -0.3000,
        -1.0100, -0.1400,  -0.6800, -0.0600,  -0.1800,  0.0400,   0.5400,  0.1400,   0.8600,  0.0400,   1.0300,  0.0800,
        -1.0100,  0.2800,  -0.2400,  0.4200,   0.4400,  0.2200,   0.7200,  0.4400,   0.9200,  0.4600,   1.0300,  0.5000,
        -1.0200,  0.6800,  -0.4400,  0.7600,   0.1200,  0.6200,   0.5600,  0.7400,   0.8800,  0.8000,   1.0400,  0.8200,
        -1.0400,  1.0400,  -0.4600,  1.0600,   0.1000,  1.0200,   0.5600,  1.0500,   0.8900,  1.0300,   1.0500,  1.0400
    ]),
    new Float32Array([
        -1.0400, -1.0400,  -0.4800, -1.0200,   0.1200, -1.0600,   0.5800, -1.0300,   0.9200, -0.9600,   1.0400, -0.9000,
        -1.0200, -0.6000,  -0.2200, -0.7200,   0.4600, -0.5400,   0.7800, -0.4800,   0.9600, -0.4600,   1.0400, -0.4000,
        -1.0100, -0.2000,  -0.0800, -0.2600,   0.4400, -0.0800,   0.7200,  0.0200,   0.9000,  0.0000,   1.0300,  0.0600,
        -1.0200,  0.2400,  -0.6200,  0.1400,  -0.2200,  0.3400,   0.3800,  0.4200,   0.8400,  0.4200,   1.0300,  0.4600,
        -1.0300,  0.6600,  -0.6400,  0.6000,  -0.1000,  0.7600,   0.4800,  0.8000,   0.8600,  0.7600,   1.0400,  0.8200,
        -1.0400,  1.0300,  -0.3800,  1.0600,   0.2200,  1.0400,   0.6200,  1.0100,   0.9600,  0.9600,   1.0500,  1.0200
    ]),
    new Float32Array([
        -1.0400, -1.0200,  -0.4000, -1.0500,   0.2400, -1.0100,   0.6500, -1.0400,   0.9600, -0.9200,   1.0500, -0.8000,
        -1.0200, -0.5400,  -0.5800, -0.4600,   0.0400, -0.6400,   0.5800, -0.5800,   0.9200, -0.4200,   1.0400, -0.3600,
        -1.0100, -0.0600,  -0.3800,  0.1200,   0.3200, -0.1800,   0.6800, -0.1000,   0.8900,  0.0600,   1.0300,  0.1000,
        -1.0100,  0.3600,  -0.5000,  0.5000,   0.0800,  0.2000,   0.6000,  0.2800,   0.8800,  0.4800,   1.0300,  0.5200,
        -1.0200,  0.7200,  -0.3800,  0.8000,   0.2000,  0.6800,   0.6400,  0.6600,   0.9000,  0.7800,   1.0400,  0.8600,
        -1.0400,  1.0400,  -0.4200,  1.0300,   0.1800,  1.0600,   0.5800,  1.0200,   0.9200,  1.0100,   1.0500,  1.0400
    ])
];

let meshBlurHProgram = null;
let meshBlurVProgram = null;
let meshPostProgram = null;
let meshBlurHVAO = null;
let meshBlurVVAO = null;
let meshVAO = null;
let meshVertexBuffer = null;
let meshIndexBuffer = null;
let _meshActivePair = [-1, -1];
let _meshCpuVertices = null;

let a_meshBlurH_pos = -1;
let u_meshBlurH_image = null;
let u_meshBlurH_step = null;

let a_meshBlurV_pos = -1;
let u_meshBlurV_image = null;
let u_meshBlurV_step = null;

let a_mesh_base = -1;
let a_mesh_posA = -1;
let a_mesh_posB = -1;
let a_mesh_uv = -1;

let u_mesh_image = null;
let u_mesh_viewAspect = null;
let u_mesh_time = null;
let u_mesh_warpTimeScale = null;
let u_mesh_presetMix = null;
let u_mesh_saturate = null;
let u_mesh_whiteScrim = null;
let u_mesh_blackScrim = null;
let u_mesh_darkFactor = null;
let u_mesh_lightFactor = null;
let u_mesh_floor = null;
let u_mesh_ceiling = null;
let u_mesh_brightness = null;
let u_mesh_contrast = null;
let u_mesh_hueRotate = null;
let u_mesh_opacity = null;

const meshVertexShaderSource = `
    attribute vec4 a_basePos;
    attribute vec4 a_posA;
    attribute vec4 a_posB;
    attribute vec2 a_uv;

    uniform float u_viewAspect;
    uniform float u_time;
    uniform float u_warpTimeScale;
    uniform float u_presetMix;

    varying vec2 v_texCoord;

    void main() {
        vec2 pos = mix(a_posA.xy, a_posB.xy, u_presetMix);

        float t = u_time * u_warpTimeScale;
        float u = a_basePos.x;
        float v = a_basePos.y;
        float edgeWeight = sin(u * 3.14159265) * sin(v * 3.14159265);

        vec2 drift = vec2(
            sin(t * 0.31 + v * 4.2 + u * 2.1) * 0.16 + cos(t * 0.19 - (u + v) * 3.4) * 0.09,
            cos(t * 0.27 + u * 4.5 - v * 2.3) * 0.16 + sin(t * 0.23 + (u - v) * 3.1) * 0.09
        ) * edgeWeight;

        vec2 finalPos = pos + drift;
        gl_Position = vec4(finalPos.x, finalPos.y, 0.0, 1.0);
        v_texCoord = a_uv;
    }
`;

const meshFragmentShaderSource = `
    #ifdef GL_ES
    precision mediump float;
    #endif

    #ifdef GL_FRAGMENT_PRECISION_HIGH
    #define HP highp
    #else
    #define HP mediump
    #endif

    varying vec2 v_texCoord;
    uniform sampler2D u_image;
    uniform float u_saturate;
    uniform float u_whiteScrim;
    uniform float u_blackScrim;
    uniform float u_darkFactor;
    uniform float u_lightFactor;
    uniform float u_floor;
    uniform float u_ceiling;
    uniform float u_brightness;
    uniform float u_contrast;
    uniform float u_hueRotate;
    uniform float u_opacity;

    float interleavedGradientNoise(HP vec2 uv) {
        return fract(52.9829189 * fract(dot(uv, vec2(0.06711056, 0.00583715))));
    }

    vec3 rgb2hsl(vec3 c) {
        float maxC = max(c.r, max(c.g, c.b));
        float minC = min(c.r, min(c.g, c.b));
        float l = (maxC + minC) * 0.5;
        float d = maxC - minC;
        if (d < 0.0001) return vec3(0.0, 0.0, l);
        float s = d / (1.0 - abs(2.0 * l - 1.0));
        float h;
        if (maxC == c.r)      h = mod((c.g - c.b) / d, 6.0);
        else if (maxC == c.g) h = (c.b - c.r) / d + 2.0;
        else                  h = (c.r - c.g) / d + 4.0;
        h *= 0.16666667;
        return vec3(h, s, l);
    }

    vec3 hsl2rgb(vec3 hsl) {
        float h = hsl.x, s = hsl.y, l = hsl.z;
        if (s < 0.0001) return vec3(l);
        float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
        float p = 2.0 * l - q;
        vec3 t = fract(vec3(h + 0.33333333, h, h - 0.33333333));
        vec3 rgb = clamp(abs(t * 6.0 - 3.0) - 1.0, 0.0, 1.0);
        return p + (q - p) * rgb;
    }

    void main() {
        vec3 c = texture2D(u_image, v_texCoord).rgb;

        float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = clamp(mix(vec3(luma), c, u_saturate), 0.0, 1.0);

        c = mix(c, vec3(0.0), u_blackScrim);
        c = mix(c, vec3(1.0), u_whiteScrim);
        c = c * (1.0 - u_darkFactor) + u_lightFactor;
        c = clamp(c, vec3(u_floor), vec3(u_ceiling));

        c *= u_brightness;
        c = (c - 0.5) * u_contrast + 0.5;
        if (abs(u_hueRotate) > 0.0001) {
            vec3 hsl = rgb2hsl(clamp(c, 0.0, 1.0));
            hsl.x = fract(hsl.x + u_hueRotate * 0.15915494);
            c = hsl2rgb(hsl);
        }

        HP vec2 fc = gl_FragCoord.xy;
        float n = interleavedGradientNoise(fc) + interleavedGradientNoise(fc + vec2(5.588238, 5.588238)) - 1.0;
        c += n * 0.0039215686;

        c = clamp(c, 0.0, 1.0);
        gl_FragColor = vec4(c, u_opacity);
    }
`;

function _catmullRom(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (
        (2.0 * p1) +
        (-p0 + p2) * t +
        (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 +
        (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3
    );
}

function _sampleControlGridBicubic(ctrl, u, v, outXY) {
    const gx = u * (MESH_CTRL_N - 1);
    const gy = v * (MESH_CTRL_N - 1);
    const ix = Math.min(MESH_CTRL_N - 2, Math.max(0, Math.floor(gx)));
    const iy = Math.min(MESH_CTRL_N - 2, Math.max(0, Math.floor(gy)));
    const tx = gx - ix;
    const ty = gy - iy;

    let rx0 = 0, rx1 = 0, rx2 = 0, rx3 = 0;
    let ry0 = 0, ry1 = 0, ry2 = 0, ry3 = 0;

    for (let m = -1; m <= 2; m++) {
        const row = Math.min(MESH_CTRL_N - 1, Math.max(0, iy + m));
        const c0 = Math.min(MESH_CTRL_N - 1, Math.max(0, ix - 1));
        const c1 = ix;
        const c2 = Math.min(MESH_CTRL_N - 1, ix + 1);
        const c3 = Math.min(MESH_CTRL_N - 1, ix + 2);

        const b0 = (row * MESH_CTRL_N + c0) * 2;
        const b1 = (row * MESH_CTRL_N + c1) * 2;
        const b2 = (row * MESH_CTRL_N + c2) * 2;
        const b3 = (row * MESH_CTRL_N + c3) * 2;

        const vx = _catmullRom(ctrl[b0], ctrl[b1], ctrl[b2], ctrl[b3], tx);
        const vy = _catmullRom(ctrl[b0 + 1], ctrl[b1 + 1], ctrl[b2 + 1], ctrl[b3 + 1], tx);

        if (m === -1) { rx0 = vx; ry0 = vy; }
        else if (m === 0) { rx1 = vx; ry1 = vy; }
        else if (m === 1) { rx2 = vx; ry2 = vy; }
        else { rx3 = vx; ry3 = vy; }
    }

    outXY[0] = _catmullRom(rx0, rx1, rx2, rx3, ty);
    outXY[1] = _catmullRom(ry0, ry1, ry2, ry3, ty);
}

function _buildMeshBuffers(presetIdxA, presetIdxB) {
    if (!_meshCpuVertices) {
        _meshCpuVertices = new Float32Array(MESH_VERTEX_COUNT * MESH_FLOATS_PER_VERTEX);
    }
    const presetA = MESH_CONTROL_PRESETS[presetIdxA % MESH_CONTROL_PRESETS.length];
    const presetB = MESH_CONTROL_PRESETS[presetIdxB % MESH_CONTROL_PRESETS.length];
    const tmpA = [0, 0];
    const tmpB = [0, 0];

    let ptr = 0;
    for (let y = 0; y < MESH_SUBDIV_N; y++) {
        const v = y / (MESH_SUBDIV_N - 1);
        for (let x = 0; x < MESH_SUBDIV_N; x++) {
            const u = x / (MESH_SUBDIV_N - 1);
            _sampleControlGridBicubic(presetA, u, v, tmpA);
            _sampleControlGridBicubic(presetB, u, v, tmpB);

            _meshCpuVertices[ptr++] = u;
            _meshCpuVertices[ptr++] = v;
            _meshCpuVertices[ptr++] = 0.0;
            _meshCpuVertices[ptr++] = 1.0;

            _meshCpuVertices[ptr++] = tmpA[0];
            _meshCpuVertices[ptr++] = tmpA[1];
            _meshCpuVertices[ptr++] = 0.5;
            _meshCpuVertices[ptr++] = 1.0;

            _meshCpuVertices[ptr++] = tmpB[0];
            _meshCpuVertices[ptr++] = tmpB[1];
            _meshCpuVertices[ptr++] = 0.5;
            _meshCpuVertices[ptr++] = 1.0;

            _meshCpuVertices[ptr++] = u;
            _meshCpuVertices[ptr++] = v;
        }
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, meshVertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, _meshCpuVertices, gl.DYNAMIC_DRAW);
    _meshActivePair[0] = presetIdxA;
    _meshActivePair[1] = presetIdxB;
}

function _buildMeshIndexArray() {
    const indices = new Uint16Array(MESH_INDEX_COUNT);
    let ptr = 0;
    for (let y = 0; y < MESH_SUBDIV_N - 1; y++) {
        const row0 = y * MESH_SUBDIV_N;
        const row1 = (y + 1) * MESH_SUBDIV_N;
        for (let x = 0; x < MESH_SUBDIV_N - 1; x++) {
            const i00 = row0 + x;
            const i10 = i00 + 1;
            const i01 = row1 + x;
            const i11 = i01 + 1;
            indices[ptr++] = i00;
            indices[ptr++] = i01;
            indices[ptr++] = i10;
            indices[ptr++] = i10;
            indices[ptr++] = i01;
            indices[ptr++] = i11;
        }
    }
    return indices;
}

function _bindMeshAttributes() {
    const stride = MESH_FLOATS_PER_VERTEX * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, meshVertexBuffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshIndexBuffer);
    if (a_mesh_base >= 0) {
        gl.enableVertexAttribArray(a_mesh_base);
        gl.vertexAttribPointer(a_mesh_base, 4, gl.FLOAT, false, stride, 0);
    }
    if (a_mesh_posA >= 0) {
        gl.enableVertexAttribArray(a_mesh_posA);
        gl.vertexAttribPointer(a_mesh_posA, 4, gl.FLOAT, false, stride, 16);
    }
    if (a_mesh_posB >= 0) {
        gl.enableVertexAttribArray(a_mesh_posB);
        gl.vertexAttribPointer(a_mesh_posB, 4, gl.FLOAT, false, stride, 32);
    }
    if (a_mesh_uv >= 0) {
        gl.enableVertexAttribArray(a_mesh_uv);
        gl.vertexAttribPointer(a_mesh_uv, 2, gl.FLOAT, false, stride, 48);
    }
}

const _meshPipeline = {
    layerScales: MESH_LAYER_SCALES,
    layerAbsBaseX: MESH_LAYER_ABS_BASE_X,
    layerAbsBaseY: MESH_LAYER_ABS_BASE_Y,

    getCanvasBaseSize() {
        return DISABLE_GAUSSIAN_BLUR ? Math.max(CANVAS_SIZE, 512) : CANVAS_SIZE;
    },

    applyDefaultPostParams(out) {
        out.brightness = 1.0;
        out.saturate = 2.0;
        out.preSaturate = 1.3;
        out.contrast = 1.0;
        out.hueRotate = 0.0;
        out.opacity = 1.0;
        out.blackScrim = 0.25;
        out.whiteScrim = 0.0;
        out.darkFactor = 0.20;
        out.lightFactor = 0.0;
        out.floor = 0.07;
        out.ceiling = 0.97;
        out.meshWarpTimeScale = 1.75;
    },

    getPreSaturate() {
        return _postParams.preSaturate;
    },

    resetState() {
        meshBlurHProgram = null;
        meshBlurVProgram = null;
        meshPostProgram = null;
        meshBlurHVAO = null;
        meshBlurVVAO = null;
        meshVAO = null;
        _meshActivePair = [-1, -1];
    },

    initStaticPrograms() {
        const meshVS = createShader(gl, gl.VERTEX_SHADER, meshVertexShaderSource);
        const meshFS = createShader(gl, gl.FRAGMENT_SHADER, meshFragmentShaderSource);
        if (!meshVS || !meshFS) return false;

        meshPostProgram = createProgram(gl, meshVS, meshFS);
        gl.deleteShader(meshVS);
        gl.deleteShader(meshFS);
        if (!meshPostProgram) return false;

        a_mesh_base = gl.getAttribLocation(meshPostProgram, 'a_basePos');
        a_mesh_posA = gl.getAttribLocation(meshPostProgram, 'a_posA');
        a_mesh_posB = gl.getAttribLocation(meshPostProgram, 'a_posB');
        a_mesh_uv   = gl.getAttribLocation(meshPostProgram, 'a_uv');

        u_mesh_image         = gl.getUniformLocation(meshPostProgram, 'u_image');
        u_mesh_viewAspect    = gl.getUniformLocation(meshPostProgram, 'u_viewAspect');
        u_mesh_time          = gl.getUniformLocation(meshPostProgram, 'u_time');
        u_mesh_warpTimeScale = gl.getUniformLocation(meshPostProgram, 'u_warpTimeScale');
        u_mesh_presetMix     = gl.getUniformLocation(meshPostProgram, 'u_presetMix');
        u_mesh_saturate      = gl.getUniformLocation(meshPostProgram, 'u_saturate');
        u_mesh_whiteScrim    = gl.getUniformLocation(meshPostProgram, 'u_whiteScrim');
        u_mesh_blackScrim    = gl.getUniformLocation(meshPostProgram, 'u_blackScrim');
        u_mesh_darkFactor    = gl.getUniformLocation(meshPostProgram, 'u_darkFactor');
        u_mesh_lightFactor   = gl.getUniformLocation(meshPostProgram, 'u_lightFactor');
        u_mesh_floor         = gl.getUniformLocation(meshPostProgram, 'u_floor');
        u_mesh_ceiling       = gl.getUniformLocation(meshPostProgram, 'u_ceiling');
        u_mesh_brightness    = gl.getUniformLocation(meshPostProgram, 'u_brightness');
        u_mesh_contrast      = gl.getUniformLocation(meshPostProgram, 'u_contrast');
        u_mesh_hueRotate     = gl.getUniformLocation(meshPostProgram, 'u_hueRotate');
        u_mesh_opacity       = gl.getUniformLocation(meshPostProgram, 'u_opacity');

        gl.useProgram(meshPostProgram);
        gl.uniform1i(u_mesh_image, 0);
        return true;
    },

    initVAOs() {
        // Subdivided 41x41 Mesh Buffers (94136-byte vertex layout + 9600 indices)
        meshVertexBuffer = gl.createBuffer();
        meshIndexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshIndexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, _buildMeshIndexArray(), gl.STATIC_DRAW);
        _buildMeshBuffers(0, 1);

        if (vaoExt) {
            meshVAO = vaoExt.createVertexArrayOES();
            vaoExt.bindVertexArrayOES(meshVAO);
            _bindMeshAttributes();
            vaoExt.bindVertexArrayOES(null);
        }
    },

    isProgramsReady() {
        return !!(meshPostProgram && meshBlurHProgram && meshBlurVProgram);
    },

    rebuildBlurPrograms(quadVS, passFS) {
        const newH = createProgram(gl, quadVS, passFS);
        const newV = createProgram(gl, quadVS, passFS);
        if (!newH || !newV) return false;

        if (meshBlurHProgram) gl.deleteProgram(meshBlurHProgram);
        if (meshBlurVProgram) gl.deleteProgram(meshBlurVProgram);
        meshBlurHProgram = newH;
        meshBlurVProgram = newV;

        a_meshBlurH_pos = gl.getAttribLocation(meshBlurHProgram, 'a_position');
        u_meshBlurH_image = gl.getUniformLocation(meshBlurHProgram, 'u_image');
        u_meshBlurH_step = gl.getUniformLocation(meshBlurHProgram, 'u_step');

        a_meshBlurV_pos = gl.getAttribLocation(meshBlurVProgram, 'a_position');
        u_meshBlurV_image = gl.getUniformLocation(meshBlurVProgram, 'u_image');
        u_meshBlurV_step = gl.getUniformLocation(meshBlurVProgram, 'u_step');

        if (vaoExt) {
            if (meshBlurHVAO) vaoExt.deleteVertexArrayOES(meshBlurHVAO);
            if (meshBlurVVAO) vaoExt.deleteVertexArrayOES(meshBlurVVAO);

            meshBlurHVAO = vaoExt.createVertexArrayOES();
            vaoExt.bindVertexArrayOES(meshBlurHVAO);
            gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
            gl.enableVertexAttribArray(a_meshBlurH_pos);
            gl.vertexAttribPointer(a_meshBlurH_pos, 2, gl.FLOAT, false, 0, 0);

            meshBlurVVAO = vaoExt.createVertexArrayOES();
            vaoExt.bindVertexArrayOES(meshBlurVVAO);
            gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
            gl.enableVertexAttribArray(a_meshBlurV_pos);
            gl.vertexAttribPointer(a_meshBlurV_pos, 2, gl.FLOAT, false, 0, 0);
            vaoExt.bindVertexArrayOES(null);
        }

        gl.useProgram(meshBlurHProgram);
        gl.uniform1i(u_meshBlurH_image, 0);
        gl.useProgram(meshBlurVProgram);
        gl.uniform1i(u_meshBlurV_image, 0);
        return true;
    },

    applyViewportUniforms() {
        gl.useProgram(meshBlurHProgram);
        gl.uniform2f(u_meshBlurH_step, 1.0 / blurDimensions.width, 0.0);
        gl.useProgram(meshBlurVProgram);
        gl.uniform2f(u_meshBlurV_step, 0.0, 1.0 / blurDimensions.height);
        gl.useProgram(meshPostProgram);
        gl.uniform1f(u_mesh_viewAspect, _viewportAspect);
    },

    renderFrame(currentTime, isLightweight) {
        // --- PASS 2 & 3: MPSImageGaussianBlur into renderTexture (skipped when DISABLE_GAUSSIAN_BLUR is true) ---
        if (!DISABLE_GAUSSIAN_BLUR) {
            gl.useProgram(meshBlurHProgram);
            if (vaoExt) {
                vaoExt.bindVertexArrayOES(meshBlurHVAO);
            } else {
                gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
                gl.vertexAttribPointer(a_meshBlurH_pos, 2, gl.FLOAT, false, 0, 0);
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, blurFramebuffer);
            gl.bindTexture(gl.TEXTURE_2D, renderTexture);
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            gl.useProgram(meshBlurVProgram);
            if (vaoExt) {
                vaoExt.bindVertexArrayOES(meshBlurVVAO);
            } else {
                gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
                gl.vertexAttribPointer(a_meshBlurV_pos, 2, gl.FLOAT, false, 0, 0);
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, renderFramebuffer);
            gl.bindTexture(gl.TEXTURE_2D, blurTextureA);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }

        // --- PASS 4: PinchEncoder (Render 41x41 subdivided 6x6 control-point mesh to Screen Canvas) ---
        gl.useProgram(meshPostProgram);

        let idxA = 0, idxB = 0, presetMix = 0.0;
        if (MESH_PRESET_INDEX >= 0) {
            idxA = idxB = Math.floor(MESH_PRESET_INDEX) % MESH_CONTROL_PRESETS.length;
        } else {
            const cycleDuration = 18.0;
            const totalPhase = Math.max(0.0, currentTime) / cycleDuration;
            const stepIdx = Math.floor(totalPhase);
            const rawT = totalPhase - stepIdx;
            presetMix = rawT * rawT * (3.0 - 2.0 * rawT);
            idxA = stepIdx % MESH_CONTROL_PRESETS.length;
            idxB = (stepIdx + 1) % MESH_CONTROL_PRESETS.length;
        }

        if (_meshActivePair[0] !== idxA || _meshActivePair[1] !== idxB) {
            _buildMeshBuffers(idxA, idxB);
        }

        if (vaoExt) {
            vaoExt.bindVertexArrayOES(meshVAO);
        } else {
            _bindMeshAttributes();
        }

        if (_appliedPostUniformsDirty) {
            gl.uniform1f(u_mesh_saturate,      _postParams.saturate);
            gl.uniform1f(u_mesh_whiteScrim,    _postParams.whiteScrim);
            gl.uniform1f(u_mesh_blackScrim,    _postParams.blackScrim);
            gl.uniform1f(u_mesh_darkFactor,    _postParams.darkFactor);
            gl.uniform1f(u_mesh_lightFactor,   _postParams.lightFactor);
            gl.uniform1f(u_mesh_floor,         _postParams.floor);
            gl.uniform1f(u_mesh_ceiling,       _postParams.ceiling);
            gl.uniform1f(u_mesh_brightness,    _postParams.brightness);
            gl.uniform1f(u_mesh_contrast,      _postParams.contrast);
            gl.uniform1f(u_mesh_hueRotate,     _postParams.hueRotate);
            gl.uniform1f(u_mesh_opacity,       _postParams.opacity);
            gl.uniform1f(u_mesh_warpTimeScale, _postParams.meshWarpTimeScale);
            _appliedPostUniformsDirty = false;
        }

        gl.uniform1f(u_mesh_time, isLightweight ? 0.0 : currentTime);
        gl.uniform1f(u_mesh_presetMix, isLightweight ? 0.0 : presetMix);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvasDimensions.width, canvasDimensions.height);
        gl.bindTexture(gl.TEXTURE_2D, renderTexture);
        gl.drawElements(gl.TRIANGLES, MESH_INDEX_COUNT, gl.UNSIGNED_SHORT, 0);
    }
};
