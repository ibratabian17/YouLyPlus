/**
 * lil Material 3 Expressive - Progress Bar
 * https://github.com/ibratabian17/M3E-UILib.git
 * This code are trying to replicate material 3 expressive design.
 * Due google not releasing m3e for the web properly.
 * It is responsive and stops animations when not visible to save resources.
 *
 * @fires seek - Dispatches a custom event with { detail: { progress } } when the user clicks/drags.
 */
class WavyProgressBar {
  /**
   * Start the squiggle animation
   * @param {element} element - The progressbar container
   */
  constructor(element) {
    this.container = typeof element === 'string' ? document.querySelector(element) : element;
    if (!this.container) throw new Error("WavyProgressBar: The provided element was not found.");

    this._injectCSS();
    this._initializeState();
    this._createDOM();
    this._setupEventListeners();
    this._animateBound = this._animate.bind(this);
  }

  // --- Public API ---
  /**
   * Update the seekbar progress
   * @param {float} progress - The float progress between 0-1
   */
  update(progress) {
    this.progress = Math.max(0, Math.min(1, progress));
    this._draw();
  }

  /**
   * Start the squiggle animation
   */
  play() {
    if (!this.hasInitializedLayout) {
      this.playAfterInit = true;
      return;
    }
    this.targetAmplitude = this.maxAmplitude;
    if (this.isVisible) {
      this._startAnimationLoop();
    }
  }

  /**
   * Pause
   */
  pause() {
    this.playAfterInit = false;
    this.targetAmplitude = 0;
    if (this.isVisible) {
      this._startAnimationLoop();
    }
  }

  // --- Private Methods ---

  _injectCSS() {
    if (document.getElementById('ibra-m3e-wavypbar-style')) return;

    const style = document.createElement('style');
    style.id = 'ibra-m3e-wavypbar-style';
    style.innerHTML = `
      .progress-container {
    --progress-stroke-width: 4;
    --wave-amplitude: 3;
    --wave-frequency: 0.16;
    --thumb-width: 5;
    --thumb-height: 20;
    --thumb-radius: 3;
    --track-color: #e0e0e052;
    --progress-color: #ffffff;
    --thumb-color: #ffffff;
    --primary-hover-color: #ffffff;
    --path-resolution: 4;
    --amplitude-ease-factor: 0.2;
}

      .progress-container svg { width: 100%; height: 100%; overflow: visible; }
      .progress-container .track, .progress-container .progress { fill: none; stroke-width: var(--progress-stroke-width); stroke-linecap: round; }
      .progress-container .track { stroke: var(--track-color); }
      .progress-container .progress { stroke: var(--progress-color); }
      .progress-container .thumb { fill: var(--thumb-color); rx: var(--thumb-radius); ry: var(--thumb-radius); will-change: transform; }
    `;
    document.head.appendChild(style);
  }

  _createDOM() {
    this.container.innerHTML = '';
    const svgNS = "http://www.w3.org/2000/svg";

    this.svg = document.createElementNS(svgNS, 'svg');
    this.svg.setAttribute('preserveAspectRatio', 'none');

    this.trackLineEl = document.createElementNS(svgNS, 'line');
    this.trackLineEl.classList.add('track');

    this.progressPathEl = document.createElementNS(svgNS, 'path');
    this.progressPathEl.classList.add('progress');

    this.thumbEl = document.createElementNS(svgNS, 'rect');
    this.thumbEl.classList.add('thumb');

    this.svg.appendChild(this.trackLineEl);
    this.svg.appendChild(this.progressPathEl);
    this.svg.appendChild(this.thumbEl);
    this.container.appendChild(this.svg);
  }

  _readCSSVars() {
    const style = getComputedStyle(this.container);

    const parseOrDefault = (v, d) => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : d;
    };

    const maxAmplitude = parseOrDefault(style.getPropertyValue('--wave-amplitude'), 3);
    const frequency = parseOrDefault(style.getPropertyValue('--wave-frequency'), 0.15);
    const thumbWidth = parseOrDefault(style.getPropertyValue('--thumb-width'), 5);
    const thumbHeight = parseOrDefault(style.getPropertyValue('--thumb-height'), 20);
    const pathResolution = parseOrDefault(style.getPropertyValue('--path-resolution'), 4);
    const amplitudeEaseFactor = parseOrDefault(style.getPropertyValue('--amplitude-ease-factor'), 0.2);

    const anyRead = style.getPropertyValue('--wave-amplitude').trim() !== '' ||
                    style.getPropertyValue('--wave-frequency').trim() !== '' ||
                    style.getPropertyValue('--thumb-width').trim() !== '';

    this.maxAmplitude = maxAmplitude;
    this.frequency = frequency;
    this.thumbWidth = thumbWidth;
    this.thumbHeight = thumbHeight;
    this.pathResolution = Math.max(1, pathResolution);
    this.amplitudeEaseFactor = Math.max(0.01, Math.min(1, amplitudeEaseFactor));

    return anyRead;
  }

  _initializeState() {
    this.progress = 0;
    this.animationId = null;
    this.waveOffset = 0;
    this.currentAmplitude = 0;
    this.targetAmplitude = 0;
    this.svgWidth = 0;
    this.svgHeight = 0;
    this.centerY = 0;
    this.isVisible = false;
    this.hasInitializedLayout = false;
    this.playAfterInit = false;
    this._pathSegments = [];
    this._cssRetryId = null;
  }

  _initializeElements() {
    this.thumbWidth = Number.isFinite(this.thumbWidth) ? this.thumbWidth : 5;
    this.thumbHeight = Number.isFinite(this.thumbHeight) ? this.thumbHeight : 20;

    this.thumbEl.setAttribute('width', this.thumbWidth);
    this.thumbEl.setAttribute('height', this.thumbHeight);
    this.thumbEl.setAttribute('x', -(this.thumbWidth / 2));
    this.trackLineEl.setAttribute('y1', this.centerY);
    this.trackLineEl.setAttribute('y2', this.centerY);
    this.thumbEl.setAttribute('y', this.centerY - (this.thumbHeight / 2));
  }

  _setupEventListeners() {
    this.container.addEventListener('click', (e) => {
      const rect = this.container.getBoundingClientRect();
      if (rect.width === 0) return;

      const clickX = e.clientX - rect.left;
      const progress = clickX / rect.width;
      this.container.dispatchEvent(new CustomEvent('seek', {
        detail: { progress: Math.max(0, Math.min(1, progress)) }
      }));
    });

    const resizeObserver = new ResizeObserver(entries => {
      for (let entry of entries) {
        this._onResize(entry.contentRect);
      }
    });
    resizeObserver.observe(this.container);

    const intersectionObserver = new IntersectionObserver(entries => {
      for (let entry of entries) {
        this._onVisibilityChange(entry.isIntersecting);
      }
    });
    intersectionObserver.observe(this.container);
  }

  _onResize(rect) {
    if (rect.width === 0 || rect.height === 0) {
      return;
    }

    this.svgWidth = rect.width;
    this.svgHeight = rect.height;
    this.centerY = this.svgHeight / 2;

    this.svg.setAttribute('viewBox', `0 0 ${this.svgWidth} ${this.svgHeight}`);
    this.trackLineEl.setAttribute('x2', this.svgWidth);

    if (!this.hasInitializedLayout) {
      this._tryInitLayout();
    } else {
      this._initializeElements();
      this._draw();
    }
  }

  _tryInitLayout() {
    if (this.hasInitializedLayout) return;
    if (this._cssRetryId) return;

    const attempt = () => {
      const cssPresent = this._readCSSVars();
      if (cssPresent || this._attemptCount > 6) {
        this._initializeElements();
        this.hasInitializedLayout = true;
        this._cssRetryId = null;
        this._attemptCount = 0;
        if (this.playAfterInit) {
          this.playAfterInit = false;
          this.play();
        }
        this._draw();
        return;
      }

      this._attemptCount = (this._attemptCount || 0) + 1;
      this._cssRetryId = requestAnimationFrame(attempt);
    };

    this._attemptCount = 0;
    this._cssRetryId = requestAnimationFrame(attempt);
  }

  _onVisibilityChange(isIntersecting) {
    this.isVisible = isIntersecting;
    if (this.isVisible) {
      if (this.targetAmplitude > 0 || this.currentAmplitude > 0) {
        this._startAnimationLoop();
      }
    } else {
      if (this.animationId) {
        cancelAnimationFrame(this.animationId);
        this.animationId = null;
      }
    }
  }

  _startAnimationLoop() {
    if (this.animationId) return;
    this.animationId = requestAnimationFrame(this._animateBound);
  }

  _animate() {
    let needsAnotherFrame = false;
    const amplitudeDiff = this.targetAmplitude - this.currentAmplitude;

    if (Math.abs(amplitudeDiff) > 0.01) {
      this.currentAmplitude += amplitudeDiff * this.amplitudeEaseFactor;
      needsAnotherFrame = true;
    } else if (this.currentAmplitude !== this.targetAmplitude) {
      this.currentAmplitude = this.targetAmplitude;
      needsAnotherFrame = true;
    }

    if (this.targetAmplitude > 0) {
      this.waveOffset += 0.3;
      needsAnotherFrame = true;
    }

    this._draw();

    if (needsAnotherFrame) {
      this.animationId = requestAnimationFrame(this._animateBound);
    } else {
      this.animationId = null;
    }
  }

  _draw() {
    // reportedly, our dying learning about math and writing this
    if (!this.hasInitializedLayout) return;

    const currentX = (Number.isFinite(this.progress) ? this.progress : 0) * this.svgWidth;
    
    if (this.currentAmplitude > 0.01 && currentX > 0) {
      this._pathSegments.length = 0;
      
      const startY = this.centerY + Math.sin(this.waveOffset * this.frequency) * this.currentAmplitude;
      this._pathSegments.push(`M 0 ${startY}`);
      
      for (let x = this.pathResolution; x <= currentX; x += this.pathResolution) {
        const y = this.centerY + Math.sin((x + this.waveOffset) * this.frequency) * this.currentAmplitude;
        this._pathSegments.push(` L ${x} ${y}`);
      }
      
      const endY = this.centerY + Math.sin((currentX + this.waveOffset) * this.frequency) * this.currentAmplitude;
      this._pathSegments.push(` L ${currentX} ${endY}`);
      
      this.progressPathEl.setAttribute('d', this._pathSegments.join(''));
    } else {
      this.progressPathEl.setAttribute('d', `M 0 ${this.centerY} L ${currentX} ${this.centerY}`);
    }

    this.trackLineEl.setAttribute('x1', currentX);
    this.thumbEl.style.transform = `translateX(${currentX}px)`;
  }
}