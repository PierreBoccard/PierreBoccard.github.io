# Capturing the PhD-page scrollies as MP4

This pipeline takes any of the four scroll-driven animations on `/phd/` and
renders it to an H.264 MP4 you can drop into Keynote, PowerPoint, or a
Beamer / `media9` slide.

## One-time setup

```bash
brew install ffmpeg
npm install            # pulls Puppeteer (~170 MB Chromium binary)
```

## Render an animation

```bash
# Defaults: hits the live https://pierreboccard.github.io/phd/ page,
# 30 fps, sensible per-target duration.
npm run capture -- vsf       # cosmic-web -> voids -> VSF histogram
npm run capture -- rubin     # LSST 10-year sky-footprint
npm run capture -- photoz    # photo-z LOS shuffling
npm run capture -- radec     # RA-Dec true vs photo-z cross-fade
```

Output ends up in `build/talk/<target>/<target>.mp4` plus the individual
PNG frames in `build/talk/<target>/frames/`. The PNGs are kept so you can
recompose at a different frame rate, make a GIF, or use them as a Beamer
flip-book via `\animategraphics`.

## Common knobs

```bash
# Slower playback (more frames, same animation):
node scripts/capture-anim.js vsf --duration=22

# Higher frame rate for a smoother projection:
node scripts/capture-anim.js rubin --fps=60

# Render against a local Jekyll build instead of the live site:
bundle exec jekyll serve            # in another terminal
node scripts/capture-anim.js vsf --url=http://localhost:4000/phd/

# Custom viewport (defaults 1920x1080):
node scripts/capture-anim.js radec --width=2560 --height=1440
```

## Dropping the MP4 into slides

- **Keynote:** drag the .mp4 onto the slide -> Format -> Movie ->
  Start movie "Automatically", optionally "Loop".
- **PowerPoint:** Insert -> Video -> This Device -> Playback tab ->
  Start: Automatically -> "Play Full Screen" and "Loop until Stopped".
- **Beamer / LaTeX:** `\usepackage{media9}` then
  `\includemedia[activate=onclick,addresource=vsf.mp4,flashvars={src=vsf.mp4}]{}{VPlayer.swf}`.
  Note: only Adobe Acrobat Reader plays embedded MP4s in PDFs -- macOS
  Preview and most browser PDF viewers show only the poster frame.

## How it works

The scrollies are pure functions of scroll-progress, so the script just:

1. opens the page in headless Chrome,
2. computes the section's pinned scroll range,
3. for each frame, scrolls to the interpolated position, waits a double
   `requestAnimationFrame` for the scrolly to catch up, and screenshots
   the `<svg>` element,
4. pipes the PNG sequence through `ffmpeg -c:v libx264 -crf 18`.

No edits to the scrolly JS are needed.
