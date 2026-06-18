# PersonaGen SvelteKit Portal

Everything you need to build and deploy the PersonaGen portal, Svelte 5 + Supabase multi-container stack.

## Local Development

1. Install dependencies:
   ```sh
   npm install
   ```
2. Start the development server:
   ```sh
   npm run dev
   ```
3. Run types check and linter:
   ```sh
   npm run check
   ```

---

## 🐳 Single-Instance Docker Compose (Portable Stack)

You can run the entire stack (SvelteKit app + PostgreSQL + Gotrue Auth + PostgREST + Kong Gateway) in a single docker-compose project. This is completely self-contained and ready for deployment to any Docker/VPS environment, including **Easypanel**.

### How it Works

- **SvelteKit App**: Runs using Svelte's node adapter. It compiles on-the-fly inside the container.
- **Supabase Stack**: Pre-configured services (`db`, `auth`, `rest`, `kong`) run side-by-side in the same network.
- **Auto-Seeding**: On first run, the database automatically runs [migration.sql](file:///c:/Users/nexal/personagendemo/personagen-svelte/supabase/migration.sql) to set up all tables, schemas, functions, and RLS policies.

### Local Docker Run

1. Fill out environment variables in `.env`.
2. Build and start the container stack:
   ```sh
   docker compose up --build -d
   ```
3. Open your browser to `http://localhost:3000` to access SvelteKit and `http://localhost:8000` to access the Supabase API Gateway.

### Deploying to Easypanel (Single Compose Project)

1. In the Easypanel Dashboard, click **Create Project**.
2. Select **Compose Project** (instead of standard App or Service).
3. Connect your GitHub repository.
4. Set the path to `docker-compose.yml` (located at the root or `personagen-svelte/docker-compose.yml`).
5. Configure the environment variables in the project settings:
   - `GEMINI_API_KEY`: Your Gemini API Key.
   - `PUBLIC_SUPABASE_ANON_KEY`: Public anon key for the configured Supabase project.
   - `JWT_SECRET`: A secure random JWT secret (required for GoTrue/PostgREST auth).
   - `POSTGRES_PASSWORD`: Database administrator password.
   - `SUPABASE_SERVICE_ROLE_KEY`: Service role key for server workers and internal MCP bridge.
   - `FACTORY_API_KEY`: Internal bearer key shared by the app and account factory.
   - `FACTORY_ENCRYPTION_KEY`: 32-byte hex key used by the account factory for stored sessions.
   - `MAIL_API_KEY`: Internal bearer key shared by the account factory and mail service.
   - `COMPOSIO_API_KEY` and `COMPOSIO_AUTH_CONFIG_*`: Social connection credentials where live posting is enabled.
6. Click **Deploy**. Easypanel will build the frontend, spin up all 5 containers, mount persistent database volumes, and automatically run the migrations.

---

## 📲 Testing & Troubleshooting Social Integrations

### Instagram API (Composio)

Instagram requires a **two-step publishing process** via Composio. Standard single-action publish slugs (such as `INSTAGRAM_PUBLISH_PHOTO`) are deprecated and will return `404 ToolNotFound`.

1. **Step 1 (Create Container)**: Call `INSTAGRAM_POST_IG_USER_MEDIA` with `ig_user_id: 'me'`, your `caption`, and a public `image_url` (or `video_url`). This returns a `creation_id`.
2. **Step 2 (Publish)**: Call `INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH` with `ig_user_id: 'me'`, and the `creation_id`.

> [!WARNING]
> **No Query Parameters in Media URLs**: The Instagram Graph API will fail with a `400 Bad Request` if your `image_url` contains query parameters (e.g. `?w=800` or AWS S3 authentication tokens). Always provide a direct link without query strings. For test fallbacks, use `https://picsum.photos/1080/1080.jpg`.

### Reusable Instagram Post Test Snippet

To verify your Composio connection end-to-end without running the entire SvelteKit scheduler, save the following script as `test_post_instagram.js` at the root and run `node test_post_instagram.js`:

```javascript
import fs from 'fs';

// Parse .env manually
const envContent = fs.readFileSync('.env', 'utf8');
const env = {};
envContent.split('\n').forEach((line) => {
	const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
	if (match) {
		let value = match[2] || '';
		if (value.startsWith('"') && value.endsWith('"')) {
			value = value.substring(1, value.length - 1);
		}
		env[match[1]] = value;
	}
});

const apiKey = env.COMPOSIO_API_KEY;
const agentId = '08229e1e-9a30-4f2f-89d4-0cf47eb72ade'; // Ratio Agent

async function run() {
	if (!apiKey) {
		console.error('COMPOSIO_API_KEY is missing from .env');
		return;
	}

	const content = `Hello Instagram! End-to-end integration test at ${new Date().toLocaleString()}. #personagen`;
	const mediaUrl = 'https://picsum.photos/1080/1080.jpg'; // No query parameters allowed!

	console.log('Step 1: Creating Instagram Media Container via INSTAGRAM_POST_IG_USER_MEDIA...');
	const createResponse = await fetch(
		'https://backend.composio.dev/api/v3.1/tools/execute/INSTAGRAM_POST_IG_USER_MEDIA',
		{
			method: 'POST',
			headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				user_id: agentId,
				arguments: { ig_user_id: 'me', image_url: mediaUrl, caption: content }
			})
		}
	);

	if (!createResponse.ok) {
		console.error(
			`Container creation failed! Status: ${createResponse.status}, Error:`,
			await createResponse.text()
		);
		return;
	}

	const createResult = await createResponse.json();
	const creationId = createResult.data?.id || createResult.result?.id || createResult.id;
	if (!creationId) {
		console.error('Failed to extract creation_id:', createResult);
		return;
	}

	console.log(`Container created successfully. Creation ID: ${creationId}`);
	console.log(
		'Step 2: Publishing Instagram Media Container via INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH...'
	);

	const publishResponse = await fetch(
		'https://backend.composio.dev/api/v3.1/tools/execute/INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH',
		{
			method: 'POST',
			headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				user_id: agentId,
				arguments: { ig_user_id: 'me', creation_id: creationId, max_wait_seconds: 60 }
			})
		}
	);

	if (!publishResponse.ok) {
		console.error(
			`Publish failed! Status: ${publishResponse.status}, Error:`,
			await publishResponse.text()
		);
		return;
	}

	const publishResult = await publishResponse.json();
	console.log(
		'Publish completed successfully! Result ID:',
		publishResult.data?.id || publishResult.id
	);
}

run().catch(console.error);
```
