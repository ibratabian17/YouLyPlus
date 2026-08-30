// --- WebGL & Animation State Variables ---
let gl = null;
let glProgram = null;
let blurHProgram = null;
let blurVPostProgram = null;
let webglCanvas = null;
let blurContainerElem = null;
let needsAnimation = false;

// Extension for VAO
let vaoExt = null;
let mainVAO = null;
let blurHVAO = null;
let blurVPostVAO = null;

// Attribute locations
let a_main_pos = -1;
let a_main_tex = -1;
let a_blurH_pos = -1;
let a_blurH_tex = -1;
let a_blurVPost_pos = -1;
let a_blurVPost_tex = -1;

// Uniform locations - Main
let u_main_artworkTexture = null;
let u_main_transitionProgress = null;
let u_main_layerTransform = null; // [rotation, scale, offsetX, offsetY]

// Uniform locations - Blur Horizontal
let u_blurH_image = null;
let u_blurH_step = null;

// Uniform locations - Blur Vertical + Post-process
let u_blurVPost_image = null;
let u_blurVPost_step = null;
let u_blurVPost_brightness = null;
let u_blurVPost_saturate = null;
let u_blurVPost_contrast = null;
let u_blurVPost_hueRotate = null;
let u_blurVPost_opacity = null;

// Cached post-process values
const _postParams = { brightness: 0.7, saturate: 3.0, contrast: 0.95, hueRotate: 0.0, opacity: 1.0 };
let _postParamsDirty = true;

// WebGL objects
let quadBuffer = null;
let currentArtworkTexture = null;
let previousArtworkTexture = null;

// Framebuffers & Textures
let renderFramebuffer = null;
let blurFramebuffer = null;
let renderTexture = null;
let blurTextureA = null;

// Constants
const BLUR_DOWNSAMPLE = 1;
const BLUR_DOWNSAMPLE_LIGHTWEIGHT = 2;
const BLUR_RADIUS = 7;
const TARGET_FPS = 40;
const FRAME_INTERVAL = 1000 / TARGET_FPS;
const ARTWORK_TRANSITION_SPEED = 0.02;
const TWO_PI = Math.PI * 2;

// Animation State
let blurDimensions = { width: 0, height: 0 };
let canvasDimensions = { width: 0, height: 0 };
let currentTargetMasterArtworkPalette = {
    background: { r: 0, g: 0, b: 0 },
    primary: { r: 255, g: 255, b: 255 },
    secondary: { r: 200, g: 200, b: 200 }
};

let LYPLUS_bgConfig = {
    dynamicPlayerSelectors: [],
    blurContainerParentSelector: 'body',
    mutationObserverRootSelector: 'body',
    artworkSelector: ''
};

function LYPLUS_setBgConfig(config) {
    Object.assign(LYPLUS_bgConfig, config);
}

// Layer Config
const ROTATION_POWER = 0.8;
const ROTATION_SPEEDS = [-0.10, 0.18, 0.32];
const INITIAL_ROTATIONS = [0.3, -2.1, 2.4];
const LAYER_SCALES = [1.4, 1.26, 1.26];
const PERIMETER_SPEEDS = [0.09, 0.012, 0.02];
const PERIMETER_DIRECTION = [-1, 1, 1];
const LAYER_BASE_POSITIONS = [0, 0, 0.75, -0.75, -0.75, 0.75];

// Dynamic State
let artworkTransitionProgress = 1.0;
let globalAnimationId = null;
let startTime = 0;
let lastDrawTime = 0;
let bgObserver = null;
const BEAT_ROT_BOOST = [0.28, -0.18, 0.02];
const BEAT_SPD_BOOST = [0.8, 0.2, 0.5];
const BEAT_SCALE_BOOST = [0.2, 0.34, 0.39];
const BEAT_SCALE_DECAY = 2; // decays over 1 second
const layerPerimTime = [0, 0, 0];
const layerBeatScale = [0, 0, 0];
const layerBeatRot = [0, 0, 0];
let beatEnergyBaseline = 0;

// Precalculated per-frame layer transform cache [rot, scale, px, py] for 3 layers
const _cachedLayerRots = [0, 0, 0];
const _cachedLayerScales = [0, 0, 0];
const _cachedLayerPosX = [0, 0, 0];
const _cachedLayerPosY = [0, 0, 0];

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

        let maxDiff = 0;
        for (let i = 0; i < bufferLength; i++) {
            const diff = Math.abs(dataArray[i] - 128);
            if (diff > maxDiff) maxDiff = diff;
        }

        s.beatPulse = (maxDiff / 128) * volumeMultiplier;
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

// --- Shader Sources ---

const vertexShaderSource = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    
    // [rotation(rad), scale, offsetX, offsetY]
    uniform vec4 u_layerTransform; 
    
    varying vec2 v_texCoord;
    varying vec2 v_uv;
    
    void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
        
        float rotation = u_layerTransform.x;
        float scale = u_layerTransform.y;
        vec2 offset = u_layerTransform.zw;
        
        vec2 centered = a_position * 0.5;
        centered.y = -centered.y; 
        centered -= offset;
        
        float s = sin(-rotation);
        float c = cos(-rotation);
        centered = vec2(centered.x * c - centered.y * s, centered.x * s + centered.y * c);
        
        centered /= scale;
        v_uv = centered + 0.5;
    }
`;

const quadVertexShaderSource = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;
    
    void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
    }
`;

const fragmentShaderSource = `
    #ifdef GL_ES
    precision mediump float;
    #endif
    
    varying vec2 v_uv;
    uniform sampler2D u_artworkTexture;
    uniform float u_transitionProgress;
    
    void main() {
        if (v_uv.x < 0.0 || v_uv.x > 1.0 || v_uv.y < 0.0 || v_uv.y > 1.0) {
            discard;
        }
        vec4 color = texture2D(u_artworkTexture, v_uv);
        gl_FragColor = vec4(color.rgb, color.a * u_transitionProgress);
    }
`;

// Pass 2: Horizontal Gaussian Blur (Precomputed weights, no transcendental calls in shader)
const blurHFragmentShaderSource = `
    #ifdef GL_ES
    precision mediump float;
    #endif

    varying vec2 v_texCoord;
    uniform sampler2D u_image;
    uniform vec2 u_step;

    #define TAP(i, w) color += (texture2D(u_image, v_texCoord + u_step * i) + texture2D(u_image, v_texCoord - u_step * i)) * w;

    void main() {
        vec4 color = texture2D(u_image, v_texCoord);
        TAP(1.0,  0.99384664)
        TAP(2.0,  0.97561821)
        TAP(3.0,  0.94595947)
        TAP(4.0,  0.90600021)
        TAP(5.0,  0.85700465)
        TAP(6.0,  0.80073740)
        TAP(7.0,  0.73899471)
        TAP(8.0,  0.67364818)
        TAP(9.0,  0.60653066)
        TAP(10.0, 0.53939589)
        TAP(11.0, 0.47382299)
        TAP(12.0, 0.41111229)
        TAP(13.0, 0.35232760)
        TAP(14.0, 0.29824286)
        gl_FragColor = vec4(color.rgb * 0.049636453, 1.0);
    }
`;

// Pass 3: Vertical Gaussian Blur + Dither Noise + Post-Process directly to Screen
const blurVPostFragmentShaderSource = `
    #ifdef GL_ES
    precision mediump float;
    #endif

    varying vec2 v_texCoord;
    uniform sampler2D u_image;
    uniform vec2 u_step;
    uniform float u_brightness;
    uniform float u_saturate;
    uniform float u_contrast;
    uniform float u_hueRotate;
    uniform float u_opacity;

    float interleavedGradientNoise(vec2 uv) {
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
        h /= 6.0;
        return vec3(h, s, l);
    }

    float hue2rgb(float p, float q, float t) {
        if (t < 0.0) t += 1.0;
        if (t > 1.0) t -= 1.0;
        if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
        if (t < 0.5)     return q;
        if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
        return p;
    }

    vec3 hsl2rgb(vec3 hsl) {
        float h = hsl.x, s = hsl.y, l = hsl.z;
        if (s < 0.0001) return vec3(l);
        float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
        float p = 2.0 * l - q;
        return vec3(
            hue2rgb(p, q, h + 1.0/3.0),
            hue2rgb(p, q, h),
            hue2rgb(p, q, h - 1.0/3.0)
        );
    }

    #define TAP(i, w) color += (texture2D(u_image, v_texCoord + u_step * i) + texture2D(u_image, v_texCoord - u_step * i)) * w;

    void main() {
        vec4 color = texture2D(u_image, v_texCoord);
        TAP(1.0,  0.99384664)
        TAP(2.0,  0.97561821)
        TAP(3.0,  0.94595947)
        TAP(4.0,  0.90600021)
        TAP(5.0,  0.85700465)
        TAP(6.0,  0.80073740)
        TAP(7.0,  0.73899471)
        TAP(8.0,  0.67364818)
        TAP(9.0,  0.60653066)
        TAP(10.0, 0.53939589)
        TAP(11.0, 0.47382299)
        TAP(12.0, 0.41111229)
        TAP(13.0, 0.35232760)
        TAP(14.0, 0.29824286)

        vec3 c = color.rgb * 0.049636453;
        
        float noise = interleavedGradientNoise(gl_FragCoord.xy);
        c += (noise - 0.5) / 255.0;

        c *= u_brightness;
        float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(luma), c, u_saturate);
        c = (c - 0.5) * u_contrast + 0.5;
        if (abs(u_hueRotate) > 0.0001) {
            vec3 hsl = rgb2hsl(clamp(c, 0.0, 1.0));
            hsl.x = fract(hsl.x + u_hueRotate / 6.28318530718);
            c = hsl2rgb(hsl);
        }
        c = clamp(c, 0.0, 1.0);
        gl_FragColor = vec4(c, u_opacity);
    }
`;

function _parsePostProcess(str, out) {
    out.brightness = 1.0;
    out.saturate = 1.0;
    out.contrast = 1.0;
    out.hueRotate = 0.0;
    out.opacity = 1.0;
    if (!str || !str.trim()) return out;
    const re = /([\w-]+)\(([^)]+)\)/g;
    let m;
    while ((m = re.exec(str)) !== null) {
        const fn = m[1].toLowerCase();
        const raw = m[2].trim();
        const num = parseFloat(raw);
        if (!isNaN(num)) {
            if      (fn === 'brightness') out.brightness = num;
            else if (fn === 'saturate')   out.saturate   = num;
            else if (fn === 'contrast')   out.contrast   = num;
            else if (fn === 'opacity')    out.opacity    = num;
            else if (fn === 'hue-rotate') out.hueRotate  = raw.endsWith('rad') ? num : (num * Math.PI) / 180.0;
        }
    }
    return out;
}

function _readPostParamsFromCSS() {
    if (!blurContainerElem) return;
    const raw = getComputedStyle(blurContainerElem).getPropertyValue('--webgl-post-process');
    _parsePostProcess(raw, _postParams);
    _postParamsDirty = false;
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
    blurHVAO = null;
    blurVPostVAO = null;
    glProgram = null;
    blurHProgram = null;
    blurVPostProgram = null;
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

    canvasDimensions = { width: 0, height: 0 };
    blurDimensions = { width: 0, height: 0 };

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

    if (bgObserver) bgObserver.disconnect();
    bgObserver = new MutationObserver((mutations) => {
        let isDetached = false;
        for (let i = 0; i < mutations.length; i++) {
            const removed = mutations[i].removedNodes;
            for (let j = 0; j < removed.length; j++) {
                const node = removed[j];
                if (node === blurContainerElem || (node.contains && node.contains(blurContainerElem))) {
                    isDetached = true;
                    break;
                }
            }
            if (isDetached) break;
        }

        if (isDetached) {
            checkBg();
        }
    });

    const parent = document.querySelector(LYPLUS_bgConfig.mutationObserverRootSelector) || document.body;
    bgObserver.observe(parent, { childList: true, subtree: true });

    // Enable VAO extension
    vaoExt = gl.getExtension('OES_vertex_array_object');

    webglCanvas.addEventListener('webglcontextlost', handleContextLost, false);
    webglCanvas.addEventListener('webglcontextrestored', handleContextRestored, false);

    // Shader Compilation
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const quadVertexShader = createShader(gl, gl.VERTEX_SHADER, quadVertexShaderSource);
    const mainFragShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    const blurHFragShader = createShader(gl, gl.FRAGMENT_SHADER, blurHFragmentShaderSource);
    const blurVPostFragShader = createShader(gl, gl.FRAGMENT_SHADER, blurVPostFragmentShaderSource);

    if (!vertexShader || !quadVertexShader || !mainFragShader || !blurHFragShader || !blurVPostFragShader) return null;

    glProgram        = createProgram(gl, vertexShader, mainFragShader);
    blurHProgram     = createProgram(gl, quadVertexShader, blurHFragShader);
    blurVPostProgram = createProgram(gl, quadVertexShader, blurVPostFragShader);

    // Locations - Main
    a_main_pos = gl.getAttribLocation(glProgram, 'a_position');
    a_main_tex = gl.getAttribLocation(glProgram, 'a_texCoord');
    u_main_artworkTexture = gl.getUniformLocation(glProgram, 'u_artworkTexture');
    u_main_transitionProgress = gl.getUniformLocation(glProgram, 'u_transitionProgress');
    u_main_layerTransform = gl.getUniformLocation(glProgram, 'u_layerTransform');

    // Locations - Blur H
    a_blurH_pos = gl.getAttribLocation(blurHProgram, 'a_position');
    a_blurH_tex = gl.getAttribLocation(blurHProgram, 'a_texCoord');
    u_blurH_image = gl.getUniformLocation(blurHProgram, 'u_image');
    u_blurH_step = gl.getUniformLocation(blurHProgram, 'u_step');

    // Locations - Blur V + Post-process
    a_blurVPost_pos = gl.getAttribLocation(blurVPostProgram, 'a_position');
    a_blurVPost_tex = gl.getAttribLocation(blurVPostProgram, 'a_texCoord');
    u_blurVPost_image      = gl.getUniformLocation(blurVPostProgram, 'u_image');
    u_blurVPost_step       = gl.getUniformLocation(blurVPostProgram, 'u_step');
    u_blurVPost_brightness = gl.getUniformLocation(blurVPostProgram, 'u_brightness');
    u_blurVPost_saturate   = gl.getUniformLocation(blurVPostProgram, 'u_saturate');
    u_blurVPost_contrast   = gl.getUniformLocation(blurVPostProgram, 'u_contrast');
    u_blurVPost_hueRotate  = gl.getUniformLocation(blurVPostProgram, 'u_hueRotate');
    u_blurVPost_opacity    = gl.getUniformLocation(blurVPostProgram, 'u_opacity');

    // Interleaved Quad Buffer [x, y, u, v]
    quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 0, 0,
         1, -1, 1, 0,
        -1,  1, 0, 1,
        -1,  1, 0, 1,
         1, -1, 1, 0,
         1,  1, 1, 1
    ]), gl.STATIC_DRAW);

    // --- VAO Setup ---
    if (vaoExt) {
        // Main VAO
        mainVAO = vaoExt.createVertexArrayOES();
        vaoExt.bindVertexArrayOES(mainVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.enableVertexAttribArray(a_main_pos);
        gl.vertexAttribPointer(a_main_pos, 2, gl.FLOAT, false, 16, 0);
        gl.enableVertexAttribArray(a_main_tex);
        gl.vertexAttribPointer(a_main_tex, 2, gl.FLOAT, false, 16, 8);
        vaoExt.bindVertexArrayOES(null);

        // Blur H VAO
        blurHVAO = vaoExt.createVertexArrayOES();
        vaoExt.bindVertexArrayOES(blurHVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.enableVertexAttribArray(a_blurH_pos);
        gl.vertexAttribPointer(a_blurH_pos, 2, gl.FLOAT, false, 16, 0);
        gl.enableVertexAttribArray(a_blurH_tex);
        gl.vertexAttribPointer(a_blurH_tex, 2, gl.FLOAT, false, 16, 8);
        vaoExt.bindVertexArrayOES(null);

        // Blur V + Post VAO
        blurVPostVAO = vaoExt.createVertexArrayOES();
        vaoExt.bindVertexArrayOES(blurVPostVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.enableVertexAttribArray(a_blurVPost_pos);
        gl.vertexAttribPointer(a_blurVPost_pos, 2, gl.FLOAT, false, 16, 0);
        gl.enableVertexAttribArray(a_blurVPost_tex);
        gl.vertexAttribPointer(a_blurVPost_tex, 2, gl.FLOAT, false, 16, 8);
        vaoExt.bindVertexArrayOES(null);
    }

    // Read initial post-process params from CSS
    _postParamsDirty = true;

    // Textures & Framebuffers
    currentArtworkTexture = createDefaultTexture();
    previousArtworkTexture = createDefaultTexture();
    renderFramebuffer = gl.createFramebuffer();
    blurFramebuffer = gl.createFramebuffer();

    // Config Textures
    const confTex = (tex) => {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    };

    renderTexture = gl.createTexture(); confTex(renderTexture);
    blurTextureA = gl.createTexture(); confTex(blurTextureA);

    // Attach Textures to Framebuffers
    gl.bindFramebuffer(gl.FRAMEBUFFER, renderFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, renderTexture, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, blurFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, blurTextureA, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    handleResize();
    window.removeEventListener('resize', handleResize);
    window.addEventListener('resize', handleResize, { passive: true });

    startTime = performance.now() / 1000;

    // Visibility observer
    new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
            if (!globalAnimationId) globalAnimationId = requestAnimationFrame(animateWebGLBackground);
        } else {
            if (globalAnimationId) {
                cancelAnimationFrame(globalAnimationId);
                globalAnimationId = null;
            }
        }
    }, { threshold: 0.01 }).observe(webglCanvas);

    return blurContainerElem;
}

function handleResize() {
    if (!gl || !webglCanvas) return;
    const w = 256; const h = 256;
    if (w === canvasDimensions.width && h === canvasDimensions.height) return;

    canvasDimensions.width = w;
    canvasDimensions.height = h;
    webglCanvas.width = w;
    webglCanvas.height = h;
    const downsample = (typeof currentSettings !== 'undefined' && currentSettings.lightweight) ? BLUR_DOWNSAMPLE_LIGHTWEIGHT : BLUR_DOWNSAMPLE;
    blurDimensions.width = Math.max(1, Math.floor(w / downsample));
    blurDimensions.height = Math.max(1, Math.floor(h / downsample));

    // Resize textures
    gl.bindTexture(gl.TEXTURE_2D, renderTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindTexture(gl.TEXTURE_2D, blurTextureA);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, blurDimensions.width, blurDimensions.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
}

function createDefaultTexture() {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([30, 30, 40, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return texture;
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

    let target = NO_ARTWORK_IDENTIFIER;
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
        finalize(createDefaultTexture(), { background: { r: 0, g: 0, b: 0 }, primary: { r: 255, g: 255, b: 255 }, secondary: { r: 200, g: 200, b: 200 } });
        return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
        let pal = (typeof ColorTunes !== 'undefined') ? ColorTunes.getSongPalette(img) : currentTargetMasterArtworkPalette;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        finalize(tex, pal);
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

    const elapsed = timestamp - lastDrawTime;
    if (elapsed < FRAME_INTERVAL) {
        globalAnimationId = requestAnimationFrame(animateWebGLBackground);
        return;
    }
    const elapsedSec = Math.min(elapsed / 1000.0, 0.1);
    lastDrawTime = timestamp - (elapsed % FRAME_INTERVAL);

    const currentTime = lastDrawTime / 1000 - startTime;

    const isTransitioning = artworkTransitionProgress < 1.0;
    if (isTransitioning) {
        artworkTransitionProgress = Math.min(1.0, artworkTransitionProgress + ARTWORK_TRANSITION_SPEED * 1.5);
        if (artworkTransitionProgress >= 1.0) needsAnimation = false;
    }

    processAudioPulse();
    const pulse = LYPLUS_audioState?.beatPulse ?? 0;
    const isLightweight = typeof currentSettings !== 'undefined' && currentSettings.lightweight;

    const shouldRender =
        typeof currentSettings === 'undefined' ||
        !currentSettings.lightweight ||
        isTransitioning ||
        needsAnimation ||
        (currentSettings.audioBeatSync && pulse > 0.001);

    if (!shouldRender) {
        globalAnimationId = null;
        return;
    }

    beatEnergyBaseline += (pulse - beatEnergyBaseline) * Math.min(1.0, 0.8 * elapsedSec);
    const relativePulse = Math.max(0, pulse - beatEnergyBaseline);

    // Precalculate transform state for all 3 layers once per frame
    if (isLightweight) {
        for (let i = 0; i < 3; i++) {
            _cachedLayerRots[i] = 0.0;
            _cachedLayerScales[i] = LAYER_SCALES[i];
            _cachedLayerPosX[i] = 0.0;
            _cachedLayerPosY[i] = 0.0;
        }
    } else {
        const attackSpeed = 12.0;
        const decaySpeed  = BEAT_SCALE_DECAY;
        for (let i = 0; i < 3; i++) {
            layerPerimTime[i] += elapsedSec * (1.0 + pulse * BEAT_SPD_BOOST[i]);

            const speed = relativePulse > layerBeatScale[i] ? attackSpeed : decaySpeed;
            const delta = Math.min(1.0, speed * elapsedSec);
            layerBeatScale[i] += (relativePulse - layerBeatScale[i]) * delta;
            layerBeatRot[i]   += (relativePulse - layerBeatRot[i]) * delta;

            const bs = layerBeatScale[i];
            const smoothBS = bs * bs * (3.0 - 2.0 * bs);

            const br = layerBeatRot[i];
            const smoothBR = br * br * (3.0 - 2.0 * br);

            const rot = INITIAL_ROTATIONS[i] + (ROTATION_SPEEDS[i] * currentTime * ROTATION_POWER) + smoothBR * BEAT_ROT_BOOST[i];

            const bx = LAYER_BASE_POSITIONS[i * 2];
            const by = LAYER_BASE_POSITIONS[i * 2 + 1];

            const offset = i * 0.33;
            const t = ((offset + PERIMETER_DIRECTION[i] * PERIMETER_SPEEDS[i] * layerPerimTime[i]) % 1.0);
            const angle = t * TWO_PI;
            const px = Math.abs(bx) * Math.cos(angle);
            const py = Math.abs(by) * Math.sin(angle);

            _cachedLayerRots[i] = rot;
            _cachedLayerScales[i] = LAYER_SCALES[i] + smoothBS * BEAT_SCALE_BOOST[i];
            _cachedLayerPosX[i] = px;
            _cachedLayerPosY[i] = py;
        }
    }

    // --- PASS 1: Render layered artwork quads to renderFramebuffer ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, renderFramebuffer);
    gl.viewport(0, 0, canvasDimensions.width, canvasDimensions.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(glProgram);

    if (vaoExt) {
        vaoExt.bindVertexArrayOES(mainVAO);
    } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.enableVertexAttribArray(a_main_pos);
        gl.vertexAttribPointer(a_main_pos, 2, gl.FLOAT, false, 16, 0);
        gl.enableVertexAttribArray(a_main_tex);
        gl.vertexAttribPointer(a_main_tex, 2, gl.FLOAT, false, 16, 8);
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(u_main_artworkTexture, 0);

    if (artworkTransitionProgress < 1.0) {
        _renderLayerQuads(previousArtworkTexture, 1.0 - artworkTransitionProgress);
    }
    _renderLayerQuads(currentArtworkTexture, artworkTransitionProgress);

    // --- PASS 2: Horizontal Gaussian Blur (renderTexture -> blurTextureA) ---
    gl.useProgram(blurHProgram);

    if (vaoExt) {
        vaoExt.bindVertexArrayOES(blurHVAO);
    } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.enableVertexAttribArray(a_blurH_pos);
        gl.vertexAttribPointer(a_blurH_pos, 2, gl.FLOAT, false, 16, 0);
        gl.enableVertexAttribArray(a_blurH_tex);
        gl.vertexAttribPointer(a_blurH_tex, 2, gl.FLOAT, false, 16, 8);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, blurFramebuffer);
    gl.viewport(0, 0, blurDimensions.width, blurDimensions.height);
    gl.uniform1i(u_blurH_image, 0);
    // blurRadius * 0.3 = 7 * 0.3 = 2.1
    gl.uniform2f(u_blurH_step, 2.1 / canvasDimensions.width, 0.0);
    gl.bindTexture(gl.TEXTURE_2D, renderTexture);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // --- PASS 3: Vertical Gaussian Blur + Dither Noise + Post-process (blurTextureA -> Screen Canvas) ---
    if (_postParamsDirty) _readPostParamsFromCSS();

    gl.useProgram(blurVPostProgram);

    if (vaoExt) {
        vaoExt.bindVertexArrayOES(blurVPostVAO);
    } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.enableVertexAttribArray(a_blurVPost_pos);
        gl.vertexAttribPointer(a_blurVPost_pos, 2, gl.FLOAT, false, 16, 0);
        gl.enableVertexAttribArray(a_blurVPost_tex);
        gl.vertexAttribPointer(a_blurVPost_tex, 2, gl.FLOAT, false, 16, 8);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvasDimensions.width, canvasDimensions.height);
    gl.bindTexture(gl.TEXTURE_2D, blurTextureA);
    gl.uniform1i(u_blurVPost_image, 0);
    gl.uniform2f(u_blurVPost_step, 0.0, 2.1 / blurDimensions.height);
    gl.uniform1f(u_blurVPost_brightness, _postParams.brightness);
    gl.uniform1f(u_blurVPost_saturate,   _postParams.saturate);
    gl.uniform1f(u_blurVPost_contrast,   _postParams.contrast);
    gl.uniform1f(u_blurVPost_hueRotate,  _postParams.hueRotate);
    gl.uniform1f(u_blurVPost_opacity,    _postParams.opacity);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (vaoExt) vaoExt.bindVertexArrayOES(null);

    // Schedule next frame
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
    const c = currentTargetMasterArtworkPalette?.primary || { r: 255, g: 255, b: 255 };
    return { r: c.r, g: c.g, b: c.b, a: 255 };
}

window.addEventListener('message', (event) => {
    if (event.source === window && event.data?.type === 'LYPLUS_updateFullScreenAnimatedBg') {
        const el = LYPLUS_bgConfig.artworkSelector ? document.querySelector(LYPLUS_bgConfig.artworkSelector) : null;
        checkBg();
        const targetUrl = event.data?.artworkUrl || (el ? el.src : null);
        LYPLUS_requestProcessNewArtwork(targetUrl);
    }

    if (event.source === window && event.data?.type === 'LYPLUS_reattachBg') {
        checkBg();
    }
});