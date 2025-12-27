// --- WebGL & Animation State Variables ---
let gl = null;
let glProgram = null;
let blurProgram = null;
let webglCanvas = null;
let needsAnimation = false;

// Uniform locations
let u_artworkTextureLocation, u_timeLocation, u_transitionProgressLocation;
let u_blur_imageLocation, u_blur_resolutionLocation, u_blur_directionLocation, u_blur_radiusLocation;
let a_positionLocation, a_texCoordLocation, a_blur_positionLocation;
let a_layerIndexLocation;

// WebGL objects
let positionBuffer;
let texCoordBuffer;
let layerIndexBuffer;
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
    layerIndexBuffer = null;
}

function handleContextRestored() {
    console.log("LYPLUS: WebGL context restored. Re-initializing...");
    LYPLUS_setupBlurEffect();
}

let blurDimensions = { width: 0, height: 0 };
let canvasDimensions = { width: 0, height: 0 };

const BLUR_DOWNSAMPLE = 1;
const BLUR_RADIUS = 7;

const MASTER_PALETTE_TEX_WIDTH = 8;
const MASTER_PALETTE_TEX_HEIGHT = 5;
const MASTER_PALETTE_SIZE = MASTER_PALETTE_TEX_WIDTH * MASTER_PALETTE_TEX_HEIGHT;

const STRETCHED_GRID_WIDTH = 128;
const STRETCHED_GRID_HEIGHT = 128;

let currentTargetMasterArtworkPalette = {};

const TARGET_FPS = 30;
const FRAME_INTERVAL = 1000 / TARGET_FPS;
let lastDrawTime = 0;

// Animation & rotation
const ROTATION_SPEEDS = [-0.10, 0.18, 0.32];
const ROTATION_POWER = 0.8;
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
let startTime = 0;

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
    attribute float a_layerIndex;
    
    varying vec2 v_texCoord;
    varying vec2 v_uv;
    varying float v_layerIndex;
    
    void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
        v_uv = a_position * 0.5 + 0.5;
        v_layerIndex = a_layerIndex;
    }
`;

// GPU-optimized fragment shader - all calculations moved here
const fragmentShaderSource = `
    #ifdef GL_ES
    precision mediump float;
    #endif
    
    varying vec2 v_texCoord;
    varying vec2 v_uv;
    varying float v_layerIndex;
    
    uniform sampler2D u_artworkTexture;
    uniform float u_time;
    uniform float u_transitionProgress;
    
    // Layer configuration injected from JS
    const float ROTATION_POWER = ${ROTATION_POWER.toFixed(1)};
    
    vec2 rotate(vec2 v, float angle) {
        float s = sin(angle);
        float c = cos(angle);
        return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
    }
    
    vec2 getBasePosition(int idx) {
        if (idx == 0) return vec2(${BASE_LAYER_POSITIONS[0].x.toFixed(2)}, ${BASE_LAYER_POSITIONS[0].y.toFixed(2)});
        if (idx == 1) return vec2(${BASE_LAYER_POSITIONS[1].x.toFixed(2)}, ${BASE_LAYER_POSITIONS[1].y.toFixed(2)});
        return vec2(${BASE_LAYER_POSITIONS[2].x.toFixed(2)}, ${BASE_LAYER_POSITIONS[2].y.toFixed(2)});
    }
    
    float getRotationSpeed(int idx) {
        if (idx == 0) return ${ROTATION_SPEEDS[0].toFixed(2)};
        if (idx == 1) return ${ROTATION_SPEEDS[1].toFixed(2)};
        return ${ROTATION_SPEEDS[2].toFixed(2)};
    }
    
    float getInitialRotation(int idx) {
        if (idx == 0) return ${rotations[0].toFixed(2)};
        if (idx == 1) return ${rotations[1].toFixed(2)};
        return ${rotations[2].toFixed(2)};
    }
    
    float getLayerScale(int idx) {
        if (idx == 0) return ${LAYER_SCALES[0].toFixed(2)};
        if (idx == 1) return ${LAYER_SCALES[1].toFixed(2)};
        return ${LAYER_SCALES[2].toFixed(2)};
    }
    
    float getPerimeterSpeed(int idx) {
        if (idx == 0) return ${PERIMETER_SPEEDS[0].toFixed(3)};
        if (idx == 1) return ${PERIMETER_SPEEDS[1].toFixed(3)};
        return ${PERIMETER_SPEEDS[2].toFixed(3)};
    }
    
    float getPerimeterDirection(int idx) {
        if (idx == 0) return ${PERIMETER_DIRECTION[0].toFixed(1)};
        if (idx == 1) return ${PERIMETER_DIRECTION[1].toFixed(1)};
        return ${PERIMETER_DIRECTION[2].toFixed(1)};
    }
    
    vec2 calculatePerimeterPosition(int idx, float time) {
        vec2 base = getBasePosition(idx);
        float radiusX = abs(base.x);
        float radiusY = abs(base.y);
        
        float speed = getPerimeterSpeed(idx);
        float dir = getPerimeterDirection(idx);
        
        // Use layer index as initial offset for variety
        float offset = float(idx) * 0.33;
        float t = fract(offset + dir * speed * time);
        float angle = t * 6.283185307; // 2*PI
        
        return vec2(radiusX * cos(angle), radiusY * sin(angle));
    }
    
    void main() {
        int idx = int(v_layerIndex);
        
        // Calculate rotation based on time (GPU-side)
        float rotation = getInitialRotation(idx) + (getRotationSpeed(idx) * u_time * ROTATION_POWER);
        float scale = getLayerScale(idx);
        
        // Calculate perimeter position (GPU-side)
        vec2 position = calculatePerimeterPosition(idx, u_time);
        
        // Transform UV coordinates
        vec2 centered = v_uv - 0.5;
        centered.y = -centered.y;
        centered -= position;
        centered = rotate(centered, -rotation);
        centered /= scale;
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
    return {
        background: { r: 0, g: 0, b: 0 },
        primary: { r: 255, g: 255, b: 255 },
        secondary: { r: 200, g: 200, b: 200 }
    };
}

function LYPLUS_setupBlurEffect() {
    console.log("LYPLUS: Setting up GPU-optimized WebGL...");
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
        const ctxAttribs = { 
            antialias: false, 
            depth: false, 
            stencil: false, 
            preserveDrawingBuffer: false, 
            alpha: false
        };
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

    // Get attribute/uniform locations
    a_positionLocation = gl.getAttribLocation(glProgram, 'a_position');
    a_texCoordLocation = gl.getAttribLocation(glProgram, 'a_texCoord');
    a_layerIndexLocation = gl.getAttribLocation(glProgram, 'a_layerIndex');
    u_artworkTextureLocation = gl.getUniformLocation(glProgram, 'u_artworkTexture');
    u_timeLocation = gl.getUniformLocation(glProgram, 'u_time');
    u_transitionProgressLocation = gl.getUniformLocation(glProgram, 'u_transitionProgress');

    a_blur_positionLocation = gl.getAttribLocation(blurProgram, 'a_position');
    u_blur_imageLocation = gl.getUniformLocation(blurProgram, 'u_image');
    u_blur_resolutionLocation = gl.getUniformLocation(blurProgram, 'u_resolution');
    u_blur_directionLocation = gl.getUniformLocation(blurProgram, 'u_direction');
    u_blur_radiusLocation = gl.getUniformLocation(blurProgram, 'u_blurRadius');

    positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    const positions = [
        -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,  // Layer 0
        -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,  // Layer 1
        -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1   // Layer 2
    ];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

    texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    const texCoords = [
        0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1,  // Layer 0
        0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1,  // Layer 1
        0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1   // Layer 2
    ];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texCoords), gl.STATIC_DRAW);

    layerIndexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, layerIndexBuffer);
    const layerIndices = [
        0,0,0,0,0,0,
        1,1,1,1,1,1,
        2,2,2,2,2,2
    ];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(layerIndices), gl.STATIC_DRAW);

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
    currentTargetMasterArtworkPalette = {
        background: { ...initialPalette.background },
        primary: { ...initialPalette.primary },
        secondary: { ...initialPalette.secondary }
    };

    handleResize();
    window.addEventListener('resize', handleResize, { passive: true });

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Initialize start time
    startTime = performance.now() / 1000;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                if (!globalAnimationId) {
                    console.log("LYPLUS: Canvas is visible, starting animation.");
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
        let palette;
        if (typeof ColorTunes !== 'undefined') {
            try {
                palette = ColorTunes.getSongPalette(img);
            } catch (e) {
                console.error("LYPLUS: ColorTunes failed", e);
                palette = getDefaultMasterPalette();
            }
        } else {
            console.warn("LYPLUS: ColorTunes library not found, using default.");
            palette = getDefaultMasterPalette();
        }

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

// Kept for API compatibility - no longer does actual calculations
function updateLayerPerimeterPositions(deltaTime) {
    // All calculations moved to GPU shader
    // This function kept for backwards compatibility
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
    lastDrawTime = now - (elapsed % FRAME_INTERVAL);

    const currentTime = lastDrawTime / 1000 - startTime;

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

    // === RENDER TO FRAMEBUFFER ===
    gl.bindFramebuffer(gl.FRAMEBUFFER, renderFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, renderTexture, 0);
    gl.viewport(0, 0, canvasDimensions.width, canvasDimensions.height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(glProgram);

    // Setup vertex attributes (once per frame)
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(a_positionLocation);
    gl.vertexAttribPointer(a_positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.enableVertexAttribArray(a_texCoordLocation);
    gl.vertexAttribPointer(a_texCoordLocation, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, layerIndexBuffer);
    gl.enableVertexAttribArray(a_layerIndexLocation);
    gl.vertexAttribPointer(a_layerIndexLocation, 1, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(u_artworkTextureLocation, 0);
    gl.uniform1f(u_timeLocation, currentTime); // Single time uniform

    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    
    // Draw previous artwork (fading out)
    if (artworkTransitionProgress < 1.0) {
        gl.bindTexture(gl.TEXTURE_2D, previousArtworkTexture);
        gl.uniform1f(u_transitionProgressLocation, 1.0 - artworkTransitionProgress);
        
        // Draw each layer separately for proper blending
        for (let layer = 0; layer < 3; layer++) {
            gl.drawArrays(gl.TRIANGLES, layer * 6, 6);
        }
    }

    gl.bindTexture(gl.TEXTURE_2D, currentArtworkTexture);
    gl.uniform1f(u_transitionProgressLocation, artworkTransitionProgress);
    
    for (let layer = 0; layer < 3; layer++) {
        gl.drawArrays(gl.TRIANGLES, layer * 6, 6);
    }

    // === BLUR PASSES ===
    gl.useProgram(blurProgram);
    gl.uniform1f(u_blur_radiusLocation, BLUR_RADIUS);

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(a_blur_positionLocation);
    gl.vertexAttribPointer(a_blur_positionLocation, 2, gl.FLOAT, false, 0, 0);

    // Horizontal blur pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, blurFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, blurTextureA, 0);
    gl.viewport(0, 0, blurDimensions.width, blurDimensions.height);
    gl.uniform2f(u_blur_directionLocation, 1.0, 0.0);
    gl.uniform2f(u_blur_resolutionLocation, canvasDimensions.width, canvasDimensions.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, renderTexture);
    gl.uniform1i(u_blur_imageLocation, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Vertical blur pass (to screen)
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

function LYPLUS_getSongPalette() {
    if (!currentTargetMasterArtworkPalette || !currentTargetMasterArtworkPalette.primary) {
        return { r: 255, g: 255, b: 255, a: 255 };
    }

    const c = currentTargetMasterArtworkPalette.primary;

    return {
        r: c.r,
        g: c.g,
        b: c.b,
        a: 255
    };
}

window.addEventListener('message', (event) => {
    if (event.source === window && event.data && event.data.type === 'LYPLUS_updateFullScreenAnimatedBg') {
        const artworkElement = document.querySelector('.image.ytmusic-player-bar');
        const artworkUrl = (artworkElement && artworkElement.src && artworkElement.src.trim() !== "") ? artworkElement.src : null;
        LYPLUS_requestProcessNewArtwork(artworkUrl);
    }
});