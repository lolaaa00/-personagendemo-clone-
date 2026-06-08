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
   - `JWT_SECRET`: A secure random JWT secret (required for GoTrue/PostgREST auth).
   - `POSTGRES_PASSWORD`: Database administrator password.
6. Click **Deploy**. Easypanel will build the frontend, spin up all 5 containers, mount persistent database volumes, and automatically run the migrations.

