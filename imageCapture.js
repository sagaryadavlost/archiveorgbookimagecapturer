// ==UserScript==
// @name         Archive.org Book Image Capturer - Reliable
// @namespace    http://tampermonkey.net/
// @version      1.6
// @description  Reliable capture (no corruption) with best-effort request order
// @author       Grok
// @match        https://archive.org/details/*
 // @grant        none
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const CONFIG = {
        PANEL_ID: 'ia-book-capturer',
        ZIP_FILENAME_PREFIX: 'archive_org_book_part',
        PAGE_BATCH_SIZE: 20,
        ZOOM_SELECTOR: 'button.BRicon.zoom_in',
        ZOOM_CLICKS: 6,
        ZOOM_CLICK_DELAY_MS: 1000,
        ZOOM_FINISH_DELAY_MS: 5000,
        NEXT_PAGE_SELECTOR: 'button.BRicon.book_right.book_flip_next',
        CURRENT_PAGE_SELECTOR: '.BRcurrentpage',
        PAGE_FLIP_DELAY_MS: 5000,
        ZIP_MEMORY_RELEASE_DELAY_MS: 10000
    };

    let capturedBlobs = []; // {blob, sequenceNum}
    let seenHashes = new Set();
    let nextNum = 1;
    let totalCapturedPages = 0;
    let nextZipPart = 1;
    let zipQueue = Promise.resolve();
    let isRunning = true;
    let originalCreateObjectURL = null;

    async function ensureJSZip() {
        if (typeof JSZip !== 'undefined') return JSZip;
        return new Promise(r => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
            s.onload = () => r(typeof JSZip !== 'undefined' ? JSZip : null);
            document.head.appendChild(s);
        });
    }

    // Simple fast hash for deduplication
    async function getHash(blob) {
        try {
            const buf = await blob.arrayBuffer();
            const arr = new Uint8Array(buf);
            let hash = blob.size + ":";
            for (let i = 0; i < Math.min(64, arr.length); i++) {
                hash += arr[i].toString(16).padStart(2, '0');
            }
            return hash;
        } catch (e) {
            return "hash-" + blob.size;
        }
    }

    // === MAIN INTERCEPTOR (Most Reliable) ===
    function interceptCreateObjectURL() {
        originalCreateObjectURL = URL.createObjectURL;

        URL.createObjectURL = function (obj) {
            if (obj instanceof Blob && obj.type === 'image/jpeg' && obj.size > 2000) {
                handleImageBlob(obj);
            }
            return originalCreateObjectURL.call(URL, obj);
        };
    }

    async function handleImageBlob(blob) {
        const hash = await getHash(blob);

        if (seenHashes.has(hash)) return; // duplicate

        seenHashes.add(hash);

        capturedBlobs.push({
            blob: blob,
            sequenceNum: nextNum++
        });
        totalCapturedPages++;

        console.log(`[IA Capturer] Captured page ${totalCapturedPages} (${(blob.size/1024).toFixed(1)} KB)`);
        updatePanel();

        if (capturedBlobs.length >= CONFIG.PAGE_BATCH_SIZE) {
            const batch = capturedBlobs.splice(0, CONFIG.PAGE_BATCH_SIZE);
            queueZipDownload(batch);
            updatePanel();
        }
    }

    // UI
    function createStatusPanel() {
        let panel = document.getElementById(CONFIG.PANEL_ID);
        if (panel) return panel;

        panel = document.createElement('div');
        panel.id = CONFIG.PANEL_ID;
        panel.style.cssText = `
            position:fixed; top:20px; right:20px; background:rgba(0,0,0,0.92); color:#0f0;
            padding:16px; border-radius:8px; font-family:monospace; z-index:2147483647;
            min-width:280px; border:2px solid #0f0;
        `;
        document.body.appendChild(panel);
        return panel;
    }

    function updatePanel() {
        const panel = createStatusPanel();
        const count = totalCapturedPages;
        const mem = Math.round(capturedBlobs.reduce((s, i) => s + i.blob.size, 0) * 1.05 / (1024*1024) * 100) / 100;

        panel.innerHTML = `
            <strong>📖 IA Book Capturer (Reliable)</strong><br>
            Status: <b>${isRunning ? 'Running' : 'Stopped'}</b><br>
            Pages captured: <b>${count}</b><br>
            Pending memory: <b>${mem} MB</b><br><br>
            <button id="btn-zip" style="padding:10px 16px;margin:4px;background:#0f0;color:#000;border:none;border-radius:4px;cursor:pointer;font-weight:bold;">📥 Download ZIP</button>
            <button id="btn-stop" style="padding:10px 16px;margin:4px;background:#ff9800;color:#000;border:none;border-radius:4px;cursor:pointer;font-weight:bold;">Stop</button>
            <button id="btn-clear" style="padding:10px 16px;margin:4px;background:#c00;color:white;border:none;border-radius:4px;cursor:pointer;">Clear</button>
        `;

        panel.querySelector('#btn-zip').onclick = downloadAsZip;
        panel.querySelector('#btn-stop').onclick = stopCapture;
        panel.querySelector('#btn-clear').onclick = clearAll;
    }

    async function downloadAsZip() {
        if (capturedBlobs.length === 0) return alert("No pages captured yet.");

        const batch = capturedBlobs.splice(0, capturedBlobs.length);
        queueZipDownload(batch);
        updatePanel();
    }

    function queueZipDownload(batch) {
        const partNumber = nextZipPart++;
        zipQueue = zipQueue
            .then(() => downloadBatchAsZip(batch, partNumber))
            .catch(error => console.error('[IA Capturer] ZIP creation failed:', error));
    }

    async function downloadBatchAsZip(batch, partNumber) {
        if (batch.length === 0) return;

        const JSZip = await ensureJSZip();
        if (!JSZip) return alert("JSZip not loaded.");

        const zip = new JSZip();
        const loading = showLoading(`Creating ZIP part ${partNumber} (${batch.length} pages)...`);

        try {
            // Already in capture order
            for (let i = 0; i < batch.length; i++) {
                const item = batch[i];
                const num = String(item.sequenceNum).padStart(4, '0');
                zip.file(`page_${num}.jpg`, item.blob);
            }

            const zipBlob = await zip.generateAsync({type:"blob", compression:"DEFLATE"});

            const url = URL.createObjectURL(zipBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${CONFIG.ZIP_FILENAME_PREFIX}_${String(partNumber).padStart(3, '0')}.zip`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), CONFIG.ZIP_MEMORY_RELEASE_DELAY_MS);

        } catch (e) {
            console.error(e);
            alert("ZIP creation failed");
        } finally {
            removeLoading(loading);
        }
    }

    function showLoading(txt) {
        const d = document.createElement('div');
        d.textContent = txt;
        d.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.95);color:#0f0;padding:30px;border-radius:10px;z-index:99999999;`;
        document.body.appendChild(d);
        return d;
    }

    function removeLoading(el) {
        if (el?.parentNode) el.parentNode.removeChild(el);
    }

    function clearAll() {
        capturedBlobs = [];
        seenHashes.clear();
        nextNum = 1;
        totalCapturedPages = 0;
        updatePanel();
    }

    function stopCapture() {
        isRunning = false;
        if (originalCreateObjectURL) {
            URL.createObjectURL = originalCreateObjectURL;
            originalCreateObjectURL = null;
        }
        console.log('[IA Capturer] Capture stopped by user.');
        updatePanel();
    }

    function waitForZoomButton(timeoutMs = 30000) {
        return new Promise(resolve => {
            const startedAt = Date.now();
            const findButton = () => {
                const button = document.querySelector(CONFIG.ZOOM_SELECTOR);
                if (button) return resolve(button);
                if (Date.now() - startedAt >= timeoutMs) return resolve(null);
                setTimeout(findButton, 250);
            };
            findButton();
        });
    }

    function getPagePosition() {
        const pageElement = document.querySelector(CONFIG.CURRENT_PAGE_SELECTOR);
        const match = pageElement?.textContent.match(/\((\d+)\s*\/\s*(\d+)\)/);
        if (!match) return null;

        return {
            current: Number(match[1]),
            total: Number(match[2])
        };
    }

    async function zoomInBeforeCapture() {
        const zoomButton = await waitForZoomButton();
        if (!zoomButton) {
            console.warn('[IA Capturer] Zoom in button was not found.');
            return false;
        }

        for (let clickNumber = 0; clickNumber < CONFIG.ZOOM_CLICKS; clickNumber++) {
            if (!isRunning) return false;
            zoomButton.click();
            await new Promise(resolve => setTimeout(resolve, CONFIG.ZOOM_CLICK_DELAY_MS));
        }

        if (!isRunning) return false;
        await new Promise(resolve => setTimeout(resolve, CONFIG.ZOOM_FINISH_DELAY_MS));
        if (!isRunning) return false;
        console.log('[IA Capturer] Finished zooming in and waiting for the page to settle.');
        return true;
    }

    async function flipPagesAutomatically() {
        let previousPage = null;

        while (isRunning) {
            const pagePosition = getPagePosition();
            if (pagePosition && (pagePosition.current >= pagePosition.total ||
                (previousPage !== null && pagePosition.current < previousPage))) {
                stopCapture();
                console.log(`[IA Capturer] Stopped page flipping at page ${pagePosition.current}/${pagePosition.total}.`);
                if (capturedBlobs.length > 0) {
                    const finalBatch = capturedBlobs.splice(0, capturedBlobs.length);
                    queueZipDownload(finalBatch);
                    updatePanel();
                }
                return;
            }
            if (pagePosition) previousPage = pagePosition.current;

            const nextPageButton = document.querySelector(CONFIG.NEXT_PAGE_SELECTOR);
            if (!nextPageButton || nextPageButton.disabled || nextPageButton.getAttribute('aria-disabled') === 'true') {
                console.log('[IA Capturer] Stopped page flipping: next-page button is unavailable.');
                if (capturedBlobs.length > 0) {
                    const finalBatch = capturedBlobs.splice(0, capturedBlobs.length);
                    queueZipDownload(finalBatch);
                    updatePanel();
                }
                return;
            }

            nextPageButton.click();
            await new Promise(resolve => setTimeout(resolve, CONFIG.PAGE_FLIP_DELAY_MS));
        }
    }

    // Init
    function init() {
        if (!document.body) return setTimeout(init, 100);
        interceptCreateObjectURL();
        createStatusPanel();
        updatePanel();
        zoomInBeforeCapture().then(zoomCompleted => {
            if (zoomCompleted && isRunning) flipPagesAutomatically();
        });
        console.log('%c[IA Reliable Capturer v1.6] Loaded', 'color:lime;font-weight:bold');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
