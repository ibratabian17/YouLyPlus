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
let paletteTexture = null;    // Stores the (potentially transitioning) master palette
let cellStateTexture = null;  // Stores state for each display cell

// Palette and Cell State Constants
const MASTER_PALETTE_TEX_WIDTH = 8;
const MASTER_PALETTE_TEX_HEIGHT = 5;
const MASTER_PALETTE_SIZE = MASTER_PALETTE_TEX_WIDTH * MASTER_PALETTE_TEX_HEIGHT;

const DISPLAY_GRID_WIDTH = 8;
const DISPLAY_GRID_HEIGHT = 5;
const TOTAL_DISPLAY_CELLS = DISPLAY_GRID_WIDTH * DISPLAY_GRID_HEIGHT;

// Master artwork palettes for transition
let previousMasterArtworkPalette = [];    // From previous song
let currentTargetMasterArtworkPalette = []; // From current song's artwork
let activeMasterDisplayPalette = [];      // Blended palette used for display (uploaded to texture)

// State for each of the 8x5 display cells
let displayCellStates = [];

// Animation speed & progress
const SONG_PALETTE_TRANSITION_SPEED = 0.015; // Speed of overall palette change
let songPaletteTransitionProgress = 1.0;     // 0.0 to 1.0

const CELL_FADE_SPEED_BASE = 0.006;
const CELL_FADE_SPEED_VARIATION = 0.005;

let globalAnimationId = null;
window.currentLyplusArtworkUrl = null;

const OVERSAMPLE_GRID_WIDTH = 12;
const OVERSAMPLE_GRID_HEIGHT = 8;


// --- Shader Sources (remain IDENTICAL to the previous "Random Cell Fades" version) ---
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

    uniform sampler2D u_paletteTexture;   // Master artwork colors (now smoothly transitioning)
    uniform sampler2D u_cellStateTexture; // Per-cell state
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

// --- WebGL Helper Functions (createShader, createProgram - same) ---
function createShader(glCtx, type, source) { /* ... */ }
function createProgram(glCtx, vs, fs) { /* ... */ }

// --- Main Setup Function ---
function LYPLUS_setupBlurEffect() {
    console.log("LYPLUS: Setting up WebGL (Gradual Palette Transition & Random Cell Fades)...");
    // ... (Standard container and canvas creation - same as before) ...
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
    } catch (e) { console.error("LYPLUS: WebGL context creation failed initial attempt.", e); }
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
    const initialMasterPaletteData = new Uint8Array(MASTER_PALETTE_SIZE * 4).fill(0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, MASTER_PALETTE_TEX_WIDTH, MASTER_PALETTE_TEX_HEIGHT, 0, gl.RGBA, gl.UNSIGNED_BYTE, initialMasterPaletteData);

    cellStateTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, cellStateTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    // Initialize JS palettes and cell states
    const defaultInitialColor = { r: 0, g: 0, b: 0, a: 0 }; // Start transparent or dark
    previousMasterArtworkPalette = Array(MASTER_PALETTE_SIZE).fill(null).map(() => ({ ...defaultInitialColor }));
    currentTargetMasterArtworkPalette = Array(MASTER_PALETTE_SIZE).fill(null).map(() => ({ ...defaultInitialColor }));
    activeMasterDisplayPalette = Array(MASTER_PALETTE_SIZE).fill(null).map(() => ({ ...defaultInitialColor }));

    displayCellStates = [];
    const initialCellStateData = new Uint8Array(TOTAL_DISPLAY_CELLS * 4);
    const normalizer = Math.max(1, MASTER_PALETTE_SIZE - 1);
    for (let i = 0; i < TOTAL_DISPLAY_CELLS; i++) {
        const sourceIdx = 0;
        const targetIdx = MASTER_PALETTE_SIZE > 1 ? 1 : 0;
        displayCellStates.push({
            sourceIdx: sourceIdx, targetIdx: targetIdx, progress: 0.0,
            speed: CELL_FADE_SPEED_BASE + (Math.random() * CELL_FADE_SPEED_VARIATION * 2) - CELL_FADE_SPEED_VARIATION
        });
        initialCellStateData[i * 4 + 0] = Math.round((sourceIdx / normalizer) * 255);
        initialCellStateData[i * 4 + 1] = Math.round((targetIdx / normalizer) * 255);
        initialCellStateData[i * 4 + 2] = 0;
        initialCellStateData[i * 4 + 3] = 255;
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, DISPLAY_GRID_WIDTH, DISPLAY_GRID_HEIGHT, 0, gl.RGBA, gl.UNSIGNED_BYTE, initialCellStateData);

    LYPLUS_handleResize();
    window.addEventListener('resize', LYPLUS_handleResize);
    console.log("LYPLUS: WebGL setup (Gradual Palette Transition) complete.");
    return blurContainer;
}

// --- Function to update the WebGL Master Palette Texture ---
function updateMasterPaletteTexture(paletteArray) { // Uses activeMasterDisplayPalette
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

// --- Function to update the WebGL Cell State Texture (same as before) ---
function updateCellStateTexture() { /* ... */ }


// --- Update Function (triggered by message event) ---
function LYPLUS_updateBlurBackground() {
    if (!glProgram) {
        if (!LYPLUS_setupBlurEffect()) { return; }
    }
    const artworkElement = document.querySelector('#song-image>#thumbnail>#img');
    if (!artworkElement) { console.warn("LYPLUS: Artwork element not found."); return; }
    const artworkUrl = artworkElement.src;
    if (!artworkUrl || (artworkUrl === window.currentLyplusArtworkUrl && songPaletteTransitionProgress >= 1.0)) { return; }
    window.currentLyplusArtworkUrl = artworkUrl;
    console.log("LYPLUS: Updating master palette for new song:", artworkUrl.substring(0, 50) + "...");

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
        // ... (Palette extraction logic - same as before, result in `topContrastingPalette`)
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
        tempCanvas.width = OVERSAMPLE_GRID_WIDTH * 10; tempCanvas.height = OVERSAMPLE_GRID_HEIGHT * 10;
        try { tempCtx.drawImage(img, 0, 0, tempCanvas.width, tempCanvas.height); }
        catch (e) { console.error("LYPLUS: Error drawing image to temp canvas.", e); return; }
        const sampledColors = [];
        const regionImgWidth = Math.floor(tempCanvas.width / OVERSAMPLE_GRID_WIDTH);
        const regionImgHeight = Math.floor(tempCanvas.height / OVERSAMPLE_GRID_HEIGHT);
        for (let y = 0; y < OVERSAMPLE_GRID_HEIGHT; y++) {
            for (let x = 0; x < OVERSAMPLE_GRID_WIDTH; x++) {
                const color = getAverageColor(tempCtx, x * regionImgWidth, y * regionImgHeight, regionImgWidth, regionImgHeight);
                const contrastWithWhite = calculateContrastRatio(color, { r: 255, g: 255, b: 255 });
                const contrastWithBlack = calculateContrastRatio(color, { r: 0, g: 0, b: 0 });
                color.contrastScore = contrastWithWhite + contrastWithBlack;

                // Track color frequency
                let existingColor = sampledColors.find(c => c.r === color.r && c.g === color.g && c.b === color.b);
                if (existingColor) {
                    existingColor.frequency = (existingColor.frequency || 1) + 1;
                } else {
                    color.frequency = 1;
                    sampledColors.push(color);
                }
            }
        }
        function calculateSaturation(color) {
            const max = Math.max(color.r, color.g, color.b);
            const min = Math.min(color.r, color.g, color.b);
            return (max - min) / max;
        }

        function calculateColorDifference(color1, color2) {
            return Math.abs(color1.r - color2.r) + Math.abs(color1.g - color2.g) + Math.abs(color1.b - color2.b);
        }

        const minColorDifference = 40; // Adjust as needed

        sampledColors.sort((a, b) => {
            const saturationA = calculateSaturation(a);
            const saturationB = calculateSaturation(b);
            const frequencyA = a.frequency || 0;
            const frequencyB = b.frequency || 0;

            if (frequencyB !== frequencyA) {
                return frequencyB - frequencyA; // Prioritize frequent colors
            }

            if (saturationB !== saturationA) {
                return saturationB - saturationA;
            }

            const diffToPreviousA = previousMasterArtworkPalette.reduce((sum, prevColor) => sum + calculateColorDifference(a, prevColor), 0);
            const diffToPreviousB = previousMasterArtworkPalette.reduce((sum, prevColor) => sum + calculateColorDifference(b, prevColor), 0);
            if (diffToPreviousB !== diffToPreviousA) {
                return diffToPreviousB - diffToPreviousA;
            }

            // let diffToOthersA = 0;
            // for (let i = 0; i < topContrastingPalette.length; i++) {
            //     if (topContrastingPalette[i] !== a) {
            //         diffToOthersA += calculateColorDifference(a, topContrastingPalette[i]);
            //     }
            // }
            // let diffToOthersB = 0;
            // for (let i = 0; i < topContrastingPalette.length; i++) {
            //     if (topContrastingPalette[i] !== b) {
            //         diffToOthersB += calculateColorDifference(b, topContrastingPalette[i]);
            //     }
            // }
            // if (diffToOthersB !== diffToOthersA) {
            //     return diffToOthersB - diffToOthersA;
            // }

            return b.contrastScore - a.contrastScore;
        });

        const topFrequentColors = sampledColors.slice(0, MASTER_PALETTE_SIZE);
        const topContrastingPalette = [];

        for (let i = 0; i < Math.min(MASTER_PALETTE_SIZE, topFrequentColors.length); i++) {
            topContrastingPalette.push(topFrequentColors[i]);
        }

        // If the most frequent colors don't fill the palette, add more diverse colors
        if (topContrastingPalette.length < MASTER_PALETTE_SIZE) {
            const remainingColors = sampledColors.slice(MASTER_PALETTE_SIZE);

            remainingColors.sort((a, b) => {
                // Calculate the minimum color difference to the selected colors
                let minDiffA = Infinity;
                for (let j = 0; j < topContrastingPalette.length; j++) {
                    minDiffA = Math.min(minDiffA, calculateColorDifference(a, topContrastingPalette[j]));
                }
                let minDiffB = Infinity;
                for (let j = 0; j < topContrastingPalette.length; j++) {
                    minDiffB = Math.min(minDiffB, calculateColorDifference(b, topContrastingPalette[j]));
                }

                if (minDiffB !== minDiffA) {
                    return minDiffB - minDiffA; // Prioritize colors with larger minimum difference
                }

                const frequencyA = a.frequency || 0;
                const frequencyB = b.frequency || 0;
                return frequencyB - frequencyA; // Then prioritize frequent colors
            });

            for (let i = 0; i < remainingColors.length && topContrastingPalette.length < MASTER_PALETTE_SIZE; i++) {
                topContrastingPalette.push(remainingColors[i]);
            }
        }

        // Fill remaining slots with default colors if needed
        while (topContrastingPalette.length < MASTER_PALETTE_SIZE) {
            topContrastingPalette.push({ r: 20, g: 20, b: 30, a: 255 });
        }

        // Start master palette transition
        // Current activeMasterDisplayPalette (which might be mid-transition itself) becomes the 'previous'
        previousMasterArtworkPalette = activeMasterDisplayPalette.map(c => ({ ...c }));
        currentTargetMasterArtworkPalette = topContrastingPalette;
        songPaletteTransitionProgress = 0.0; // Reset progress to start blending

        // Individual cell fades will continue, but now using the gradually changing master palette.
        // We don't need to reset individual cell states here unless we want an abrupt visual change
        // in their patterns when a new song starts. For smoother overall transition, let them continue.

        if (!globalAnimationId) {
            console.log("LYPLUS: Starting WebGL animation loop.");
            animateWebGLBackground();
        }
    };
    img.onerror = () => { /* ... (same error handling, set default palettes) ... */ };
    img.src = artworkUrl;
}

// --- Animation Loop ---
function animateWebGLBackground() {
    if (!gl || !glProgram) { /* ... stop ... */ return; }

    let needsCellStateTextureUpdate = false;

    // 1. Update Master Palette if transitioning
    if (songPaletteTransitionProgress < 1.0) {
        songPaletteTransitionProgress = Math.min(1.0, songPaletteTransitionProgress + SONG_PALETTE_TRANSITION_SPEED);
        for (let i = 0; i < MASTER_PALETTE_SIZE; i++) {
            const prevC = previousMasterArtworkPalette[i] || { r: 0, g: 0, b: 0, a: 0 };
            const targetC = currentTargetMasterArtworkPalette[i] || { r: 0, g: 0, b: 0, a: 0 };
            activeMasterDisplayPalette[i] = blendColors(prevC, targetC, songPaletteTransitionProgress);
        }
        updateMasterPaletteTexture(activeMasterDisplayPalette); // Upload blended master palette
        if (songPaletteTransitionProgress >= 1.0) {
            // Ensure final palette is exact
            activeMasterDisplayPalette = currentTargetMasterArtworkPalette.map(c => ({ ...c }));
            updateMasterPaletteTexture(activeMasterDisplayPalette);
        }
    } else if (activeMasterDisplayPalette !== currentTargetMasterArtworkPalette && currentTargetMasterArtworkPalette.length > 0) {
        // If transition is done, ensure active is set to target (e.g., after initial load)
        // This check prevents re-cloning every frame if already set.
        let needsFinalSet = activeMasterDisplayPalette.length !== currentTargetMasterArtworkPalette.length;
        if (!needsFinalSet) {
            for (let i = 0; i < MASTER_PALETTE_SIZE; ++i) {
                if (!activeMasterDisplayPalette[i] || !currentTargetMasterArtworkPalette[i] ||
                    activeMasterDisplayPalette[i].r !== currentTargetMasterArtworkPalette[i].r ||
                    activeMasterDisplayPalette[i].g !== currentTargetMasterArtworkPalette[i].g ||
                    activeMasterDisplayPalette[i].b !== currentTargetMasterArtworkPalette[i].b ||
                    activeMasterDisplayPalette[i].a !== currentTargetMasterArtworkPalette[i].a) {
                    needsFinalSet = true; break;
                }
            }
        }
        if (needsFinalSet) {
            activeMasterDisplayPalette = currentTargetMasterArtworkPalette.map(c => ({ ...c }));
            updateMasterPaletteTexture(activeMasterDisplayPalette);
        }
    }

    // 2. Update state for each display cell (CPU side)
    // This logic uses indices into the (now potentially transitioning) activeMasterDisplayPalette
    if (activeMasterDisplayPalette.length === MASTER_PALETTE_SIZE) {
        for (let i = 0; i < TOTAL_DISPLAY_CELLS; i++) {
            const state = displayCellStates[i];
            state.progress += state.speed;

            if (state.progress >= 1.0) {
                state.progress = 0.0;
                state.sourceIdx = state.targetIdx;

                // Assign target colors randomly
                let newTarget = Math.floor(Math.random() * MASTER_PALETTE_SIZE);
                if (MASTER_PALETTE_SIZE > 1) {
                    while (newTarget === state.sourceIdx) {
                        newTarget = Math.floor(Math.random() * MASTER_PALETTE_SIZE);
                    }
                }
                state.targetIdx = newTarget;
                state.speed = CELL_FADE_SPEED_BASE + (Math.random() * CELL_FADE_SPEED_VARIATION * 2) - CELL_FADE_SPEED_VARIATION;
                needsCellStateTextureUpdate = true;
            } else if (state.progress < 0.0 && state.speed < 0) {
                state.progress = 1.0;
                needsCellStateTextureUpdate = true;
            } else {
                needsCellStateTextureUpdate = true; // Update if progress changed
            }
        }
    }

    if (needsCellStateTextureUpdate) {
        updateCellStateTexture();
    }

    // 3. WebGL Rendering (same as before)
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(glProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(a_positionLocation);
    gl.vertexAttribPointer(a_positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, paletteTexture); // This is activeMasterDisplayPalette
    gl.uniform1i(u_paletteTextureLocation, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, cellStateTexture);
    gl.uniform1i(u_cellStateTextureLocation, 1);
    gl.uniform2f(u_resolutionLocation, webglCanvas.width, webglCanvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    globalAnimationId = requestAnimationFrame(animateWebGLBackground);
}

// --- updateCellStateTexture (same as before)
function updateCellStateTexture() {
    if (!gl || !cellStateTexture || displayCellStates.length !== TOTAL_DISPLAY_CELLS) return;
    const textureData = new Uint8Array(TOTAL_DISPLAY_CELLS * 4);
    const normalizer = Math.max(1, MASTER_PALETTE_SIZE - 1);

    for (let i = 0; i < TOTAL_DISPLAY_CELLS; i++) {
        const state = displayCellStates[i];
        textureData[i * 4 + 0] = Math.round((state.sourceIdx / normalizer) * 255);
        textureData[i * 4 + 1] = Math.round((state.targetIdx / normalizer) * 255);
        textureData[i * 4 + 2] = Math.round(Math.min(1.0, Math.max(0.0, state.progress)) * 255); // Clamp progress 0-1
        textureData[i * 4 + 3] = 255;
    }
    gl.bindTexture(gl.TEXTURE_2D, cellStateTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, DISPLAY_GRID_WIDTH, DISPLAY_GRID_HEIGHT, 0, gl.RGBA, gl.UNSIGNED_BYTE, textureData);
}

// Ensure all helper functions are defined
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

function LYPLUS_handleResize() {
    if (!gl || !webglCanvas) return;
    const displayWidth = webglCanvas.clientWidth;
    const displayHeight = webglCanvas.clientHeight;
    if (webglCanvas.width !== displayWidth || webglCanvas.height !== displayHeight) {
        webglCanvas.width = displayWidth;
        webglCanvas.height = displayHeight;
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    }
}

function calculateLuminance(color) {
    const a = [color.r, color.g, color.b].map(v => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

function calculateContrastRatio(color1, color2) {
    const lum1 = calculateLuminance(color1);
    const lum2 = calculateLuminance(color2);
    const brightest = Math.max(lum1, lum2);
    const darkest = Math.min(lum1, lum2);
    return (brightest + 0.05) / (darkest + 0.05);
}

function getAverageColor(ctx, x, y, width, height) {
    if (width <= 0 || height <= 0) return { r: 0, g: 0, b: 0, a: 0 };
    try {
        const imageData = ctx.getImageData(x, y, Math.max(1, width), Math.max(1, height));
        const data = imageData.data;
        let r = 0, g = 0, b = 0, a = 0;
        const pixelCount = data.length / 4;
        if (pixelCount === 0) return { r: 0, g: 0, b: 0, a: 0 };
        for (let i = 0; i < data.length; i += 4) {
            r += data[i]; g += data[i + 1]; b += data[i + 2]; a += data[i + 3];
        }
        return {
            r: Math.round(r / pixelCount), g: Math.round(g / pixelCount),
            b: Math.round(b / pixelCount), a: Math.round(a / pixelCount)
        };
    } catch (e) {
        console.error("LYPLUS: Error in getAverageColor:", e, { x, y, width, height });
        return { r: 0, g: 0, b: 0, a: 255 };
    }
}
function blendColors(color1, color2, ratio) {
    const c1 = color1 || { r: 0, g: 0, b: 0, a: 255 };
    const c2 = color2 || { r: 0, g: 0, b: 0, a: 255 };
    // Ensure ratio is clamped between 0 and 1 for predictable blending
    const t = Math.max(0, Math.min(1, ratio));
    return {
        r: c1.r * (1 - t) + c2.r * t,
        g: c1.g * (1 - t) + c2.g * t,
        b: c1.b * (1 - t) + c2.b * t,
        a: c1.a * (1 - t) + c2.a * t
    };
}
window.addEventListener('message', (event) => {
    if (event.source === window && event.data && event.data.type === 'LYPLUS_updateFullScreenAnimatedBg') {
        LYPLUS_updateBlurBackground();
    }
});
