#!/usr/bin/env node
/*
 * encrypt-drafts.js — local-only encryption of PhD draft pages.
 *
 * Reads each project's plaintext HTML from $PHD_DRAFTS_DIR (default
 * ~/phd_drafts/<slug>/index.html), inlines any local <img src="..."> as
 * base64 data URIs, encrypts with AES-256-GCM using a 32-byte key derived
 * via PBKDF2-SHA256 (250 000 iterations) from your passphrase, and writes
 * the ciphertext to <repo>/assets/private/<slug>.enc.
 *
 *   node scripts/encrypt-drafts.js [passphrase]
 *
 *   # or set the passphrase in an environment variable
 *   PHD_PASS='correct horse battery staple' node scripts/encrypt-drafts.js
 *
 * The plaintext is never written into the repo. Only the .enc blobs are
 * committed. Visitors of the public site enter the passphrase in their
 * browser to decrypt in-memory via the Web Crypto API.
 *
 * Blob layout (after base64 decode):
 *     [ 0..16 )  PBKDF2 salt   (16 bytes)
 *     [16..28 )  AES-GCM IV    (12 bytes)
 *     [28..-16)  ciphertext
 *     [-16.. )   GCM auth tag  (16 bytes)
 *
 * Web Crypto on the browser side treats (ciphertext || tag) as a single
 * "ciphertext" input, so the layout above maps directly.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const DRAFTS_DIR = process.env.PHD_DRAFTS_DIR || path.join(os.homedir(), 'phd_drafts');
const REPO_ROOT  = path.resolve(__dirname, '..');
const OUT_DIR    = path.join(REPO_ROOT, 'assets', 'private');
const PROJECTS   = ['project-a', 'project-b', 'project-c', 'project-d'];

const MIME = {
    svg:  'image/svg+xml',
    png:  'image/png',
    jpg:  'image/jpeg',
    jpeg: 'image/jpeg',
    gif:  'image/gif',
    webp: 'image/webp',
    pdf:  'application/pdf'
};

function getPassphrase() {
    const arg = process.argv[2];
    if (arg && arg.length > 0) return arg;
    if (process.env.PHD_PASS) return process.env.PHD_PASS;
    console.error('No passphrase provided.');
    console.error('Usage: node scripts/encrypt-drafts.js <passphrase>');
    console.error('   or: PHD_PASS=... node scripts/encrypt-drafts.js');
    process.exit(1);
}

function inlineImages(html, projectDir) {
    return html.replace(
        /<img\b([^>]*?)\bsrc=(["'])([^"']+)\2([^>]*)>/gi,
        (full, pre, _q, src, post) => {
            if (/^(https?:|data:|\/\/)/i.test(src)) return full;
            const imgPath = path.resolve(projectDir, src);
            if (!fs.existsSync(imgPath)) {
                console.warn(`    ! missing image: ${imgPath}`);
                return full;
            }
            const ext  = path.extname(imgPath).slice(1).toLowerCase();
            const mime = MIME[ext] || 'application/octet-stream';
            const data = fs.readFileSync(imgPath).toString('base64');
            return `<img${pre}src="data:${mime};base64,${data}"${post}>`;
        }
    );
}

function encrypt(plaintext, passphrase) {
    const salt = crypto.randomBytes(16);
    const iv   = crypto.randomBytes(12);
    const key  = crypto.pbkdf2Sync(passphrase, salt, 250000, 32, 'sha256');

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct  = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag(); /* 16 bytes */

    return Buffer.concat([salt, iv, ct, tag]).toString('base64');
}

function selfTest(passphrase) {
    /* Sanity check: round-trip a tiny string through encrypt + decrypt */
    const sample = 'cosmic voids · ' + Math.random();
    const blob   = encrypt(sample, passphrase);
    const raw    = Buffer.from(blob, 'base64');
    const salt = raw.subarray(0, 16);
    const iv   = raw.subarray(16, 28);
    const tag  = raw.subarray(raw.length - 16);
    const ct   = raw.subarray(28, raw.length - 16);
    const key  = crypto.pbkdf2Sync(passphrase, salt, 250000, 32, 'sha256');
    const dec  = crypto.createDecipheriv('aes-256-gcm', key, iv);
    dec.setAuthTag(tag);
    const plain = Buffer.concat([dec.update(ct), dec.final()]).toString('utf8');
    if (plain !== sample) throw new Error('self-test failed: round-trip mismatch');
}

function main() {
    const pass = getPassphrase();
    selfTest(pass);

    fs.mkdirSync(OUT_DIR, { recursive: true });

    let done = 0, skipped = 0;
    console.log(`drafts dir: ${DRAFTS_DIR}`);
    console.log(`output dir: ${OUT_DIR}\n`);

    for (const slug of PROJECTS) {
        const projectDir = path.join(DRAFTS_DIR, slug);
        const htmlPath   = path.join(projectDir, 'index.html');

        if (!fs.existsSync(htmlPath)) {
            console.log(`  skip   ${slug.padEnd(11)}  (no ${htmlPath})`);
            skipped++;
            continue;
        }

        let html = fs.readFileSync(htmlPath, 'utf8');
        const beforeLen = html.length;
        html = inlineImages(html, projectDir);
        const afterLen = html.length;

        const blob    = encrypt(html, pass);
        const outPath = path.join(OUT_DIR, `${slug}.enc`);
        fs.writeFileSync(outPath, blob);

        console.log(
            `  ok     ${slug.padEnd(11)}  ` +
            `${String(beforeLen).padStart(7)}  ->  ${String(afterLen).padStart(7)} chars  ` +
            `(after image inlining)  ->  ${blob.length} b64`
        );
        done++;
    }

    console.log(`\n${done} encrypted, ${skipped} skipped.`);
    if (done > 0) {
        console.log(`Next: git add assets/private/*.enc && git commit && git push`);
    }
}

main();
