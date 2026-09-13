# Archive.org Book Image Capturer

This is a Tampermonkey userscript for collecting book-page images from an
Archive.org book reader and downloading the collected pages as numbered ZIP
files.

Current version: **1.6**

Version 1.6 adds automatic stopping when the reader reaches the final page or
the page counter restarts, along with a Stop control for manual interruption.

## How to install

1. Install the Tampermonkey browser extension.
2. Create a new userscript.
3. Replace the generated contents with `imageCapture.js`.
4. Save the userscript and open an Archive.org book page whose URL matches `https://archive.org/details/...`.

The script loads JSZip from cdnjs when the ZIP download is requested, so the
browser must be able to load that external library.

## What happens when the page opens

1. The script starts very early during page loading.
2. It watches `URL.createObjectURL` for JPEG `Blob` objects larger than 2 KB. When the book reader creates one, the script stores it as a captured page.
3. Duplicate images are ignored using a lightweight size-and-content hash.
4. A status panel appears in the upper-right corner showing the number of captured pages and the approximate memory used.
5. The script waits up to 30 seconds for the reader's `Zoom in` button.
6. Once found, it clicks `Zoom in` 6 times. There is a 1-second wait after every click, followed by an additional 5-second wait for the reader to settle.
7. After zooming completes, it clicks the reader's `Flip right` button, waits 5 seconds for the new page to load, and repeats automatically.
8. Every 20 captured pages are removed from the pending memory list, packaged
   into a ZIP, and downloaded automatically.
9. Automatic flipping stops when the reader reports the final page, or when its
   page number moves backward because the reader has restarted from the first
   page. Any remaining pending pages are downloaded as the final ZIP part.

The zoom sequence runs automatically only once when the script initializes.
Page flipping starts only after zooming and its 5-second settling wait finish.
The script keeps flipping until the reader's next-page button is unavailable or
disabled. Pages created by the reader after each turn are captured automatically
when they meet the JPEG and size conditions above. When flipping stops, any
remaining pages are downloaded as a final smaller ZIP part.

## Status panel controls

- **Pages captured**: total number of unique JPEG images captured during this run.
- **Pending memory**: approximate memory used by pages waiting to be put into a ZIP. Completed batches are released from this list.
- **Stop**: stops zooming and automatic page flipping, and stops capturing new reader images. Pages already pending can still be downloaded with **Download ZIP**.
- **Download ZIP**: manually downloads any currently pending pages as the next numbered ZIP part.
- **Clear**: removes all captured pages and resets the counter.

## ZIP parts and memory usage

Automatic downloads contain at most 20 pages each and use names such as
`archive_org_book_part_001.zip`, `archive_org_book_part_002.zip`, and so on.
Inside each ZIP, images retain their overall capture numbers, such as
`page_0001.jpg` through `page_0020.jpg`.

The script does not keep completed batches in its pending image list. This
reduces the amount of image data held while a long book is being captured.
The browser may still briefly use additional memory while JSZip generates a
ZIP and while the browser handles the download.
After each download starts, the generated ZIP Blob URL is revoked after 10
seconds so the browser can release that ZIP's memory.

## Important limitations

- Keep the book reader open while the automatic ZIP parts are being generated and downloaded; pending images are held in browser memory rather than written to disk immediately.
- The script captures JPEG blobs created through `URL.createObjectURL`. It does not download arbitrary network images or non-JPEG formats.
- If the Zoom in button is not available in the current document, the script logs a warning and continues without changing the zoom level.
- If the next-page button disappears or becomes disabled, automatic page
  flipping stops.
- Automatic page flipping also stops when `.BRcurrentpage` reports the final
  page, such as `Page — (403/403)`, or when the page number wraps backward.
- Clicking **Download ZIP** with no pending pages shows `No pages captured yet.`

## Troubleshooting

Open the browser developer console and look for messages beginning with
`[IA Capturer]`. They indicate captured pages, a missing zoom button, or a
completed zoom sequence.
