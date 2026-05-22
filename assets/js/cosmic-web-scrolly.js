/*
 * Cosmic web -> Void Size Function scroll-pinned animation  (v2)
 * -----------------------------------------------------------------------------
 * Side-by-side scene:
 *   * LEFT  -- cosmic-web image from the cosmic-web-explorer simulation
 *   * RIGHT -- a VSF plot with axes, theoretical curve and 8 markers
 *
 * 28 voids were auto-detected on the image at 8 distinct spatial scales.
 * They are revealed in ascending radius order (smallest first), one per
 * scroll-tick. As each void appears:
 *   - a dashed cyan circle fades in on the image
 *   - a curved connector line draws from the void to the marker for its
 *     bin on the right (stroke-dashoffset animation)
 *   - the bin's marker rises up the y-axis as the count grows
 *
 * After every void in a given bin has been revealed, the connectors for
 * THAT bin fade out and the next bin's voids begin to appear. The result
 * is a marker-based VSF that builds left-to-right.
 *
 * No external libs. Block-comment style throughout to survive Jekyll's
 * compress.html layout.
 */

(function () {
    'use strict';

    var SVG_NS = 'http://www.w3.org/2000/svg';

    /* ===================================================================== */
    /* Geometry                                                              */
    /* ===================================================================== */

    /* SVG viewBox is 0 0 1800 900 (2:1). Side-by-side layout. */
    /* Cosmic web image on the LEFT, native aspect ~1.84:1 */
    var IMG = { x: 20, y: 70, w: 1160, h: 630 };
    /* VSF panel on the RIGHT */
    var VSF = { x: 1230, y: 70, w: 550, h: 760 };
    /* Inner plot area inside the VSF panel */
    var PLOT = { x: 1310, y: 200, w: 440, h: 580 };

    /* 28 voids, 8 distinct radii. Reference coords are 0..1000 horizontally
       (and proportional vertically); JS scales them to the IMG rectangle.
       Sorted by radius ascending so the reveal goes smallest -> largest. */
    var VOIDS_REF = [
        { cx: 263.7, cy: 492.7, r: 10.9 },
        { cx: 157.4, cy: 237.5, r: 10.9 },
        { cx: 323.2, cy: 126.4, r: 14.6 },
        { cx: 515.8, cy: 233.9, r: 14.6 },
        { cx: 735.1, cy: 217.5, r: 14.6 },
        { cx: 410.1, cy:  93.6, r: 19.4 },
        { cx: 829.3, cy: 406.4, r: 19.4 },
        { cx: 878.5, cy: 301.9, r: 19.4 },
        { cx: 420.4, cy: 380.9, r: 24.3 },
        { cx: 653.7, cy: 173.1, r: 24.3 },
        { cx: 480.0, cy:  64.4, r: 24.3 },
        { cx: 478.1, cy: 493.9, r: 24.3 },
        { cx: 206.0, cy: 270.4, r: 30.4 },
        { cx: 585.7, cy:  96.0, r: 30.4 },
        { cx: 864.5, cy: 229.6, r: 30.4 },
        { cx: 342.6, cy: 311.1, r: 30.4 },
        { cx: 230.9, cy: 334.1, r: 30.4 },
        { cx: 666.5, cy:  59.5, r: 37.7 },
        { cx: 321.4, cy: 440.5, r: 37.7 },
        { cx: 125.2, cy: 170.1, r: 37.7 },
        { cx: 586.3, cy: 324.4, r: 37.7 },
        { cx: 922.8, cy: 473.3, r: 37.7 },
        { cx: 848.7, cy:  82.0, r: 45.0 },
        { cx: 419.8, cy: 282.5, r: 45.0 },
        { cx: 555.9, cy: 418.6, r: 45.0 },
        { cx: 432.6, cy: 182.3, r: 45.0 },
        { cx: 675.6, cy: 283.1, r: 53.5 },
        { cx: 754.6, cy: 298.9, r: 53.5 }
    ];

    /* 8 unique bin radii (in 1000-wide reference units). Map each void to
       its bin by exact match -- the detection used these exact radii. */
    var BIN_RADII = [10.9, 14.6, 19.4, 24.3, 30.4, 37.7, 45.0, 53.5];
    /* Physical labels (rough Mpc/h) for the x-axis */
    var BIN_LABELS_MPC = ['9', '12', '16', '20', '25', '31', '37', '44'];
    var N_BINS = BIN_RADII.length;

    function binForR(r) {
        for (var i = 0; i < BIN_RADII.length; i++) {
            if (Math.abs(BIN_RADII[i] - r) < 0.05) return i;
        }
        /* fallback to nearest */
        var best = 0, bestD = Infinity;
        for (var j = 0; j < BIN_RADII.length; j++) {
            var d = Math.abs(BIN_RADII[j] - r);
            if (d < bestD) { bestD = d; best = j; }
        }
        return best;
    }

    /* Per-bin total count (for axis scaling) */
    var TOTAL_PER_BIN = new Array(N_BINS).fill(0);
    for (var _i = 0; _i < VOIDS_REF.length; _i++) {
        TOTAL_PER_BIN[binForR(VOIDS_REF[_i].r)]++;
    }
    var MAX_COUNT = Math.max.apply(null, TOTAL_PER_BIN);
    /* Y-axis goes a bit above the max so the top marker has breathing room */
    var Y_AXIS_MAX = Math.max(MAX_COUNT + 1, 6);

    /* Build the visits sequence:
         for each bin (small radius -> large)
            for each void in this bin: visit = reveal
            one extra visit = fade (connectors for this bin fade out)
    */
    var VISITS = [];
    var voidIdxsByBin = []; /* per bin, indices of voids in VOIDS_REF */
    for (var b = 0; b < N_BINS; b++) {
        voidIdxsByBin[b] = [];
        for (var i = 0; i < VOIDS_REF.length; i++) {
            if (binForR(VOIDS_REF[i].r) === b) voidIdxsByBin[b].push(i);
        }
        for (var k = 0; k < voidIdxsByBin[b].length; k++) {
            VISITS.push({ type: 'reveal', voidIdx: voidIdxsByBin[b][k], binIdx: b });
        }
        VISITS.push({ type: 'fade', binIdx: b });
    }
    var N_VISITS = VISITS.length;
    /* Pre-compute per-void reveal-visit index and per-bin fade-visit index */
    var voidRevealVisit = new Array(VOIDS_REF.length);
    var binFadeVisit    = new Array(N_BINS);
    for (var vi = 0; vi < N_VISITS; vi++) {
        var V = VISITS[vi];
        if (V.type === 'reveal') voidRevealVisit[V.voidIdx] = vi;
        else binFadeVisit[V.binIdx] = vi;
    }

    /* ===================================================================== */
    /* Utility                                                               */
    /* ===================================================================== */

    function svgEl(name, attrs) {
        var el = document.createElementNS(SVG_NS, name);
        if (attrs) for (var k in attrs) el.setAttribute(k, attrs[k]);
        return el;
    }
    function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

    /* Scale a (cx, cy, r) from 1000-wide reference into the IMG rectangle.
       The reference is normalised against the source image WIDTH, so the
       same factor applies to all three. */
    function scaleVoid(v) {
        var s = IMG.w / 1000.0;
        return {
            cx: IMG.x + v.cx * s,
            cy: IMG.y + v.cy * s,
            r:  v.r * s,
            bin: binForR(v.r),
            refR: v.r
        };
    }
    var VOIDS = VOIDS_REF.map(scaleVoid);

    /* x-position of bin b's marker on the VSF plot */
    var BIN_GAP = PLOT.w / N_BINS;
    function binX(b) {
        return PLOT.x + BIN_GAP * (b + 0.5);
    }
    /* y-position for a given count value (linear scale 0..Y_AXIS_MAX) */
    function plotY(count) {
        return PLOT.y + PLOT.h * (1 - count / Y_AXIS_MAX);
    }

    /* ===================================================================== */
    /* Scene construction                                                    */
    /* ===================================================================== */

    function buildScene(scrolly) {
        var svg = scrolly.querySelector('.cosmic-scene');
        if (!svg) return null;

        /* --- VSF axes / ticks / labels --------------------------------- */
        var axes = svgEl('g', { 'class': 'vsf-axes' });
        /* axes lines */
        axes.appendChild(svgEl('line', {
            x1: PLOT.x, y1: PLOT.y,
            x2: PLOT.x, y2: PLOT.y + PLOT.h
        }));
        axes.appendChild(svgEl('line', {
            x1: PLOT.x,           y1: PLOT.y + PLOT.h,
            x2: PLOT.x + PLOT.w,  y2: PLOT.y + PLOT.h
        }));
        /* x ticks */
        for (var b = 0; b < N_BINS; b++) {
            var bx = binX(b);
            axes.appendChild(svgEl('line', {
                x1: bx, y1: PLOT.y + PLOT.h,
                x2: bx, y2: PLOT.y + PLOT.h + 7,
                'class': 'vsf-tick'
            }));
            var t = svgEl('text', {
                x: bx, y: PLOT.y + PLOT.h + 28,
                'class': 'vsf-tick-label', 'text-anchor': 'middle'
            });
            t.textContent = BIN_LABELS_MPC[b];
            axes.appendChild(t);
        }
        /* y ticks */
        for (var yt = 0; yt <= Y_AXIS_MAX; yt++) {
            var yy = plotY(yt);
            axes.appendChild(svgEl('line', {
                x1: PLOT.x - 7, y1: yy, x2: PLOT.x, y2: yy,
                'class': 'vsf-tick'
            }));
            var ytxt = svgEl('text', {
                x: PLOT.x - 12, y: yy + 5,
                'class': 'vsf-tick-label', 'text-anchor': 'end'
            });
            ytxt.textContent = yt;
            axes.appendChild(ytxt);
            /* faint gridline */
            axes.appendChild(svgEl('line', {
                x1: PLOT.x, y1: yy, x2: PLOT.x + PLOT.w, y2: yy,
                'class': 'vsf-grid'
            }));
        }
        /* axis labels */
        var xLab = svgEl('text', {
            x: PLOT.x + PLOT.w / 2, y: PLOT.y + PLOT.h + 65,
            'class': 'vsf-axis-label', 'text-anchor': 'middle'
        });
        xLab.textContent = 'effective void radius  R  [ h^-1 Mpc ]';
        axes.appendChild(xLab);
        var yLab = svgEl('text', {
            x: PLOT.x - 60, y: PLOT.y + PLOT.h / 2,
            'class': 'vsf-axis-label', 'text-anchor': 'middle',
            transform: 'rotate(-90 ' + (PLOT.x - 60) + ' ' + (PLOT.y + PLOT.h / 2) + ')'
        });
        yLab.textContent = 'number of voids per bin';
        axes.appendChild(yLab);
        /* title */
        var title = svgEl('text', {
            x: VSF.x + VSF.w / 2, y: VSF.y + 60,
            'class': 'vsf-title', 'text-anchor': 'middle'
        });
        title.textContent = 'VOID  SIZE  FUNCTION';
        axes.appendChild(title);
        var sub = svgEl('text', {
            x: VSF.x + VSF.w / 2, y: VSF.y + 92,
            'class': 'vsf-subtitle', 'text-anchor': 'middle'
        });
        sub.textContent = 'one void at a time';
        axes.appendChild(sub);
        svg.appendChild(axes);

        /* --- Theoretical VSF curve under the markers ------------------- */
        var curveG = svgEl('g', { 'class': 'vsf-curve' });
        /* Smooth peaked curve passing roughly through the final marker
           positions; computed analytically. */
        var nPts = 220;
        var d = '';
        var rMin = BIN_RADII[0] - 2;
        var rMax = BIN_RADII[N_BINS - 1] + 4;
        for (var p = 0; p < nPts; p++) {
            var rr = rMin + (rMax - rMin) * (p / (nPts - 1));
            /* peaked f(r) = A*r^a * exp(-(r/r0)^b) */
            var r0 = 32, A = 0.00025, aa = 2.0, bb = 2.4;
            var v = A * Math.pow(rr, aa) * Math.exp(-Math.pow(rr / r0, bb));
            /* map to plot coordinates */
            var fracX = (rr - rMin) / (rMax - rMin);
            /* normalise so the curve's peak matches MAX_COUNT */
            var fracY = v / (A * Math.pow(r0 * Math.pow(aa / bb, 1 / bb), aa)
                              * Math.exp(-aa / bb));
            var px = PLOT.x + PLOT.w * fracX;
            var py = PLOT.y + PLOT.h * (1 - fracY * MAX_COUNT / Y_AXIS_MAX);
            d += (p === 0 ? 'M' : ' L') + px.toFixed(1) + ',' + py.toFixed(1);
        }
        curveG.appendChild(svgEl('path', { d: d, 'class': 'theory-line' }));
        svg.appendChild(curveG);

        /* --- Markers (one per bin) -------------------------------------- */
        var markersG = svgEl('g', { 'class': 'markers' });
        var markers = [];
        for (var bb2 = 0; bb2 < N_BINS; bb2++) {
            var mx = binX(bb2);
            var my = plotY(0);
            /* outer glow */
            var glow = svgEl('circle', {
                cx: mx, cy: my, r: 9, 'class': 'marker-glow'
            });
            /* main marker */
            var marker = svgEl('circle', {
                cx: mx, cy: my, r: 5, 'class': 'marker'
            });
            /* count label above */
            var lab = svgEl('text', {
                x: mx, y: my - 14, 'class': 'marker-count', 'text-anchor': 'middle'
            });
            markersG.appendChild(glow);
            markersG.appendChild(marker);
            markersG.appendChild(lab);
            markers.push({ glow: glow, marker: marker, label: lab });
        }
        svg.appendChild(markersG);

        /* --- Void circles on the image --------------------------------- */
        var voidsG = svgEl('g', { 'class': 'voids' });
        var voidCircles = [];
        for (var v = 0; v < VOIDS.length; v++) {
            var V = VOIDS[v];
            var fill = svgEl('circle', {
                cx: V.cx, cy: V.cy, r: V.r, 'class': 'void-fill'
            });
            var ring = svgEl('circle', {
                cx: V.cx, cy: V.cy, r: V.r, 'class': 'void-ring'
            });
            voidsG.appendChild(fill);
            voidsG.appendChild(ring);
            voidCircles.push({ fill: fill, ring: ring });
        }
        svg.appendChild(voidsG);

        /* --- Connectors (one per void) --------------------------------- */
        var connG = svgEl('g', { 'class': 'connectors' });
        var connectors = [];
        for (var c = 0; c < VOIDS.length; c++) {
            var path = svgEl('path', { d: '', 'class': 'void-connector' });
            connG.appendChild(path);
            connectors.push(path);
        }
        svg.appendChild(connG);

        return {
            svg: svg,
            markers: markers,
            voidCircles: voidCircles,
            connectors: connectors
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

        var visitsF = progress * N_VISITS;
        var v = Math.min(N_VISITS - 1, Math.floor(visitsF));
        var withinT = clamp(visitsF - v, 0, 1);
        var currentVisit = VISITS[v];

        /* ---- Per-bin counts (fractional during reveal) ------------- */
        var counts = new Array(N_BINS).fill(0);
        for (var i = 0; i < VOIDS.length; i++) {
            var rv = voidRevealVisit[i];
            var bIdx = VOIDS[i].bin;
            if (rv < v) counts[bIdx] += 1;
            else if (rv === v && currentVisit.type === 'reveal') counts[bIdx] += withinT;
        }

        /* ---- Markers ---------------------------------------------- */
        for (var b = 0; b < N_BINS; b++) {
            var c = counts[b];
            var mx = binX(b);
            var my = plotY(c);
            state.markers[b].marker.setAttribute('cx', mx.toFixed(1));
            state.markers[b].marker.setAttribute('cy', my.toFixed(1));
            state.markers[b].glow.setAttribute('cx', mx.toFixed(1));
            state.markers[b].glow.setAttribute('cy', my.toFixed(1));
            state.markers[b].label.setAttribute('x', mx.toFixed(1));
            state.markers[b].label.setAttribute('y', (my - 14).toFixed(1));
            /* Visibility: marker shows once count > 0 */
            var op = c > 0 ? 1 : 0;
            state.markers[b].marker.style.opacity = op;
            state.markers[b].glow.style.opacity   = op * 0.7;
            state.markers[b].label.style.opacity  = op;
            var displayN = Math.round(c);
            state.markers[b].label.textContent = displayN > 0 ? displayN : '';
        }

        /* ---- Per-void state: reveal + connector ------------------- */
        for (var iv = 0; iv < VOIDS.length; iv++) {
            var V = VOIDS[iv];
            var rv2 = voidRevealVisit[iv];
            var bn  = V.bin;
            var fadeV = binFadeVisit[bn];

            /* Reveal of the circle */
            var revealT;
            if (v < rv2) revealT = 0;
            else if (v === rv2 && currentVisit.type === 'reveal') revealT = withinT;
            else revealT = 1;
            state.voidCircles[iv].fill.style.opacity = (0.28 * revealT).toFixed(3);
            state.voidCircles[iv].ring.style.opacity = revealT.toFixed(3);

            /* Connector opacity logic:
                 visit <  rv2          -> 0
                 visit == rv2          -> withinT (drawing in)
                 rv2 < visit < fadeV   -> 1     (bin in progress)
                 visit == fadeV        -> 1 - withinT  (fade out)
                 visit >  fadeV        -> 0 */
            var conOp;
            if (v < rv2) conOp = 0;
            else if (v === rv2 && currentVisit.type === 'reveal') conOp = withinT;
            else if (v < fadeV) conOp = 1;
            else if (v === fadeV && currentVisit.type === 'fade') conOp = 1 - withinT;
            else conOp = 0;

            var path = state.connectors[iv];
            path.style.opacity = conOp.toFixed(3);

            if (conOp > 0.01) {
                /* Recompute the path EVERY FRAME so it tracks the marker's
                   current position as the bin count grows. */
                var bx = binX(bn);
                var by = plotY(counts[bn]);
                /* Quadratic bezier control point: between void & marker, lifted
                   above to give a nice arc */
                var midX = (V.cx + bx) * 0.5;
                var midY = Math.min(V.cy, by) - 50;
                var d = 'M' + V.cx.toFixed(1) + ',' + V.cy.toFixed(1) +
                        ' Q' + midX.toFixed(1) + ',' + midY.toFixed(1) +
                        ' ' + bx.toFixed(1) + ',' + by.toFixed(1);
                path.setAttribute('d', d);
                /* Animate stroke-dashoffset for the "drawing in" effect ONLY
                   during the reveal frame. After the reveal, the line is
                   fully drawn (no dash offset). */
                if (path.getTotalLength) {
                    var totalLen = path.getTotalLength();
                    path.style.strokeDasharray  = totalLen;
                    var drawProg;
                    if (v < rv2) drawProg = 0;
                    else if (v === rv2 && currentVisit.type === 'reveal') drawProg = withinT;
                    else drawProg = 1;
                    path.style.strokeDashoffset = (totalLen * (1 - drawProg)).toFixed(1);
                }
            }
        }

        /* ---- HUD --------------------------------------------------- */
        if (hudBar) hudBar.style.width = (progress * 100).toFixed(1) + '%';
        var totalRevealed = 0;
        for (var ii = 0; ii < VOIDS.length; ii++) {
            if (voidRevealVisit[ii] < v) totalRevealed++;
            else if (voidRevealVisit[ii] === v && currentVisit.type === 'reveal')
                totalRevealed += (withinT > 0.5 ? 1 : 0);
        }
        if (hudCount) hudCount.textContent = totalRevealed + ' / ' + VOIDS.length;
        if (hudRadius) {
            /* Show the current bin's radius */
            var curBin = (currentVisit && currentVisit.binIdx !== undefined) ? currentVisit.binIdx : 0;
            hudRadius.textContent = 'R ~ ' + BIN_LABELS_MPC[curBin] + ' h^-1 Mpc';
        }
    }

    /* ===================================================================== */
    /* Wire scroll                                                           */
    /* ===================================================================== */

    function init() {
        var scrolly = document.getElementById('cosmicScrolly');
        if (!scrolly) return;
        var state = buildScene(scrolly);
        var hudCount  = scrolly.querySelector('.scrolly-progress-label .count');
        var hudRadius = scrolly.querySelector('.scrolly-progress-label .radius');
        var hudBar    = scrolly.querySelector('.scrolly-progress-bar');

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
