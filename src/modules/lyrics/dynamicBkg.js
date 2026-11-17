const DEFAULT_DYNAMIC_BG_STYLE = 'android'; // 'ipad' | 'android'

function _isIpadBgStyle() {
    if (typeof currentSettings !== 'undefined' && currentSettings.dynamicBgStyle) {
        return currentSettings.dynamicBgStyle === 'ipad';
    }
    return DEFAULT_DYNAMIC_BG_STYLE === 'ipad';
}

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
    return `#version 300 es
    precision mediump float;

    in vec2 v_texCoord;
    uniform sampler2D u_image;
    uniform vec2 u_step;
    uniform float u_brightness;
    uniform float u_saturate;
    uniform float u_contrast;
    uniform float u_hueRotate;
    uniform float u_opacity;
    uniform float u_blackScrim;
    uniform float u_whiteScrim;

    out vec4 fragColor;

    float interleavedGradientNoise(highp vec2 uv) {
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

        highp vec2 fc = gl_FragCoord.xy;
        float n = interleavedGradientNoise(fc) + interleavedGradientNoise(fc + vec2(5.588238, 5.588238)) - 1.0;
        c += n * 0.0039215686;

        c = clamp(c, 0.0, 1.0);
        fragColor = vec4(c, u_opacity);
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

        if (blurHVAO) gl.deleteVertexArray(blurHVAO);
        if (blurVPostVAO) gl.deleteVertexArray(blurVPostVAO);

        blurHVAO = gl.createVertexArray();
        gl.bindVertexArray(blurHVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.enableVertexAttribArray(a_blurH_pos);
        gl.vertexAttribPointer(a_blurH_pos, 2, gl.FLOAT, false, 0, 0);

        blurVPostVAO = gl.createVertexArray();
        gl.bindVertexArray(blurVPostVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.enableVertexAttribArray(a_blurVPost_pos);
        gl.vertexAttribPointer(a_blurVPost_pos, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);

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
        gl.bindVertexArray(blurHVAO);

        gl.bindFramebuffer(gl.FRAMEBUFFER, blurFramebuffer);
        gl.bindTexture(gl.TEXTURE_2D, renderTexture);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        gl.useProgram(blurVPostProgram);
        gl.bindVertexArray(blurVPostVAO);

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
    return _isIpadBgStyle() ? _meshPipeline : _androidPipeline;
}

let gl = null;
let glProgram = null;
let webglCanvas = null;
let blurContainerElem = null;
let needsAnimation = false;

let mainVAO = null;
let a_main_pos = -1;

let u_main_artworkTexture = null;
let u_main_transitionProgress = null;
let u_main_layerTransforms = null;
let u_main_aspect = null;
let u_main_renderHeight = null;
let u_main_preSaturate = null;
let _appliedPreSaturate = NaN;
let _appliedClearR = -1;
let _appliedClearG = -1;
let _appliedClearB = -1;
let _viewportAspect = 1.0;
let _viewportWidth = 0;
let _viewportHeight = 0;
let _viewportDirty = true;
const _layerSizeFactor = new Float32Array([1, 1, 1]);
let _activeLightweight = null;
let _needsRedraw = false;
let _isCanvasVisible = true;
let _viewportObserver = null;
let _intersectionObserver = null;
let _observedBgParent = null;

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
let _postParamsDirty = false;
let _appliedPostUniformsDirty = true;
let _postParamsIdleId = 0;

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

// Precalculated per-frame layer transform cache: 3x [rot, scale, px, py]
const _layerTransforms = new Float32Array(12);

const LYPLUS_FFT_SIZE = 2048;
const LYPLUS_connectedElements = new WeakSet();
let _audioDataArray = null;

const LYPLUS_MEDIA_SELECTORS = [
    'audio#apple-music-player',
    'video.video-stream.html5-main-video',
    'video#video-one',
    'audio',
    'video:not(amp-ambient-video video):not([data-loop])',
];
let _cachedMediaElement = null;
let _lastMediaSearchTime = 0;
let _mediaPlayListenerAttached = false;

function _isValidMediaCandidate(el) {
    if (!el || !el.isConnected) return false;
    if (el.tagName === 'AUDIO') return true;
    if (el.tagName === 'VIDEO') {
        if (el.hasAttribute('data-loop')) return false;
        if (el.closest && el.closest('amp-ambient-video')) return false;
        return true;
    }
    return false;
}

function _attachMediaPlayCapture() {
    if (_mediaPlayListenerAttached || typeof document === 'undefined') return;
    _mediaPlayListenerAttached = true;
    document.addEventListener('play', (e) => {
        const t = e.target;
        if (_isValidMediaCandidate(t)) {
            _cachedMediaElement = t;
        }
    }, true);
}

function _resolveMediaElement() {
    if (_cachedMediaElement && _cachedMediaElement.isConnected) return _cachedMediaElement;
    const now = performance.now();
    if (now - _lastMediaSearchTime < 2000) return null;
    _lastMediaSearchTime = now;

    const byId = document.getElementById('apple-music-player') || document.getElementById('video-one');
    if (byId) {
        _cachedMediaElement = byId;
        return byId;
    }

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

const vertexShaderSource = `#version 300 es
    in vec2 a_position;
    
    // [rotation(rad), scale, offsetX, offsetY] per layer instance
    uniform vec4 u_layerTransforms[3]; 
    
    uniform float u_aspect;
    uniform float u_renderHeight;
    
    out vec2 v_uv;
    out float v_edgePx;
    
    void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        
        vec4 layerTransform = u_layerTransforms[gl_InstanceID];
        float rotation = layerTransform.x;
        float scale = layerTransform.y;
        vec2 offset = layerTransform.zw * vec2(u_aspect, 1.0);
        
        vec2 centered = vec2(a_position.x * 0.5 * u_aspect, -a_position.y * 0.5) - offset;
        
        float s = sin(-rotation);
        float c = cos(-rotation);
        centered = vec2(centered.x * c - centered.y * s, centered.x * s + centered.y * c);
        
        v_uv = (centered / scale) + 0.5;
        v_edgePx = scale * u_renderHeight;
    }
`;

const quadVertexShaderSource = `#version 300 es
    in vec2 a_position;
    out vec2 v_texCoord;
    
    void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_position * 0.5 + 0.5;
    }
`;

const fragmentShaderSource = `#version 300 es
    precision mediump float;
    
    in vec2 v_uv;
    in float v_edgePx;
    uniform sampler2D u_artworkTexture;
    uniform float u_transitionProgress;
    uniform float u_preSaturate;

    out vec4 fragColor;
    
    void main() {
        vec2 e = min(v_uv, 1.0 - v_uv);
        float aa = clamp(min(e.x, e.y) * v_edgePx + 0.5, 0.0, 1.0);
        if (aa <= 0.0) discard;
        vec4 color = texture(u_artworkTexture, v_uv);
        float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
        vec3 satRgb = clamp(mix(vec3(luma), color.rgb, u_preSaturate), 0.0, 1.0);
        fragColor = vec4(satRgb, color.a * u_transitionProgress * aa);
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
    let src = `    vec3 c = texture(u_image, v_texCoord).rgb * ${_glslFloat(kernel.center)};\n`;
    for (let i = 0; i < kernel.taps.length; i++) {
        const t = kernel.taps[i];
        const off = _glslFloat(t.offset);
        src += `    c += (texture(u_image, v_texCoord + u_step * ${off}).rgb` +
               ` + texture(u_image, v_texCoord - u_step * ${off}).rgb) * ${_glslFloat(t.weight)};\n`;
    }
    return src;
}

function buildBlurPassFragmentShaderSource(kernel) {
    return `#version 300 es
    precision mediump float;

    in vec2 v_texCoord;
    uniform sampler2D u_image;
    uniform vec2 u_step;

    out vec4 fragColor;

    void main() {
${_blurTapsGLSL(kernel)}
        fragColor = vec4(c, 1.0);
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
    const inlineVal = blurContainerElem.style.getPropertyValue('--webgl-post-process');
    const raw = inlineVal || getComputedStyle(blurContainerElem).getPropertyValue('--webgl-post-process');
    _parsePostProcess(raw, _postParams);
    _postParamsDirty = false;
    _appliedPostUniformsDirty = true;
    _needsRedraw = true;
}

function _schedulePostParamsSync() {
    if (_postParamsIdleId) return;
    const run = () => {
        _postParamsIdleId = 0;
        if (_postParamsDirty) _readPostParamsFromCSS();
    };
    if (typeof requestIdleCallback === 'function') {
        _postParamsIdleId = requestIdleCallback(run, { timeout: 200 });
    } else {
        _postParamsIdleId = setTimeout(run, 16);
    }
}

function handleContextLost(event) {
    event.preventDefault();
    console.warn("LYPLUS: WebGL context lost.");
    if (globalAnimationId) {
        cancelAnimationFrame(globalAnimationId);
        globalAnimationId = null;
    }
    gl = null;
    mainVAO = null;
    glProgram = null;
    _activeLightweight = null;
    _appliedPreSaturate = NaN;
    _appliedClearR = -1;
    _appliedClearG = -1;
    _appliedClearB = -1;
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

function _observeBgParent(parent) {
    if (!bgObserver || !parent || _observedBgParent === parent) return;
    bgObserver.disconnect();
    _observedBgParent = parent;
    bgObserver.observe(parent, { childList: true, subtree: false });
}

function LYPLUS_setupBlurEffect() {
    console.log("LYPLUS: Setting up Optimized WebGL2...");
    _attachMediaPlayCapture();
    const pipeline = _getActivePipeline();

    canvasDimensions.width = 0;
    canvasDimensions.height = 0;
    blurDimensions.width = 0;
    blurDimensions.height = 0;
    _viewportWidth = window.innerWidth || 1280;
    _viewportHeight = window.innerHeight || 720;
    _viewportDirty = true;

    if (typeof currentSettings !== 'undefined' && currentSettings.dynamicPlayer) {
        for (let i = 0; i < LYPLUS_bgConfig.dynamicPlayerSelectors.length; i++) {
            document.querySelector(LYPLUS_bgConfig.dynamicPlayerSelectors[i])?.classList.add("dynamic-player");
        }
    }
    const existingContainer = document.querySelector('.lyplus-blur-container');
    if (existingContainer) existingContainer.remove();

    blurContainerElem = document.createElement('div');
    blurContainerElem.classList.add('lyplus-blur-container');
    blurContainerElem.classList.toggle('lyplus-bg-ipad', _isIpadBgStyle());
    blurContainerElem.style.contain = 'strict';
    webglCanvas = document.createElement('canvas');
    webglCanvas.id = 'lyplus-webgl-canvas';
    webglCanvas.style.cssText = 'width:100%;height:100%;display:block;pointer-events:none;';
    blurContainerElem.appendChild(webglCanvas);
    const containerParent = document.querySelector(LYPLUS_bgConfig.blurContainerParentSelector) || document.body;
    containerParent.prepend(blurContainerElem);

    const ctxAttribs = {
        alpha: false,
        depth: false,
        stencil: false,
        antialias: false,
        preserveDrawingBuffer: false,
        powerPreference: 'low-power'
    };
    try {
        gl = webglCanvas.getContext('webgl2', ctxAttribs);
    } catch (e) { }

    if (!gl) return null;

    _androidPipeline.resetState();
    _meshPipeline.resetState();
    _activeLightweight = null;
    _appliedPreSaturate = NaN;
    _appliedClearR = -1;
    _appliedClearG = -1;
    _appliedClearB = -1;
    _kernelBaseSize = 0;

    if (!bgObserver) {
        bgObserver = new MutationObserver(() => {
            if (blurContainerElem && !blurContainerElem.isConnected) {
                checkBg();
            }
        });
    }
    _observedBgParent = null;
    _observeBgParent(containerParent);

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
    u_main_layerTransforms = gl.getUniformLocation(glProgram, 'u_layerTransforms');
    u_main_aspect = gl.getUniformLocation(glProgram, 'u_aspect');
    u_main_renderHeight = gl.getUniformLocation(glProgram, 'u_renderHeight');
    u_main_preSaturate = gl.getUniformLocation(glProgram, 'u_preSaturate');

    gl.useProgram(glProgram);
    gl.uniform1i(u_main_artworkTexture, 0);
    _appliedPreSaturate = pipeline.getPreSaturate();
    gl.uniform1f(u_main_preSaturate, _appliedPreSaturate);

    // Position-only Quad Buffer [x, y]
    quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTICES, gl.STATIC_DRAW);

    // VAO Setup
    mainVAO = gl.createVertexArray();
    gl.bindVertexArray(mainVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.enableVertexAttribArray(a_main_pos);
    gl.vertexAttribPointer(a_main_pos, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    pipeline.initVAOs();

    _postParamsDirty = true;
    _appliedPostUniformsDirty = true;
    _schedulePostParamsSync();

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

    _applyResizeInternal();
    if (!pipeline.isProgramsReady()) return null;

    window.removeEventListener('resize', handleResize);
    if (_viewportObserver) _viewportObserver.disconnect();
    if (typeof ResizeObserver !== 'undefined') {
        _viewportObserver = new ResizeObserver((entries) => {
            const rect = entries[0]?.contentRect;
            if (rect && rect.width > 0 && rect.height > 0) {
                const w = Math.round(rect.width);
                const h = Math.round(rect.height);
                if (w !== _viewportWidth || h !== _viewportHeight) {
                    _viewportWidth = w;
                    _viewportHeight = h;
                    _viewportDirty = true;
                    _needsRedraw = true;
                    if (!globalAnimationId && _isCanvasVisible && !document.hidden) {
                        globalAnimationId = requestAnimationFrame(animateWebGLBackground);
                    }
                }
            }
        });
        _viewportObserver.observe(blurContainerElem);
    } else {
        window.addEventListener('resize', handleResize, { passive: true });
    }

    startTime = performance.now() / 1000;

    if (_intersectionObserver) _intersectionObserver.disconnect();
    _isCanvasVisible = true;
    _intersectionObserver = new IntersectionObserver((entries) => {
        _isCanvasVisible = entries[0].isIntersecting;
        if (_isCanvasVisible && !document.hidden) {
            if (!globalAnimationId) globalAnimationId = requestAnimationFrame(animateWebGLBackground);
        } else if (globalAnimationId) {
            cancelAnimationFrame(globalAnimationId);
            globalAnimationId = null;
        }
    }, { threshold: 0.01 });
    _intersectionObserver.observe(blurContainerElem);

    document.removeEventListener('visibilitychange', _handleVisibilityChange);
    document.addEventListener('visibilitychange', _handleVisibilityChange);

    return blurContainerElem;
}

function _handleVisibilityChange() {
    if (document.hidden) {
        if (globalAnimationId) {
            cancelAnimationFrame(globalAnimationId);
            globalAnimationId = null;
        }
    } else if (_isCanvasVisible && gl && !globalAnimationId) {
        globalAnimationId = requestAnimationFrame(animateWebGLBackground);
    }
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
    const w = _viewportWidth > 0 ? _viewportWidth : (window.innerWidth || 1280);
    const h = _viewportHeight > 0 ? _viewportHeight : (window.innerHeight || 720);
    if (!(w > 0 && h > 0)) return 1.0;
    return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, w / h));
}

function _applyResizeInternal() {
    if (!gl || !webglCanvas) return;
    _viewportDirty = false;
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
    if (!sizeChanged && lightweight === _activeLightweight && pipeline.isProgramsReady() && _kernelBaseSize === base) {
        return;
    }

    _activeLightweight = lightweight;

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
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, rw, rh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindTexture(gl.TEXTURE_2D, blurTextureA);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, rw, rh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }

    if (!pipeline.isProgramsReady() || _kernelBaseSize !== base) {
        if (!_rebuildBlurPrograms(base)) {
            console.error('LYPLUS: failed to build blur programs');
            return;
        }
    }
    _viewportAspect = aspect;
    _applyViewportUniforms();
    _needsRedraw = true;
}

function handleResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w > 0 && h > 0) {
        _viewportWidth = w;
        _viewportHeight = h;
    }
    _viewportDirty = true;
    _needsRedraw = true;
    if (!globalAnimationId && gl && _isCanvasVisible && !document.hidden) {
        globalAnimationId = requestAnimationFrame(animateWebGLBackground);
    }
}

function createDefaultTexture() {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, DEFAULT_TEX_PIXEL);
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

        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, outStep.canvas);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } catch (e) {
        console.warn('LYPLUS: artwork prefilter failed, uploading directly', e);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
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

// Draw a single artwork texture with 3 instanced layers using precalculated transforms
function _renderLayerQuads(tex, progress) {
    if (progress <= 0.001) return;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1f(u_main_transitionProgress, progress);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, 3);
}

function animateWebGLBackground(timestamp) {
    if (!gl || document.hidden || !_isCanvasVisible) { globalAnimationId = null; return; }

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

    if (_viewportDirty || isLightweight !== _activeLightweight) {
        _applyResizeInternal();
    }

    const shouldRender =
        !isLightweight ||
        isTransitioning ||
        needsAnimation ||
        _needsRedraw ||
        (typeof currentSettings !== 'undefined' && currentSettings.audioBeatSync && pulse > 0.001);

    if (!shouldRender) {
        globalAnimationId = null;
        return;
    }

    const pipeline = _getActivePipeline();
    if (!pipeline.isProgramsReady()) {
        globalAnimationId = requestAnimationFrame(animateWebGLBackground);
        return;
    }

    beatEnergyBaseline += (pulse - beatEnergyBaseline) * Math.min(1.0, 0.8 * elapsedSec);
    const relativePulse = pulse > beatEnergyBaseline ? pulse - beatEnergyBaseline : 0.0;

    const layerScales = pipeline.layerScales;
    const layerAbsBaseX = pipeline.layerAbsBaseX;
    const layerAbsBaseY = pipeline.layerAbsBaseY;

    if (isLightweight) {
        for (let i = 0; i < 3; i++) {
            const base = i * 4;
            _layerTransforms[base] = 0.0;
            _layerTransforms[base + 1] = layerScales[i] * _layerSizeFactor[i];
            _layerTransforms[base + 2] = 0.0;
            _layerTransforms[base + 3] = 0.0;
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

            const base = i * 4;
            _layerTransforms[base]     = INITIAL_ROTATIONS[i] + EFFECTIVE_ROT_SPEEDS[i] * currentTime + smoothBR * BEAT_ROT_BOOST[i];
            _layerTransforms[base + 1] = (layerScales[i] + smoothBS * BEAT_SCALE_BOOST[i]) * _layerSizeFactor[i];
            _layerTransforms[base + 2] = layerAbsBaseX[i] * Math.cos(angle);
            _layerTransforms[base + 3] = layerAbsBaseY[i] * Math.sin(angle);
        }
    }

    const bw = blurDimensions.width;
    const bh = blurDimensions.height;

    // --- PASS 1: Render 3 rotating artwork layers to renderFramebuffer ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, renderFramebuffer);
    gl.viewport(0, 0, bw, bh);

    const bgCol = currentTargetMasterArtworkPalette?.background || DEFAULT_PALETTE.background;
    const cr = (bgCol.r || 0) / 255.0;
    const cg = (bgCol.g || 0) / 255.0;
    const cb = (bgCol.b || 0) / 255.0;
    if (cr !== _appliedClearR || cg !== _appliedClearG || cb !== _appliedClearB) {
        gl.clearColor(cr, cg, cb, 1.0);
        _appliedClearR = cr;
        _appliedClearG = cg;
        _appliedClearB = cb;
    }
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(glProgram);
    const preSat = pipeline.getPreSaturate();
    if (preSat !== _appliedPreSaturate) {
        gl.uniform1f(u_main_preSaturate, preSat);
        _appliedPreSaturate = preSat;
    }
    gl.uniform4fv(u_main_layerTransforms, _layerTransforms);
    gl.bindVertexArray(mainVAO);

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
            _observeBgParent(parent);
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
        checkBg();
        let targetUrl = event.data?.artworkUrl;
        if (!targetUrl && LYPLUS_bgConfig.artworkSelector) {
            const el = document.querySelector(LYPLUS_bgConfig.artworkSelector);
            if (el) targetUrl = el.src;
        }
        LYPLUS_requestProcessNewArtwork(targetUrl);
    } else if (type === 'LYPLUS_reattachBg') {
        checkBg();
    } else if (type === 'LYPLUS_updatePostProcess') {
        _postParamsDirty = true;
        _schedulePostParamsSync();
    }
});

function _syncDynamicBgStyle() {
    if (blurContainerElem) {
        blurContainerElem.classList.toggle('lyplus-bg-ipad', _isIpadBgStyle());
    }
    if (!gl || !glProgram) return;

    const pipeline = _getActivePipeline();
    const base = _isLightweightMode() ? RENDER_SIZE_LIGHTWEIGHT : RENDER_SIZE;
    if (!pipeline.isProgramsReady() || _kernelBaseSize !== base) {
        if (!pipeline.isProgramsReady()) {
            if (!pipeline.initStaticPrograms()) return;
            pipeline.initVAOs();
        }
        if (!_rebuildBlurPrograms(base)) return;
    }

    pipeline.applyDefaultPostParams(_postParams);
    _postParamsDirty = true;
    _appliedPostUniformsDirty = true;
    _viewportDirty = true;
    _needsRedraw = true;
    _schedulePostParamsSync();

    _applyResizeInternal();
    gl.useProgram(glProgram);
    _appliedPreSaturate = pipeline.getPreSaturate();
    gl.uniform1f(u_main_preSaturate, _appliedPreSaturate);

    if (!globalAnimationId) {
        globalAnimationId = requestAnimationFrame(animateWebGLBackground);
    }
}

window.addEventListener('YOUPLUS_SETTINGS_UPDATED', (event) => {
    const changedKeys = event.detail?.changedKeys;
    if (Array.isArray(changedKeys) && changedKeys.includes('dynamicBgStyle')) {
        _syncDynamicBgStyle();
    }
});

// Apple Music iPad

const MESH_PRESET_INDEX = -1; // -1 = dynamic 5-preset cycle, 0..4 = fixed preset index
const MESH_GRID_MODE = 'auto'; // 'auto' | 'portrait' (6x6 -> 41x41) | 'landscape' (9x9 -> 33x33)
const DISABLE_GAUSSIAN_BLUR = false; // true = MPSImageGaussianBlur sigma 0

const MESH_LAYER_SCALES = new Float32Array([1.12, 0.92, 0.84]);
const MESH_LAYER_BASE_POSITIONS = [0, 0, 0.58, -0.58, -0.58, 0.58];
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

const MESH_FLOATS_PER_VERTEX = 22;

const MESH_PORTRAIT_PRESETS = [
    {
        from: new Float32Array([
            0, 0,  0.2, 0,  0.4, 0,  0.6, 0,  0.8, 0,  1, 0,
            0, 0.2,  -0.0933, 0.4,  0.4, 0.2,  0.6, 0.2,  0.3653, 0.1335,  1, 0.2,
            0, 0.4,  0.4232, 0.359,  0.3429, 0.5349,  0.6, 0.4,  0.832, 0.4148,  1, 0.4,
            0, 0.6,  0.2, 0.6,  0.2293, 0.7775,  0.7829, 0.5595,  0.6514, 0.7302,  1, 0.6,
            0, 0.8,  0.2, 0.8,  0.28, 0.9195,  0.4773, 0.8,  0.8, 0.8,  1, 0.8,
            0, 1,  0.6514, 1.1073,  0.4, 1,  1, 1.0317,  1, 1.1302,  1, 1
        ]),
        to: new Float32Array([
            0, 0,  0.2, 0,  0.4, 0,  0.6, 0,  0.8, 0,  1, 0,
            0, 0.2,  -0.0136, 0.3413,  0.4462, 0.1687,  0.5616, 0.1557,  0.8587, 0.2234,  1, 0.2,
            0, 0.4,  0.4526, 0.6053,  0.4422, 0.4585,  0.6707, 0.3845,  0.8404, 0.3971,  1, 0.4,
            0, 0.6,  0.2057, 0.6424,  0.4285, 0.7124,  0.7214, 0.6394,  0.7206, 0.7122,  1, 0.6,
            0, 0.8,  0.249, 0.8405,  0.3589, 0.91,  0.622, 0.8399,  0.8393, 0.8306,  1, 0.8,
            0, 1,  0.6514, 1.1073,  0.4, 1,  1, 1.0317,  1, 1.1302,  1, 1
        ])
    },
    {
        from: new Float32Array([
            0, 0,  0.2, 0,  0.4, 0,  0.6, 0,  0.8, 0,  1, 0,
            0, 0.2,  0.3265, 0.3839,  0.4, 0.2,  0.462, 0.3424,  0.683, 0.2797,  1, 0.2,
            0, 0.4,  0.2, 0.4,  0.4, 0.4,  0.6, 0.4903,  0.6574, 0.4903,  1.1357, 0.4,
            -0.1173, 0.4597,  0.3771, 0.4384,  0.6415, 0.5947,  0.8254, 0.6935,  0.9334, 0.5862,  1, 0.6,
            -0.0437, 0.6533,  0.2, 0.6618,  0.683, 0.7362,  0.8139, 0.833,  0.9104, 0.8085,  1, 0.8,
            0, 1,  0.2, 1,  0.4, 1,  0.6, 1,  0.8, 1,  1, 1
        ]),
        to: new Float32Array([
            0, 0,  0.2, 0,  0.4, 0,  0.6, 0,  0.8, 0,  1, 0,
            0, 0.2,  0.2437, 0.4392,  0.4115, 0.1703,  0.4959, 0.2668,  0.6861, 0.2451,  1, 0.2,
            0, 0.4,  0.1494, 0.4787,  0.4, 0.5063,  0.6966, 0.516,  0.8139, 0.4478,  1.1357, 0.4,
            -0.1173, 0.4597,  0.2437, 0.6085,  0.6414, 0.5756,  0.7543, 0.625,  0.8685, 0.5749,  1, 0.6,
            -0.0437, 0.6533,  0.2722, 0.6552,  0.6951, 0.7311,  0.817, 0.8154,  0.9065, 0.7936,  1, 0.8,
            0, 1,  0.2, 1,  0.4, 1,  0.6, 1,  0.8, 1,  1, 1
        ])
    },
    {
        from: new Float32Array([
            0, 0,  0.2, 0,  0.4, 0,  0.7465, -0.0935,  0.9702, -0.0872,  1.5935, -0.0308,
            -0.1675, 0.2878,  0.7185, 0.3087,  0.5952, 0.0728,  0.7823, 0.0815,  0.9318, 0.301,  1.1369, 0.3756,
            0, 0.4,  0.3295, 0.4607,  0.7823, 0.3087,  0.7465, 0.365,  0.9514, 0.4305,  1.1514, 0.4424,
            0, 0.6,  0.2, 0.6,  0.3295, 0.4424,  0.5703, 0.5,  0.7887, 0.4847,  1, 0.6,
            0, 0.8,  0.2414, 0.7926,  0.0418, 0.7303,  0.5952, 0.4688,  0.9433, 0.6929,  1, 0.8,
            0, 1,  0.2, 1,  0.4, 1,  0.6, 1,  0.8, 1,  1, 1
        ]),
        to: new Float32Array([
            0, 0,  0.2, 0,  0.4, 0,  0.7465, -0.0935,  0.9702, -0.0872,  1.5935, -0.0308,
            -0.1675, 0.2878,  0.5414, 0.2825,  0.6163, 0.1139,  0.7414, 0.0855,  0.9101, 0.2709,  1.1369, 0.3756,
            0, 0.4,  0.2881, 0.4479,  0.6634, 0.3152,  0.8363, 0.3661,  0.9023, 0.4001,  1.1514, 0.4424,
            0, 0.6,  0.177, 0.6,  0.4, 0.4775,  0.5652, 0.44,  0.7671, 0.475,  1, 0.6,
            0, 0.8,  0.2278, 0.7652,  0.1499, 0.7324,  0.5952, 0.5623,  0.873, 0.6353,  1, 0.8,
            0, 1,  0.2, 1,  0.4, 1,  0.6, 1,  0.8, 1,  1, 1
        ])
    },
    {
        from: new Float32Array([
            -0.2292, -0.3968,  0.161, -0.2455,  0.4116, -0.1582,  0.6783, -0.1793,  0.8449, -0.336,  1.381, -0.5476,
            -0.1319, 0.1656,  0.1502, 0.1458,  0.2956, 0.2187,  0.4427, 0.2187,  0.8114, 0.0103,  1.2083, 0.0403,
            -0.1247, 0.3136,  0.195, 0.3876,  0.3372, 0.4375,  0.401, 0.4435,  0.7442, 0.3289,  1.1964, 0.3566,
            -0.1057, 0.5332,  0.2502, 0.4501,  0.4239, 0.5456,  0.521, 0.655,  0.7937, 0.5765,  1.1524, 0.5412,
            -0.0896, 0.819,  0.2939, 0.6865,  0.4821, 0.7466,  0.5985, 0.8252,  0.9275, 0.8294,  1.1628, 0.8011,
            -0.0387, 1.1138,  0.1726, 1.1222,  0.4691, 1.2042,  0.625, 1.3164,  1.005, 1.2328,  1.0938, 1.2328
        ]),
        to: new Float32Array([
            -0.2292, -0.3968,  0.161, -0.2455,  0.4116, -0.1582,  0.6783, -0.1793,  0.8449, -0.336,  1.381, -0.5476,
            -0.1319, 0.1656,  0.1146, 0.1814,  0.2734, 0.2545,  0.4134, 0.2706,  0.7899, 0.0622,  1.2083, 0.0403,
            -0.1247, 0.3136,  0.1278, 0.3882,  0.3088, 0.4467,  0.4179, 0.4965,  0.7359, 0.3795,  1.1964, 0.3566,
            -0.1057, 0.5332,  0.1693, 0.4921,  0.3698, 0.5427,  0.5075, 0.6537,  0.7912, 0.603,  1.1524, 0.5412,
            -0.0896, 0.819,  0.2373, 0.7026,  0.4395, 0.7288,  0.579, 0.8093,  0.9151, 0.8259,  1.1628, 0.8011,
            -0.0387, 1.1138,  0.1726, 1.1222,  0.4691, 1.2042,  0.625, 1.3164,  1.005, 1.2328,  1.0938, 1.2328
        ])
    },
    {
        from: new Float32Array([
            -0.2351, -0.0967,  0.2135, -0.1414,  0.9221, -0.0908,  0.9221, -0.0685,  1.3027, 0.0253,  1.2351, 0.1786,
            -0.3768, 0.1851,  0.2, 0.2,  0.6615, 0.3146,  0.9543, 0,  0.6969, 0.1911,  1, 0.2,
            0, 0.4,  0.2, 0.4,  0.0776, 0.2318,  0.6, 0.4,  0.6615, 0.3851,  1, 0.4,
            0, 0.6,  0.1291, 0.6,  0.4, 0.6,  0.4, 0.4304,  0.4264, 0.5792,  1.2029, 0.8188,
            -0.1192, 1,  0.6, 0.8,  0.4264, 0.8104,  0.6, 0.8,  0.8, 0.8,  1, 0.8,
            0, 1,  0.0776, 1.0283,  0.4, 1,  0.6, 1,  0.8, 1,  1.1868, 1.0283
        ]),
        to: new Float32Array([
            -0.2351, -0.0967,  0.2135, -0.1414,  0.9221, -0.0908,  0.9221, -0.0685,  1.3027, 0.0253,  1.2351, 0.1786,
            -0.3768, 0.1851,  0.1839, 0.2,  0.7034, 0.2952,  0.8839, 0.0693,  0.7775, 0.3339,  1, 0.2,
            0, 0.4,  0.0357, 0.5369,  0.193, 0.3538,  0.5447, 0.4177,  0.7012, 0.4366,  1, 0.4,
            0, 0.6,  0.2, 0.6878,  0.412, 0.6776,  0.5, 0.5896,  0.6454, 0.6878,  1.2029, 0.8188,
            -0.1192, 1,  0.6193, 0.9027,  0.4238, 0.8516,  0.625, 0.8437,  0.8284, 0.8275,  1, 0.8,
            0, 1,  0.0776, 1.0283,  0.4, 1,  0.6, 1,  0.8, 1,  1.1868, 1.0283
        ])
    }
];

const MESH_LANDSCAPE_PRESETS = [
    {
        from: new Float32Array([
            -0.2292, -0.0529,  -0.0402, -0.127,  0.1116, -0.3122,  0.0923, -0.336,  1.1205, -0.164,  1.0089, -0.0635,  1.1205, -0.0529,  1.1116, -0.0899,  1.1979, -0.0741,
            -0.2202, 0.2685,  0.0104, 0.1595,  0.0901, 0.1224,  0.0852, 0.1369,  0.5439, 0.1344,  0.7326, 0.1435,  0.77, 0.1639,  1.228, 0.1063,  1.1801, 0.1435,
            -0.1667, 0.3611,  0.0216, 0.2768,  0.0988, 0.2841,  0.1149, 0.309,  0.3256, 0.3146,  0.5665, 0.3323,  0.6196, 0.3427,  0.9253, 0.2953,  1.0893, 0.2341,
            -0.1176, 0.4544,  0.0384, 0.4088,  0.1296, 0.44,  0.1746, 0.46,  0.2937, 0.4422,  0.5499, 0.439,  0.6474, 0.4649,  0.7314, 0.4088,  1.064, 0.338,
            -0.0625, 0.5344,  0.0735, 0.5189,  0.2002, 0.5498,  0.2634, 0.5721,  0.3308, 0.56,  0.5746, 0.5344,  0.7293, 0.5344,  0.7897, 0.5189,  1.0461, 0.5,
            -0.0402, 0.6574,  0.2961, 0.6915,  0.3626, 0.6612,  0.364, 0.6308,  0.4068, 0.6062,  0.625, 0.5802,  0.7949, 0.5963,  0.8597, 0.6174,  1.0461, 0.6435,
            -0.0298, 0.7685,  0.3156, 0.8697,  0.3919, 0.7994,  0.4221, 0.7381,  0.5158, 0.6781,  0.7389, 0.6448,  0.8387, 0.6835,  0.886, 0.7164,  1.1265, 0.8214,
            -0.0402, 0.9041,  0.2477, 0.9995,  0.4357, 0.9519,  0.458, 0.8792,  0.6496, 0.8258,  0.8289, 0.8186,  0.844, 0.848,  0.9142, 0.923,  1.1116, 0.9676,
            -0.0625, 1.0979,  0.0238, 1.2196,  0.3304, 1.0688,  0.375, 1,  0.7887, 1.0556,  0.8408, 1.0556,  0.875, 1.0688,  0.9435, 1.0688,  1.0893, 1.2196
        ]),
        to: new Float32Array([
            -0.2292, -0.0529,  -0.0402, -0.127,  0.1116, -0.3122,  0.0923, -0.336,  1.1205, -0.164,  1.0089, -0.0635,  1.1205, -0.0529,  1.1116, -0.0899,  1.1979, -0.0741,
            -0.2202, 0.2685,  0.0238, 0.1435,  0.0997, 0.0933,  0.0774, 0.1091,  0.75, 0.0933,  0.7738, 0.1091,  0.7991, 0.1435,  1.2798, 0.088,  1.1801, 0.1435,
            -0.1667, 0.3611,  0.0432, 0.25,  0.1116, 0.25,  0.0923, 0.2791,  0.5387, 0.2791,  0.5908, 0.3161,  0.625, 0.3161,  0.9896, 0.2791,  1.0893, 0.2341,
            -0.1176, 0.4544,  0.0625, 0.3909,  0.1503, 0.4418,  0.1637, 0.4306,  0.4836, 0.3909,  0.6161, 0.4544,  0.6458, 0.4544,  0.7411, 0.3909,  1.064, 0.338,
            -0.0625, 0.5344,  0.0997, 0.5159,  0.2664, 0.5721,  0.2589, 0.5721,  0.4836, 0.5344,  0.7113, 0.5344,  0.7411, 0.5344,  0.7991, 0.5159,  1.0461, 0.5,
            -0.0402, 0.6574,  0.375, 0.713,  0.3929, 0.6574,  0.375, 0.625,  0.5, 0.6038,  0.7991, 0.5721,  0.808, 0.625,  0.875, 0.625,  1.0461, 0.6435,
            -0.0298, 0.7685,  0.3586, 0.9041,  0.4063, 0.8003,  0.4568, 0.75,  0.625, 0.6574,  0.8616, 0.67,  0.8408, 0.713,  0.8943, 0.7288,  1.1265, 0.8214,
            -0.0402, 0.9041,  0.2589, 1.0152,  0.4747, 0.9676,  0.4568, 0.8882,  0.7411, 0.8538,  0.8616, 0.8538,  0.8408, 0.875,  0.9211, 0.9438,  1.1116, 0.9676,
            -0.0625, 1.0979,  0.0238, 1.2196,  0.3304, 1.0688,  0.375, 1,  0.7887, 1.0556,  0.8408, 1.0556,  0.875, 1.0688,  0.9435, 1.0688,  1.0893, 1.2196
        ])
    },
    {
        from: new Float32Array([
            -0.1726, -0.1984,  0.0551, -0.2593,  0.2158, -0.2593,  0.3839, -0.1984,  0.5119, -0.1984,  0.6473, -0.1243,  0.744, -0.2698,  1.0179, -0.4259,  1.2515, -0.2698,
            0, 0.0562,  0.1132, 0.1823,  0.2232, 0.2548,  0.3564, 0.2908,  0.4899, 0.2322,  0.6246, 0.1356,  0.8459, -0.0943,  1.0024, -0.1368,  1.1042, 0.0146,
            -0.0193, 0.0357,  0.1007, 0.1925,  0.2084, 0.2714,  0.3394, 0.3083,  0.4861, 0.3096,  0.6242, 0.2446,  0.8012, 0.0367,  0.9676, -0.0375,  1.0551, -0.0172,
            0, 0.3353,  0.094, 0.398,  0.1862, 0.3802,  0.3233, 0.3458,  0.4853, 0.3774,  0.6429, 0.3933,  0.7828, 0.2597,  0.9472, 0.1519,  1.0685, 0.1647,
            -0.0521, 0.5192,  0.0825, 0.4857,  0.187, 0.4246,  0.321, 0.3704,  0.4831, 0.3932,  0.6564, 0.4542,  0.7645, 0.4768,  0.8992, 0.4089,  1.1473, 0.2345,
            -0.0402, 0.6442,  0.0864, 0.5604,  0.1913, 0.4564,  0.3254, 0.4008,  0.4861, 0.4165,  0.6635, 0.4825,  0.7679, 0.5222,  0.8914, 0.4359,  1.128, 0.2345,
            -0.0253, 0.7718,  0.0867, 0.6243,  0.2009, 0.5205,  0.3369, 0.4877,  0.4929, 0.4952,  0.6676, 0.5504,  0.7852, 0.6101,  0.8932, 0.5562,  1.1622, 0.3082,
            -0.0253, 0.9041,  0.0866, 0.7937,  0.2171, 0.7224,  0.3545, 0.6842,  0.4998, 0.6902,  0.6545, 0.7284,  0.8221, 0.7827,  0.8955, 0.9097,  1.2411, 1.1343,
            -0.0521, 1.1005,  0.0982, 1.0556,  0.2277, 1.0556,  0.3557, 1.0556,  0.5, 1.1587,  0.625, 1.1799,  0.7649, 1.3677,  0.8958, 1.4841,  1.0685, 1.3519
        ]),
        to: new Float32Array([
            -0.1726, -0.1984,  0.0551, -0.2593,  0.2158, -0.2593,  0.3839, -0.1984,  0.5119, -0.1984,  0.6473, -0.1243,  0.744, -0.2698,  1.0179, -0.4259,  1.2515, -0.2698,
            0, 0.0562,  0.125, 0.1971,  0.2381, 0.2679,  0.375, 0.2917,  0.5, 0.2202,  0.625, 0.125,  0.8467, -0.1111,  1, -0.1528,  1.1042, 0.0146,
            -0.0193, 0.0357,  0.125, 0.1766,  0.25, 0.25,  0.375, 0.3082,  0.5, 0.25,  0.625, 0.1766,  0.7887, 0.0146,  0.9598, -0.0648,  1.0551, -0.0172,
            0, 0.3353,  0.125, 0.3896,  0.2167, 0.3444,  0.375, 0.3231,  0.5119, 0.3772,  0.625, 0.3353,  0.7768, 0.1025,  0.9464, 0.0562,  1.0685, 0.1647,
            -0.0521, 0.5192,  0.125, 0.4471,  0.2229, 0.3824,  0.375, 0.3444,  0.5119, 0.3933,  0.6577, 0.4353,  0.75, 0.4677,  0.8601, 0.4353,  1.1473, 0.2345,
            -0.0402, 0.6442,  0.125, 0.5192,  0.2277, 0.4,  0.375, 0.3664,  0.5119, 0.4074,  0.6577, 0.4677,  0.75, 0.5,  0.8527, 0.4471,  1.128, 0.2345,
            -0.0253, 0.7718,  0.1116, 0.5675,  0.2339, 0.4353,  0.3708, 0.4219,  0.5148, 0.4353,  0.6726, 0.5,  0.7649, 0.578,  0.8601, 0.5357,  1.1622, 0.3082,
            -0.0253, 0.9041,  0.0982, 0.7718,  0.2381, 0.6872,  0.375, 0.6442,  0.5119, 0.6442,  0.6577, 0.6872,  0.8229, 0.7348,  0.875, 0.875,  1.2411, 1.1343,
            -0.0521, 1.1005,  0.0982, 1.0556,  0.2277, 1.0556,  0.3557, 1.0556,  0.5, 1.1587,  0.625, 1.1799,  0.7649, 1.3677,  0.8958, 1.4841,  1.0685, 1.3519
        ])
    },
    {
        from: new Float32Array([
            -0.064, -0.1323,  0.0893, -0.1614,  0.25, -0.0608,  0.5729, -0.1614,  0.6771, -0.1614,  0.7292, -0.1614,  0.7634, -0.1217,  0.875, -0.0608,  1.0164, -0.0423,
            -0.0714, 0.1091,  0.2024, 0.0916,  0.2398, 0.1013,  0.4104, 0.1177,  0.5615, 0.1902,  0.6281, 0.1974,  0.6708, 0.0865,  0.7786, -0.0164,  1.0164, 0.1091,
            -0.0565, 0.25,  0.1693, 0.2087,  0.1809, 0.2276,  0.2567, 0.2144,  0.4721, 0.2222,  0.63, 0.3036,  0.6468, 0.2862,  0.7266, 0.227,  1.0104, 0.2262,
            -0.0565, 0.375,  0.1032, 0.3847,  0.137, 0.3946,  0.2537, 0.3447,  0.5137, 0.2953,  0.6493, 0.3614,  0.6881, 0.3717,  0.7872, 0.3789,  1.0313, 0.3538,
            -0.1429, 0.6058,  0.1513, 0.5191,  0.1757, 0.5353,  0.3379, 0.4624,  0.6379, 0.4124,  0.7213, 0.484,  0.7674, 0.5002,  0.8631, 0.5057,  1.0461, 0.4841,
            -0.0714, 0.6753,  0.2071, 0.6491,  0.2173, 0.6685,  0.3774, 0.6207,  0.6904, 0.5605,  0.7637, 0.6042,  0.8191, 0.6327,  0.9133, 0.6491,  1.0789, 0.625,
            -0.0565, 0.8108,  0.2129, 0.7772,  0.2241, 0.8068,  0.3497, 0.8049,  0.6923, 0.7451,  0.7909, 0.7207,  0.8523, 0.7552,  0.9334, 0.7704,  1.0923, 0.75,
            -0.0565, 0.9306,  0.1779, 0.9377,  0.1932, 1.0141,  0.2905, 0.9671,  0.6556, 0.9121,  0.7904, 0.8524,  0.8743, 0.8659,  0.9528, 0.881,  1.0789, 0.9306,
            0, 1,  -0.0714, 1.2169,  0.125, 1.4021,  0.25, 1.0794,  0.625, 1.0794,  0.7902, 1.0794,  0.875, 1.0794,  0.9509, 1.0582,  1.0104, 1.0794
        ]),
        to: new Float32Array([
            -0.064, -0.1323,  0.0893, -0.1614,  0.25, -0.0608,  0.5729, -0.1614,  0.6771, -0.1614,  0.7292, -0.1614,  0.7634, -0.1217,  0.875, -0.0608,  1.0164, -0.0423,
            -0.0714, 0.1091,  0.2054, 0.0985,  0.2292, 0.1091,  0.375, 0.125,  0.5357, 0.2077,  0.6131, 0.25,  0.6458, 0.125,  0.75, -0.0284,  1.0164, 0.1091,
            -0.0565, 0.25,  0.1696, 0.2077,  0.1771, 0.2262,  0.2143, 0.2262,  0.375, 0.1759,  0.625, 0.2937,  0.6369, 0.3161,  0.6652, 0.2262,  1.0104, 0.2262,
            -0.0565, 0.375,  0.0997, 0.375,  0.125, 0.375,  0.1771, 0.3882,  0.3616, 0.2077,  0.6131, 0.3406,  0.6548, 0.3406,  0.7068, 0.375,  1.0313, 0.3538,
            -0.1429, 0.6058,  0.1414, 0.5,  0.1563, 0.5,  0.1949, 0.5,  0.5193, 0.2937,  0.6964, 0.4517,  0.7158, 0.4517,  0.7902, 0.4841,  1.0461, 0.4841,
            -0.0714, 0.6753,  0.2054, 0.625,  0.2054, 0.625,  0.2292, 0.625,  0.6131, 0.375,  0.7158, 0.5298,  0.7634, 0.5456,  0.8557, 0.625,  1.0789, 0.625,
            -0.0565, 0.8108,  0.2143, 0.75,  0.2292, 0.75,  0.25, 0.7315,  0.6652, 0.6865,  0.7634, 0.6462,  0.8095, 0.7077,  0.8914, 0.75,  1.0923, 0.75,
            -0.0565, 0.9306,  0.2054, 0.9067,  0.2054, 0.9306,  0.2292, 0.9411,  0.625, 0.875,  0.7634, 0.7718,  0.8557, 0.8108,  0.939, 0.8538,  1.0789, 0.9306,
            0, 1,  -0.0714, 1.2169,  0.125, 1.4021,  0.25, 1.0794,  0.625, 1.0794,  0.7902, 1.0794,  0.875, 1.0794,  0.9509, 1.0582,  1.0104, 1.0794
        ])
    },
    {
        from: new Float32Array([
            -0.2292, -0.3968,  0.0699, -0.3439,  0.2217, -0.1799,  0.3512, -0.1376,  0.6533, -0.2407,  0.6845, -0.164,  0.7753, -0.3148,  0.9494, -0.3677,  1.381, -0.5476,
            -0.1711, 0.0827,  -0.0015, -0.1247,  0.255, 0.0704,  0.3568, 0.0563,  0.5504, 0.0341,  0.6151, 0.0281,  0.7902, -0.1278,  0.9226, -0.1982,  1.2039, -0.0628,
            -0.1057, 0.2209,  0.057, 0.1529,  0.2583, 0.2179,  0.3189, 0.2138,  0.4171, 0.2069,  0.5318, 0.1703,  0.7386, 0.0506,  0.9631, 0.0141,  1.2113, 0.1091,
            -0.1176, 0.2983,  0.1302, 0.3228,  0.272, 0.365,  0.3113, 0.3529,  0.3599, 0.3479,  0.4861, 0.3086,  0.6931, 0.2316,  0.9251, 0.2406,  1.2113, 0.33,
            -0.1533, 0.375,  0.1682, 0.3811,  0.2945, 0.4476,  0.3831, 0.4846,  0.4187, 0.4907,  0.5224, 0.4621,  0.6982, 0.4233,  0.8298, 0.4446,  1.1369, 0.463,
            -0.0938, 0.5728,  0.1938, 0.4241,  0.3608, 0.508,  0.4518, 0.5735,  0.508, 0.6373,  0.6138, 0.64,  0.7828, 0.5889,  0.839, 0.5789,  1.1563, 0.5608,
            -0.0789, 0.75,  0.2754, 0.5601,  0.4215, 0.5819,  0.5007, 0.6763,  0.5616, 0.767,  0.6724, 0.7799,  0.883, 0.74,  0.8858, 0.779,  1.1563, 0.6389,
            -0.1057, 0.9226,  0.1405, 0.8819,  0.3221, 0.8897,  0.479, 0.9121,  0.5999, 0.9253,  0.6753, 0.9071,  0.9766, 0.926,  1.0255, 1.0064,  1.1726, 1.0443,
            -0.0387, 1.1138,  0.0878, 1.1349,  0.2292, 1.1138,  0.4301, 1.1852,  0.625, 1.2804,  0.625, 1.3254,  1.0372, 1.2328,  0.9568, 1.2328,  1.0938, 1.2328
        ]),
        to: new Float32Array([
            -0.2292, -0.3968,  0.0699, -0.3439,  0.2217, -0.1799,  0.3512, -0.1376,  0.6533, -0.2407,  0.6845, -0.164,  0.7753, -0.3148,  0.9494, -0.3677,  1.381, -0.5476,
            -0.1711, 0.0827,  -0.0387, -0.1263,  0.25, 0.125,  0.2887, 0.125,  0.5, 0.125,  0.5565, 0.125,  0.7827, -0.0787,  0.9182, -0.1799,  1.2039, -0.0628,
            -0.1057, 0.2209,  0.0268, 0.1918,  0.25, 0.25,  0.2679, 0.2844,  0.2887, 0.2685,  0.3958, 0.2844,  0.6771, 0.125,  0.9702, 0.0542,  1.2113, 0.1091,
            -0.1176, 0.2983,  0.1101, 0.33,  0.25, 0.42,  0.317, 0.42,  0.3571, 0.42,  0.3958, 0.42,  0.6369, 0.2983,  0.9107, 0.2844,  1.2113, 0.33,
            -0.1533, 0.375,  0.1533, 0.375,  0.2292, 0.42,  0.375, 0.5,  0.4301, 0.5377,  0.4583, 0.5377,  0.6845, 0.4735,  0.811, 0.4735,  1.1369, 0.463,
            -0.0938, 0.5728,  0.1533, 0.4054,  0.3363, 0.5,  0.4167, 0.5377,  0.5, 0.625,  0.5476, 0.6991,  0.7887, 0.6118,  0.8378, 0.588,  1.1563, 0.5608,
            -0.0789, 0.75,  0.25, 0.5608,  0.3958, 0.5608,  0.4732, 0.625,  0.5402, 0.75,  0.5967, 0.7976,  0.8839, 0.7361,  0.8839, 0.7811,  1.1563, 0.6389,
            -0.1057, 0.9226,  0.125, 0.875,  0.2976, 0.875,  0.4464, 0.8882,  0.5908, 0.9041,  0.625, 0.875,  0.9702, 0.9041,  1.0268, 1,  1.1726, 1.0443,
            -0.0387, 1.1138,  0.0878, 1.1349,  0.2292, 1.1138,  0.4301, 1.1852,  0.625, 1.2804,  0.625, 1.3254,  1.0372, 1.2328,  0.9568, 1.2328,  1.0938, 1.2328
        ])
    },
    {
        from: new Float32Array([
            -0.0952, -0.1561,  0.0997, -0.1561,  0.2396, -0.0847,  0.3586, -0.0608,  0.4926, -0.0608,  0.6086, -0.1561,  0.7426, -0.1772,  0.8616, -0.1561,  1.064, -0.2275,
            -0.0521, 0.0933,  -0.0294, 0.2939,  0.2743, 0.3443,  0.3733, 0.3142,  0.483, 0.276,  0.6055, 0.2111,  0.7312, 0.1206,  0.8629, -0.0237,  1.064, -0.1772,
            -0.125, 0.3611,  0.0863, 0.4713,  0.2899, 0.4029,  0.3798, 0.368,  0.4759, 0.3296,  0.5911, 0.2655,  0.7163, 0.1903,  0.8709, 0.0377,  1.0804, -0.123,
            -0.0952, 0.5119,  0.1568, 0.5184,  0.2952, 0.4428,  0.3816, 0.3963,  0.4712, 0.3601,  0.5807, 0.2969,  0.7097, 0.2278,  0.8669, 0.1948,  1.119, 0.4147,
            -0.0521, 0.625,  0.2564, 0.539,  0.3012, 0.5293,  0.3745, 0.4544,  0.4681, 0.3974,  0.579, 0.3266,  0.7094, 0.2622,  0.8816, 0.279,  1.1071, 0.4683,
            -0.1399, 0.6938,  0.2858, 0.5756,  0.2869, 0.6269,  0.3614, 0.5222,  0.4695, 0.4317,  0.5892, 0.3481,  0.7312, 0.2981,  0.9203, 0.3443,  1.119, 0.5985,
            -0.0521, 0.7897,  0.2137, 0.7792,  0.2578, 0.7166,  0.3079, 0.6162,  0.472, 0.4939,  0.6617, 0.4652,  0.8301, 0.5635,  0.9261, 0.6539,  1.119, 0.75,
            -0.0685, 0.9438,  0.1577, 0.9305,  0.2083, 0.8588,  0.254, 0.9005,  0.4803, 0.73,  0.7359, 0.7001,  0.9075, 0.9041,  0.9884, 0.9913,  1.1726, 0.957,
            -0.0283, 1.0873,  0.0997, 1.1561,  0.125, 1.1799,  0.2604, 1.1243,  0.4926, 1.0688,  0.8006, 1.0873,  0.9167, 1.1376,  1.0313, 1.2698,  1.1548, 1.3228
        ]),
        to: new Float32Array([
            -0.0952, -0.1561,  0.0997, -0.1561,  0.2396, -0.0847,  0.3586, -0.0608,  0.4926, -0.0608,  0.6086, -0.1561,  0.7426, -0.1772,  0.8616, -0.1561,  1.064, -0.2275,
            -0.0521, 0.0933,  -0.0521, 0.3062,  0.2708, 0.375,  0.375, 0.3485,  0.4926, 0.3062,  0.625, 0.2335,  0.75, 0.125,  0.875, -0.0337,  1.064, -0.1772,
            -0.125, 0.3611,  0.0789, 0.5,  0.2827, 0.4147,  0.3824, 0.375,  0.4926, 0.33,  0.625, 0.25,  0.75, 0.1812,  0.8988, 0.0146,  1.0804, -0.123,
            -0.0952, 0.5119,  0.1518, 0.5344,  0.2827, 0.4683,  0.3824, 0.4147,  0.4926, 0.375,  0.625, 0.2851,  0.7589, 0.2163,  0.8988, 0.2335,  1.119, 0.4147,
            -0.0521, 0.625,  0.2827, 0.5344,  0.2961, 0.5985,  0.3646, 0.5119,  0.4926, 0.3995,  0.6324, 0.3062,  0.7589, 0.2619,  0.9286, 0.3062,  1.1071, 0.4683,
            -0.1399, 0.6938,  0.2902, 0.5721,  0.2604, 0.6759,  0.3586, 0.5344,  0.5, 0.4286,  0.6414, 0.33,  0.8006, 0.3062,  0.9673, 0.375,  1.119, 0.5985,
            -0.0521, 0.7897,  0.192, 0.8294,  0.25, 0.75,  0.2708, 0.6759,  0.5, 0.5119,  0.7738, 0.5589,  0.8988, 0.7315,  0.9286, 0.713,  1.119, 0.75,
            -0.0685, 0.9438,  0.1518, 0.9438,  0.1979, 0.875,  0.25, 0.957,  0.5, 0.7718,  0.7738, 0.7315,  0.936, 0.9755,  1, 1.0205,  1.1726, 0.957,
            -0.0283, 1.0873,  0.0997, 1.1561,  0.125, 1.1799,  0.2604, 1.1243,  0.4926, 1.0688,  0.8006, 1.0873,  0.9167, 1.1376,  1.0313, 1.2698,  1.1548, 1.3228
        ])
    }
];

let meshBlurHProgram = null;
let meshBlurVProgram = null;
let meshPostProgram = null;
let meshBlurHVAO = null;
let meshBlurVVAO = null;
let meshVAO = null;
let meshVertexBuffer = null;
let meshIndexBuffer = null;
let _meshActiveLandscape = null;
let _meshIndexCount = 0;
const _meshCache = { portrait: null, landscape: null };
const _meshPresetWeights0 = new Float32Array(3);
const _meshPresetWeights1 = new Float32Array(2);

let a_meshBlurH_pos = -1;
let u_meshBlurH_image = null;
let u_meshBlurH_step = null;

let a_meshBlurV_pos = -1;
let u_meshBlurV_image = null;
let u_meshBlurV_step = null;

let a_mesh_uv = -1;
let a_mesh_preset0 = -1;
let a_mesh_preset1 = -1;
let a_mesh_preset2 = -1;
let a_mesh_preset3 = -1;
let a_mesh_preset4 = -1;

let u_mesh_image = null;
let u_mesh_viewAspect = null;
let u_mesh_time = null;
let u_mesh_warpTimeScale = null;
let u_mesh_presetWeights0 = null;
let u_mesh_presetWeights1 = null;
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

const meshVertexShaderSource = `#version 300 es
    in vec2 a_uv;
    in vec4 a_preset0;
    in vec4 a_preset1;
    in vec4 a_preset2;
    in vec4 a_preset3;
    in vec4 a_preset4;

    uniform float u_viewAspect;
    uniform float u_time;
    uniform float u_warpTimeScale;
    uniform vec3 u_presetWeights0;
    uniform vec2 u_presetWeights1;

    out vec2 v_texCoord;

    void main() {
        float t = u_time * u_warpTimeScale;
        float warpMix = (sin(t / 3.5) + 1.0) * 0.5;

        vec2 p0 = mix(a_preset0.xy, a_preset0.zw, warpMix);
        vec2 p1 = mix(a_preset1.xy, a_preset1.zw, warpMix);
        vec2 p2 = mix(a_preset2.xy, a_preset2.zw, warpMix);
        vec2 p3 = mix(a_preset3.xy, a_preset3.zw, warpMix);
        vec2 p4 = mix(a_preset4.xy, a_preset4.zw, warpMix);

        vec2 pos = p0 * u_presetWeights0.x
                 + p1 * u_presetWeights0.y
                 + p2 * u_presetWeights0.z
                 + p3 * u_presetWeights1.x
                 + p4 * u_presetWeights1.y;

        gl_Position = vec4(pos, 0.0, 1.0);
        v_texCoord = a_uv;
    }
`;

const meshFragmentShaderSource = `#version 300 es
    precision mediump float;

    in vec2 v_texCoord;
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

    out vec4 fragColor;

    float interleavedGradientNoise(highp vec2 uv) {
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
        vec3 c = texture(u_image, v_texCoord).rgb;

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

        highp vec2 fc = gl_FragCoord.xy;
        float n = interleavedGradientNoise(fc) + interleavedGradientNoise(fc + vec2(5.588238, 5.588238)) - 1.0;
        c += n * 0.0039215686;

        c = clamp(c, 0.0, 1.0);
        fragColor = vec4(c, u_opacity);
    }
`;

function _subdivideControlMesh(points, n) {
    const stride = 2 * n + 1;
    const at = (x, y) => points[y * (n + 1) + x];
    const face = (x, y) => {
        const a = at(x, y);
        const b = at(x + 1, y);
        const c = at(x, y + 1);
        const d = at(x + 1, y + 1);
        return [(a[0] + b[0] + c[0] + d[0]) * 0.25, (a[1] + b[1] + c[1] + d[1]) * 0.25];
    };
    const out = new Array(stride * stride);

    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            out[(2 * y + 1) * stride + 2 * x + 1] = face(x, y);
        }
    }

    for (let y = 0; y <= n; y++) {
        for (let x = 0; x < n; x++) {
            const a = at(x, y);
            const b = at(x + 1, y);
            const sx = a[0] + b[0];
            const sy = a[1] + b[1];
            if (y === 0 || y === n) {
                out[2 * y * stride + 2 * x + 1] = [sx * 0.5, sy * 0.5];
            } else {
                const f0 = face(x, y - 1);
                const f1 = face(x, y);
                out[2 * y * stride + 2 * x + 1] = [(sx + f0[0] + f1[0]) * 0.25, (sy + f0[1] + f1[1]) * 0.25];
            }
        }
    }

    for (let y = 0; y < n; y++) {
        for (let x = 0; x <= n; x++) {
            const a = at(x, y);
            const b = at(x, y + 1);
            const sx = a[0] + b[0];
            const sy = a[1] + b[1];
            if (x === 0 || x === n) {
                out[(2 * y + 1) * stride + 2 * x] = [sx * 0.5, sy * 0.5];
            } else {
                const f0 = face(x - 1, y);
                const f1 = face(x, y);
                out[(2 * y + 1) * stride + 2 * x] = [(sx + f0[0] + f1[0]) * 0.25, (sy + f0[1] + f1[1]) * 0.25];
            }
        }
    }

    for (let y = 0; y <= n; y++) {
        for (let x = 0; x <= n; x++) {
            const p = at(x, y);
            const borderY = y === 0 || y === n;
            const borderX = x === 0 || x === n;
            let v;
            if (borderY && borderX) {
                v = [p[0], p[1]];
            } else if (borderY) {
                const prev = at(x - 1, y);
                const next = at(x + 1, y);
                v = [(prev[0] + 6.0 * p[0] + next[0]) * 0.125, (prev[1] + 6.0 * p[1] + next[1]) * 0.125];
            } else if (borderX) {
                const prev = at(x, y - 1);
                const next = at(x, y + 1);
                v = [(prev[0] + 6.0 * p[0] + next[0]) * 0.125, (prev[1] + 6.0 * p[1] + next[1]) * 0.125];
            } else {
                const f00 = face(x - 1, y - 1);
                const f10 = face(x, y - 1);
                const f01 = face(x - 1, y);
                const f11 = face(x, y);
                const fx = (f00[0] + f10[0] + f01[0] + f11[0]) * 0.25;
                const fy = (f00[1] + f10[1] + f01[1] + f11[1]) * 0.25;
                const eL = at(x - 1, y);
                const eR = at(x + 1, y);
                const eT = at(x, y - 1);
                const eB = at(x, y + 1);
                const ex = (eL[0] + eR[0] + eT[0] + eB[0]) * 0.25;
                const ey = (eL[1] + eR[1] + eT[1] + eB[1]) * 0.25;
                v = [(fx + ex + 2.0 * p[0]) * 0.25, (fy + ey + 2.0 * p[1]) * 0.25];
            }
            out[2 * y * stride + 2 * x] = v;
        }
    }

    return out;
}

function _subdivideControlPair(rawArray, baseQuads, steps) {
    const count = (baseQuads + 1) * (baseQuads + 1);
    let pts = new Array(count);
    for (let i = 0; i < count; i++) {
        pts[i] = [rawArray[i * 2] * 2.0 - 1.0, rawArray[i * 2 + 1] * 2.0 - 1.0];
    }
    let n = baseQuads;
    for (let s = 0; s < steps; s++) {
        pts = _subdivideControlMesh(pts, n);
        n *= 2;
    }
    return pts;
}

function _getMeshGeometry(isLandscape) {
    const key = isLandscape ? 'landscape' : 'portrait';
    if (_meshCache[key]) return _meshCache[key];

    const presets = isLandscape ? MESH_LANDSCAPE_PRESETS : MESH_PORTRAIT_PRESETS;
    const baseQuads = isLandscape ? 8 : 5;
    const subdivSteps = isLandscape ? 2 : 3;
    const quads = baseQuads * (1 << subdivSteps);
    const width = quads + 1;
    const vertexCount = width * width;

    const subdividedFrom = new Array(5);
    const subdividedTo = new Array(5);
    for (let p = 0; p < 5; p++) {
        subdividedFrom[p] = _subdivideControlPair(presets[p].from, baseQuads, subdivSteps);
        subdividedTo[p] = _subdivideControlPair(presets[p].to, baseQuads, subdivSteps);
    }

    const vertices = new Float32Array(vertexCount * MESH_FLOATS_PER_VERTEX);
    let vPtr = 0;
    for (let i = 0; i < vertexCount; i++) {
        vertices[vPtr++] = (i % width) / quads;
        vertices[vPtr++] = Math.floor(i / width) / quads;
        for (let p = 0; p < 5; p++) {
            const f = subdividedFrom[p][i];
            const t = subdividedTo[p][i];
            vertices[vPtr++] = f[0];
            vertices[vPtr++] = f[1];
            vertices[vPtr++] = t[0];
            vertices[vPtr++] = t[1];
        }
    }

    const indices = new Uint16Array(quads * quads * 6);
    let iPtr = 0;
    for (let y = 0; y < quads; y++) {
        const row0 = y * width;
        const row1 = (y + 1) * width;
        for (let x = 0; x < quads; x++) {
            const i00 = row0 + x;
            const i10 = i00 + 1;
            const i01 = row1 + x;
            const i11 = i01 + 1;
            indices[iPtr++] = i00;
            indices[iPtr++] = i11;
            indices[iPtr++] = i01;
            indices[iPtr++] = i00;
            indices[iPtr++] = i10;
            indices[iPtr++] = i11;
        }
    }

    const geo = { vertices, indices, indexCount: indices.length };
    _meshCache[key] = geo;
    return geo;
}

function _resolveMeshLandscape() {
    if (MESH_GRID_MODE === 'landscape') return true;
    if (MESH_GRID_MODE === 'portrait') return false;
    return _viewportAspect >= 1.0;
}

function _uploadMeshGeometry(isLandscape) {
    const geo = _getMeshGeometry(isLandscape);
    gl.bindBuffer(gl.ARRAY_BUFFER, meshVertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, geo.vertices, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.indices, gl.STATIC_DRAW);
    _meshIndexCount = geo.indexCount;
    _meshActiveLandscape = isLandscape;
}

function _bindMeshAttributes() {
    const stride = MESH_FLOATS_PER_VERTEX * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, meshVertexBuffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshIndexBuffer);
    if (a_mesh_uv >= 0) {
        gl.enableVertexAttribArray(a_mesh_uv);
        gl.vertexAttribPointer(a_mesh_uv, 2, gl.FLOAT, false, stride, 0);
    }
    const attrs = [a_mesh_preset0, a_mesh_preset1, a_mesh_preset2, a_mesh_preset3, a_mesh_preset4];
    for (let i = 0; i < 5; i++) {
        if (attrs[i] >= 0) {
            gl.enableVertexAttribArray(attrs[i]);
            gl.vertexAttribPointer(attrs[i], 4, gl.FLOAT, false, stride, 8 + i * 16);
        }
    }
}

const _meshPipeline = {
    layerScales: MESH_LAYER_SCALES,
    layerAbsBaseX: MESH_LAYER_ABS_BASE_X,
    layerAbsBaseY: MESH_LAYER_ABS_BASE_Y,

    getCanvasBaseSize() {
        const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
        const cssW = _viewportWidth > 0 ? _viewportWidth : ((typeof window !== 'undefined' && window.innerWidth) || 1280);
        const cssH = _viewportHeight > 0 ? _viewportHeight : ((typeof window !== 'undefined' && window.innerHeight) || 720);
        const scaled = Math.round(Math.sqrt(cssW * cssH) * 0.5 * dpr);
        return Math.min(1024, Math.max(512, scaled));
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
        _meshActiveLandscape = null;
    },

    initStaticPrograms() {
        const meshVS = createShader(gl, gl.VERTEX_SHADER, meshVertexShaderSource);
        const meshFS = createShader(gl, gl.FRAGMENT_SHADER, meshFragmentShaderSource);
        if (!meshVS || !meshFS) return false;

        meshPostProgram = createProgram(gl, meshVS, meshFS);
        gl.deleteShader(meshVS);
        gl.deleteShader(meshFS);
        if (!meshPostProgram) return false;

        a_mesh_uv      = gl.getAttribLocation(meshPostProgram, 'a_uv');
        a_mesh_preset0 = gl.getAttribLocation(meshPostProgram, 'a_preset0');
        a_mesh_preset1 = gl.getAttribLocation(meshPostProgram, 'a_preset1');
        a_mesh_preset2 = gl.getAttribLocation(meshPostProgram, 'a_preset2');
        a_mesh_preset3 = gl.getAttribLocation(meshPostProgram, 'a_preset3');
        a_mesh_preset4 = gl.getAttribLocation(meshPostProgram, 'a_preset4');

        u_mesh_image          = gl.getUniformLocation(meshPostProgram, 'u_image');
        u_mesh_viewAspect     = gl.getUniformLocation(meshPostProgram, 'u_viewAspect');
        u_mesh_time           = gl.getUniformLocation(meshPostProgram, 'u_time');
        u_mesh_warpTimeScale  = gl.getUniformLocation(meshPostProgram, 'u_warpTimeScale');
        u_mesh_presetWeights0 = gl.getUniformLocation(meshPostProgram, 'u_presetWeights0');
        u_mesh_presetWeights1 = gl.getUniformLocation(meshPostProgram, 'u_presetWeights1');
        u_mesh_saturate       = gl.getUniformLocation(meshPostProgram, 'u_saturate');
        u_mesh_whiteScrim     = gl.getUniformLocation(meshPostProgram, 'u_whiteScrim');
        u_mesh_blackScrim     = gl.getUniformLocation(meshPostProgram, 'u_blackScrim');
        u_mesh_darkFactor     = gl.getUniformLocation(meshPostProgram, 'u_darkFactor');
        u_mesh_lightFactor    = gl.getUniformLocation(meshPostProgram, 'u_lightFactor');
        u_mesh_floor          = gl.getUniformLocation(meshPostProgram, 'u_floor');
        u_mesh_ceiling        = gl.getUniformLocation(meshPostProgram, 'u_ceiling');
        u_mesh_brightness     = gl.getUniformLocation(meshPostProgram, 'u_brightness');
        u_mesh_contrast       = gl.getUniformLocation(meshPostProgram, 'u_contrast');
        u_mesh_hueRotate      = gl.getUniformLocation(meshPostProgram, 'u_hueRotate');
        u_mesh_opacity        = gl.getUniformLocation(meshPostProgram, 'u_opacity');

        gl.useProgram(meshPostProgram);
        gl.uniform1i(u_mesh_image, 0);
        return true;
    },

    initVAOs() {
        meshVertexBuffer = gl.createBuffer();
        meshIndexBuffer = gl.createBuffer();
        _uploadMeshGeometry(_resolveMeshLandscape());

        meshVAO = gl.createVertexArray();
        gl.bindVertexArray(meshVAO);
        _bindMeshAttributes();
        gl.bindVertexArray(null);
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

        if (meshBlurHVAO) gl.deleteVertexArray(meshBlurHVAO);
        if (meshBlurVVAO) gl.deleteVertexArray(meshBlurVVAO);

        meshBlurHVAO = gl.createVertexArray();
        gl.bindVertexArray(meshBlurHVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.enableVertexAttribArray(a_meshBlurH_pos);
        gl.vertexAttribPointer(a_meshBlurH_pos, 2, gl.FLOAT, false, 0, 0);

        meshBlurVVAO = gl.createVertexArray();
        gl.bindVertexArray(meshBlurVVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.enableVertexAttribArray(a_meshBlurV_pos);
        gl.vertexAttribPointer(a_meshBlurV_pos, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);

        gl.useProgram(meshBlurHProgram);
        gl.uniform1i(u_meshBlurH_image, 0);
        gl.useProgram(meshBlurVProgram);
        gl.uniform1i(u_meshBlurV_image, 0);
        return true;
    },

    applyViewportUniforms() {
        const wantLandscape = _resolveMeshLandscape();
        if (_meshActiveLandscape !== null && wantLandscape !== _meshActiveLandscape && meshVertexBuffer && meshIndexBuffer) {
            _uploadMeshGeometry(wantLandscape);
        }
        gl.useProgram(meshBlurHProgram);
        gl.uniform2f(u_meshBlurH_step, 1.0 / blurDimensions.width, 0.0);
        gl.useProgram(meshBlurVProgram);
        gl.uniform2f(u_meshBlurV_step, 0.0, 1.0 / blurDimensions.height);
        gl.useProgram(meshPostProgram);
        gl.uniform1f(u_mesh_viewAspect, _viewportAspect);
    },

    renderFrame(currentTime, isLightweight) {
        if (!DISABLE_GAUSSIAN_BLUR) {
            gl.useProgram(meshBlurHProgram);
            gl.bindVertexArray(meshBlurHVAO);
            gl.bindFramebuffer(gl.FRAMEBUFFER, blurFramebuffer);
            gl.bindTexture(gl.TEXTURE_2D, renderTexture);
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            gl.useProgram(meshBlurVProgram);
            gl.bindVertexArray(meshBlurVVAO);
            gl.bindFramebuffer(gl.FRAMEBUFFER, renderFramebuffer);
            gl.bindTexture(gl.TEXTURE_2D, blurTextureA);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }

        gl.useProgram(meshPostProgram);

        let idxA = 0, idxB = 0, presetMix = 0.0;
        if (MESH_PRESET_INDEX >= 0) {
            idxA = idxB = Math.floor(MESH_PRESET_INDEX) % 5;
        } else if (!isLightweight) {
            const cycleDuration = 16.0;
            const totalPhase = Math.max(0.0, currentTime) / cycleDuration;
            const stepIdx = Math.floor(totalPhase);
            const rawT = totalPhase - stepIdx;
            presetMix = rawT * rawT * (3.0 - 2.0 * rawT);
            idxA = stepIdx % 5;
            idxB = (stepIdx + 1) % 5;
        }

        _meshPresetWeights0[0] = 0.0;
        _meshPresetWeights0[1] = 0.0;
        _meshPresetWeights0[2] = 0.0;
        _meshPresetWeights1[0] = 0.0;
        _meshPresetWeights1[1] = 0.0;

        if (idxA < 3) _meshPresetWeights0[idxA] += 1.0 - presetMix;
        else _meshPresetWeights1[idxA - 3] += 1.0 - presetMix;

        if (idxB < 3) _meshPresetWeights0[idxB] += presetMix;
        else _meshPresetWeights1[idxB - 3] += presetMix;

        gl.bindVertexArray(meshVAO);

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
        gl.uniform3fv(u_mesh_presetWeights0, _meshPresetWeights0);
        gl.uniform2fv(u_mesh_presetWeights1, _meshPresetWeights1);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvasDimensions.width, canvasDimensions.height);
        gl.bindTexture(gl.TEXTURE_2D, renderTexture);
        gl.drawElements(gl.TRIANGLES, _meshIndexCount, gl.UNSIGNED_SHORT, 0);
    }
};