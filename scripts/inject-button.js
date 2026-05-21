const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'index.html');
let html = fs.readFileSync(file, 'utf8');

const target = '                                                <details class="phase-details">';
const replacement = `                                                 <div style="margin-top: 1rem; margin-bottom: 0.75rem; display: flex; gap: 10px; flex-wrap: wrap;">
                                                     <a href="msa.pdf" target="_blank" class="ii-btn" style="display: inline-flex; align-items: center; gap: 8px; text-decoration: none; padding: 8px 16px; background: var(--rose); color: white; border-radius: 6px; font-weight: 500; font-size: 0.85rem; border: none; cursor: pointer; transition: opacity 0.2s;">
                                                         <span class="ico">📥</span> Download Master Service Agreement (PDF)
                                                     </a>
                                                 </div>\r\n` + target;

if (html.includes(target)) {
  html = html.replace(target, replacement);
  fs.writeFileSync(file, html, 'utf8');
  console.log('Button injected successfully!');
} else {
  console.error('Target not found!');
}
