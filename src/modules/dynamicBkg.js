// --- WebGL & Animation State Variables ---
let gl = null;
let glProgram = null; // For rendering the initial grid
let updateStateProgram = null; // For GPGPU state updates
let blurProgram = null; // For the high-performance Gaussian blur
let webglCanvas = null;

// Uniform locations
let u_paletteTextureLocation, u_cellStateTextureLocation, u_songPaletteTransitionProgressLocation;
let u_update_currentStateTextureLocation, u_update_deltaTimeLocation, u_update_randomLocation;
let u_blur_imageLocation, u_blur_resolutionLocation, u_blur_directionLocation;
let a_positionLocation, a_update_positionLocation, a_blur_positionLocation;

// WebGL objects
let positionBuffer;
let paletteTexture = null;
let stateTextureA = null; // Ping-pong texture for cell state
let stateTextureB = null; // Pong

// Framebuffers and textures for multi-pass rendering
let cellStateFramebuffer = null;
let renderFramebuffer = null;
let blurFramebuffer = null;
let renderTexture = null;
let blurTextureA = null;

const BLUR_DOWNSAMPLE_FACTOR = 26;

// Palette and Cell State Constants
const MASTER_PALETTE_TEX_WIDTH = 8;
const MASTER_PALETTE_TEX_HEIGHT = 5;
const MASTER_PALETTE_SIZE = MASTER_PALETTE_TEX_WIDTH * MASTER_PALETTE_TEX_HEIGHT;

// The DATA grid remains 8x5, as you originally had.
const DISPLAY_GRID_WIDTH = 8;
const DISPLAY_GRID_HEIGHT = 5;
const TOTAL_DISPLAY_CELLS = DISPLAY_GRID_WIDTH * DISPLAY_GRID_HEIGHT;

// FIX: Define a 16:9 aspect ratio for the intermediate texture we stretch the 8x5 grid onto.
const STRETCHED_GRID_WIDTH = 32;
const STRETCHED_GRID_HEIGHT = 18;


// Master artwork palettes for transition
let currentTargetMasterArtworkPalette = [];

// Animation speed & progress
const SONG_PALETTE_TRANSITION_SPEED = 0.015;
let songPaletteTransitionProgress = 1.0;
let globalAnimationId = null;
let lastFrameTime = 0;

// Artwork processing state
let isProcessingArtwork = false;
let pendingArtworkUrl = null;
let currentProcessingArtworkIdentifier = null;
let lastAppliedArtworkIdentifier = null;
let artworkCheckTimeoutId = null;
const ARTWORK_RECHECK_DELAY = 300;
const NO_ARTWORK_IDENTIFIER = 'LYPLUS_NO_ARTWORK';
const OVERSAMPLE_GRID_WIDTH = 12;
const OVERSAMPLE_GRID_HEIGHT = 8;


// --- Shader Sources ---

const vertexShaderSource = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_uv = a_position * 0.5 + 0.5;
    }
`;

const updateStateShaderSource = `
    #ifdef GL_ES
    precision mediump float;
    #endif
    varying vec2 v_uv;
    uniform sampler2D u_currentStateTexture;
    uniform float u_deltaTime;
    uniform vec2 u_random;
    const int TOTAL_MASTER_COLORS_CONST = ${MASTER_PALETTE_SIZE};
    const float NORMALIZER = float(TOTAL_MASTER_COLORS_CONST - 1);
    const float SPEED_MULTIPLIER = 10.0;
    float random(vec2 st) {
        return fract(sin(dot(st, vec2(12.9898, 78.233))) * 43758.5453123);
    }
    void main() {
        vec4 currentState = texture2D(u_currentStateTexture, v_uv);
        float sourceIdx_norm = currentState.r;
        float targetIdx_norm = currentState.g;
        float progress = currentState.b;
        float speed_packed = currentState.a;
        float speed = speed_packed * SPEED_MULTIPLIER;
        if (speed == 0.0) {
            speed = (random(v_uv) * 0.5 + 0.5) * 0.012;
        }
        progress += speed * u_deltaTime;
        if (progress >= 1.0) {
            progress = fract(progress);
            sourceIdx_norm = targetIdx_norm;
            vec2 seed = vec2(targetIdx_norm * 255.0, progress * 100.0) + u_random;
            float newTargetIdx_float = floor(random(seed) * float(TOTAL_MASTER_COLORS_CONST));
            if (TOTAL_MASTER_COLORS_CONST > 1) {
                 if(newTargetIdx_float/NORMALIZER == sourceIdx_norm) {
                    newTargetIdx_float = mod(newTargetIdx_float + 1.0, float(TOTAL_MASTER_COLORS_CONST));
                 }
                 targetIdx_norm = newTargetIdx_float / NORMALIZER;
            }
            speed = (random(seed + v_uv) * 0.5 + 0.5) * 0.48;
        }
        gl_FragColor = vec4(sourceIdx_norm, targetIdx_norm, progress, speed / SPEED_MULTIPLIER);
    }
`;

const fragmentShaderSource = `
    #ifdef GL_ES
    precision mediump float;
    #endif
    const int MASTER_PALETTE_TEX_WIDTH_CONST = ${MASTER_PALETTE_TEX_WIDTH};
    const int MASTER_PALETTE_TEX_HEIGHT_CONST = ${MASTER_PALETTE_TEX_HEIGHT * 2};
    const int SINGLE_PALETTE_HEIGHT_CONST = ${MASTER_PALETTE_TEX_HEIGHT};
    const int TOTAL_MASTER_COLORS_CONST = ${MASTER_PALETTE_SIZE};
    uniform sampler2D u_paletteTexture;
    uniform sampler2D u_cellStateTexture;
    uniform float u_songPaletteTransitionProgress;
    varying vec2 v_uv;
    vec4 getColorFromMasterPalette(int index, float y_offset) {
        index = int(clamp(float(index), 0.0, float(TOTAL_MASTER_COLORS_CONST - 1)));
        float texY_row = floor(float(index) / float(MASTER_PALETTE_TEX_WIDTH_CONST));
        float texX_col = mod(float(index), float(MASTER_PALETTE_TEX_WIDTH_CONST));
        float u = (texX_col + 0.5) / float(MASTER_PALETTE_TEX_WIDTH_CONST);
        float v = (texY_row + y_offset + 0.5) / float(MASTER_PALETTE_TEX_HEIGHT_CONST);
        return texture2D(u_paletteTexture, vec2(u, v));
    }
    void main() {
        vec4 cellStateEncoded = texture2D(u_cellStateTexture, v_uv);
        float normalizer = float(TOTAL_MASTER_COLORS_CONST - 1);
        if (normalizer < 1.0) normalizer = 1.0;
        int sourceColorIndex = int(cellStateEncoded.r * normalizer + 0.5);
        int targetColorIndex = int(cellStateEncoded.g * normalizer + 0.5);
        float fadeProgress = cellStateEncoded.b;
        vec4 prevPalette_source = getColorFromMasterPalette(sourceColorIndex, 0.0);
        vec4 targetPalette_source = getColorFromMasterPalette(sourceColorIndex, float(SINGLE_PALETTE_HEIGHT_CONST));
        vec4 colorA = mix(prevPalette_source, targetPalette_source, u_songPaletteTransitionProgress);
        vec4 prevPalette_target = getColorFromMasterPalette(targetColorIndex, 0.0);
        vec4 targetPalette_target = getColorFromMasterPalette(targetColorIndex, float(SINGLE_PALETTE_HEIGHT_CONST));
        vec4 colorB = mix(prevPalette_target, targetPalette_target, u_songPaletteTransitionProgress);
        gl_FragColor = mix(colorA, colorB, fadeProgress);
    }
`;

const blurFragmentShaderSource = `
    #ifdef GL_ES
    precision mediump float;
    #endif
    varying vec2 v_uv;
    uniform sampler2D u_image;
    uniform vec2 u_resolution;
    uniform vec2 u_direction;
    void main() {
        vec2 texelSize = 1.0 / u_resolution;
        vec3 result = texture2D(u_image, v_uv).rgb * 0.227027;
        result += texture2D(u_image, v_uv + texelSize * u_direction * 1.0).rgb * 0.1945946;
        result += texture2D(u_image, v_uv - texelSize * u_direction * 1.0).rgb * 0.1945946;
        result += texture2D(u_image, v_uv + texelSize * u_direction * 2.0).rgb * 0.1216216;
        result += texture2D(u_image, v_uv - texelSize * u_direction * 2.0).rgb * 0.1216216;
        result += texture2D(u_image, v_uv + texelSize * u_direction * 3.0).rgb * 0.05405405;
        result += texture2D(u_image, v_uv - texelSize * u_direction * 3.0).rgb * 0.05405405;
        result += texture2D(u_image, v_uv + texelSize * u_direction * 4.0).rgb * 0.01621621;
        result += texture2D(u_image, v_uv - texelSize * u_direction * 4.0).rgb * 0.01621621;
        gl_FragColor = vec4(result, 1.0);
    }
`;

// --- WebGL Helper Functions ---
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

function getDefaultMasterPalette() {
    return Array(MASTER_PALETTE_SIZE).fill(null).map((_, i) => {
        const base = 20;
        const variation = (i % 5) * 5;
        return { r: base + variation, g: base + variation, b: base + variation + 10, a: 255 };
    });
}

// --- Main Setup Function ---
function LYPLUS_setupBlurEffect() {
    console.log("LYPLUS: Setting up WebGL with GPU blur...");
    if (typeof currentSettings !== 'undefined' && currentSettings.dynamicPlayer) {
        document.querySelector('#layout')?.classList.add("dynamic-player");
    }

    const existingContainer = document.querySelector('.lyplus-blur-container');
    if (existingContainer) existingContainer.remove();
    const blurContainer = document.createElement('div');
    blurContainer.classList.add('lyplus-blur-container');
    webglCanvas = document.createElement('canvas');
    webglCanvas.id = 'lyplus-webgl-canvas';
    blurContainer.appendChild(webglCanvas);
    (document.querySelector('#layout') || document.body).prepend(blurContainer);

    try {
        const ctxAttribs = { antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false };
        gl = webglCanvas.getContext('webgl', ctxAttribs) || webglCanvas.getContext('experimental-webgl', ctxAttribs);
    } catch (e) { console.error("LYPLUS: WebGL context creation failed.", e); }
    if (!gl) { console.error("LYPLUS: WebGL not supported!"); return null; }

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const displayFragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    const updateStateFragmentShader = createShader(gl, gl.FRAGMENT_SHADER, updateStateShaderSource);
    const blurFragmentShader = createShader(gl, gl.FRAGMENT_SHADER, blurFragmentShaderSource);
    if (!vertexShader || !displayFragmentShader || !updateStateFragmentShader || !blurFragmentShader) return null;

    glProgram = createProgram(gl, vertexShader, displayFragmentShader);
    updateStateProgram = createProgram(gl, vertexShader, updateStateFragmentShader);
    blurProgram = createProgram(gl, vertexShader, blurFragmentShader);
    if (!glProgram || !updateStateProgram || !blurProgram) return null;

    a_positionLocation = gl.getAttribLocation(glProgram, 'a_position');
    u_paletteTextureLocation = gl.getUniformLocation(glProgram, 'u_paletteTexture');
    u_cellStateTextureLocation = gl.getUniformLocation(glProgram, 'u_cellStateTexture');
    u_songPaletteTransitionProgressLocation = gl.getUniformLocation(glProgram, 'u_songPaletteTransitionProgress');

    a_update_positionLocation = gl.getAttribLocation(updateStateProgram, 'a_position');
    u_update_currentStateTextureLocation = gl.getUniformLocation(updateStateProgram, 'u_currentStateTexture');
    u_update_deltaTimeLocation = gl.getUniformLocation(updateStateProgram, 'u_deltaTime');
    u_update_randomLocation = gl.getUniformLocation(updateStateProgram, 'u_random');

    a_blur_positionLocation = gl.getAttribLocation(blurProgram, 'a_position');
    u_blur_imageLocation = gl.getUniformLocation(blurProgram, 'u_image');
    u_blur_resolutionLocation = gl.getUniformLocation(blurProgram, 'u_resolution');
    u_blur_directionLocation = gl.getUniformLocation(blurProgram, 'u_direction');

    positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    const positions = [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

    paletteTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    stateTextureA = createCellStateTexture();
    stateTextureB = createCellStateTexture();
    uploadInitialCellStates(stateTextureA);

    cellStateFramebuffer = gl.createFramebuffer();
    renderFramebuffer = gl.createFramebuffer();
    blurFramebuffer = gl.createFramebuffer();

    renderTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, renderTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // FIX: Initialize the render texture with the 16:9 stretched dimensions.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, STRETCHED_GRID_WIDTH, STRETCHED_GRID_HEIGHT, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    blurTextureA = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, blurTextureA);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const initialPalette = getDefaultMasterPalette();
    currentTargetMasterArtworkPalette = initialPalette.map(c => ({ ...c }));
    updateMasterPaletteTexture(initialPalette, initialPalette);

    window.addEventListener('resize', handleResize, false);
    handleResize();

    if (!globalAnimationId) {
        console.log("LYPLUS: Starting WebGL animation loop.");
        lastFrameTime = performance.now();
        animateWebGLBackground();
    }
    console.log("LYPLUS: WebGL setup complete with GPU blur pipeline.");
    return blurContainer;
}

function handleResize() {
    if (!gl || !webglCanvas) return;

    const displayWidth = webglCanvas.clientWidth;
    const displayHeight = webglCanvas.clientHeight;

    if (webglCanvas.width !== displayWidth || webglCanvas.height !== displayHeight) {
        webglCanvas.width = displayWidth;
        webglCanvas.height = displayHeight;
    }

    const blurWidth = Math.round(displayWidth / BLUR_DOWNSAMPLE_FACTOR);
    const blurHeight = Math.round(displayHeight / BLUR_DOWNSAMPLE_FACTOR);

    gl.bindTexture(gl.TEXTURE_2D, blurTextureA);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, blurWidth, blurHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    console.log(`LYPLUS: Canvas resized to ${displayWidth}x${displayHeight}. Blur texture resized to ${blurWidth}x${blurHeight}.`);
}

// --- Texture Creation/Update Functions ---
function createCellStateTexture() {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    // The state texture remains the original 8x5 data size.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, DISPLAY_GRID_WIDTH, DISPLAY_GRID_HEIGHT, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return texture;
}

function uploadInitialCellStates(texture) {
    if (!gl) return;
    const textureData = new Uint8Array(TOTAL_DISPLAY_CELLS * 4);
    const normalizer = Math.max(1, MASTER_PALETTE_SIZE - 1);
    const CELL_FADE_SPEED_BASE = 0.006;
    const CELL_FADE_SPEED_VARIATION = 0.005;
    for (let i = 0; i < TOTAL_DISPLAY_CELLS; i++) {
        const sourceIdx = Math.floor(Math.random() * MASTER_PALETTE_SIZE);
        let targetIdx = Math.floor(Math.random() * MASTER_PALETTE_SIZE);
        if (MASTER_PALETTE_SIZE > 1) {
            while (targetIdx === sourceIdx) targetIdx = Math.floor(Math.random() * MASTER_PALETTE_SIZE);
        }
        const speed = CELL_FADE_SPEED_BASE + (Math.random() * CELL_FADE_SPEED_VARIATION * 2) - CELL_FADE_SPEED_VARIATION;
        textureData[i * 4 + 0] = Math.round((sourceIdx / normalizer) * 255);
        textureData[i * 4 + 1] = Math.round((targetIdx / normalizer) * 255);
        textureData[i * 4 + 2] = Math.round(Math.random() * 255);
        textureData[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, speed)) * 255);
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, DISPLAY_GRID_WIDTH, DISPLAY_GRID_HEIGHT, 0, gl.RGBA, gl.UNSIGNED_BYTE, textureData);
}

function updateMasterPaletteTexture(previousPalette, targetPalette) {
    if (!gl || !paletteTexture) return;
    const textureWidth = MASTER_PALETTE_TEX_WIDTH;
    const textureHeight = MASTER_PALETTE_TEX_HEIGHT * 2;
    const textureData = new Uint8Array(textureWidth * textureHeight * 4);
    const writePalette = (palette, y_offset) => {
        for (let i = 0; i < MASTER_PALETTE_SIZE; i++) {
            const color = palette[i] || { r: 0, g: 0, b: 0, a: 255 };
            const y = y_offset + Math.floor(i / MASTER_PALETTE_TEX_WIDTH);
            const x = i % MASTER_PALETTE_TEX_WIDTH;
            const idx = (y * textureWidth + x) * 4;
            textureData[idx + 0] = Math.round(color.r);
            textureData[idx + 1] = Math.round(color.g);
            textureData[idx + 2] = Math.round(color.b);
            textureData[idx + 3] = Math.round(color.a);
        }
    };
    writePalette(previousPalette, 0);
    writePalette(targetPalette, MASTER_PALETTE_TEX_HEIGHT);
    gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, textureWidth, textureHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, textureData);
}

// --- Artwork Processing Queue and Update Logic (Unchanged) ---
function LYPLUS_requestProcessNewArtwork(artworkUrlFromEvent) {
    if (!glProgram && !LYPLUS_setupBlurEffect()) {
        console.warn("LYPLUS: WebGL setup failed, cannot process artwork.");
        return;
    }
    if (artworkCheckTimeoutId) {
        clearTimeout(artworkCheckTimeoutId);
        artworkCheckTimeoutId = null;
    }
    let artworkIdentifierToProcess;
    let isPotentiallyTemporary = false;
    if (typeof artworkUrlFromEvent === 'string') {
        const trimmedUrl = artworkUrlFromEvent.trim();
        if (trimmedUrl !== "" && trimmedUrl.startsWith('http')) {
            const baseDomains = ["https://music.youtube.com/", "https://www.youtube.com/"];
            let isJustBaseDomain = baseDomains.some(domain => trimmedUrl === domain);
            if (!isJustBaseDomain) {
                const imagePatterns = /\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i;
                const cdnPattern = /lh3\.googleusercontent\.com|ytimg\.com/i;
                if (imagePatterns.test(trimmedUrl) || cdnPattern.test(trimmedUrl)) {
                    artworkIdentifierToProcess = trimmedUrl;
                } else {
                    artworkIdentifierToProcess = NO_ARTWORK_IDENTIFIER;
                }
            } else {
                isPotentiallyTemporary = true;
                artworkIdentifierToProcess = null;
            }
        } else {
            isPotentiallyTemporary = true;
            artworkIdentifierToProcess = null;
        }
    } else {
        isPotentiallyTemporary = true;
        artworkIdentifierToProcess = null;
    }
    if (isPotentiallyTemporary) {
        artworkCheckTimeoutId = setTimeout(() => {
            artworkCheckTimeoutId = null;
            const artworkElement = document.querySelector('.image.ytmusic-player-bar');
            const currentArtworkSrc = (artworkElement && artworkElement.src && artworkElement.src.trim() !== "") ? artworkElement.src : null;
            LYPLUS_requestProcessNewArtwork(currentArtworkSrc);
        }, ARTWORK_RECHECK_DELAY);
        return;
    }
    if (artworkIdentifierToProcess === null) {
        artworkIdentifierToProcess = NO_ARTWORK_IDENTIFIER;
    }
    if (artworkIdentifierToProcess === lastAppliedArtworkIdentifier && songPaletteTransitionProgress >= 1.0) return;
    if (artworkIdentifierToProcess === currentProcessingArtworkIdentifier || artworkIdentifierToProcess === pendingArtworkUrl) return;
    pendingArtworkUrl = artworkIdentifierToProcess;
    if (!isProcessingArtwork) {
        processNextArtworkFromQueue();
    }
}

function processNextArtworkFromQueue() {
    if (isProcessingArtwork || !pendingArtworkUrl) return;
    isProcessingArtwork = true;
    currentProcessingArtworkIdentifier = pendingArtworkUrl;
    pendingArtworkUrl = null;
    console.log("LYPLUS: Processing artwork/state:", currentProcessingArtworkIdentifier);
    const previousPaletteForTransition = currentTargetMasterArtworkPalette.length === MASTER_PALETTE_SIZE ?
        currentTargetMasterArtworkPalette.map(c => ({ ...c })) :
        getDefaultMasterPalette();
    const finishProcessing = (newTargetPalette) => {
        currentTargetMasterArtworkPalette = newTargetPalette;
        updateMasterPaletteTexture(previousPaletteForTransition, currentTargetMasterArtworkPalette);
        songPaletteTransitionProgress = 0.0;
        lastAppliedArtworkIdentifier = currentProcessingArtworkIdentifier;
        isProcessingArtwork = false;
        currentProcessingArtworkIdentifier = null;
        if (pendingArtworkUrl) {
            processNextArtworkFromQueue();
        }
    };
    if (currentProcessingArtworkIdentifier === NO_ARTWORK_IDENTIFIER) {
        console.log("LYPLUS: No artwork detected. Transitioning to default palette.");
        finishProcessing(getDefaultMasterPalette());
        return;
    }
    const onImageLoadSuccess = (img) => {
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
        tempCanvas.width = OVERSAMPLE_GRID_WIDTH * 10;
        tempCanvas.height = OVERSAMPLE_GRID_HEIGHT * 10;
        try {
            tempCtx.drawImage(img, 0, 0, tempCanvas.width, tempCanvas.height);
        } catch (e) {
            console.error("LYPLUS: Error drawing image to temp canvas.", e);
            onImageLoadError(e);
            return;
        }
        const sampledColors = [];
        const regionImgWidth = Math.floor(tempCanvas.width / OVERSAMPLE_GRID_WIDTH);
        const regionImgHeight = Math.floor(tempCanvas.height / OVERSAMPLE_GRID_HEIGHT);
        for (let y = 0; y < OVERSAMPLE_GRID_HEIGHT; y++) {
            for (let x = 0; x < OVERSAMPLE_GRID_WIDTH; x++) {
                const color = getAverageColor(tempCtx, x * regionImgWidth, y * regionImgHeight, regionImgWidth, regionImgHeight);
                let existingColor = sampledColors.find(c => c.r === color.r && c.g === color.g && c.b === color.b);
                if (existingColor) {
                    existingColor.frequency = (existingColor.frequency || 1) + 1;
                } else {
                    color.frequency = 1;
                    sampledColors.push(color);
                }
            }
        }
        sampledColors.forEach(color => {
            color.saturation = calculateSaturation(color);
            color.luminance = calculateLuminance(color);
            const lumFactor = 1.0 - Math.abs(color.luminance - 0.5) * 1.8;
            const freqNorm = color.frequency / (OVERSAMPLE_GRID_WIDTH * OVERSAMPLE_GRID_HEIGHT);
            color.vibrancy = (color.saturation * 0.7) + (Math.max(0, lumFactor) * 0.15) + (freqNorm * 0.15);
        });
        let sortedCandidates = [...sampledColors].sort((a, b) => b.vibrancy - a.vibrancy);
        const newMasterPalette = [];
        const MIN_COLOR_DIFFERENCE_THRESHOLD = 85;
        for (const candidate of sortedCandidates) {
            if (newMasterPalette.length >= MASTER_PALETTE_SIZE) break;
            if (newMasterPalette.length === 0) {
                newMasterPalette.push(candidate);
                continue;
            }
            let isDifferentEnough = true;
            for (const selectedColor of newMasterPalette) {
                if (calculateColorDifference(candidate, selectedColor) < MIN_COLOR_DIFFERENCE_THRESHOLD) {
                    isDifferentEnough = false;
                    break;
                }
            }
            if (isDifferentEnough) {
                newMasterPalette.push(candidate);
            }
        }
        if (newMasterPalette.length < MASTER_PALETTE_SIZE) {
            const alreadySelectedIdentifiers = new Set(newMasterPalette.map(c => `${c.r}-${c.g}-${c.b}`));
            for (const candidate of sortedCandidates) {
                if (newMasterPalette.length >= MASTER_PALETTE_SIZE) break;
                const candidateIdentifier = `${candidate.r}-${candidate.g}-${candidate.b}`;
                if (!alreadySelectedIdentifiers.has(candidateIdentifier)) {
                    newMasterPalette.push(candidate);
                    alreadySelectedIdentifiers.add(candidateIdentifier);
                }
            }
        }
        while (newMasterPalette.length < MASTER_PALETTE_SIZE) {
            newMasterPalette.push({ r: 20, g: 20, b: 30, a: 255 });
        }
        const finalTargetPalette = newMasterPalette.slice(0, MASTER_PALETTE_SIZE).map(c => ({
            r: c.r, g: c.g, b: c.b, a: c.a !== undefined ? c.a : 255
        }));
        finishProcessing(finalTargetPalette);
    };
    const onImageLoadError = (error) => {
        console.error(`LYPLUS: Error loading/processing image. Using default palette.`, error);
        finishProcessing(getDefaultMasterPalette());
    };
    const imageUrl = currentProcessingArtworkIdentifier;
    if (imageUrl.startsWith('http')) {
        fetch(imageUrl, { mode: 'cors' })
            .then(response => { if (!response.ok) throw new Error(`CORS fetch failed: ${response.status}`); return response.blob(); })
            .then(blob => {
                const img = new Image(); const objectURL = URL.createObjectURL(blob);
                img.onload = () => { onImageLoadSuccess(img); URL.revokeObjectURL(objectURL); };
                img.onerror = (e) => { onImageLoadError(e); URL.revokeObjectURL(objectURL); };
                img.src = objectURL;
            })
            .catch(error => {
                console.warn("LYPLUS: CORS fetch failed, trying img.crossOrigin.", error);
                const img = new Image(); img.crossOrigin = "anonymous";
                img.onload = () => onImageLoadSuccess(img); img.onerror = onImageLoadError;
                img.src = imageUrl;
            });
    } else {
        onImageLoadError("Non-http URL");
    }
}

// --- Animation Loop ---
function animateWebGLBackground() {
    if (!gl || !glProgram) {
        globalAnimationId = null;
        return;
    }

    const now = performance.now();
    const deltaTime = (now - lastFrameTime) / 1000.0;
    lastFrameTime = now;

    // Pass 1: GPGPU Update 8x5 Cell States (A -> B)
    gl.bindFramebuffer(gl.FRAMEBUFFER, cellStateFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, stateTextureB, 0);
    gl.viewport(0, 0, DISPLAY_GRID_WIDTH, DISPLAY_GRID_HEIGHT);
    gl.useProgram(updateStateProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(a_update_positionLocation);
    gl.vertexAttribPointer(a_update_positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stateTextureA);
    gl.uniform1i(u_update_currentStateTextureLocation, 0);
    gl.uniform1f(u_update_deltaTimeLocation, deltaTime);
    gl.uniform2f(u_update_randomLocation, Math.random(), Math.random());
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Swap textures. B has the new state. A is now the old state.
    [stateTextureA, stateTextureB] = [stateTextureB, stateTextureA];

    // Pass 2: Render 8x5 Grid to an Off-screen 16:9 Texture, stretching it.
    gl.bindFramebuffer(gl.FRAMEBUFFER, renderFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, renderTexture, 0);
    // FIX: Set the viewport to the 16:9 texture's dimensions.
    gl.viewport(0, 0, STRETCHED_GRID_WIDTH, STRETCHED_GRID_HEIGHT);
    gl.useProgram(glProgram);
    gl.enableVertexAttribArray(a_positionLocation);
    gl.vertexAttribPointer(a_positionLocation, 2, gl.FLOAT, false, 0, 0);
    if (songPaletteTransitionProgress < 1.0) {
        songPaletteTransitionProgress = Math.min(1.0, songPaletteTransitionProgress + SONG_PALETTE_TRANSITION_SPEED);
    }
    gl.uniform1f(u_songPaletteTransitionProgressLocation, songPaletteTransitionProgress);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
    gl.uniform1i(u_paletteTextureLocation, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, stateTextureA); // Read from newly updated 8x5 state
    gl.uniform1i(u_cellStateTextureLocation, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Pass 3 & 4: Two-Pass Gaussian Blur
    gl.useProgram(blurProgram);
    gl.enableVertexAttribArray(a_blur_positionLocation);
    gl.vertexAttribPointer(a_blur_positionLocation, 2, gl.FLOAT, false, 0, 0);
    const blurWidth = Math.round(gl.canvas.width / BLUR_DOWNSAMPLE_FACTOR);
    const blurHeight = Math.round(gl.canvas.height / BLUR_DOWNSAMPLE_FACTOR);

    // Pass 3: Horizontal Blur (stretched texture -> blurTextureA)
    gl.bindFramebuffer(gl.FRAMEBUFFER, blurFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, blurTextureA, 0);
    gl.viewport(0, 0, blurWidth, blurHeight);
    gl.uniform2f(u_blur_directionLocation, 1.0, 0.0);
    // FIX: The blur shader's source is now the 16:9 stretched texture.
    gl.uniform2f(u_blur_resolutionLocation, STRETCHED_GRID_WIDTH, STRETCHED_GRID_HEIGHT);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, renderTexture);
    gl.uniform1i(u_blur_imageLocation, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Pass 4: Vertical Blur & Render to Screen (blurTextureA -> Canvas)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.uniform2f(u_blur_directionLocation, 0.0, 1.0);
    gl.uniform2f(u_blur_resolutionLocation, blurWidth, blurHeight);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, blurTextureA);
    gl.uniform1i(u_blur_imageLocation, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    globalAnimationId = requestAnimationFrame(animateWebGLBackground);
}


// --- Helper Functions (Color Math etc.) ---
function calculateLuminance(color) {
    const a = [color.r, color.g, color.b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}
function getAverageColor(ctx, x, y, width, height) {
    if (width <= 0 || height <= 0) return { r: 0, g: 0, b: 0, a: 0 };
    try {
        const imageData = ctx.getImageData(x, y, Math.max(1, width), Math.max(1, height));
        const data = imageData.data;
        let r = 0, g = 0, b = 0;
        const pixelCount = data.length / 4;
        if (pixelCount === 0) return { r: 0, g: 0, b: 0, a: 255 };
        for (let i = 0; i < data.length; i += 4) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
        }
        return {
            r: Math.round(r / pixelCount),
            g: Math.round(g / pixelCount),
            b: Math.round(b / pixelCount),
            a: 255
        };
    } catch (e) {
        console.error("LYPLUS: Error in getAverageColor:", e, { x, y, width, height });
        return { r: 0, g: 0, b: 0, a: 255 };
    }
}
function calculateSaturation(color) {
    const r_norm = color.r / 255; const g_norm = color.g / 255; const b_norm = color.b / 255;
    const max = Math.max(r_norm, g_norm, b_norm); const min = Math.min(r_norm, g_norm, b_norm);
    const delta = max - min;
    if (delta < 0.00001 || max < 0.00001) return 0;
    return delta / max;
}
function calculateColorDifference(color1, color2) {
    const c1 = color1 || { r: 0, g: 0, b: 0 }; const c2 = color2 || { r: 0, g: 0, b: 0 };
    return Math.abs(c1.r - c2.r) + Math.abs(c1.g - c2.g) + Math.abs(c1.b - c2.b);
}

// --- Event Listener to Trigger Update ---
window.addEventListener('message', (event) => {
    if (event.source === window && event.data && event.data.type === 'LYPLUS_updateFullScreenAnimatedBg') {
        const artworkElement = document.querySelector('.image.ytmusic-player-bar');
        const artworkUrl = (artworkElement && artworkElement.src && artworkElement.src.trim() !== "") ? artworkElement.src : null;
        LYPLUS_requestProcessNewArtwork(artworkUrl);
    }
});