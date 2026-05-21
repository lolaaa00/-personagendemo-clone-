const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'templates', 'msa-template.html');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Set text-align to justify on body, and ensure headings are left-aligned and break-avoid
const bodyTarget = `  body {
    font-family: 'Inter', -apple-system, sans-serif;
    font-size: 10.5pt;
    line-height: 1.65;
    color: var(--ink);
    background: var(--bg);
    max-width: 8.5in;
    margin: 0 auto;
    padding: 0.75in 1in;
  }`;

const bodyReplacement = `  body {
    font-family: 'Inter', -apple-system, sans-serif;
    font-size: 10.5pt;
    line-height: 1.65;
    color: var(--ink);
    background: var(--bg);
    max-width: 8.5in;
    margin: 0 auto;
    padding: 0.75in 1in;
    text-align: justify;
  }

  h1, h2, h3, h4, h5, h6 {
    text-align: left;
    page-break-after: avoid;
    break-after: avoid;
  }`;

content = content.replace(bodyTarget, bodyReplacement);

// 2. Remove page-break-inside: avoid from .section
content = content.replace('page-break-inside: avoid;', '/* page-break-inside: avoid; */');

// 3. Remove print media query page-break-inside: avoid for .section
const printTarget = `  @media print {
    body { padding: 0; }
    .section { page-break-inside: avoid; }
    .signature-block { page-break-inside: avoid; }
  }`;

const printReplacement = `  @media print {
    body { padding: 0; }
    .section { /* page-break-inside: avoid; */ }
    .signature-block { page-break-inside: avoid; }
  }`;

content = content.replace(printTarget, printReplacement);

// 4. Remove all persona showcases and their captions
// Regex to match <div class="persona-showcase">...</div> and any immediately following caption <p class="persona-showcase-caption">...</p>
const regex1 = /<div class="persona-showcase">[\s\S]*?<\/div>\r?\n<p class="persona-showcase-caption">[\s\S]*?<\/p>/g;
content = content.replace(regex1, '');

// Also clean up any other .persona-showcase that doesn't have that specific caption format (like in Exhibit B)
const regex2 = /<div class="persona-showcase">[\s\S]*?<\/div>/g;
content = content.replace(regex2, '');

// 5. Remove Exhibit B entirely
const exhibitBRegex = /<!-- EXHIBIT B -->[\s\S]*?<\/div>\s*<\/body>/g;
// Replace Exhibit B up to the closing body tag
content = content.replace(exhibitBRegex, '</body>');

// Write the modifications back to file
fs.writeFileSync(filePath, content, 'utf8');
console.log('MSA Template updated successfully!');
