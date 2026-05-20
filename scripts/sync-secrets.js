const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ENV_PATH = path.join(__dirname, '..', '.env');
const REQUIRED_SECRETS = [
  { key: 'STRIPE_API_KEY', description: 'Stripe Secret Key (sk_live_...)', defaultValue: '' },
  { key: 'CLICKUP_API_KEY', description: 'ClickUp Personal Token (pk_...)', defaultValue: '' },
  { key: 'OPENROUTER_API_KEY', description: 'OpenRouter API Key (sk-or-...)', defaultValue: '' },
  { key: 'DOCUSEAL_API_TOKEN', description: 'DocuSeal API Token', defaultValue: '' },
  { key: 'SOCKS5_PROXY', description: 'Optional SOCKS5 Proxy Route (socks5://...)', defaultValue: '' }
];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function run() {
  console.log('🔒 Local Credential Sync & Environment Bootstrapper');
  console.log('==================================================');
  
  let currentEnv = {};
  if (fs.existsSync(ENV_PATH)) {
    console.log('ℹ️ Existing .env file detected. Parsing current values...');
    const content = fs.readFileSync(ENV_PATH, 'utf-8');
    content.split('\n').forEach(line => {
      const parts = line.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join('=').trim();
        currentEnv[key] = value;
      }
    });
  }

  const newEnvContent = [];
  console.log('\nPlease verify or enter the secret tokens for your local Go CLIs:\n');

  for (const secret of REQUIRED_SECRETS) {
    const existingValue = currentEnv[secret.key] || process.env[secret.key] || secret.defaultValue;
    const maskedValue = existingValue ? `${existingValue.substring(0, 8)}...[hidden]` : 'Not Set';
    
    const answer = await askQuestion(`${secret.description} [Current: ${maskedValue}]: `);
    const finalValue = answer.trim() || existingValue;
    
    if (finalValue) {
      newEnvContent.push(`${secret.key}=${finalValue}`);
    } else {
      newEnvContent.push(`# ${secret.key}=`);
    }
  }

  fs.writeFileSync(ENV_PATH, newEnvContent.join('\n') + '\n');
  console.log('\n==================================================');
  console.log(`✅ Success: Environment file written to ${ENV_PATH}`);
  console.log('🔒 Ensure this file remains in your .gitignore and is never committed!');
  
  rl.close();
}

run().catch(console.error);
