// --- WebGL & Animation State Variables ---
let gl = null;
let glProgram = null;
let blurProgram = null;
let webglCanvas = null;
let blurContainerElem = null;
let needsAnimation = false;

// Extension for VAO
let vaoExt = null;
let mainVAO = null;
let blurVAO = null;

// Uniform locations
let u_main_artworkTexture = null;
let u_main_transitionProgress = null;
let u_main_layerTransform = null; // [rotation, scale, offsetX, offsetY]

// Uniform locations
let u_blur_image = null;
let u_blur_resolution = null;
let u_blur_direction = null;
let u_blur_radius = null;

// WebGL objects
let positionBuffer;
let texCoordBuffer;
let currentArtworkTexture = null;
let previousArtworkTexture = null;

// Framebuffers
let renderFramebuffer = null;
let blurFramebuffer = null;
let renderTexture = null;
let blurTextureA = null;

// Constants
const BLUR_DOWNSAMPLE = 1;
const BLUR_RADIUS = 7;
const TARGET_FPS = 30;
const FRAME_INTERVAL = 1000 / TARGET_FPS;

// Animation State
let blurDimensions = { width: 0, height: 0 };
let canvasDimensions = { width: 0, height: 0 };
let currentTargetMasterArtworkPalette = {
    background: { r: 0, g: 0, b: 0 },
    primary: { r: 255, g: 255, b: 255 },
    secondary: { r: 200, g: 200, b: 200 }
};

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
let bgCheckInterval = null;
let bgObserver = null;

// Artwork Processing
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
        
        vec2 centered = (a_position * 0.5 + 0.5) - 0.5;
        centered.y = -centered.y; 
        
        centered -= offset;
        
        float s = sin(-rotation);
        float c = cos(-rotation);
        centered = vec2(centered.x * c - centered.y * s, centered.x * s + centered.y * c);
        
        centered /= scale;
        v_uv = centered + 0.5;
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
        } else {
            vec4 color = texture2D(u_artworkTexture, v_uv);
            gl_FragColor = vec4(color.rgb, color.a * u_transitionProgress);
        }
    }
`;

const blurFragmentShaderSource = `
    #ifdef GL_ES
    precision highp float;
    #endif

    varying vec2 v_texCoord;
    uniform sampler2D u_image;
    uniform vec2 u_resolution;
    uniform vec2 u_direction;
    uniform float u_blurRadius;

    float interleavedGradientNoise(vec2 uv) {
        return fract(52.9829189 * fract(dot(uv, vec2(0.06711056, 0.00583715))));
    }

    void main() {
        vec2 texelSize = 1.0 / u_resolution;
        vec2 step = u_direction * texelSize * (u_blurRadius * 0.3);
        
        vec4 color = texture2D(u_image, v_texCoord);
        float totalWeight = 1.0;
        
        float sigma = 9.0;
        float k = 2.0 * sigma * sigma;
        
        for (float i = 1.0; i <= 20.0; i++) {
            float w = exp(-(i * i) / k);
            vec2 offset = step * i;
            
            color += texture2D(u_image, v_texCoord + offset) * w;
            color += texture2D(u_image, v_texCoord - offset) * w;
            totalWeight += 2.0 * w;
        }

        vec3 finalColor = color.rgb / totalWeight;
        
        float noise = interleavedGradientNoise(gl_FragCoord.xy);
        finalColor += (noise - 0.5) / 255.0;

        gl_FragColor = vec4(finalColor, 1.0);
    }
`;

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
    blurVAO = null;
    glProgram = null;
    blurProgram = null;
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
        const el = document.querySelector('.image.ytmusic-player-bar') || document.querySelector('[data-test="current-media-imagery"] img');
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
        document.querySelector('#layout')?.classList.add("dynamic-player");
        document.querySelector('#wimp')?.classList.add("dynamic-player");
    }
    const existingContainer = document.querySelector('.lyplus-blur-container');
    if (existingContainer) existingContainer.remove();

    blurContainerElem = document.createElement('div');
    blurContainerElem.classList.add('lyplus-blur-container');
    webglCanvas = document.createElement('canvas');
    webglCanvas.id = 'lyplus-webgl-canvas';
    blurContainerElem.appendChild(webglCanvas);
    (document.querySelector('#wimp [data-test="now-playing"]') || document.querySelector('#layout') || document.body).prepend(blurContainerElem);

    const ctxAttribs = { alpha: false, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false };
    try {
        gl = webglCanvas.getContext('webgl', ctxAttribs) || webglCanvas.getContext('experimental-webgl', ctxAttribs);
    } catch (e) { }

    if (!gl) return null;

    if (bgObserver) bgObserver.disconnect();
    bgObserver = new MutationObserver((mutations) => {
        let isDetached = false;
        mutations.forEach(m => {
            Array.from(m.removedNodes).forEach(node => {
                if (node === blurContainerElem || node.contains?.(blurContainerElem)) {
                    isDetached = true;
                }
            });
        });

        if (isDetached) {
            checkBg();
        }
    });

    const parent = document.querySelector('#wimp') || document.querySelector('#layout') || document.body;
    bgObserver.observe(parent, { childList: true, subtree: true });

    // Enable VAO extension
    vaoExt = gl.getExtension('OES_vertex_array_object');

    webglCanvas.addEventListener('webglcontextlost', handleContextLost, false);
    webglCanvas.addEventListener('webglcontextrestored', handleContextRestored, false);

    // Shader Compilation
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const mainFragShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    const blurFragShader = createShader(gl, gl.FRAGMENT_SHADER, blurFragmentShaderSource);

    if (!vertexShader || !mainFragShader || !blurFragShader) return null;

    glProgram = createProgram(gl, vertexShader, mainFragShader);
    blurProgram = createProgram(gl, vertexShader, blurFragShader);

    // Locations - Main
    const a_pos = gl.getAttribLocation(glProgram, 'a_position');
    const a_tex = gl.getAttribLocation(glProgram, 'a_texCoord');
    u_main_artworkTexture = gl.getUniformLocation(glProgram, 'u_artworkTexture');
    u_main_transitionProgress = gl.getUniformLocation(glProgram, 'u_transitionProgress');
    u_main_layerTransform = gl.getUniformLocation(glProgram, 'u_layerTransform');

    // Locations - Blur
    const a_blur_pos = gl.getAttribLocation(blurProgram, 'a_position');
    const a_blur_tex = gl.getAttribLocation(blurProgram, 'a_texCoord');
    u_blur_image = gl.getUniformLocation(blurProgram, 'u_image');
    u_blur_resolution = gl.getUniformLocation(blurProgram, 'u_resolution');
    u_blur_direction = gl.getUniformLocation(blurProgram, 'u_direction');
    u_blur_radius = gl.getUniformLocation(blurProgram, 'u_blurRadius');

    // Buffers
    positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 1, -1, -1, 1,
        -1, 1, 1, -1, 1, 1
    ]), gl.STATIC_DRAW);

    texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        0, 0, 1, 0, 0, 1,
        0, 1, 1, 0, 1, 1
    ]), gl.STATIC_DRAW);

    // --- VAO Setup ---
    // Pre-record state for Main Program
    if (vaoExt) {
        mainVAO = vaoExt.createVertexArrayOES();
        vaoExt.bindVertexArrayOES(mainVAO);

        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.enableVertexAttribArray(a_pos);
        gl.vertexAttribPointer(a_pos, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.enableVertexAttribArray(a_tex);
        gl.vertexAttribPointer(a_tex, 2, gl.FLOAT, false, 0, 0);

        vaoExt.bindVertexArrayOES(null);

        // Pre-record state for Blur Program
        blurVAO = vaoExt.createVertexArrayOES();
        vaoExt.bindVertexArrayOES(blurVAO);

        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.enableVertexAttribArray(a_blur_pos);
        gl.vertexAttribPointer(a_blur_pos, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.enableVertexAttribArray(a_blur_tex);
        gl.vertexAttribPointer(a_blur_tex, 2, gl.FLOAT, false, 0, 0);

        vaoExt.bindVertexArrayOES(null);
    }

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

    // --- ATTACH TEXTURES TO FRAMEBUFFERS ---
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
    blurDimensions.width = w;
    blurDimensions.height = h;

    // Resize textures
    gl.bindTexture(gl.TEXTURE_2D, renderTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindTexture(gl.TEXTURE_2D, blurTextureA);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
}

function createDefaultTexture() {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([30, 30, 40, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return texture;
}

function LYPLUS_requestProcessNewArtwork(url) {
    if (!glProgram && !LYPLUS_setupBlurEffect()) return;
    if (artworkCheckTimeoutId) { clearTimeout(artworkCheckTimeoutId); artworkCheckTimeoutId = null; }

    let target = NO_ARTWORK_IDENTIFIER;

    if (typeof url === 'string' && url.startsWith('http')) {
        const isBase = ["https://music.youtube.com/", "https://www.youtube.com/"].includes(url);
        if (!isBase) {
            if (/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i.test(url) || /lh3\.googleusercontent\.com|ytimg\.com/i.test(url)) {
                target = url;
            }
        } else {
            // Temporary, recheck later
            artworkCheckTimeoutId = setTimeout(() => {
                const el = document.querySelector('.image.ytmusic-player-bar');
                LYPLUS_requestProcessNewArtwork(el ? el.src : null);
            }, ARTWORK_RECHECK_DELAY);
            return;
        }
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
    img.onerror = () => finalize(createDefaultTexture(), currentTargetMasterArtworkPalette);

    const pBrowser = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
    if (pBrowser && pBrowser.runtime) {
        pBrowser.runtime.sendMessage({ type: 'FETCH_IMAGE', url: currentProcessingArtworkIdentifier }, (response) => {
            if (pBrowser.runtime.lastError || !response || !response.success || !response.dataUrl) {
                console.error("LYPLUS: Failed to fetch image via background script", pBrowser.runtime.lastError || (response && response.error));
                finalize(createDefaultTexture(), currentTargetMasterArtworkPalette);
                return;
            }
            img.src = response.dataUrl;
        });
    } else {
        img.src = currentProcessingArtworkIdentifier;
    }
}

// Pre-allocate reusable transform arrays
const _layerParams = new Float32Array(4); // [rotation, scale, offsetX, offsetY]

function animateWebGLBackground(timestamp) {
    if (!gl) { globalAnimationId = null; return; }

    const elapsed = timestamp - lastDrawTime;
    if (elapsed < FRAME_INTERVAL) {
        globalAnimationId = requestAnimationFrame(animateWebGLBackground);
        return;
    }
    lastDrawTime = timestamp - (elapsed % FRAME_INTERVAL);

    const currentTime = lastDrawTime / 1000 - startTime;
    if (artworkTransitionProgress < 1.0) {
        artworkTransitionProgress = Math.min(1.0, artworkTransitionProgress + ARTWORK_TRANSITION_SPEED * 1.5); // Slightly faster transition
        if (artworkTransitionProgress >= 1.0) needsAnimation = false;
    }

    const shouldRender = (typeof currentSettings === 'undefined' || !currentSettings.lightweight || needsAnimation);

    // --- RENDER PASS ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, renderFramebuffer);
    gl.viewport(0, 0, canvasDimensions.width, canvasDimensions.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // it's Optional if drawing full screen quads over everything, but i think it's more safer to keep. <3

    gl.useProgram(glProgram);

    // Use VAO if available
    if (vaoExt) {
        vaoExt.bindVertexArrayOES(mainVAO);
    } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.enableVertexAttribArray(gl.getAttribLocation(glProgram, 'a_position'));
        gl.vertexAttribPointer(gl.getAttribLocation(glProgram, 'a_position'), 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.enableVertexAttribArray(gl.getAttribLocation(glProgram, 'a_texCoord'));
        gl.vertexAttribPointer(gl.getAttribLocation(glProgram, 'a_texCoord'), 2, gl.FLOAT, false, 0, 0);
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(u_main_artworkTexture, 0);

    // Draw logic for Cross-fading
    const drawLayers = (tex, progress) => {
        if (progress <= 0.001) return;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1f(u_main_transitionProgress, progress);

        for (let i = 0; i < 3; i++) {
            const rot = INITIAL_ROTATIONS[i] + (ROTATION_SPEEDS[i] * currentTime * ROTATION_POWER);

            const bx = LAYER_BASE_POSITIONS[i * 2];
            const by = LAYER_BASE_POSITIONS[i * 2 + 1];

            const offset = i * 0.33;
            const t = ((offset + PERIMETER_DIRECTION[i] * PERIMETER_SPEEDS[i] * currentTime) % 1.0);
            const angle = t * 6.283185307;
            const px = Math.abs(bx) * Math.cos(angle);
            const py = Math.abs(by) * Math.sin(angle);

            _layerParams[0] = rot;
            _layerParams[1] = LAYER_SCALES[i];
            _layerParams[2] = px;
            _layerParams[3] = py;

            gl.uniform4fv(u_main_layerTransform, _layerParams);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
    };

    if (artworkTransitionProgress < 1.0) drawLayers(previousArtworkTexture, 1.0 - artworkTransitionProgress);
    drawLayers(currentArtworkTexture, artworkTransitionProgress);

    if (vaoExt) vaoExt.bindVertexArrayOES(null);

    // --- BLUR PASS 1  ---
    gl.useProgram(blurProgram);
    gl.uniform1f(u_blur_radius, BLUR_RADIUS);

    if (vaoExt) {
        vaoExt.bindVertexArrayOES(blurVAO);
    } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.vertexAttribPointer(gl.getAttribLocation(blurProgram, 'a_position'), 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.vertexAttribPointer(gl.getAttribLocation(blurProgram, 'a_texCoord'), 2, gl.FLOAT, false, 0, 0);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, blurFramebuffer);
    gl.viewport(0, 0, blurDimensions.width, blurDimensions.height);
    gl.uniform2f(u_blur_direction, 1.0, 0.0);
    gl.uniform2f(u_blur_resolution, canvasDimensions.width, canvasDimensions.height);
    gl.bindTexture(gl.TEXTURE_2D, renderTexture);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // --- BLUR PASS 2 (Vertical to Screen) ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvasDimensions.width, canvasDimensions.height);
    gl.uniform2f(u_blur_direction, 0.0, 1.0);
    gl.uniform2f(u_blur_resolution, blurDimensions.width, blurDimensions.height);
    gl.bindTexture(gl.TEXTURE_2D, blurTextureA);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (vaoExt) vaoExt.bindVertexArrayOES(null);

    if (shouldRender) {
        globalAnimationId = requestAnimationFrame(animateWebGLBackground);
    } else {
        globalAnimationId = null;
    }
}

let bgCheckRetryTimeout = null;

function checkBg() {
    if (!blurContainerElem) return;

    if (bgCheckRetryTimeout) clearTimeout(bgCheckRetryTimeout);

    if (!document.querySelector('.lyplus-blur-container')) {
        console.log('LYPLUS: Reattaching blur container');
        const isTidal = document.querySelector('#wimp');
        let parent = null;

        if (isTidal) {
            parent = document.querySelector('#wimp [data-test="now-playing"]');
        } else {
            parent = document.querySelector('#layout');
        }

        if (parent) {
            parent.prepend(blurContainerElem);
            if (!globalAnimationId) globalAnimationId = requestAnimationFrame(animateWebGLBackground);
        } else {
            console.log('LYPLUS: Target parent not found yet, retrying in 100ms...');
            bgCheckRetryTimeout = setTimeout(checkBg, 100);
        }
    }
}


const ARTWORK_TRANSITION_SPEED = 0.02;

function LYPLUS_getSongPalette() {
    const c = currentTargetMasterArtworkPalette?.primary || { r: 255, g: 255, b: 255 };
    return { r: c.r, g: c.g, b: c.b, a: 255 };
}

window.addEventListener('message', (event) => {
    if (event.source === window && event.data?.type === 'LYPLUS_updateFullScreenAnimatedBg') {
        const el = document.querySelector('.image.ytmusic-player-bar') || document.querySelector('[data-test="current-media-imagery"] img');
        checkBg();
        LYPLUS_requestProcessNewArtwork(el ? el.src : null);
    }

    if (event.source === window && event.data?.type === 'LYPLUS_reattachBg') {
        checkBg();
    }
});