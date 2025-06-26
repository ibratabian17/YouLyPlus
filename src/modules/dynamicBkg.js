// --- WebGL & Animation State Variables ---
let gl = null;
let glProgram = null;
let webglCanvas = null;

// Uniform locations
let u_paletteTextureLocation, u_cellStateTextureLocation;
let u_resolutionLocation;
let a_positionLocation;

// WebGL objects
let positionBuffer;
let paletteTexture = null;
let cellStateTexture = null;

// Palette and Cell State Constants
const MASTER_PALETTE_TEX_WIDTH = 8;
const MASTER_PALETTE_TEX_HEIGHT = 5;
const MASTER_PALETTE_SIZE = MASTER_PALETTE_TEX_WIDTH * MASTER_PALETTE_TEX_HEIGHT;

const DISPLAY_GRID_WIDTH = 8;
const DISPLAY_GRID_HEIGHT = 5;
const TOTAL_DISPLAY_CELLS = DISPLAY_GRID_WIDTH * DISPLAY_GRID_HEIGHT;

// Master artwork palettes for transition
let previousMasterArtworkPalette = [];
let currentTargetMasterArtworkPalette = [];
let activeMasterDisplayPalette = []; // Blended palette used for display

// State for each of the 8x5 display cells
let displayCellStates = [];

// Animation speed & progress
const SONG_PALETTE_TRANSITION_SPEED = 0.015;
let songPaletteTransitionProgress = 1.0;

const CELL_FADE_SPEED_BASE = 0.006;
const CELL_FADE_SPEED_VARIATION = 0.005;

let globalAnimationId = null;

// Artwork processing state
let isProcessingArtwork = false;
let pendingArtworkUrl = null; // Can be a URL string or a special marker like 'NO_ARTWORK'
let currentProcessingArtworkIdentifier = null; // URL string or 'NO_ARTWORK'
let lastAppliedArtworkIdentifier = null; // URL string or 'NO_ARTWORK'
let artworkCheckTimeoutId = null;
const ARTWORK_RECHECK_DELAY = 300; // milliseconds

const NO_ARTWORK_IDENTIFIER = 'LYPLUS_NO_ARTWORK'; // Special identifier for no artwork

const OVERSAMPLE_GRID_WIDTH = 12; // Lower these (e.g., 8) for less CPU on palette extraction
const OVERSAMPLE_GRID_HEIGHT = 8;  // Lower these (e.g., 5)


// --- Shader Sources (remain IDENTICAL) ---
const vertexShaderSource = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_uv = a_position * 0.5 + 0.5;
    }
`;

const fragmentShaderSource = `
    #ifdef GL_ES
    precision mediump float;
    #endif

    const int MASTER_PALETTE_TEX_WIDTH_CONST = ${MASTER_PALETTE_TEX_WIDTH};
    const int MASTER_PALETTE_TEX_HEIGHT_CONST = ${MASTER_PALETTE_TEX_HEIGHT};
    const int TOTAL_MASTER_COLORS_CONST = MASTER_PALETTE_TEX_WIDTH_CONST * MASTER_PALETTE_TEX_HEIGHT_CONST;

    uniform sampler2D u_paletteTexture;
    uniform sampler2D u_cellStateTexture;
    uniform vec2 u_resolution;
    varying vec2 v_uv;

    vec4 getColorFromMasterPalette(int index) {
        index = int(clamp(float(index), 0.0, float(TOTAL_MASTER_COLORS_CONST - 1)));
        float texY_row = floor(float(index) / float(MASTER_PALETTE_TEX_WIDTH_CONST));
        float texX_col = mod(float(index), float(MASTER_PALETTE_TEX_WIDTH_CONST));
        float u = (texX_col + 0.5) / float(MASTER_PALETTE_TEX_WIDTH_CONST);
        float v = (texY_row + 0.5) / float(MASTER_PALETTE_TEX_HEIGHT_CONST);
        return texture2D(u_paletteTexture, vec2(u, v));
    }

    void main() {
        vec4 cellStateEncoded = texture2D(u_cellStateTexture, v_uv);
        float normalizer = float(TOTAL_MASTER_COLORS_CONST - 1);
        if (normalizer < 1.0) normalizer = 1.0;
        int sourceColorIndex = int(cellStateEncoded.r * normalizer + 0.5);
        int targetColorIndex = int(cellStateEncoded.g * normalizer + 0.5);
        float fadeProgress = cellStateEncoded.b;
        vec4 colorA = getColorFromMasterPalette(sourceColorIndex);
        vec4 colorB = getColorFromMasterPalette(targetColorIndex);
        gl_FragColor = mix(colorA, colorB, fadeProgress);
    }
`;

// --- WebGL Helper Functions (createShader, createProgram) ---
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
        // A slightly more interesting default than all black
        const base = 20;
        const variation = (i % 5) * 5;
        return { r: base + variation, g: base + variation, b: base + variation + 10, a: 255 };
    });
}

// --- Main Setup Function ---
function LYPLUS_setupBlurEffect() {
    console.log("LYPLUS: Setting up WebGL...");
    if (typeof currentSettings !== 'undefined' && currentSettings.dynamicPlayer) {
        const layoutElement = document.querySelector('#layout');
        if (layoutElement) layoutElement.classList.add("dynamic-player");
    }

    const existingContainer = document.querySelector('.lyplus-blur-container');
    if (existingContainer) existingContainer.remove();
    const blurContainer = document.createElement('div');
    blurContainer.classList.add('lyplus-blur-container');
    blurContainer.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; z-index:-10; pointer-events:none;';
    webglCanvas = document.createElement('canvas');
    webglCanvas.id = 'lyplus-webgl-canvas';
    webglCanvas.style.cssText = 'width:100%; height:100%; display:block;';
    blurContainer.appendChild(webglCanvas);
    (document.querySelector('#layout') || document.body).prepend(blurContainer);

    try {
        const ctxAttribs = { antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false };
        gl = webglCanvas.getContext('webgl', ctxAttribs) || webglCanvas.getContext('experimental-webgl', ctxAttribs);
    } catch (e) { console.error("LYPLUS: WebGL context creation failed.", e); }
    if (!gl) { console.error("LYPLUS: WebGL not supported or context unavailable!"); return null; }

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    if (!vertexShader || !fragmentShader) return null;
    glProgram = createProgram(gl, vertexShader, fragmentShader);
    if (!glProgram) return null;

    a_positionLocation = gl.getAttribLocation(glProgram, 'a_position');
    u_paletteTextureLocation = gl.getUniformLocation(glProgram, 'u_paletteTexture');
    u_cellStateTextureLocation = gl.getUniformLocation(glProgram, 'u_cellStateTexture');
    u_resolutionLocation = gl.getUniformLocation(glProgram, 'u_resolution');

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

    cellStateTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, cellStateTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    const initialPalette = getDefaultMasterPalette();
    previousMasterArtworkPalette = initialPalette.map(c => ({ ...c }));
    currentTargetMasterArtworkPalette = initialPalette.map(c => ({ ...c }));
    activeMasterDisplayPalette = initialPalette.map(c => ({ ...c }));
    updateMasterPaletteTexture(activeMasterDisplayPalette);

    displayCellStates = [];
    const normalizer = Math.max(1, MASTER_PALETTE_SIZE - 1);
    for (let i = 0; i < TOTAL_DISPLAY_CELLS; i++) {
        const sourceIdx = Math.floor(Math.random() * MASTER_PALETTE_SIZE);
        let targetIdx = Math.floor(Math.random() * MASTER_PALETTE_SIZE);
        if (MASTER_PALETTE_SIZE > 1) {
            while (targetIdx === sourceIdx) targetIdx = Math.floor(Math.random() * MASTER_PALETTE_SIZE);
        } else {
            targetIdx = sourceIdx;
        }
        displayCellStates.push({
            sourceIdx: sourceIdx, targetIdx: targetIdx, progress: Math.random(), // Start at random progress
            speed: CELL_FADE_SPEED_BASE + (Math.random() * CELL_FADE_SPEED_VARIATION * 2) - CELL_FADE_SPEED_VARIATION
        });
    }
    updateCellStateTexture(); // Upload initial cell states

    if (!globalAnimationId) {
        console.log("LYPLUS: Starting WebGL animation loop (initial setup).");
        animateWebGLBackground();
    }
    console.log("LYPLUS: WebGL setup complete.");
    return blurContainer;
}

// --- Function to update the WebGL Master Palette Texture ---
function updateMasterPaletteTexture(paletteArray) {
    if (!gl || !paletteTexture || !paletteArray || paletteArray.length !== MASTER_PALETTE_SIZE) {
        return;
    }
    const textureData = new Uint8Array(MASTER_PALETTE_SIZE * 4);
    for (let i = 0; i < MASTER_PALETTE_SIZE; i++) {
        const color = paletteArray[i] || { r: 0, g: 0, b: 0, a: 255 };
        textureData[i * 4 + 0] = Math.round(color.r);
        textureData[i * 4 + 1] = Math.round(color.g);
        textureData[i * 4 + 2] = Math.round(color.b);
        textureData[i * 4 + 3] = Math.round(color.a);
    }
    gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, MASTER_PALETTE_TEX_WIDTH, MASTER_PALETTE_TEX_HEIGHT, 0, gl.RGBA, gl.UNSIGNED_BYTE, textureData);
}

// --- Function to update the WebGL Cell State Texture ---
function updateCellStateTexture() {
    if (!gl || !cellStateTexture || displayCellStates.length !== TOTAL_DISPLAY_CELLS) return;
    const textureData = new Uint8Array(TOTAL_DISPLAY_CELLS * 4);
    const normalizer = Math.max(1, MASTER_PALETTE_SIZE - 1);

    for (let i = 0; i < TOTAL_DISPLAY_CELLS; i++) {
        const state = displayCellStates[i];
        textureData[i * 4 + 0] = Math.round((state.sourceIdx / normalizer) * 255);
        textureData[i * 4 + 1] = Math.round((state.targetIdx / normalizer) * 255);
        textureData[i * 4 + 2] = Math.round(Math.min(1.0, Math.max(0.0, state.progress)) * 255);
        textureData[i * 4 + 3] = 255;
    }
    gl.bindTexture(gl.TEXTURE_2D, cellStateTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, DISPLAY_GRID_WIDTH, DISPLAY_GRID_HEIGHT, 0, gl.RGBA, gl.UNSIGNED_BYTE, textureData);
}


// --- Artwork Processing Queue and Update Logic ---
function LYPLUS_requestProcessNewArtwork(artworkUrlFromEvent) {
    if (!glProgram && !LYPLUS_setupBlurEffect()) {
        console.warn("LYPLUS: WebGL setup failed, cannot process artwork.");
        return;
    }

    // Always clear any pending re-check if a new event comes in
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
                    // This could be a non-image URL, or one we don't recognize.
                    // If it's not a known base domain, it's less likely to be temporary.
                    //console.warn(`LYPLUS: URL "${trimmedUrl}" does not look like a typical image URL. Treating as NO_ARTWORK.`);
                    artworkIdentifierToProcess = NO_ARTWORK_IDENTIFIER;
                }
            } else {
                // It's a base domain - could be temporary!
                isPotentiallyTemporary = true;
                artworkIdentifierToProcess = null; // Don't process yet
            }
        } else {
            // Empty string or doesn't start with http - could be temporary!
            isPotentiallyTemporary = true;
            artworkIdentifierToProcess = null; // Don't process yet
        }
    } else {
        // Not a string (null, undefined) - could be temporary!
        isPotentiallyTemporary = true;
        artworkIdentifierToProcess = null; // Don't process yet
    }


    if (isPotentiallyTemporary) {
        //console.log("LYPLUS: Potentially temporary invalid artwork URL. Scheduling re-check.", artworkUrlFromEvent);
        artworkCheckTimeoutId = setTimeout(() => {
            artworkCheckTimeoutId = null; // Clear the ID
            const artworkElement = document.querySelector('.image.ytmusic-player-bar');
            const currentArtworkSrc = (artworkElement && artworkElement.src && artworkElement.src.trim() !== "") ? artworkElement.src : null;
            //console.log("LYPLUS: Re-checking artwork. Current src:", currentArtworkSrc);
            // Call this function again with the freshly fetched src.
            // This will re-evaluate if it's valid, NO_ARTWORK, or still potentially temporary (though unlikely to loop infinitely here).
            LYPLUS_requestProcessNewArtwork(currentArtworkSrc);
        }, ARTWORK_RECHECK_DELAY);
        return; // Don't proceed to queueing yet
    }

    // If artworkIdentifierToProcess is still null here, it means it was not temporary but truly invalid from the start
    if (artworkIdentifierToProcess === null) {
        artworkIdentifierToProcess = NO_ARTWORK_IDENTIFIER;
    }

    if (artworkIdentifierToProcess === lastAppliedArtworkIdentifier && songPaletteTransitionProgress >= 1.0) {
        return;
    }
    if (artworkIdentifierToProcess === currentProcessingArtworkIdentifier || artworkIdentifierToProcess === pendingArtworkUrl) {
        return;
    }
    pendingArtworkUrl = artworkIdentifierToProcess;
    if (!isProcessingArtwork) {
        processNextArtworkFromQueue();
    }
}

function processNextArtworkFromQueue() {
    if (isProcessingArtwork || !pendingArtworkUrl) {
        return;
    }

    isProcessingArtwork = true;
    currentProcessingArtworkIdentifier = pendingArtworkUrl;
    pendingArtworkUrl = null;

    console.log("LYPLUS: Processing artwork/state:", currentProcessingArtworkIdentifier);

    if (activeMasterDisplayPalette && activeMasterDisplayPalette.length === MASTER_PALETTE_SIZE) {
        previousMasterArtworkPalette = activeMasterDisplayPalette.map(c => ({ ...c }));
    } else {
        previousMasterArtworkPalette = getDefaultMasterPalette();
        console.warn("LYPLUS: activeMasterDisplayPalette was not ready during pre-transition capture. Using default.");
    }

    if (currentProcessingArtworkIdentifier === NO_ARTWORK_IDENTIFIER) {
        // Handle "no artwork" case: transition to a default palette
        console.log("LYPLUS: No artwork detected or invalid URL. Transitioning to default palette.");
        currentTargetMasterArtworkPalette = getDefaultMasterPalette();
        songPaletteTransitionProgress = 0.0;
        lastAppliedArtworkIdentifier = currentProcessingArtworkIdentifier;

        isProcessingArtwork = false;
        currentProcessingArtworkIdentifier = null;
        if (pendingArtworkUrl) {
            processNextArtworkFromQueue();
        }
        return; // Done with this "no artwork" processing
    }

    // Proceed with actual image processing for a valid URL
    const imageUrl = currentProcessingArtworkIdentifier;

    const onImageLoadSuccess = (img) => {
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
        tempCanvas.width = OVERSAMPLE_GRID_WIDTH * 10;
        tempCanvas.height = OVERSAMPLE_GRID_HEIGHT * 10;

        try { tempCtx.drawImage(img, 0, 0, tempCanvas.width, tempCanvas.height); }
        catch (e) { console.error("LYPLUS: Error drawing image to temp canvas.", e); onImageLoadError(); return; }

        const sampledColors = [];
        const regionImgWidth = Math.floor(tempCanvas.width / OVERSAMPLE_GRID_WIDTH);
        const regionImgHeight = Math.floor(tempCanvas.height / OVERSAMPLE_GRID_HEIGHT);

        for (let y = 0; y < OVERSAMPLE_GRID_HEIGHT; y++) {
            for (let x = 0; x < OVERSAMPLE_GRID_WIDTH; x++) {
                const color = getAverageColor(tempCtx, x * regionImgWidth, y * regionImgHeight, regionImgWidth, regionImgHeight);
                color.contrastScore = calculateContrastRatio(color, { r: 255, g: 255, b: 255 }) + calculateContrastRatio(color, { r: 0, g: 0, b: 0 });
                let existingColor = sampledColors.find(c => c.r === color.r && c.g === color.g && c.b === color.b);
                if (existingColor) { existingColor.frequency = (existingColor.frequency || 1) + 1; }
                else { color.frequency = 1; sampledColors.push(color); }
            }
        }

        sampledColors.forEach(color => {
            color.saturation = calculateSaturation(color);
            color.luminance = calculateLuminance(color);
            const lumFactor = 1.0 - Math.abs(color.luminance - 0.5) * 1.8;
            const freqNorm = color.frequency / (OVERSAMPLE_GRID_WIDTH * OVERSAMPLE_GRID_HEIGHT);
            color.vibrancy = (color.saturation * 0.7) + (Math.max(0, lumFactor) * 0.15) + (freqNorm * 0.15);
        });

        let sortedCandidates = [...sampledColors].sort((a, b) => {
            if (b.vibrancy !== a.vibrancy) return b.vibrancy - a.vibrancy;
            if (b.frequency !== a.frequency) return b.frequency - a.frequency;
            return b.contrastScore - a.contrastScore;
        });

        const newMasterPalette = [];
        const MIN_COLOR_DIFFERENCE_THRESHOLD = 85;

        for (const candidate of sortedCandidates) {
            if (newMasterPalette.length >= MASTER_PALETTE_SIZE) break;
            if (newMasterPalette.length === 0) { newMasterPalette.push(candidate); continue; }
            let isDifferentEnough = true;
            for (const selectedColor of newMasterPalette) {
                if (calculateColorDifference(candidate, selectedColor) < MIN_COLOR_DIFFERENCE_THRESHOLD) { isDifferentEnough = false; break; }
            }
            if (isDifferentEnough) newMasterPalette.push(candidate);
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
        while (newMasterPalette.length < MASTER_PALETTE_SIZE) newMasterPalette.push({ r: 20, g: 20, b: 30, a: 255 });

        const finalTargetPalette = newMasterPalette.slice(0, MASTER_PALETTE_SIZE).map(c => ({
            r: c.r, g: c.g, b: c.b, a: c.a !== undefined ? c.a : 255
        }));

        currentTargetMasterArtworkPalette = finalTargetPalette;
        songPaletteTransitionProgress = 0.0;
        lastAppliedArtworkIdentifier = currentProcessingArtworkIdentifier;

        isProcessingArtwork = false;
        currentProcessingArtworkIdentifier = null;
        if (pendingArtworkUrl) processNextArtworkFromQueue();
    };

    const onImageLoadError = () => {
        console.error(`LYPLUS: Error loading/processing image ${imageUrl}. Transitioning to default palette.`);
        currentTargetMasterArtworkPalette = getDefaultMasterPalette();
        songPaletteTransitionProgress = 0.0;
        lastAppliedArtworkIdentifier = currentProcessingArtworkIdentifier; // Still mark it as "applied" with the fallback

        isProcessingArtwork = false;
        currentProcessingArtworkIdentifier = null;
        if (pendingArtworkUrl) processNextArtworkFromQueue();
    };

    if (imageUrl.startsWith('http')) { // This check is now redundant due to NO_ARTWORK_IDENTIFIER handling but safe
        fetch(imageUrl, { mode: 'cors' })
            .then(response => { if (!response.ok) throw new Error(`CORS fetch failed: ${response.status}`); return response.blob(); })
            .then(blob => {
                const img = new Image(); const objectURL = URL.createObjectURL(blob);
                img.onload = () => { onImageLoadSuccess(img); URL.revokeObjectURL(objectURL); };
                img.onerror = () => { onImageLoadError(); URL.revokeObjectURL(objectURL); };
                img.src = objectURL;
            })
            .catch(error => {
                console.warn("LYPLUS: CORS fetch failed, trying img.crossOrigin.", error);
                const img = new Image(); img.crossOrigin = "anonymous";
                img.onload = () => onImageLoadSuccess(img); img.onerror = onImageLoadError;
                img.src = imageUrl;
            });
    } else { // Should not be reached if NO_ARTWORK_IDENTIFIER is used correctly for non-http
        console.error("LYPLUS: Reached image loading with non-http URL, this should be handled by NO_ARTWORK_IDENTIFIER:", imageUrl);
        onImageLoadError(); // Treat as error
    }
}

// --- Animation Loop ---
function animateWebGLBackground() {
    if (!gl || !glProgram) {
        globalAnimationId = null; return;
    }

    let needsMasterPaletteTextureUpdate = false;
    let needsCellStateTextureUpdate = false;

    if (songPaletteTransitionProgress < 1.0) {
        songPaletteTransitionProgress = Math.min(1.0, songPaletteTransitionProgress + SONG_PALETTE_TRANSITION_SPEED);
        if (previousMasterArtworkPalette && previousMasterArtworkPalette.length === MASTER_PALETTE_SIZE &&
            currentTargetMasterArtworkPalette && currentTargetMasterArtworkPalette.length === MASTER_PALETTE_SIZE) {
            for (let i = 0; i < MASTER_PALETTE_SIZE; i++) {
                const prevC = previousMasterArtworkPalette[i] || { r: 0, g: 0, b: 0, a: 255 };
                const targetC = currentTargetMasterArtworkPalette[i] || { r: 0, g: 0, b: 0, a: 255 };
                activeMasterDisplayPalette[i] = blendColors(prevC, targetC, songPaletteTransitionProgress);
            }
        } else {
            activeMasterDisplayPalette = (currentTargetMasterArtworkPalette && currentTargetMasterArtworkPalette.length === MASTER_PALETTE_SIZE)
                ? currentTargetMasterArtworkPalette.map(c => ({ ...c }))
                : getDefaultMasterPalette();
            songPaletteTransitionProgress = 1.0;
        }
        needsMasterPaletteTextureUpdate = true;
        if (songPaletteTransitionProgress >= 1.0) {
            activeMasterDisplayPalette = currentTargetMasterArtworkPalette.map(c => ({ ...c }));
        }
    }

    if (needsMasterPaletteTextureUpdate) {
        updateMasterPaletteTexture(activeMasterDisplayPalette);
    }

    if (activeMasterDisplayPalette && activeMasterDisplayPalette.length === MASTER_PALETTE_SIZE && MASTER_PALETTE_SIZE > 0) {
        for (let i = 0; i < TOTAL_DISPLAY_CELLS; i++) {
            const state = displayCellStates[i];
            state.progress += state.speed;
            if (state.progress >= 1.0) {
                state.progress = 0.0; state.sourceIdx = state.targetIdx;
                if (MASTER_PALETTE_SIZE > 1) {
                    let newTarget = Math.floor(Math.random() * MASTER_PALETTE_SIZE); let attempts = 0;
                    while (newTarget === state.sourceIdx && attempts < MASTER_PALETTE_SIZE * 2) {
                        newTarget = Math.floor(Math.random() * MASTER_PALETTE_SIZE); attempts++;
                    }
                    state.targetIdx = newTarget;
                } else { state.targetIdx = 0; }
                state.speed = CELL_FADE_SPEED_BASE + (Math.random() * CELL_FADE_SPEED_VARIATION * 2) - CELL_FADE_SPEED_VARIATION;
                needsCellStateTextureUpdate = true;
            } else if (state.progress < 0.0 && state.speed < 0) {
                state.progress = 1.0; needsCellStateTextureUpdate = true;
            } else if (state.speed !== 0) { needsCellStateTextureUpdate = true; }
        }
    }
    if (needsCellStateTextureUpdate) updateCellStateTexture();

    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(glProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(a_positionLocation);
    gl.vertexAttribPointer(a_positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, paletteTexture); gl.uniform1i(u_paletteTextureLocation, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, cellStateTexture); gl.uniform1i(u_cellStateTextureLocation, 1);
    gl.uniform2f(u_resolutionLocation, webglCanvas.width, webglCanvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    globalAnimationId = requestAnimationFrame(animateWebGLBackground);
}

// --- Helper Functions (Resizing, Color Math etc.) ---
function calculateLuminance(color) {
    const a = [color.r, color.g, color.b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}
function calculateContrastRatio(color1, color2) {
    const lum1 = calculateLuminance(color1); const lum2 = calculateLuminance(color2);
    const brightest = Math.max(lum1, lum2); const darkest = Math.min(lum1, lum2);
    return (brightest + 0.05) / (darkest + 0.05);
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
function getAverageColor(ctx, x, y, width, height) {
    if (width <= 0 || height <= 0) return { r: 0, g: 0, b: 0, a: 0 };
    try {
        const imageData = ctx.getImageData(x, y, Math.max(1, width), Math.max(1, height));
        const data = imageData.data; let r = 0, g = 0, b = 0, a = 0;
        const pixelCount = data.length / 4;
        if (pixelCount === 0) return { r: 0, g: 0, b: 0, a: 0 };
        for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; a += data[i + 3]; }
        return { r: Math.round(r / pixelCount), g: Math.round(g / pixelCount), b: Math.round(b / pixelCount), a: Math.round(a / pixelCount) };
    } catch (e) { console.error("LYPLUS: Error in getAverageColor:", e, { x, y, width, height }); return { r: 0, g: 0, b: 0, a: 255 }; }
}
function blendColors(color1, color2, ratio) {
    const c1 = color1 || { r: 0, g: 0, b: 0, a: 255 }; const c2 = color2 || { r: 0, g: 0, b: 0, a: 255 };
    const t = Math.max(0, Math.min(1, ratio));
    return { r: c1.r * (1 - t) + c2.r * t, g: c1.g * (1 - t) + c2.g * t, b: c1.b * (1 - t) + c2.b * t, a: c1.a * (1 - t) + c2.a * t };
}

// --- Event Listener to Trigger Update ---
window.addEventListener('message', (event) => {
    if (event.source === window && event.data && event.data.type === 'LYPLUS_updateFullScreenAnimatedBg') {
        const artworkElement = document.querySelector('.image.ytmusic-player-bar');
        // Ensure artworkUrl is null if element or src is not found/empty, otherwise pass the src.
        const artworkUrl = (artworkElement && artworkElement.src && artworkElement.src.trim() !== "") ? artworkElement.src : null;
        LYPLUS_requestProcessNewArtwork(artworkUrl);
    }
});