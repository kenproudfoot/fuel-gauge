# Vendored libraries

Third-party code is copied into this folder instead of being loaded from a CDN,
so the app works offline and no outside server can ever change what runs.

| File | Library | Version | License | SHA-256 |
|---|---|---|---|---|
| `jszip.min.js` | [JSZip](https://stuk.github.io/jszip/) | 3.10.1 | MIT or GPLv3 | `acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e` |

`jszip.min.js` is the unmodified `dist/jszip.min.js` from the `jszip@3.10.1` npm
package. To update it: `npm pack jszip@<version>`, copy `dist/jszip.min.js` here,
and update this table.
