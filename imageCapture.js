// ==UserScript==
// @name         Archive.org Book Image Capturer - Reliable
// @namespace    http://tampermonkey.net/
// @version      1.4
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
        ZIP_FILENAME: 'archive_org_book.zip'
    };

    let capturedBlobs = []; // {blob, sequenceNum}
    let seenHashes = new Set();
    let nextNum = 1;
    let JSZipLib = null;

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
        const original = URL.createObjectURL;

        URL.createObjectURL = function (obj) {
            if (obj instanceof Blob && obj.type === 'image/jpeg' && obj.size > 2000) {
                handleImageBlob(obj);
            }
            return original.call(URL, obj);
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

        console.log(`[IA Capturer] Captured page ${capturedBlobs.length} (${(blob.size/1024).toFixed(1)} KB)`);
        updatePanel();
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
        const count = capturedBlobs.length;
        const mem = Math.round(capturedBlobs.reduce((s, i) => s + i.blob.size, 0) * 1.05 / (1024*1024) * 100) / 100;

        panel.innerHTML = `
            <strong>📖 IA Book Capturer (Reliable)</strong><br>
            Pages: <b>${count}</b><br>
            Memory: <b>${mem} MB</b><br><br>
            <button id="btn-zip" style="padding:10px 16px;margin:4px;background:#0f0;color:#000;border:none;border-radius:4px;cursor:pointer;font-weight:bold;">📥 Download ZIP</button>
            <button id="btn-clear" style="padding:10px 16px;margin:4px;background:#c00;color:white;border:none;border-radius:4px;cursor:pointer;">Clear</button>
        `;

        panel.querySelector('#btn-zip').onclick = downloadAsZip;
        panel.querySelector('#btn-clear').onclick = clearAll;
    }

    async function downloadAsZip() {
        if (capturedBlobs.length === 0) return alert("No pages captured yet.");

        const JSZip = await ensureJSZip();
        if (!JSZip) return alert("JSZip not loaded.");

        const zip = new JSZip();
        const loading = showLoading(`Creating ZIP (${capturedBlobs.length} pages)...`);

        try {
            // Already in capture order
            for (let i = 0; i < capturedBlobs.length; i++) {
                const item = capturedBlobs[i];
                const num = String(item.sequenceNum).padStart(4, '0');
                zip.file(`page_${num}.jpg`, item.blob);
            }

            const zipBlob = await zip.generateAsync({type:"blob", compression:"DEFLATE"});

            const url = URL.createObjectURL(zipBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = CONFIG.ZIP_FILENAME;
            a.click();
            URL.revokeObjectURL(url);

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
        updatePanel();
    }

    // Init
    function init() {
        if (!document.body) return setTimeout(init, 100);
        interceptCreateObjectURL();
        createStatusPanel();
        updatePanel();
        console.log('%c[IA Reliable Capturer v1.4] Loaded', 'color:lime;font-weight:bold');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();