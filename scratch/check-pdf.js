const fs = require('fs');
const path = require('path');

function getPageCount(pdfPath) {
  const data = fs.readFileSync(pdfPath);
  // Simple PDF page count parser
  const matches = data.toString('latin1').match(/\/Type\s*\/Pages\b/g);
  if (matches) {
    // Alternatively count /Page objects
    const pageMatches = data.toString('latin1').match(/\/Type\s*\/Page\b/g);
    return pageMatches ? pageMatches.length : 'unknown';
  }
  return 'unknown';
}

console.log('Welcome letter pages:', getPageCount('dist/honeyforx/01-welcome-letter.pdf'));
console.log('System playbook pages:', getPageCount('dist/honeyforx/02-system-playbook.pdf'));
console.log('Project tracker pages:', getPageCount('dist/honeyforx/03-project-tracker.pdf'));
