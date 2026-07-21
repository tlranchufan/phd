# REE Excel Tools — GitHub Pages edition

A static, browser-only website containing two tools:

1. **REE Excel Processor** — processes composition summaries, ratios, KEEP/EXCLUDE decisions, SD-band colours, and collated workbooks.
2. **LA-ICPMS QuickSheet Plotter** — reads QuickSheet summary workbooks and creates interactive concentration or element-ratio plots.

All workbook processing occurs in the visitor's browser. Files are not uploaded to a backend.

## Plotter features

- Reads the first worksheet of `.xls` or `.xlsx` files.
- Requires `Code`, `Compound`, `Mol/Kg`, `wt%`, and `Metric` columns.
- Uses rows whose `Metric` is `avg`, with matching `std dev` rows for error bars.
- Orders element selectors by atomic weight.
- Plots ppm or converts ppm to element mol/kg.
- Calculates weight/weight or mol/mol element ratios.
- Keeps different compounds as separate lines.
- Facets by element or compound.
- Supports log10 y axes.
- Detects repeated x-values and applies display-only offsets by sample, Code, or Compound.
- Hover labels always show the original x-value and the applied display offset.
- Exports PNG, SVG, PDF, and standalone interactive HTML.

## Publish on GitHub Pages

1. Create or open your GitHub repository.
2. Upload all files and folders from this package to the repository root.
3. Commit them to `main`.
4. Open **Settings → Pages**.
5. Choose **GitHub Actions** if using the included workflow, or **Deploy from a branch → main → /(root)**.
6. After deployment, hard-refresh the site with `Ctrl+Shift+R` if an older version is cached.

## Browser libraries

The pages load these libraries from CDNs:

- SheetJS Community Edition
- ExcelJS
- JSZip
- Plotly.js
- jsPDF

An internet connection is required when first loading the site unless those libraries are later stored locally in the repository.

## Local testing

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## License

MIT. Third-party libraries retain their own licenses.

## Blank-page check

The publishing root must contain `index.html` directly. After extracting the ZIP, upload the files themselves, not an enclosing `ree-excel-github-pages` directory. In GitHub, opening the repository root should show `index.html`, `plotter.html`, `app.js`, and `styles.css` side by side.
