const fs = require('fs');
const path = require('path');

const brainDir = 'C:/Users/nexal/.gemini/antigravity-ide/brain';
const folders = fs.readdirSync(brainDir).filter(f => fs.statSync(path.join(brainDir, f)).isDirectory());

const keywords = ["captix", "captixgroup", "captixgroup@gmail.com", "muhammad", "rahman", "amani", "+61449665123", "JY6HA5UP"];

let output = `Searching across ${folders.length} folders...\n`;

for (const folder of folders) {
  const filePath = path.join(brainDir, folder, '.system_generated', 'logs', 'transcript.jsonl');
  if (!fs.existsSync(filePath)) continue;
  
  const content = fs.readFileSync(filePath, 'utf8');
  const lowerContent = content.toLowerCase();
  const matchedKws = keywords.filter(kw => lowerContent.includes(kw.toLowerCase()));
  
  if (matchedKws.length > 0) {
    output += `\n=================== Found matches in folder: ${folder} (KWs: ${matchedKws.join(', ')}) ===================\n`;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      
      const lowerLine = line.toLowerCase();
      if (keywords.some(kw => lowerLine.includes(kw.toLowerCase()))) {
        try {
          const obj = JSON.parse(line);
          if (obj.type === "USER_INPUT" || obj.type === "PLANNER_RESPONSE" || obj.content) {
            output += `Line ${i + 1} (${obj.type}):\n`;
            output += (obj.content ? obj.content.substring(0, 1000) : 'no content') + '\n';
            output += '--------------------------------------------------\n';
          }
        } catch (e) {
          // If JSON parse fails, print raw line snippet
          if (line.includes("USER_INPUT") || line.includes("PLANNER_RESPONSE")) {
            output += `Line ${i + 1} (raw): ${line.substring(0, 400)}\n`;
            output += '--------------------------------------------------\n';
          }
        }
      }
    }
  }
}

fs.writeFileSync('scratch/search-results.txt', output);
console.log("Written search results to scratch/search-results.txt");
