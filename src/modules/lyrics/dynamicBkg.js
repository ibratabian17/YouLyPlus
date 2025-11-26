// --- WebGL & Animation State Variables ---
let gl = null;
let glProgram = null;
let blurProgram = null;
let webglCanvas = null;
let needsAnimation = false;

// Uniform locations
let u_artworkTextureLocation, u_rotationLocation, u_scaleLocation, u_positionLocation, u_transitionProgressLocation;
let u_blur_imageLocation, u_blur_resolutionLocation, u_blur_directionLocation, u_blur_radiusLocation;
let a_positionLocation, a_texCoordLocation, a_blur_positionLocation;

// WebGL objects
let positionBuffer;
let texCoordBuffer;
let currentArtworkTexture = null;
let previousArtworkTexture = null;

// Framebuffers and textures for multi-pass rendering
let renderFramebuffer = null;
let blurFramebuffer = null;
let renderTexture = null;
let blurTextureA = null;


function handleContextLost(event) {
    event.preventDefault();
    console.warn("LYPLUS: WebGL context lost. Attempting to restore...");
    if (globalAnimationId) {
        cancelAnimationFrame(globalAnimationId);
        globalAnimationId = null;
    }
    // Clean up WebGL resources
    gl = null;
    glProgram = null;
    blurProgram = null;
    currentArtworkTexture = null;
    previousArtworkTexture = null;
    renderFramebuffer = null;
    blurFramebuffer = null;
    renderTexture = null;
    blurTextureA = null;
    positionBuffer = null;
    texCoordBuffer = null;
}

function handleContextRestored() {
    console.log("LYPLUS: WebGL context restored. Re-initializing...");
    LYPLUS_setupBlurEffect();
}

let blurDimensions = { width: 0, height: 0 };
let canvasDimensions = { width: 0, height: 0 };

const BLUR_DOWNSAMPLE = 1; // The factor by which to reduce the canvas resolution for the blur pass.
const BLUR_RADIUS = 6; // Controls the radius/intensity of the blur.

// Palette Constants
const MASTER_PALETTE_TEX_WIDTH = 8;
const MASTER_PALETTE_TEX_HEIGHT = 5;
const MASTER_PALETTE_SIZE = MASTER_PALETTE_TEX_WIDTH * MASTER_PALETTE_TEX_HEIGHT;

const STRETCHED_GRID_WIDTH = 128;
const STRETCHED_GRID_HEIGHT = 128;

let currentTargetMasterArtworkPalette = [];

const TARGET_FPS = 30;
const FRAME_INTERVAL = 1000 / TARGET_FPS;
let lastDrawTime = 0;

// Animation & rotation
const ROTATION_SPEEDS = [0.10, 0.18, 0.32]; // radians per second for each layer
const ROTATION_POWER = 0.8
let rotations = [0.3, -2.1, 2.4];
let previousRotations = [0, 0, 0];
const LAYER_SCALES = [1.4, 1.26, 1.26];
const LAYER_POSITIONS = [
    { x: 0, y: 0 },
    { x: 0.75, y: -0.75 },
    { x: -0.75, y: 0.75 },
];
const BASE_LAYER_POSITIONS = LAYER_POSITIONS.map(p => ({ x: p.x, y: p.y }));
let currentLayerPositions = BASE_LAYER_POSITIONS.map(p => ({ x: p.x, y: p.y }));
let perimeterOffsets = null;
const PERIMETER_SPEEDS = [0.09, 0.012, 0.02];
const PERIMETER_DIRECTION = [-1, 1, 1];

// Transition
const ARTWORK_TRANSITION_SPEED = 0.02;
let artworkTransitionProgress = 1.0;
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

// --- Shader Sources ---

const vertexShaderSource = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;
    varying vec2 v_uv;
    void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
        v_uv = a_position * 0.5 + 0.5;
    }
`;

const fragmentShaderSource = `
    #ifdef GL_ES
    precision mediump float;
    #endif
    varying vec2 v_texCoord;
    varying vec2 v_uv;
    uniform sampler2D u_artworkTexture;
    uniform float u_rotation;
    uniform float u_scale;
    uniform vec2 u_position;
    uniform float u_transitionProgress;
    
    vec2 rotate(vec2 v, float angle) {
        float s = sin(angle);
        float c = cos(angle);
        return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
    }
    
    void main() {
        vec2 centered = v_uv - 0.5;
        centered.y = -centered.y; // betulin flip
        centered -= u_position;
        centered = rotate(centered, -u_rotation); // betulin arah rotasi
        centered /= u_scale;
        centered += 0.5;

        if (centered.x < 0.0 || centered.x > 1.0 || centered.y < 0.0 || centered.y > 1.0) {
            discard;
        } else {
            vec4 color = texture2D(u_artworkTexture, centered);
            gl_FragColor = vec4(color.rgb, color.a * u_transitionProgress);
        }
}
`;

const blurFragmentShaderSource = `
    #ifdef GL_ES
    precision highp float;
    #endif

    varying vec2 v_uv;
    uniform sampler2D u_image;
    uniform vec2 u_resolution;
    uniform vec2 u_direction;
    uniform float u_blurRadius;

    const int SAMPLES = 40;
    const int HALF = SAMPLES / 2;

    float interleavedGradientNoise(vec2 uv) {
        vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
        return fract(magic.z * fract(dot(uv, magic.xy)));
    }

    void main() {
        vec2 texelSize = 1.0 / u_resolution;
        
        vec2 step = u_direction * texelSize * (u_blurRadius * 0.3);

        vec3 color = vec3(0.0);
        float totalWeight = 0.0;

        float sigma = float(HALF) * 0.45; 
        float k = 2.0 * sigma * sigma;

        for (int i = -HALF; i <= HALF; ++i) {
            float f = float(i);
            float w = exp(-(f * f) / k);
            
            color += texture2D(u_image, v_uv + (step * f)).rgb * w;
            totalWeight += w;
        }

        vec3 finalColor = color / totalWeight;

        float noise = interleavedGradientNoise(gl_FragCoord.xy);
        finalColor += (noise - 0.5) / 255.0;

        gl_FragColor = vec4(finalColor, 1.0);
    }
`;

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
        const ctxAttribs = { antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, alpha: false };
        gl = webglCanvas.getContext('webgl', ctxAttribs) || webglCanvas.getContext('experimental-webgl', ctxAttribs);
    } catch (e) { console.error("LYPLUS: WebGL context creation failed.", e); }
    if (!gl) { console.error("LYPLUS: WebGL not supported!"); return null; }

    webglCanvas.addEventListener('webglcontextlost', handleContextLost, false);
    webglCanvas.addEventListener('webglcontextrestored', handleContextRestored, false);

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const displayFragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    const blurFragmentShader = createShader(gl, gl.FRAGMENT_SHADER, blurFragmentShaderSource);
    if (!vertexShader || !displayFragmentShader || !blurFragmentShader) return null;

    glProgram = createProgram(gl, vertexShader, displayFragmentShader);
    blurProgram = createProgram(gl, vertexShader, blurFragmentShader);
    if (!glProgram || !blurProgram) return null;

    a_positionLocation = gl.getAttribLocation(glProgram, 'a_position');
    a_texCoordLocation = gl.getAttribLocation(glProgram, 'a_texCoord');
    u_artworkTextureLocation = gl.getUniformLocation(glProgram, 'u_artworkTexture');
    u_rotationLocation = gl.getUniformLocation(glProgram, 'u_rotation');
    u_scaleLocation = gl.getUniformLocation(glProgram, 'u_scale');
    u_positionLocation = gl.getUniformLocation(glProgram, 'u_position');
    u_transitionProgressLocation = gl.getUniformLocation(glProgram, 'u_transitionProgress');

    a_blur_positionLocation = gl.getAttribLocation(blurProgram, 'a_position');
    u_blur_imageLocation = gl.getUniformLocation(blurProgram, 'u_image');
    u_blur_resolutionLocation = gl.getUniformLocation(blurProgram, 'u_resolution');
    u_blur_directionLocation = gl.getUniformLocation(blurProgram, 'u_direction');
    u_blur_radiusLocation = gl.getUniformLocation(blurProgram, 'u_blurRadius');

    positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    const positions = [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

    texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    const texCoords = [0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texCoords), gl.STATIC_DRAW);

    currentArtworkTexture = createDefaultTexture();
    previousArtworkTexture = createDefaultTexture();

    renderFramebuffer = gl.createFramebuffer();
    blurFramebuffer = gl.createFramebuffer();

    renderTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, renderTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    blurTextureA = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, blurTextureA);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const initialPalette = getDefaultMasterPalette();
    currentTargetMasterArtworkPalette = initialPalette.map(c => ({ ...c }));

    handleResize();
    window.addEventListener('resize', handleResize, { passive: true });

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MIN_SRC_ALPHA);

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                if (!globalAnimationId) {
                    console.log("LYPLUS: Canvas is visible, starting animation.");
                    lastFrameTime = performance.now();
                    globalAnimationId = requestAnimationFrame(animateWebGLBackground);
                }
            } else {
                if (globalAnimationId) {
                    console.log("LYPLUS: Canvas is not visible, stopping animation.");
                    cancelAnimationFrame(globalAnimationId);
                    globalAnimationId = null;
                }
            }
        });
    }, { threshold: 0.01 });

    observer.observe(webglCanvas);
    return blurContainer;
}

function handleResize() {
    if (!gl || !webglCanvas) return;

    const displayWidth = 256; 
    const displayHeight = 256;

    if (displayWidth === canvasDimensions.width && displayHeight === canvasDimensions.height) {
        return false;
    }

    canvasDimensions.width = displayWidth;
    canvasDimensions.height = displayHeight;

    webglCanvas.width = canvasDimensions.width;
    webglCanvas.height = canvasDimensions.height;

    blurDimensions.width = Math.round(canvasDimensions.width / BLUR_DOWNSAMPLE);
    blurDimensions.height = Math.round(canvasDimensions.height / BLUR_DOWNSAMPLE);

    gl.bindTexture(gl.TEXTURE_2D, renderTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvasDimensions.width, canvasDimensions.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    gl.bindTexture(gl.TEXTURE_2D, blurTextureA);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, blurDimensions.width, blurDimensions.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    gl.viewport(0, 0, canvasDimensions.width, canvasDimensions.height);

    return true;
}

function createDefaultTexture() {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const size = 2;
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < data.length; i += 4) {
        data[i] = 30;
        data[i + 1] = 30;
        data[i + 2] = 40;
        data[i + 3] = 255;
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return texture;
}

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
    if (artworkIdentifierToProcess === lastAppliedArtworkIdentifier && artworkTransitionProgress >= 1.0) return;
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

    const finishProcessing = (newTexture, newPalette) => {
        if (previousArtworkTexture && previousArtworkTexture !== currentArtworkTexture) {
            gl.deleteTexture(previousArtworkTexture);
        }
        previousArtworkTexture = currentArtworkTexture;
        currentArtworkTexture = newTexture;
        currentTargetMasterArtworkPalette = newPalette;

        previousRotations = [...rotations];

        artworkTransitionProgress = 0.0;
        needsAnimation = true;

        if (!globalAnimationId) {
            lastFrameTime = performance.now();
            globalAnimationId = requestAnimationFrame(animateWebGLBackground);
        }

        lastAppliedArtworkIdentifier = currentProcessingArtworkIdentifier;
        isProcessingArtwork = false;
        currentProcessingArtworkIdentifier = null;
        if (pendingArtworkUrl) {
            processNextArtworkFromQueue();
        }
    };

    if (currentProcessingArtworkIdentifier === NO_ARTWORK_IDENTIFIER) {
        console.log("LYPLUS: No artwork detected. Using default.");
        const defaultTexture = createDefaultTexture();
        finishProcessing(defaultTexture, getDefaultMasterPalette());
        return;
    }

    const onImageLoadSuccess = (img) => {
        const palette = extractPaletteFromImage(img);
        const texture = createTextureFromImage(img);
        finishProcessing(texture, palette);
    };

    const onImageLoadError = (error) => {
        console.error(`LYPLUS: Error loading image. Using default.`, error);
        const defaultTexture = createDefaultTexture();
        finishProcessing(defaultTexture, getDefaultMasterPalette());
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

function createTextureFromImage(img) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    return texture;
}

function extractPaletteFromImage(img) {
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });

    tempCanvas.width = STRETCHED_GRID_WIDTH;
    tempCanvas.height = STRETCHED_GRID_HEIGHT;

    try {
        tempCtx.drawImage(img, 0, 0, STRETCHED_GRID_WIDTH, STRETCHED_GRID_HEIGHT);
    } catch (e) {
        console.error("LYPLUS: Error drawing image for palette extraction.", e);
        return getDefaultMasterPalette();
    }

    const palette = [];
    const cellW = STRETCHED_GRID_WIDTH / MASTER_PALETTE_TEX_WIDTH;
    const cellH = STRETCHED_GRID_HEIGHT / MASTER_PALETTE_TEX_HEIGHT;

    for (let j = 0; j < MASTER_PALETTE_TEX_HEIGHT; j++) {
        for (let i = 0; i < MASTER_PALETTE_TEX_WIDTH; i++) {
            const x = Math.floor(i * cellW);
            const y = Math.floor(j * cellH);
            const w = Math.ceil(cellW);
            const h = Math.ceil(cellH);

            const c = getAverageColor(tempCtx, x, y, w, h);
            palette.push({
                r: c.r,
                g: c.g,
                b: c.b,
                a: c.a !== undefined ? c.a : 255
            });
        }
    }

    return palette.slice(0, MASTER_PALETTE_SIZE);
}

function basePosToPerimeterOffset(xBase, yBase, margin = 0.5) {
    const m = Math.max(0.0001, margin);
    const nx = xBase / m;
    const ny = yBase / m;
    const cx = Math.max(-1, Math.min(1, nx));
    const cy = Math.max(-1, Math.min(1, ny));

    if (Math.abs(cy) === 1 && Math.abs(cx) <= 1) {
        if (cy < 0) {
            return ((cx + 1) / 2) * 0.25;
        } else {
            return 0.5 + ((1 - cx) / 2) * 0.25;
        }
    } else {
        if (cx > 0) {
            return 0.25 + ((cy + 1) / 2) * 0.25;
        } else {
            return 0.75 + ((1 - cy) / 2) * 0.25;
        }
    }
}

function perimeterTtoUnitXY(t) {
    t = ((t % 1) + 1) % 1;
    const p = t * 4.0;
    const seg = Math.floor(p);
    const local = p - seg;
    const R = 1.0;
    switch (seg) {
        case 0: // top: left -> right
            return { x: -R + local * 2 * R, y: -R };
        case 1: // right: top -> bottom
            return { x: R, y: -R + local * 2 * R };
        case 2: // bottom: right -> left
            return { x: R - local * 2 * R, y: R };
        case 3: // left: bottom -> top
        default:
            return { x: -R, y: R - local * 2 * R };
    }
}

function updateLayerPerimeterPositions(deltaTime) {
    if (!perimeterOffsets) {
        perimeterOffsets = new Array(BASE_LAYER_POSITIONS.length).fill(0.0);
        for (let i = 0; i < BASE_LAYER_POSITIONS.length; i++) {
            const base = BASE_LAYER_POSITIONS[i] || { x: 0, y: 0 };
            const margin = Math.max(Math.abs(base.x || 0), Math.abs(base.y || 0), 0.0001);
            perimeterOffsets[i] = Math.random(); 
            if (!currentLayerPositions[i]) currentLayerPositions[i] = { x: base.x, y: base.y };
            else { currentLayerPositions[i].x = base.x; currentLayerPositions[i].y = base.y; }
        }
    }

    for (let i = 0; i < BASE_LAYER_POSITIONS.length; i++) {
        const base = BASE_LAYER_POSITIONS[i];
        const radiusX = Math.abs(base.x);
        const radiusY = Math.abs(base.y);

        const speed = PERIMETER_SPEEDS[i] !== undefined ? PERIMETER_SPEEDS[i] : 0.05;
        const dir = PERIMETER_DIRECTION[i] !== undefined ? PERIMETER_DIRECTION[i] : 1;

        perimeterOffsets[i] = (perimeterOffsets[i] + dir * speed * deltaTime);
        if (perimeterOffsets[i] > 1.0) perimeterOffsets[i] -= 1.0; 

        const angle = perimeterOffsets[i] * 2.0 * Math.PI;

        const newX = radiusX * Math.cos(angle);
        const newY = radiusY * Math.sin(angle);

        currentLayerPositions[i].x = newX;
        currentLayerPositions[i].y = newY;
    }
}


function animateWebGLBackground() {
    if (!gl || !glProgram || !blurProgram) {
        globalAnimationId = null;
        return;
    }
    const now = performance.now();
    const elapsed = now - lastDrawTime;
    
    if (elapsed < FRAME_INTERVAL) {
        globalAnimationId = requestAnimationFrame(animateWebGLBackground);
        return;
    }

    const deltaTime = (now - lastFrameTime) / 1000.0;
    lastFrameTime = now;

    if (artworkTransitionProgress < 1.0) {
        artworkTransitionProgress = Math.min(1.0, artworkTransitionProgress + ARTWORK_TRANSITION_SPEED);
        if (artworkTransitionProgress >= 1.0) {
            needsAnimation = false;
        }
    }

    let shouldContinueAnimation;
    if (typeof currentSettings !== 'undefined' && currentSettings.lightweight === true) {
        shouldContinueAnimation = needsAnimation;
    } else {
        shouldContinueAnimation = true;
    }

    for (let i = 0; i < 3; i++) {
        rotations[i] += (ROTATION_SPEEDS[i] * deltaTime) * ROTATION_POWER;
    }

    updateLayerPerimeterPositions(deltaTime);

    gl.bindFramebuffer(gl.FRAMEBUFFER, renderFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, renderTexture, 0);
    gl.viewport(0, 0, canvasDimensions.width, canvasDimensions.height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(glProgram);

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(a_positionLocation);
    gl.vertexAttribPointer(a_positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.enableVertexAttribArray(a_texCoordLocation);
    gl.vertexAttribPointer(a_texCoordLocation, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(u_artworkTextureLocation, 0);

    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    for (let i = 0; i < 3; i++) {
        // Render previous artwork (fading out) with its old rotation
        if (artworkTransitionProgress < 1.0) {
            gl.bindTexture(gl.TEXTURE_2D, previousArtworkTexture);
            gl.uniform1f(u_rotationLocation, previousRotations[i]);
            gl.uniform1f(u_scaleLocation, LAYER_SCALES[i]);
            gl.uniform2f(u_positionLocation, currentLayerPositions[i].x, currentLayerPositions[i].y);
            gl.uniform1f(u_transitionProgressLocation, 1.0 - artworkTransitionProgress);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }

        // Render current artwork (fading in) with current rotation
        gl.bindTexture(gl.TEXTURE_2D, currentArtworkTexture);
        gl.uniform1f(u_rotationLocation, rotations[i]);
        gl.uniform1f(u_scaleLocation, LAYER_SCALES[i]);
        gl.uniform2f(u_positionLocation, currentLayerPositions[i].x, currentLayerPositions[i].y);
        gl.uniform1f(u_transitionProgressLocation, artworkTransitionProgress);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    // Restore normal blending for blur passes
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(blurProgram);
    gl.uniform1f(u_blur_radiusLocation, BLUR_RADIUS);

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(a_blur_positionLocation);
    gl.vertexAttribPointer(a_blur_positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, blurFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, blurTextureA, 0);
    gl.viewport(0, 0, blurDimensions.width, blurDimensions.height);
    gl.uniform2f(u_blur_directionLocation, 1.0, 0.0);
    gl.uniform2f(u_blur_resolutionLocation, canvasDimensions.width, canvasDimensions.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, renderTexture);
    gl.uniform1i(u_blur_imageLocation, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvasDimensions.width, canvasDimensions.height);
    gl.uniform2f(u_blur_directionLocation, 0.0, 1.0);
    gl.uniform2f(u_blur_resolutionLocation, blurDimensions.width, blurDimensions.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, blurTextureA);
    gl.uniform1i(u_blur_imageLocation, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (shouldContinueAnimation) {
        globalAnimationId = requestAnimationFrame(animateWebGLBackground);
    } else {
        globalAnimationId = null;
    }
}

function calculateLuminance(color) {
    const a = [color.r, color.g, color.b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

function boostSaturation(r, g, b, factor = 1.2) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
        h = s = 0;
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }

    s = Math.min(1, s * factor);

    function hue2rgb(p, q, t) {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    }

    let r2, g2, b2;
    if (s === 0) {
        r2 = g2 = b2 = l;
    } else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r2 = hue2rgb(p, q, h + 1 / 3);
        g2 = hue2rgb(p, q, h);
        b2 = hue2rgb(p, q, h - 1 / 3);
    }

    return [Math.round(r2 * 255), Math.round(g2 * 255), Math.round(b2 * 255)];
}

function getAverageColor(ctx, x, y, w, h) {
    const imageData = ctx.getImageData(x, y, w, h);
    const data = imageData.data;

    let totalR = 0, totalG = 0, totalB = 0, totalCount = 0;
    const samples = [];

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        if (a < 128) continue;

        const color = { r, g, b, a };
        color.saturation = calculateSaturation(color);
        color.luminance = calculateLuminance(color);
        const lumFactor = 1.0 - Math.abs(color.luminance - 0.5) * 1.8;
        color.vibrancy = (color.saturation * 0.5) + (Math.max(0, lumFactor) * 0.5);

        samples.push(color);

        totalR += r;
        totalG += g;
        totalB += b;
        totalCount++;
    }

    if (totalCount === 0) return { r: 0, g: 0, b: 0, a: 255 };

    const avgColor = {
        r: Math.round(totalR / totalCount),
        g: Math.round(totalG / totalCount),
        b: Math.round(totalB / totalCount),
        a: 255
    };
    avgColor.saturation = calculateSaturation(avgColor);
    avgColor.luminance = calculateLuminance(avgColor);
    const lumFactor = 1.0 - Math.abs(avgColor.luminance - 0.5) * 1.8;
    avgColor.vibrancy = (avgColor.saturation * 0.5) + (Math.max(0, lumFactor) * 0.5);

    let best = avgColor;
    for (const s of samples) {
        if (s.vibrancy > best.vibrancy * 1.2) {
            best = s;
        }
    }

    return best;
}

function calculateSaturation(color) {
    const r_norm = color.r / 255; const g_norm = color.g / 255; const b_norm = color.b / 255;
    const max = Math.max(r_norm, g_norm, b_norm); const min = Math.min(r_norm, g_norm, b_norm);
    const delta = max - min;
    if (delta < 0.00001 || max < 0.00001) return 0;
    return delta / max;
}

function rgbToHsl(r, g, b) {
    r /= 255, g /= 255, b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
        h = s = 0;
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return [h, s, l];
}

function hslToRgb(h, s, l) {
    let r, g, b;

    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function calculateColorDifference(color1, color2) {
    const c1 = color1 || { r: 0, g: 0, b: 0 }; const c2 = color2 || { r: 0, g: 0, b: 0 };
    return Math.abs(c1.r - c2.r) + Math.abs(c1.g - c2.g) + Math.abs(c1.b - c2.b);
}

function LYPLUS_getSongPalette() {
    if (!currentTargetMasterArtworkPalette || currentTargetMasterArtworkPalette.length === 0) {
        return null;
    }

    const MIN_LUMINANCE_THRESHOLD = 0.15;
    const filteredPalette = currentTargetMasterArtworkPalette.filter(color => calculateLuminance(color) > MIN_LUMINANCE_THRESHOLD);

    let selectedColor;
    if (filteredPalette.length > 0) {
        selectedColor = filteredPalette.sort((a, b) => b.vibrancy - a.vibrancy)[0];
    } else {
        selectedColor = currentTargetMasterArtworkPalette.sort((a, b) => b.vibrancy - a.vibrancy)[0];
    }

    const [h, s, l] = rgbToHsl(selectedColor.r, selectedColor.g, selectedColor.b);
    const increasedSaturation = Math.min(1.0, s * 1.2);
    const [r, g, b] = hslToRgb(h, increasedSaturation, l);

    return { r, g, b, a: selectedColor.a };
}

window.addEventListener('message', (event) => {
    if (event.source === window && event.data && event.data.type === 'LYPLUS_updateFullScreenAnimatedBg') {
        const artworkElement = document.querySelector('.image.ytmusic-player-bar');
        const artworkUrl = (artworkElement && artworkElement.src && artworkElement.src.trim() !== "") ? artworkElement.src : null;
        LYPLUS_requestProcessNewArtwork(artworkUrl);
    }
});