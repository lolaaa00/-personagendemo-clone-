#!/usr/bin/env node
/**
 * Deterministic, non-generating audit of Studio button/composer contracts.
 *
 * Usage:
 *   node --experimental-strip-types scripts/audit-composer-contracts.mjs
 *   node --experimental-strip-types scripts/audit-composer-contracts.mjs --strict
 *
 * This imports the real Studio catalog and reads the real composer/endpoint/
 * generator sources. It never boots the app, contacts a provider, writes a DB
 * row, schedules a post, or publishes anything.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STUDIO_TEMPLATES } from '../src/lib/studio-templates.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const sources = {
  catalog: join(root, 'src/lib/studio-templates.ts'),
  composer: join(root, 'src/lib/components/generation/GenerationComposer.svelte'),
  generatePost: join(root, 'src/routes/api/agent/[agentId]/generate-post/+server.ts'),
  generator: join(root, 'src/lib/server/content/generate.ts'),
  personaPage: join(root, 'src/routes/(portal)/personas/[agentId]/+page.svelte'),
  calendarPage: join(root, 'src/routes/(portal)/calendar/+page.svelte')
};
const text = Object.fromEntries(Object.entries(sources).map(([k, p]) => [k, readFileSync(p, 'utf8')]));

function lineOf(source, needle, start = 0) {
  const at = source.indexOf(needle, start);
  return at < 0 ? null : source.slice(0, at).split('\n').length;
}

function evidence(sourceKey, needle, note) {
  const line = lineOf(text[sourceKey], needle);
  return `${sources[sourceKey].replaceAll('\\', '/')}:${line ?? '?'} — ${note}`;
}

const expectedMediaBySurface = {
  motion: 'video',
  photo: 'image',
  cinematic: 'cinematic',
  typographic: 'image'
};
const expectedByPipeline = {
  'Talking head': { media: 'video', format: 'spokesperson' },
  'Product motion': { media: 'video', format: 'broll' },
  Cinematic: { media: 'cinematic' },
  'Still image': { media: 'image' }
};

const matrix = STUDIO_TEMPLATES.map((template) => {
  const body = template.baseBody ?? {};
  // generate-post treats only the literal "image" as still and literal
  // "cinematic" as cinematic; an omitted media value is video.
  const actualMedia = body.media === 'cinematic' ? 'cinematic' : body.media === 'image' ? 'image' : 'video';
  const requestedStill = body.still === 'graphic' ? 'graphic' : 'photo';
  const cinematic = actualMedia === 'cinematic';
  const actualStill = cinematic ? 'photo' : requestedStill;
  const actualCharacterRef = cinematic || (body.refs?.character !== false && actualStill !== 'graphic');
  const actualProductRef = cinematic || (body.refs?.product !== false && actualStill !== 'graphic');
  const sourceLine = lineOf(text.catalog, `id: '${template.id}'`);
  const violations = [];

  if (actualMedia !== expectedMediaBySurface[template.surface]) {
    violations.push(`surface advertises ${template.surface}, but request resolves to ${actualMedia}`);
  }
  const pipelineExpectation = expectedByPipeline[template.pipeline];
  if (pipelineExpectation?.media && actualMedia !== pipelineExpectation.media) {
    violations.push(`pipeline advertises ${template.pipeline}, but request resolves to ${actualMedia}`);
  }
  if (pipelineExpectation?.format && body.format !== pipelineExpectation.format) {
    violations.push(`pipeline advertises ${template.pipeline}, but format is ${body.format ?? 'persona default'}`);
  }
  if (template.surface === 'typographic') {
    if (actualStill !== 'graphic') violations.push('typographic surface does not resolve to graphic still');
    if (actualCharacterRef || actualProductRef) violations.push('typographic surface resolves with a photo reference');
  }
  if (template.intent === 'channel') {
    const prose = `${body.topic ?? ''}\n${body.scene ?? ''}`;
    if (actualProductRef) violations.push('channel template feeds a product reference');
    if (/\b(featured product|product (?:as|in|at|matters|category)|ties? (?:it )?to the product)\b/i.test(prose)) {
      violations.push('channel template copy explicitly depends on a product');
    }
  }
  if (actualMedia === 'video' && body.format === 'spokesperson' && actualCharacterRef === false) {
    violations.push('spokesperson video excludes the character reference');
  }

  return {
    id: template.id,
    title: template.title,
    source: `${sources.catalog.replaceAll('\\', '/')}:${sourceLine ?? '?'}`,
    intent: template.intent,
    advertisedSurface: template.surface,
    advertisedPipeline: template.pipeline,
    actualMedia,
    actualFormat: body.format ?? 'persona default',
    actualStill,
    actualRefs: { character: actualCharacterRef, product: actualProductRef },
    deliver: body.deliver ?? null,
    violations
  };
});

const systemFindings = [];
function addSystem(id, severity, title, affected, proof, consequence) {
  systemFindings.push({ id, severity, title, affected, evidence: proof, consequence });
}

if (text.generatePost.includes('requestedPlatforms.length > 0 ? requestedPlatforms : connectedPlatforms')) {
  addSystem(
    'C-PLATFORM-EMPTY',
    'P0',
    'Explicitly deselecting every platform falls back to every connected platform',
    'All post-generation composers',
    [evidence('composer', 'body.platforms = platforms;', 'composer always submits an explicit array'), evidence('generatePost', 'requestedPlatforms.length > 0 ? requestedPlatforms : connectedPlatforms', 'empty/invalid explicit array becomes all active connections')],
    'A user can clear all destination chips and still have the generated post routed to all connected accounts.'
  );
}

if (text.composer.includes("{#if videoModelOptions.length && format !== 'spokesperson'}")) {
  addSystem(
    'C-UNUSED-VIDEO-MODEL',
    'P1',
    'Video-model control is shown for image and cinematic operations even though those paths do not use it',
    'Image, typographic, and cinematic composers whenever format is auto/b-roll',
    [evidence('composer', "{#if videoModelOptions.length && format !== 'spokesperson'}", 'visibility is not gated by media === video'), evidence('generatePost', "videoModel: effectiveResolve(registryRows, 'video_i2v', body.video_model).id", 'value is resolved for every request'), evidence('generatePost', "const stepsCinematic: Step[]", 'cinematic pipeline is fixed to Kling O3 Pro reference')],
    'The UI presents a cost/model choice that cannot change the selected operation.'
  );
}

if (text.composer.includes('<select id="gc-media" bind:value={media}>') && !text.composer.includes('studioContract?.lockMedia')) {
  addSystem(
    'C-TEMPLATE-MUTATION',
    'P1',
    'Every Studio operation can be changed into a different media operation inside the generic composer',
    'All 41 Studio template buttons',
    [evidence('composer', '<select id="gc-media" bind:value={media}>', 'generic media switch is rendered for every post composer'), evidence('generatePost', "const wantCinematic = body.media === 'cinematic';", 'server follows the changed media, not the advertised template surface')],
    'A “text card,” “photo,” “talking head,” or “cinematic” button is only a prefill, not an enforced composition contract.'
  );
}

if (text.composer.includes('body.product_id = productId || undefined;')) {
  addSystem(
    'C-HIDDEN-PRODUCT-ID',
    'P0',
    'A product selected by preview is submitted even when the product UI is hidden',
    'Every product-free/channel template on a persona with a pinned brand brief',
    [evidence('composer', 'productId = preview.product?.id ??', 'preview product becomes local state unconditionally'), evidence('composer', 'body.product_id = productId || undefined;', 'confirm submits it without reference-policy gating'), evidence('generatePost', 'products.find((p: any) => p.id === genInput.productId)', 'preview chooses a product even for product-free compositions')],
    'A hidden value can steer copy and grading toward a product while the user sees a product-free channel composition.'
  );
}

if (text.generator.includes('selectedProduct = input.productId') && text.generator.includes("products.find((p: any) => p.photoUrl) || products[0]")) {
  addSystem(
    'C-CHANNEL-BRAND-LEAK',
    'P0',
    'The generator automatically selects a product whenever a brand brief exists, regardless of refs.product=false',
    'All channel templates and future niche-planner channel ideas',
    [evidence('generator', 'selectedProduct = input.productId', 'product selection occurs before the Director prompt'), evidence('generator', "products.find((p: any) => p.photoUrl) || products[0]", 'missing product id still falls back to the first product'), evidence('generator', '? `Product: "${selectedProduct.name}"', 'Director receives Product instead of Topic when one is selected'), evidence('generator', 'const wantProductRef = input.useProductRef !== false', 'refs.product only controls the image reference later')],
    'The current “channel” contract removes a product photo but does not remove product strategy/copy context.'
  );
}

if (text.generatePost.includes('wantCinematic || (genInput.useProductRef !== false')) {
  addSystem(
    'C-CINEMATIC-REFS',
    'P1',
    'Cinematic mode overrides the template reference contract and always requires both face and product',
    'Any product-free or persona-free template switched to cinematic; channel cinematic Wild Card',
    [evidence('generatePost', 'wantCinematic || (genInput.useProductRef !== false', 'cinematic forces product use'), evidence('generatePost', 'wantCinematic || (genInput.useCharacterRef !== false', 'cinematic forces character use')],
    'Switching media can reveal and consume references that the clicked operation explicitly excluded.'
  );
}

if (text.generator.includes("if (input.stillStyle === 'graphic' && format === 'spokesperson')") && !text.generator.includes("input.useCharacterRef === false && format === 'spokesperson'")) {
  addSystem(
    'C-SPOKESPERSON-NO-PERSON',
    'P1',
    'Spokesperson remains selectable for photo compositions that exclude the persona',
    'Product-only, POV, mood-board, room, macro, flat-lay, and similar templates after switching to video',
    [evidence('composer', "<option value=\"spokesperson\" disabled={isGraphicCard}", 'UI disables spokesperson only for graphic cards'), evidence('generator', "if (input.stillStyle === 'graphic' && format === 'spokesperson')", 'server coercion protects graphics only')],
    'The talking-head branch can be requested without a character/face contract.'
  );
}

if (!text.generatePost.includes('deliveryPolicy') && text.generatePost.includes("body.deliver === 'asset' || body.deliver === 'review'")) {
  addSystem(
    'C-DELIVERY-INFERRED',
    'P0',
    'Generation delivery is inferred from a nullable hidden body field rather than an explicit composer outcome',
    'Persona Generate Now, calendar Generate Post Now, Studio review/asset flows',
    [evidence('generatePost', "body.deliver === 'asset' || body.deliver === 'review'", 'only review/asset override default behavior'), evidence('generatePost', 'without it, an unscheduled generate', 'route documents immediate publication when no override exists'), evidence('composer', 'body.scheduled_time = scheduledTime || undefined;', 'composer submits schedule fields but no explicit delivery policy')],
    'A button labelled Generate/Approve can publish immediately when a caller omits one hidden field.'
  );
}

if (!text.composer.includes('preview.deliver') && text.composer.includes('body.scheduled_date = scheduledDate || undefined;')) {
  addSystem(
    'C-ASSET-IRRELEVANT-FIELDS',
    'P1',
    'Standalone-asset composers still show and submit publishing and schedule controls',
    'Studio “Create standalone asset” mode',
    [evidence('composer', 'body.scheduled_date = scheduledDate || undefined;', 'schedule is always submitted for post-kind specs'), evidence('composer', 'body.platforms = platforms;', 'destinations are always submitted'), evidence('generatePost', "deliver === 'asset' ? { standalone: true }", 'asset delivery overrides those controls')],
    'The composer asks for values that do not control standalone-asset delivery.'
  );
}

const templateFindings = matrix.filter((row) => row.violations.length > 0);
const counts = {
  templates: matrix.length,
  channel: matrix.filter((x) => x.intent === 'channel').length,
  brand: matrix.filter((x) => x.intent === 'brand').length,
  cleanTemplateContracts: matrix.filter((x) => x.violations.length === 0).length,
  templatesWithViolations: templateFindings.length,
  systemFindings: systemFindings.length,
  bySeverity: Object.fromEntries(['P0', 'P1', 'P2'].map((s) => [s, systemFindings.filter((f) => f.severity === s).length]))
};

const result = {
  generatedAt: new Date().toISOString(),
  scope: 'Static, deterministic, non-generating composer contract audit',
  counts,
  systemFindings,
  templateFindings,
  matrix
};

const outDir = join(root, 'artifacts/composer-forensics');
mkdirSync(outDir, { recursive: true });
const jsonPath = join(outDir, 'composer-contract-audit.json');
const mdPath = join(outDir, 'composer-contract-audit.md');
writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);

const md = [
  '# PersonaGen Composer Contract Audit',
  '',
  `Generated: ${result.generatedAt}`,
  '',
  '> Static and non-generating: no provider, database, scheduling, or publishing call was made.',
  '',
  '## Summary',
  '',
  `- Studio templates: **${counts.templates}** (${counts.channel} channel / ${counts.brand} brand)`,
  `- Template-level violations: **${counts.templatesWithViolations}**`,
  `- Cross-composer findings: **${counts.systemFindings}** (${counts.bySeverity.P0} P0 / ${counts.bySeverity.P1} P1 / ${counts.bySeverity.P2} P2)`,
  '',
  '## Cross-composer findings',
  '',
  ...systemFindings.flatMap((f) => [
    `### ${f.severity} · ${f.id} · ${f.title}`,
    '',
    `**Affected:** ${f.affected}`,
    '',
    f.consequence,
    '',
    ...f.evidence.map((e) => `- ${e}`),
    ''
  ]),
  '## Template-level findings',
  '',
  '| Template | Intent | Advertised | Actual | References | Violations |',
  '|---|---|---|---|---|---|',
  ...templateFindings.map((r) => `| ${r.title} (${r.id}) | ${r.intent} | ${r.advertisedSurface} / ${r.advertisedPipeline} | ${r.actualMedia} / ${r.actualFormat} / ${r.actualStill} | character=${r.actualRefs.character}, product=${r.actualRefs.product} | ${r.violations.join('; ')} |`),
  '',
  '## Full 41-template matrix',
  '',
  '| Template | Intent | Surface | Pipeline | Actual media | Format | Still | Character | Product | Deliver |',
  '|---|---|---|---|---|---|---|---:|---:|---|',
  ...matrix.map((r) => `| ${r.title} (${r.id}) | ${r.intent} | ${r.advertisedSurface} | ${r.advertisedPipeline} | ${r.actualMedia} | ${r.actualFormat} | ${r.actualStill} | ${r.actualRefs.character} | ${r.actualRefs.product} | ${r.deliver ?? 'review (caller overlay)'} |`),
  ''
].join('\n');
writeFileSync(mdPath, md);

console.log(`Composer audit: ${counts.templates} templates, ${counts.templatesWithViolations} template violations, ${counts.systemFindings} system findings.`);
console.log(`JSON: ${jsonPath}`);
console.log(`Markdown: ${mdPath}`);
if (process.argv.includes('--strict') && (templateFindings.length > 0 || systemFindings.some((f) => f.severity === 'P0' || f.severity === 'P1'))) {
  process.exitCode = 1;
}
