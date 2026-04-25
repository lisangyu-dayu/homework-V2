import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const FIXTURE_DIR = path.join(process.cwd(), 'tests', 'fixtures');
const MANIFEST_PATH = path.join(FIXTURE_DIR, 'manifest.json');

const ManifestSchema = z.object({
  version: z.number().int().min(1),
  requirements: z.object({
    minImages: z.number().int().min(1),
    maxImages: z.number().int().min(1),
    maxBytesPerImage: z.number().int().min(1),
    requiredCoverage: z.array(z.string().min(1)).min(1),
  }),
  fixtures: z.array(z.object({
    file: z.string().min(1),
    grade: z.number().int().min(1).max(12),
    coverage: z.array(z.string().min(1)).min(1),
    notes: z.string().min(1),
  })),
});

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

const manifest = ManifestSchema.parse(JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')));
const { requirements } = manifest;

if (manifest.fixtures.length < requirements.minImages || manifest.fixtures.length > requirements.maxImages) {
  fail(`fixture count ${manifest.fixtures.length} outside ${requirements.minImages}-${requirements.maxImages}`);
}

const seenFiles = new Set<string>();
const coverage = new Set<string>();

for (const fixture of manifest.fixtures) {
  if (seenFiles.has(fixture.file)) {
    fail(`duplicate fixture file: ${fixture.file}`);
  }
  seenFiles.add(fixture.file);

  const fixturePath = path.join(FIXTURE_DIR, fixture.file);
  if (!fs.existsSync(fixturePath)) {
    fail(`missing fixture file: ${fixture.file}`);
  }

  const size = fs.statSync(fixturePath).size;
  if (size > requirements.maxBytesPerImage) {
    fail(`${fixture.file} is ${formatBytes(size)}, exceeds ${formatBytes(requirements.maxBytesPerImage)}`);
  }

  for (const item of fixture.coverage) {
    coverage.add(item);
  }
}

for (const item of requirements.requiredCoverage) {
  if (!coverage.has(item)) {
    fail(`missing required coverage: ${item}`);
  }
}

process.stdout.write(
  `fixtures ok: ${manifest.fixtures.length} images, coverage=${Array.from(coverage).sort().join(', ')}\n`,
);
