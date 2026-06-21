export const DEFAULT_IGNORED: string[] = [
  '.git/**',
  '.svn/**',
  '.hg/**',
  'node_modules/**',
  '.next/**',
  '.nuxt/**',
  '.turbo/**',
  '.cache/**',
  '.parcel-cache/**',
  '.vite/**',
  'coverage/**',
  '.nyc_output/**',
  '.DS_Store',
  'Thumbs.db',
  '.idea/**',
  '.vscode/**',
  '*.log',
  'logs/**',
  'tmp/**',
  '.tmp/**',
  '.deploy-archive.zip',
  'kite-export-*.tar.gz',
  '.env*',
];

export interface MergeIgnoreOptions {
  custom?: string[];
  ignoreBuiltin?: boolean;
}

export function mergeIgnore(opts: MergeIgnoreOptions = {}): string[] {
  const { custom = [], ignoreBuiltin = false } = opts;
  const base = ignoreBuiltin ? [] : DEFAULT_IGNORED;
  return Array.from(new Set([...base, ...custom]));
}

export function parseIgnoreOption(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.flatMap(item => String(item).split(',')).map(s => s.trim()).filter(Boolean);
  }
  return String(raw).split(',').map(s => s.trim()).filter(Boolean);
}
