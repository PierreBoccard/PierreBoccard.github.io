/*
 * Cosmic web -> Void Size Function scroll-pinned animation
 * -----------------------------------------------------------------------------
 * Left half of the scene: TNG cosmic-web image with void circles appearing
 * one by one as the user scrolls.
 * Right half: a histogram-style Void Size Function plot. Each new void's
 * circle on the left draws a curved line toward the bin its radius
 * belongs to on the right, and that bin grows by one.
 *
 * 18 voids were auto-detected on the IllustrisTNG image at multiple spatial
 * scales (positions are encoded below in 1000-wide reference coords; the
 * JS scales them to the SVG image rectangle). Each void belongs to one of
 * 5 radius bins; together they reproduce a peaked VSF-like shape.
 *
 * No external libs. Block-comment style throughout to survive the Jekyll
 * compress.html layout.
 */

(function () {
    'use strict';

    var SVG_NS = 'http://www.w3.org/2000/svg';

    /* ===================================================================== */
    /* Geometry                                                              */
    /* ===================================================================== */

    /* SVG viewBox is 0 0 1800 920. */
    /* Cosmic web image is drawn at this rectangle */
    var IMG = { x: 10, y: 80, w: 800, h: 800 };
    /* VSF plot lives on the right half */
    var VSF = { x: 920, y: 80, w: 850, h: 800 };
    /* VSF inner plot box (data area) */
    var PLOT = { x: 1020, y: 200, w: 700, h: 560 };

    /* Voids picked from the TNG image. Coords are in [0..1000] reference
       space; we scale them to the IMG rectangle inside buildScene. */
    var VOIDS_REF = [
        /* small */
        { cx: 303.0, cy: 615.5, r: 27.5 },
        { cx: 241.5, cy: 670.5, r: 27.5 },
        /* small-medium */
        { cx: 701.5, cy: 292.0, r: 37.5 },
        { cx: 203.0, cy: 757.5, r: 37.5 },
        { cx: 590.0, cy: 179.5, r: 37.5 },
        { cx: 605.5, cy: 875.0, r: 37.5 },
        /* medium (peak of the size distribution) */
        { cx: 487.0, cy: 305.0, r: 47.5 },
        { cx: 530.0, cy: 435.0, r: 47.5 },
        { cx: 611.5, cy: 381.0, r: 47.5 },
        { cx: 302.5, cy: 878.0, r: 47.5 },
        { cx: 144.5, cy: 418.0, r: 47.5 },
        /* medium-large */
        { cx: 753.0, cy: 464.0, r: 62.5 },
        { cx: 562.5, cy: 646.0, r: 62.5 },
        { cx: 144.0, cy: 165.0, r: 62.5 },
        { cx: 836.5, cy: 348.0, r: 62.5 },
        /* large */
        { cx: 744.0, cy: 636.0, r: 80.0 },
        { cx: 364.0, cy: 417.5, r: 80.0 },
        { cx: 854.5, cy: 775.5, r: 80.0 }
    ];

    /* 5 radius bins. Each void's r maps to one bin index based on the
       midpoint, so the histogram has 5 bars. */
    var BIN_CENTRES = [27.5, 37.5, 47.5, 62.5, 80.0];
    var BIN_LABELS  = ['~15',  '~22',  '~28',  '~36',  '~46']; /* Mpc/h */

    /* Map a radius (in ref space) to a bin index. Use nearest centre. */
    function binFor(r) {
        var best = 0, bestD = Infinity;
        for (var i = 0; i < BIN_CENTRES.length; i++) {
            var d = Math.abs(r - BIN_CENTRES[i]);
            if (d < bestD) { bestD = d; best = i; }
        }
        return best;
    }

    /* Count of voids in each bin -- for axis scaling */
    var TOTAL_PER_BIN = [0, 0, 0, 0, 0];
    for (var _i = 0; _i < VOIDS_REF.length; _i++) {
        TOTAL_PER_BIN[binFor(VOIDS_REF[_i].r)]++;
    }
    var MAX_BIN_COUNT = Math.max.apply(null, TOTAL_PER_BIN);

    /* Reveal cadence */
    var N_VOIDS = VOIDS_REF.length;
    var N_BINS  = TOTAL_PER_BIN.length;

    /* Build the VISITS sequence:
         for each bin (small radius -> large)
            for each void in this bin: visit = { type: 'reveal', voidIdx, binIdx }
            one extra visit per bin = { type: 'fade', binIdx }
       That extra "fade" visit lets the bin's connectors fade out before the
       next bin's voids start to appear. */
    var VISITS = [];
    var voidRevealVisit = new Array(N_VOIDS);     /* per-void: index in VISITS */
    var binFadeVisit    = new Array(N_BINS);      /* per-bin: index in VISITS */
    for (var bb = 0; bb < N_BINS; bb++) {
        for (var ii = 0; ii < VOIDS_REF.length; ii++) {
            if (binFor(VOIDS_REF[ii].r) === bb) {
                VISITS.push({ type: 'reveal', voidIdx: ii, binIdx: bb });
                voidRevealVisit[ii] = VISITS.length - 1;
            }
        }
        VISITS.push({ type: 'fade', binIdx: bb });
        binFadeVisit[bb] = VISITS.length - 1;
    }
    var N_VISITS = VISITS.length;       /* 18 reveal + 5 fade = 23 */

    /* ===================================================================== */
    /* Utilities                                                             */
    /* ===================================================================== */

    function svgEl(name, attrs) {
        var el = document.createElementNS(SVG_NS, name);
        if (attrs) for (var k in attrs) el.setAttribute(k, attrs[k]);
        return el;
    }
    function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

    /* Scale a (cx, cy, r) from the 1000-wide reference into IMG SVG coords. */
    function scaleVoid(v) {
        var s = IMG.w / 1000.0;
        return {
            cx: IMG.x + v.cx * s,
            cy: IMG.y + v.cy * s,
            r:  v.r * s,
            bin: binFor(v.r)
        };
    }
    var VOIDS = VOIDS_REF.map(scaleVoid);

    /* Bin geometry: x-position of the bar, x-position of the bin centre on
       the x-axis, etc. */
    var BIN_W = PLOT.w / BIN_CENTRES.length;
    function binX(binIdx) {
        return PLOT.x + binIdx * BIN_W + BIN_W * 0.5;
    }
    function barX(binIdx) {
        return PLOT.x + binIdx * BIN_W + BIN_W * 0.18;
    }
    var BAR_W = BIN_W * 0.64;
    /* y position of the top of a bar containing `count` voids (linear scale
       from 0..MAX_BIN_COUNT mapped to PLOT.y+PLOT.h .. PLOT.y) */
    function barTopY(count) {
        var fr = count / MAX_BIN_COUNT;
        return PLOT.y + PLOT.h * (1 - fr);
    }

    /* ===================================================================== */
    /* Scene construction                                                    */
    /* ===================================================================== */

    function buildScene(scrolly) {
        var svg = scrolly.querySelector('.cosmic-scene');
        if (!svg) return null;

        /* ---- VSF axes, ticks, grid, title -------------------------------- */
        var axesG = svgEl('g', { 'class': 'vsf-axes' });
        /* axes lines */
        axesG.appendChild(svgEl('line', {
            x1: PLOT.x, y1: PLOT.y,
            x2: PLOT.x, y2: PLOT.y + PLOT.h
        }));
        axesG.appendChild(svgEl('line', {
            x1: PLOT.x,             y1: PLOT.y + PLOT.h,
            x2: PLOT.x + PLOT.w,    y2: PLOT.y + PLOT.h
        }));
        /* x-axis label */
        var xLabel = svgEl('text', {
            x: PLOT.x + PLOT.w / 2, y: PLOT.y + PLOT.h + 70,
            'class': 'vsf-axis-label', 'text-anchor': 'middle'
        });
        xLabel.textContent = 'effective void radius  R  [ h^-1 Mpc ]';
        axesG.appendChild(xLabel);
        /* y-axis label (rotated) */
        var yLabel = svgEl('text', {
            x: PLOT.x - 75, y: PLOT.y + PLOT.h / 2,
            'class': 'vsf-axis-label', 'text-anchor': 'middle',
            transform: 'rotate(-90 ' + (PLOT.x - 75) + ' ' + (PLOT.y + PLOT.h / 2) + ')'
        });
        yLabel.textContent = 'number of voids per bin';
        axesG.appendChild(yLabel);
        /* x-axis ticks under each bin */
        for (var b = 0; b < BIN_CENTRES.length; b++) {
            axesG.appendChild(svgEl('line', {
                x1: binX(b), y1: PLOT.y + PLOT.h,
                x2: binX(b), y2: PLOT.y + PLOT.h + 8,
                'class': 'vsf-tick'
            }));
            var t = svgEl('text', {
                x: binX(b), y: PLOT.y + PLOT.h + 30,
                'class': 'vsf-tick-label', 'text-anchor': 'middle'
            });
            t.textContent = BIN_LABELS[b];
            axesG.appendChild(t);
        }
        /* y-axis ticks */
        for (var yt = 0; yt <= MAX_BIN_COUNT; yt++) {
            var yy = barTopY(yt);
            axesG.appendChild(svgEl('line', {
                x1: PLOT.x - 8, y1: yy, x2: PLOT.x, y2: yy,
                'class': 'vsf-tick'
            }));
            var tl = svgEl('text', {
                x: PLOT.x - 14, y: yy + 5,
                'class': 'vsf-tick-label', 'text-anchor': 'end'
            });
            tl.textContent = yt;
            axesG.appendChild(tl);
            /* faint horizontal gridline */
            axesG.appendChild(svgEl('line', {
                x1: PLOT.x, y1: yy, x2: PLOT.x + PLOT.w, y2: yy,
                'class': 'vsf-grid'
            }));
        }
        /* Title */
        var title = svgEl('text', {
            x: VSF.x + VSF.w / 2, y: VSF.y + 60,
            'class': 'vsf-title', 'text-anchor': 'middle'
        });
        title.textContent = 'VOID  SIZE  FUNCTION';
        axesG.appendChild(title);
        var subtitle = svgEl('text', {
            x: VSF.x + VSF.w / 2, y: VSF.y + 95,
            'class': 'vsf-subtitle', 'text-anchor': 'middle'
        });
        subtitle.textContent = 'one void at a time';
        axesG.appendChild(subtitle);
        svg.appendChild(axesG);

        /* ---- Theoretical VSF curve (faint guide under the bars) -------- */
        var curveG = svgEl('g', { 'class': 'vsf-curve' });
        /* Use a Sheth-vdW-like peaked shape: f(r) = A * r^a * exp(-(r/r0)^b)
           parametrised so the peak sits near bin 2 (the data peak). */
        var theoryPts = [];
        var r0 = 50, A = 0.0009, a = 2.1, b = 2.4;
        var nPts = 220;
        var rMin = BIN_CENTRES[0] - 8;
        var rMax = BIN_CENTRES[BIN_CENTRES.length - 1] + 8;
        var topY = MAX_BIN_COUNT + 0.4;     /* normalise so peak fits */
        var theoryMax = 0;
        for (var i = 0; i < nPts; i++) {
            var rr = rMin + (rMax - rMin) * (i / (nPts - 1));
            var v = A * Math.pow(rr, a) * Math.exp(-Math.pow(rr / r0, b));
            if (v > theoryMax) theoryMax = v;
            theoryPts.push([rr, v]);
        }
        /* Map theory to plot coords. We tie the theory's peak to MAX_BIN_COUNT
           so the curve naturally sits at the bar tops. */
        var d = '';
        for (var j = 0; j < theoryPts.length; j++) {
            var rr2 = theoryPts[j][0];
            var vv  = theoryPts[j][1];
            var binFrac = (rr2 - rMin) / (rMax - rMin);
            var px = PLOT.x + PLOT.w * binFrac;
            var py = PLOT.y + PLOT.h * (1 - (vv / theoryMax) * (MAX_BIN_COUNT / (MAX_BIN_COUNT + 0.4)));
            d += (j === 0 ? 'M' : ' L') + px.toFixed(1) + ',' + py.toFixed(1);
        }
        curveG.appendChild(svgEl('path', { d: d, 'class': 'theory-line' }));
        /* soft fill under the curve */
        var dFill = d + ' L' + (PLOT.x + PLOT.w) + ',' + (PLOT.y + PLOT.h) +
                          ' L' + PLOT.x         + ',' + (PLOT.y + PLOT.h) + ' Z';
        curveG.appendChild(svgEl('path', { d: dFill, 'class': 'theory-fill' }));
        svg.appendChild(curveG);

        /* ---- Histogram bars (one per bin) ------------------------------ */
        var barsG = svgEl('g', { 'class': 'bars' });
        var bars = [];
        for (var bb = 0; bb < BIN_CENTRES.length; bb++) {
            var bar = svgEl('rect', {
                x: barX(bb), y: PLOT.y + PLOT.h,
                width: BAR_W, height: 0,
                'class': 'bin-bar'
            });
            barsG.appendChild(bar);
            bars.push(bar);
        }
        svg.appendChild(barsG);

        /* Count text above each bar */
        var countTexts = [];
        for (var bb2 = 0; bb2 < BIN_CENTRES.length; bb2++) {
            var ct = svgEl('text', {
                x: barX(bb2) + BAR_W / 2,
                y: PLOT.y + PLOT.h - 6,
                'class': 'bin-count', 'text-anchor': 'middle'
            });
            ct.textContent = '';
            barsG.appendChild(ct);
            countTexts.push(ct);
        }

        /* ---- Void circles on the cosmic web image ---------------------- */
        var voidsG = svgEl('g', { 'class': 'voids' });
        var voidCircles = [];
        for (var v = 0; v < VOIDS.length; v++) {
            var V = VOIDS[v];
            /* faint inner fill */
            var fill = svgEl('circle', {
                cx: V.cx, cy: V.cy, r: V.r,
                'class': 'void-fill'
            });
            /* dashed cyan outline */
            var ring = svgEl('circle', {
                cx: V.cx, cy: V.cy, r: V.r,
                'class': 'void-ring'
            });
            voidsG.appendChild(fill);
            voidsG.appendChild(ring);
            voidCircles.push({ fill: fill, ring: ring });
        }
        svg.appendChild(voidsG);

        /* ---- Connector lines (one per void) ---------------------------- */
        var connectorsG = svgEl('g', { 'class': 'connectors' });
        var connectors = [];
        for (var v2 = 0; v2 < VOIDS.length; v2++) {
            var con = svgEl('path', { d: '', 'class': 'void-connector' });
            connectorsG.appendChild(con);
            connectors.push(con);
        }
        svg.appendChild(connectorsG);

        return {
            svg: svg,
            voidCircles: voidCircles,
            connectors: connectors,
            bars: bars,
            countTexts: countTexts
        };
    }

    /* ===================================================================== */
    /* Progress -> scene                                                     */
    /* ===================================================================== */

    function applyProgress(state, progress, opts) {
        if (!state) return;
        progress = clamp(progress, 0, 1);
        var hudCount = opts && opts.hudCount;
        var hudRadius = opts && opts.hudRadius;
        var hudBar = opts && opts.hudBar;

        /* The scroll progress now maps to N_VISITS, which is N_VOIDS reveal
           visits interleaved with one fade visit per bin (so the bin's
           connectors fade out before the next bin starts). */
        var visitsF = progress * N_VISITS;
        var v = Math.min(N_VISITS - 1, Math.floor(visitsF));
        var withinT = clamp(visitsF - v, 0, 1);
        var currentVisit = VISITS[v];

        /* ---- Per-bin counts (fractional during a reveal-in-progress) -- */
        var counts = [0, 0, 0, 0, 0];
        for (var ii = 0; ii < N_VOIDS; ii++) {
            var rv = voidRevealVisit[ii];
            var bi = VOIDS[ii].bin;
            if (rv < v) counts[bi] += 1;
            else if (rv === v && currentVisit.type === 'reveal') counts[bi] += withinT;
        }

        /* ---- Per-void state ------------------------------------------ */
        for (var i = 0; i < N_VOIDS; i++) {
            var V = VOIDS[i];
            var rev = voidRevealVisit[i];
            var bIdx = V.bin;
            var fadeV = binFadeVisit[bIdx];

            /* Circle reveal: monotonic once shown, stays visible forever. */
            var revealT;
            if (v < rev) revealT = 0;
            else if (v === rev && currentVisit.type === 'reveal') revealT = withinT;
            else revealT = 1;
            state.voidCircles[i].fill.style.opacity = (0.30 * revealT).toFixed(3);
            state.voidCircles[i].ring.style.opacity = revealT.toFixed(3);
            state.voidCircles[i].ring.style.strokeDasharray = '6 5';

            /* Connector path: curved bezier from void to the top of the bin
               bar. Path recomputed every frame so it tracks the bar's
               CURRENT top (which moves up as voids feed in). */
            var binCenterX = barX(bIdx) + BAR_W / 2;
            var targetY    = barTopY(counts[bIdx]);
            var midX = (V.cx + binCenterX) * 0.5;
            var midY = Math.min(V.cy, targetY) - 60;
            var dPath = 'M' + V.cx.toFixed(1) + ',' + V.cy.toFixed(1) +
                        ' Q' + midX.toFixed(1) + ',' + midY.toFixed(1) +
                        ' '  + binCenterX.toFixed(1) + ',' + targetY.toFixed(1);
            state.connectors[i].setAttribute('d', dPath);

            /* Connector opacity lifecycle:
                 visit <  rev                                   -> 0
                 visit == rev (reveal frame)                    -> withinT (drawing in)
                 rev < visit < fadeV                            -> 1
                 visit == fadeV (this bin's dedicated fade)     -> 1 - withinT
                 visit >  fadeV                                 -> 0
               This is what gives the per-bin "connectors clear out then
               the next bin starts" effect. */
            var path = state.connectors[i];
            var conOp;
            if (v < rev) conOp = 0;
            else if (v === rev && currentVisit.type === 'reveal') conOp = withinT;
            else if (v < fadeV) conOp = 1;
            else if (v === fadeV && currentVisit.type === 'fade') conOp = 1 - withinT;
            else conOp = 0;
            path.style.opacity = conOp.toFixed(3);

            /* During the reveal frame, also animate stroke-dashoffset for the
               drawing-in effect. After the reveal, the line is fully drawn
               (offset 0). After the fade visit it's invisible anyway. */
            if (conOp > 0.001 && path.getTotalLength) {
                var totalLen = path.getTotalLength();
                path.style.strokeDasharray  = totalLen;
                var drawProg;
                if (v === rev && currentVisit.type === 'reveal') drawProg = withinT;
                else drawProg = 1;
                path.style.strokeDashoffset = (totalLen * (1 - drawProg)).toFixed(1);
            }
        }

        /* ---- Bars + count labels ------------------------------------- */
        for (var b = 0; b < state.bars.length; b++) {
            var c = counts[b];
            var topY = barTopY(c);
            var h = PLOT.y + PLOT.h - topY;
            state.bars[b].setAttribute('y', topY.toFixed(1));
            state.bars[b].setAttribute('height', Math.max(0, h).toFixed(1));
            state.countTexts[b].setAttribute('y', (topY - 6).toFixed(1));
            var nDisplay = Math.round(c);
            state.countTexts[b].textContent = nDisplay > 0 ? nDisplay : '';
        }

        /* ---- HUD ----------------------------------------------------- */
        var totalRevealed = 0;
        for (var jj = 0; jj < N_VOIDS; jj++) {
            if (voidRevealVisit[jj] < v) totalRevealed++;
            else if (voidRevealVisit[jj] === v &&
                     currentVisit.type === 'reveal' && withinT > 0.5) totalRevealed++;
        }
        if (hudCount) hudCount.textContent = totalRevealed + ' / ' + N_VOIDS;
        if (hudRadius) {
            var curBin = (currentVisit && currentVisit.binIdx !== undefined) ? currentVisit.binIdx : 0;
            hudRadius.textContent = 'R ~ ' + (BIN_LABELS[curBin] || '') + ' h^-1 Mpc';
        }
        if (hudBar) hudBar.style.width = (progress * 100).toFixed(1) + '%';
    }

    /* ===================================================================== */
    /* Wire scroll                                                           */
    /* ===================================================================== */

    function init() {
        var scrolly = document.getElementById('cosmicScrolly');
        if (!scrolly) return;
        var state = buildScene(scrolly);
        var hudCount = scrolly.querySelector('.scrolly-progress-label .count');
        var hudRadius = scrolly.querySelector('.scrolly-progress-label .radius');
        var hudBar   = scrolly.querySelector('.scrolly-progress-bar');

        function update() {
            var rect = scrolly.getBoundingClientRect();
            var vh = window.innerHeight;
            var total = scrolly.offsetHeight - vh;
            if (total <= 0) {
                applyProgress(state, 0, { hudCount: hudCount, hudRadius: hudRadius, hudBar: hudBar });
                return;
            }
            var scrolled = -rect.top;
            var p = clamp(scrolled / total, 0, 1);
            applyProgress(state, p, { hudCount: hudCount, hudRadius: hudRadius, hudBar: hudBar });
        }

        applyProgress(state, 0, { hudCount: hudCount, hudRadius: hudRadius, hudBar: hudBar });

        var ticking = false;
        window.addEventListener('scroll', function () {
            if (ticking) return;
            window.requestAnimationFrame(function () { update(); ticking = false; });
            ticking = true;
        }, { passive: true });
        window.addEventListener('resize', update, { passive: true });

        scrolly.classList.add('is-ready');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
