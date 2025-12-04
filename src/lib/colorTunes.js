
/** An JS Ported from Coffee code
 * All Credits may reserved to https://github.com/dannvix/ColorTunes
 **/ 


/**
 * PriorityQueue
 * A simple priority queue implementation required by MMCQ.
 */
class PriorityQueue {
    constructor(comparator) {
        this.comparator = comparator;
        this.contents = [];
        this.sorted = false;
    }

    sort() {
        this.contents.sort(this.comparator);
        this.sorted = true;
    }

    push(obj) {
        this.contents.push(obj);
        this.sorted = false;
    }

    peek(index) {
        if (!this.sorted) this.sort();
        index = index === undefined ? this.contents.length - 1 : index;
        return this.contents[index];
    }

    pop() {
        if (!this.sorted) this.sort();
        return this.contents.pop();
    }

    size() {
        return this.contents.length;
    }

    map(func) {
        return this.contents.map(func);
    }
}

/**
 * MMCQ (Modified Media Cut Quantization)
 * Ported from the CoffeeScript version.
 */
class MMCQ {
    static sigbits = 5;
    static rshift = 8 - MMCQ.sigbits;

    constructor() {
        this.maxIterations = 1000;
        this.fractByPopulations = 0.75;
    }

    getColorIndex(r, g, b) {
        return (r << (2 * MMCQ.sigbits)) + (g << MMCQ.sigbits) + b;
    }

    getHisto(pixels) {
        const histoSize = 1 << (3 * MMCQ.sigbits);
        const histo = new Array(histoSize).fill(0);
        for (let pixel of pixels) {
            const r = pixel[0] >> MMCQ.rshift;
            const g = pixel[1] >> MMCQ.rshift;
            const b = pixel[2] >> MMCQ.rshift;
            const index = this.getColorIndex(r, g, b);
            histo[index] = (histo[index] || 0) + 1;
        }
        return histo;
    }

    cboxFromPixels(pixels, histo) {
        let rmin = 1000000, rmax = 0;
        let gmin = 1000000, gmax = 0;
        let bmin = 1000000, bmax = 0;

        for (let pixel of pixels) {
            const r = pixel[0] >> MMCQ.rshift;
            const g = pixel[1] >> MMCQ.rshift;
            const b = pixel[2] >> MMCQ.rshift;
            if (r < rmin) rmin = r;
            if (r > rmax) rmax = r;
            if (g < gmin) gmin = g;
            if (g > gmax) gmax = g;
            if (b < bmin) bmin = b;
            if (b > bmax) bmax = b;
        }
        return new ColorBox(rmin, rmax, gmin, gmax, bmin, bmax, histo);
    }

    medianCutApply(histo, cbox) {
        if (!cbox.count()) return;
        if (cbox.count() === 1) return [cbox.copy()];

        const rw = cbox.r2 - cbox.r1 + 1;
        const gw = cbox.g2 - cbox.g1 + 1;
        const bw = cbox.b2 - cbox.b1 + 1;
        const maxw = Math.max(rw, gw, bw);

        let total = 0;
        const partialsum = [];
        const lookaheadsum = [];
        let doCutColor = null;

        if (maxw === rw) {
            doCutColor = 'r';
            for (let r = cbox.r1; r <= cbox.r2; r++) {
                let sum = 0;
                for (let g = cbox.g1; g <= cbox.g2; g++) {
                    for (let b = cbox.b1; b <= cbox.b2; b++) {
                        sum += (histo[this.getColorIndex(r, g, b)] || 0);
                    }
                }
                total += sum;
                partialsum[r] = total;
            }
        } else if (maxw === gw) {
            doCutColor = 'g';
            for (let g = cbox.g1; g <= cbox.g2; g++) {
                let sum = 0;
                for (let r = cbox.r1; r <= cbox.r2; r++) {
                    for (let b = cbox.b1; b <= cbox.b2; b++) {
                        sum += (histo[this.getColorIndex(r, g, b)] || 0);
                    }
                }
                total += sum;
                partialsum[g] = total;
            }
        } else {
            doCutColor = 'b';
            for (let b = cbox.b1; b <= cbox.b2; b++) {
                let sum = 0;
                for (let r = cbox.r1; r <= cbox.r2; r++) {
                    for (let g = cbox.g1; g <= cbox.g2; g++) {
                        sum += (histo[this.getColorIndex(r, g, b)] || 0);
                    }
                }
                total += sum;
                partialsum[b] = total;
            }
        }

        partialsum.forEach((d, i) => { lookaheadsum[i] = total - d; });

        const dim1 = doCutColor + '1';
        const dim2 = doCutColor + '2';

        for (let i = cbox[dim1]; i <= cbox[dim2]; i++) {
            if (partialsum[i] > total / 2) {
                const cbox1 = cbox.copy();
                const cbox2 = cbox.copy();
                const left = i - cbox[dim1];
                const right = cbox[dim2] - i;
                let d2;

                if (left <= right) {
                    d2 = Math.min(cbox[dim2] - 1, Math.floor(i + right / 2));
                } else {
                    d2 = Math.max(cbox[dim1], Math.floor(i - 1 - left / 2));
                }

                while (!partialsum[d2]) d2++;
                let count2 = lookaheadsum[d2];
                while (!count2 && partialsum[d2 - 1]) count2 = lookaheadsum[--d2];

                cbox1[dim2] = d2;
                cbox2[dim1] = cbox1[dim2] + 1;
                
                return [cbox1, cbox2];
            }
        }
    }

    quantize(pixels, maxcolors) {
        if (!pixels.length || maxcolors < 2 || maxcolors > 256) return false;

        const histo = this.getHisto(pixels);
        const cbox = this.cboxFromPixels(pixels, histo);
        
        const pq = new PriorityQueue((a, b) => {
            const va = a.count();
            const vb = b.count();
            return va > vb ? 1 : va < vb ? -1 : 0;
        });
        pq.push(cbox);

        const iter = (lh, target) => {
            let ncolors = 1;
            let niters = 0;
            while (niters < this.maxIterations) {
                const cbox = lh.pop();
                if (!cbox.count()) {
                    lh.push(cbox);
                    niters++;
                    continue;
                }
                const cboxes = this.medianCutApply(histo, cbox);
                const cbox1 = cboxes[0];
                const cbox2 = cboxes[1];

                if (!cbox1) return;
                lh.push(cbox1);
                if (cbox2) {
                    lh.push(cbox2);
                    ncolors++;
                }
                if (ncolors >= target) return;
                if (niters++ > this.maxIterations) return;
            }
        };

        iter(pq, this.fractByPopulations * maxcolors);

        const pq2 = new PriorityQueue((a, b) => {
            const va = a.count() * a.volume();
            const vb = b.count() * b.volume();
            return va > vb ? 1 : va < vb ? -1 : 0;
        });

        while (pq.size()) pq2.push(pq.pop());

        iter(pq2, maxcolors - pq2.size());

        const cmap = new ColorMap();
        while (pq2.size()) cmap.push(pq2.pop());

        return cmap;
    }
}

class ColorBox {
    constructor(r1, r2, g1, g2, b1, b2, histo) {
        this.r1 = r1; this.r2 = r2;
        this.g1 = g1; this.g2 = g2;
        this.b1 = b1; this.b2 = b2;
        this.histo = histo;
    }

    volume(forced) {
        if (!this._volume || forced) {
            this._volume = (this.r2 - this.r1 + 1) * (this.g2 - this.g1 + 1) * (this.b2 - this.b1 + 1);
        }
        return this._volume;
    }

    count(forced) {
        if (!this._count_set || forced) {
            let numpix = 0;
            const MMCQ_inst = MMCQ; // Reference class for static methods if needed or simplified logic
            for (let r = this.r1; r <= this.r2; r++) {
                for (let g = this.g1; g <= this.g2; g++) {
                    for (let b = this.b1; b <= this.b2; b++) {
                        const index = (r << (2 * MMCQ.sigbits)) + (g << MMCQ.sigbits) + b;
                        numpix += (this.histo[index] || 0);
                    }
                }
            }
            this._count_set = true;
            this._count = numpix;
        }
        return this._count;
    }

    copy() {
        return new ColorBox(this.r1, this.r2, this.g1, this.g2, this.b1, this.b2, this.histo);
    }

    average(forced) {
        if (!this._average || forced) {
            const mult = 1 << (8 - MMCQ.sigbits);
            let total = 0, rsum = 0, gsum = 0, bsum = 0;
            
            for (let r = this.r1; r <= this.r2; r++) {
                for (let g = this.g1; g <= this.g2; g++) {
                    for (let b = this.b1; b <= this.b2; b++) {
                        const index = (r << (2 * MMCQ.sigbits)) + (g << MMCQ.sigbits) + b;
                        const hval = this.histo[index] || 0;
                        total += hval;
                        rsum += (hval * (r + 0.5) * mult);
                        gsum += (hval * (g + 0.5) * mult);
                        bsum += (hval * (b + 0.5) * mult);
                    }
                }
            }
            if (total) {
                this._average = [
                    Math.floor(rsum / total),
                    Math.floor(gsum / total),
                    Math.floor(bsum / total)
                ];
            } else {
                this._average = [
                    Math.floor(mult * (this.r1 + this.r2 + 1) / 2),
                    Math.floor(mult * (this.g1 + this.g2 + 1) / 2),
                    Math.floor(mult * (this.b1 + this.b2 + 1) / 2)
                ];
            }
        }
        return this._average;
    }
}

class ColorMap {
    constructor() {
        this.cboxes = new PriorityQueue((a, b) => {
            const va = a.cbox.count() * a.cbox.volume();
            const vb = b.cbox.count() * b.cbox.volume();
            return va > vb ? 1 : va < vb ? -1 : 0;
        });
    }

    push(cbox) {
        this.cboxes.push({ cbox: cbox, color: cbox.average() });
    }

    palette() {
        return this.cboxes.map(cbox => cbox.color);
    }
    
    // Additional helper to get raw cboxes as used in ColorTunes
    getBoxList() {
        return this.cboxes.contents; 
    }
}

/**
 * ColorTunes
 * The replicator of the "launch" logic to find song palette.
 */
class ColorTunes {
    static getColorMap(pixels, maxColors = 8) {
        const mmcq = new MMCQ();
        return mmcq.quantize(pixels, maxColors);
    }

    static colorDist(a, b) {
        const square = n => n * n;
        return square(a[0] - b[0]) + square(a[1] - b[1]) + square(a[2] - b[2]);
    }

    /**
     * Replicates the logic in @launch to find Bg, Fg, and Fg2
     * @param {HTMLImageElement|HTMLCanvasElement} imageSource 
     */
    static getSongPalette(imageSource) {
        // Create canvas to extract pixels
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        
        let width, height;
        if(imageSource.naturalWidth) {
             width = 300;
             height = Math.round(imageSource.naturalHeight * (300 / imageSource.naturalWidth));
        } else {
             width = 300;
             height = 300; // Fallback
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(imageSource, 0, 0, width, height);
        
        const getPixels = (sx, sy, w, h) => {
            const imgData = ctx.getImageData(sx, sy, w, h).data;
            const pixels = [];
            for (let i = 0; i < imgData.length; i += 4) {
                // Ignore transparent
                if (imgData[i+3] < 128) continue;
                pixels.push([imgData[i], imgData[i+1], imgData[i+2]]);
            }
            return pixels;
        };

        // 1. Get Background Color (Sample bottom left area based on ColorTunes logic)
        // Original logic: (image.width * 0.5), (image.height) -- this seems to sample a strip?
        // Actually, ColorTunes.coffee says: sx=0, sy=0, w=width*0.5, h=height.
        const bgPixels = getPixels(0, 0, width * 0.5, height);
        const bgColorMap = this.getColorMap(bgPixels, 4);
        
        // Convert to array of {count, rgb} and sort
        let bgPalette = bgColorMap.getBoxList().map(item => ({
            count: item.cbox.count(),
            rgb: item.color
        })).sort((a, b) => b.count - a.count);

        const bgColor = bgPalette[0] ? bgPalette[0].rgb : [0,0,0];

        // 2. Get Foreground Palette (Sample whole image)
        const fgPixels = getPixels(0, 0, width, height);
        const fgColorMap = this.getColorMap(fgPixels, 10);
        
        let fgPalette = fgColorMap.getBoxList().map(item => ({
            count: item.cbox.count(),
            rgb: item.color
        })).sort((a, b) => b.count - a.count);

        // 3. Find Primary Foreground Color (Furthest distance from BG)
        let fgColor = null;
        let maxDist = 0;
        
        for (let color of fgPalette) {
            const dist = this.colorDist(bgColor, color.rgb);
            if (dist > maxDist) {
                maxDist = dist;
                fgColor = color.rgb;
            }
        }
        if (!fgColor) fgColor = [255, 255, 255]; // Fallback

        // 4. Find Secondary Foreground Color (Furthest from BG, not equal to FG1)
        let fgColor2 = null;
        maxDist = 0;

        for (let color of fgPalette) {
            const dist = this.colorDist(bgColor, color.rgb);
            const isSame = (color.rgb[0] === fgColor[0] && color.rgb[1] === fgColor[1] && color.rgb[2] === fgColor[2]);
            
            if (dist > maxDist && !isSame) {
                maxDist = dist;
                fgColor2 = color.rgb;
            }
        }
        if (!fgColor2) fgColor2 = fgColor;

        // Return Object format compatible with your existing code
        return {
            background: { r: bgColor[0], g: bgColor[1], b: bgColor[2] },
            primary: { r: fgColor[0], g: fgColor[1], b: fgColor[2] },
            secondary: { r: fgColor2[0], g: fgColor2[1], b: fgColor2[2] }
        };
    }
}
