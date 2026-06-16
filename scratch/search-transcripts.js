const fs = require('fs');
const path = require('path');

const transcripts = [
  "f64d405c-1c1f-4761-b300-79a29c6e997a",
  "da4acb86-b36d-41eb-9b0f-692ecbf915d7",
  "ddb120c7-7a4f-4ce3-8620-451424d576af",
  "c72ba2d0-5dc9-4fa1-bdd7-a619c1e17b7b",
  "2dd4375a-c8fc-4a77-a8d0-f5473f131130"
];

const keywords = ["captix", "amani", "rahman", "muhammad", "honeyforx", "invoice", "due", "retainer", "paid"];

for (const folder of transcripts) {
  const filePath = `C:/Users/nexal/.gemini/antigravity-ide/brain/${folder}/.system_generated/logs/transcript.jsonl`;
  if (!fs.existsSync(filePath)) {
    console.log(`Path does not exist: ${filePath}`);
    continue;
  }
  
  console.log(`Searching in ${folder}...`);
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    
    // Check if any keyword matches
    const lowerLine = line.toLowerCase();
    const matches = keywords.filter(kw => lowerLine.includes(kw));
    
    if (matches.length > 0) {
      try {
        const obj = JSON.parse(line);
        // We only want user messages or model responses that contain text
        if (obj.type === "USER_INPUT" || obj.type === "PLANNER_RESPONSE" || obj.content) {
          console.log(`Line ${i + 1} matches: ${matches.join(', ')}`);
          console.log(`Type: ${obj.type}`);
          console.log(`Content: ${obj.content ? obj.content.substring(0, 500) : 'none'}`);
          console.log('---');
        }
      } catch (e) {
        // failed to parse JSON, just search the line
        if (line.includes("USER_INPUT") || line.includes("PLANNER_RESPONSE")) {
          console.log(`Line ${i + 1} matches (raw): ${line.substring(0, 300)}`);
          console.log('---');
        }
      }
    }
  }
}
