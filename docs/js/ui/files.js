// Browser-side file work: chart PNGs and zip archives (vendored JSZip).

/** Draw an SVG string to a canvas and return a PNG blob. */
export async function svgToPngBlob(svg, width, height) {
  const image = new Image();
  const loaded = new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('Could not draw the chart image.'));
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await loaded;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(image, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not save the chart image.'))), 'image/png');
  });
}

let jszipPromise = null;

/** Load the vendored JSZip on first use (it is in the offline cache, never fetched from a CDN). */
function loadJSZip() {
  if (globalThis.JSZip) return Promise.resolve(globalThis.JSZip);
  jszipPromise ||= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'vendor/jszip.min.js';
    script.onload = () => resolve(globalThis.JSZip);
    script.onerror = () => {
      jszipPromise = null;
      reject(new Error('Could not load the zip library.'));
    };
    document.head.append(script);
  });
  return jszipPromise;
}

/** Zip { path: string | ArrayBuffer | Uint8Array | Blob } into one Blob. */
export async function zipFiles(files) {
  const JSZip = await loadJSZip();
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

/** Read a zip into { texts: { path: string }, binaries: { path: ArrayBuffer } } (PNGs are binary). */
export async function readZip(file) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(file);
  const texts = {};
  const binaries = {};
  for (const [path, item] of Object.entries(zip.files)) {
    if (item.dir) continue;
    // Some tools wrap everything in a top-level folder; the names we look for are fixed.
    const known = /(?:^|\/)(entries\.csv|daily_summary\.csv|my-foods\.txt|settings\.json|history\/[^/]+)$/.exec(path);
    if (!known) continue;
    const name = known[1];
    if (/\.png$/i.test(name)) binaries[name] = await item.async('arraybuffer');
    else if (/\.(csv|txt|json)$/i.test(name)) texts[name] = await item.async('string');
  }
  return { texts, binaries };
}

/**
 * Shrink a photo to at most `max` pixels on its long side and return it as a
 * JPEG data: URL. Keeps uploads small and drops the photo's metadata (such as
 * location), since only the pixels are redrawn.
 */
export async function photoToDataUrl(file, max = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}
