#!/usr/bin/env node
/* ===========================================================================
   capture-anim.js
   ---------------
   Render any of the phd-page scrollies to an MP4 suitable for Keynote /
   PowerPoint / Beamer-PDF.

   The script drives a headless Chrome through the pinned scroll range of the
   target section, screenshots its <svg> at each frame, and ffmpegs the PNGs
   into an H.264 yuv420p MP4.

   Usage
   -----
     node scripts/capture-anim.js <target> [--duration=10] [--fps=30] \
                                           [--url=https://...] [--width=1920]

     Targets:
       vsf      cosmic-web -> voids -> VSF histogram   (#cosmicScrolly)
       rubin    LSST 10-year sky-footprint build-up    (#rubinScrolly)
       photoz   photo-z LOS shuffling                  (#photozScrolly)
       radec    RA-Dec true vs photo-z cross-fade      (#radecScrolly)

   Examples
   --------
     # Default duration & fps (works for a talk):
     npm run capture -- vsf
     npm run capture -- rubin

     # Slow it down for a long pause on screen:
     node scripts/capture-anim.js vsf --duration=22 --fps=30

     # Hit a locally served Jekyll build instead of the live site:
     node scripts/capture-anim.js rubin --url=http://localhost:4000/phd/

   Output:
     build/talk/<target>/frames/*.png
     build/talk/<target>/<target>.mp4
   =========================================================================== */

const puppeteer = require('puppeteer');
const fs        = require('fs');
const path      = require('path');
const { spawn } = require('child_process');

/* ---------- target catalog ----------------------------------------------- */

const TARGETS = {
    vsf: {
        sectionId:       'cosmicScrolly',
        svgSelector:     '#cosmicScrolly svg.cosmic-scene',
        defaultDuration: 16,
        defaultFps:      30,
    },
    rubin: {
        sectionId:       'rubinScrolly',
        svgSelector:     '#rubinScrolly svg',
        defaultDuration: 18,
        defaultFps:      30,
    },
    photoz: {
        sectionId:       'photozScrolly',
        svgSelector:     '#photozScrolly svg',
        defaultDuration: 12,
        defaultFps:      30,
    },
    radec: {
        sectionId:       'radecScrolly',
        svgSelector:     '#radecScrolly svg.radec-scene',
        defaultDuration: 10,
        defaultFps:      30,
    },
};

/* ---------- args --------------------------------------------------------- */

function parseArgs(argv) {
    const args = { _: [] };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const eq = a.indexOf('=');
            if (eq >= 0) args[a.slice(2, eq)] = coerce(a.slice(eq + 1));
            else { args[a.slice(2)] = coerce(argv[++i]); }
        } else {
            args._.push(a);
        }
    }
    return args;
}
function coerce(v) {
    if (v === undefined) return true;
    const n = Number(v);
    return Number.isFinite(n) && String(n) === v ? n : v;
}

function usage() {
    const targets = Object.keys(TARGETS).join(' | ');
    console.error(`usage: node scripts/capture-anim.js <${targets}> ` +
                  `[--duration=N] [--fps=N] [--url=...] [--width=1920]`);
    process.exit(1);
}

/* ---------- main --------------------------------------------------------- */

async function main() {
    const args   = parseArgs(process.argv);
    const target = args._[0];
    if (!target || !TARGETS[target]) usage();

    const cfg      = TARGETS[target];
    const duration = args.duration ?? cfg.defaultDuration;
    const fps      = args.fps      ?? cfg.defaultFps;
    const width    = args.width    ?? 1920;
    const height   = args.height   ?? 1080;
    const url      = args.url      ?? `https://pierreboccard.github.io/phd/#${cfg.sectionId}`;
    const totalFrames = Math.round(duration * fps);

    const root      = path.resolve(__dirname, '..');
    const outDir    = path.join(root, 'build', 'talk', target);
    const framesDir = path.join(outDir, 'frames');
    fs.mkdirSync(framesDir, { recursive: true });
    /* wipe stale frames so the encode is deterministic */
    for (const f of fs.readdirSync(framesDir)) fs.unlinkSync(path.join(framesDir, f));

    console.log(`[capture] ${target}  ${duration}s @ ${fps} fps  ->  ${totalFrames} frames`);
    console.log(`[capture] url:  ${url}`);
    console.log(`[capture] out:  ${outDir}`);

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--font-render-hinting=medium'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 2 });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 90000 });

    /* Hide page chrome + scroll-only decorations so the screenshot is clean */
    await page.addStyleTag({ content: `
        .scrolly-hud, .scrolly-hint { display: none !important; }
        .phd-toc, nav.phd-toc      { display: none !important; }
        /* generic: any fixed/sticky chrome that might overlap the SVG */
        [class*="cookie"], [class*="banner"] { display: none !important; }
    `});

    await page.waitForSelector(`#${cfg.sectionId}`);
    /* Let webfonts + cosmic-web image + any deferred JS settle */
    await new Promise(r => setTimeout(r, 1200));

    /* Compute pinned scroll range: from the moment the section's top touches
       the viewport top to the moment its bottom touches the viewport bottom. */
    const range = await page.evaluate((sectionId) => {
        const section = document.getElementById(sectionId);
        const rect    = section.getBoundingClientRect();
        const start   = window.scrollY + rect.top;
        const end     = start + section.offsetHeight - window.innerHeight;
        return { start, end, sectionHeight: section.offsetHeight };
    }, cfg.sectionId);
    console.log(`[capture] scroll range: ${range.start.toFixed(0)} -> ${range.end.toFixed(0)} px ` +
                `(section height ${range.sectionHeight}px)`);

    const svg = await page.$(cfg.svgSelector);
    if (!svg) throw new Error(`SVG not found: ${cfg.svgSelector}`);

    /* Measure the SVG's intrinsic CSS size once. svg.screenshot() takes the
       element's own visual box at each frame (handles sticky/transform
       correctly), but its dimensions can jitter by 1 px between frames; we
       use this measurement only to drive an ffmpeg scale filter that locks
       every frame to the same output size. */
    await page.evaluate((y) => window.scrollTo(0, y), (range.start + range.end) / 2);
    await page.evaluate(() => new Promise(r =>
        requestAnimationFrame(() => requestAnimationFrame(r))));
    await new Promise(r => setTimeout(r, 60));
    const bbox = await svg.boundingBox();
    /* deviceScaleFactor multiplies pixel dimensions on the screenshot */
    const outW = Math.floor(bbox.width  * 2 / 2) * 2;
    const outH = Math.floor(bbox.height * 2 / 2) * 2;
    console.log(`[capture] target frame size: ${outW}x${outH}`);

    /* Drive the scroll, frame by frame */
    const t0 = Date.now();
    for (let f = 0; f < totalFrames; f++) {
        const t = totalFrames === 1 ? 0 : f / (totalFrames - 1);
        const y = range.start + (range.end - range.start) * t;
        await page.evaluate((y) => window.scrollTo(0, y), y);
        /* double-RAF so any requestAnimationFrame loops in the scrolly catch up */
        await page.evaluate(() => new Promise(r =>
            requestAnimationFrame(() => requestAnimationFrame(r))));
        await new Promise(r => setTimeout(r, 30));
        const name = String(f).padStart(5, '0');
        await svg.screenshot({ path: path.join(framesDir, `frame-${name}.png`) });
        if (f === 0 || (f + 1) % 30 === 0 || f === totalFrames - 1) {
            const pct = ((f + 1) / totalFrames * 100).toFixed(1);
            process.stdout.write(`\r[capture] frame ${f + 1}/${totalFrames}  (${pct}%)   `);
        }
    }
    process.stdout.write('\n');
    console.log(`[capture] screenshots done in ${((Date.now() - t0)/1000).toFixed(1)}s`);

    await browser.close();

    /* ---- encode to MP4 ------------------------------------------------- */

    const mp4 = path.join(outDir, `${target}.mp4`);
    console.log(`[ffmpeg] encoding -> ${mp4}`);
    /* Pad every input frame to the target (outW x outH) so libx264 gets a
       constant stream size regardless of 1px bbox jitter between frames. */
    const padFilter =
        `scale=w='min(iw,${outW})':h='min(ih,${outH})':force_original_aspect_ratio=decrease,` +
        `pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2:color=black`;
    await new Promise((resolve, reject) => {
        const ff = spawn('ffmpeg', [
            '-y',
            '-framerate', String(fps),
            '-i', path.join(framesDir, 'frame-%05d.png'),
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            '-preset', 'slow',
            '-crf', '18',
            '-vf', padFilter,
            '-movflags', '+faststart',
            mp4,
        ], { stdio: 'inherit' });
        ff.on('exit', code =>
            code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)));
    });

    const stat = fs.statSync(mp4);
    console.log(`[done] ${mp4}  (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch(err => { console.error(err); process.exit(1); });
