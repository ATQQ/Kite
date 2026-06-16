import archiver from 'archiver';
import fs from 'fs';
import path from 'path';
import { mergeIgnore } from './ignore.js';

export interface PackResult {
  size: number;
  entries: string[];
  fileCount: number;
}

export interface PackOptions {
  files?: string[];
  ignore?: string[];
  ignoreBuiltin?: boolean;
}

/**
 * 将路径列表折叠：如果一个目录下的所有文件都在列表中，则只展示目录
 */
function collapseEntries(rawEntries: string[]): string[] {
  if (rawEntries.length === 0) return [];

  // 构建目录树
  const tree: Record<string, Set<string>> = {};
  for (const entry of rawEntries) {
    const parts = entry.split('/');
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      if (!tree[dir]) tree[dir] = new Set();
      tree[dir].add(parts.slice(0, i + 1).join('/'));
    }
  }

  // 递归检查：目录下所有子项都在列表中则折叠
  const allPaths = new Set(rawEntries);
  function isCompleteDir(dirPath: string): boolean {
    const children = tree[dirPath];
    if (!children) return true;
    for (const child of children) {
      if (tree[child]) {
        if (!isCompleteDir(child)) return false;
      } else if (!allPaths.has(child)) {
        return false;
      }
    }
    return true;
  }

  const result: string[] = [];
  const added = new Set<string>();

  for (const entry of rawEntries) {
    // 检查这个文件的祖先目录是否已经完整折叠
    let dominated = false;
    const parts = entry.split('/');
    for (let i = 1; i < parts.length; i++) {
      const ancestor = parts.slice(0, i).join('/');
      if (added.has(ancestor + '/')) { dominated = true; break; }
      if (tree[ancestor] && isCompleteDir(ancestor)) {
        result.push(ancestor + '/');
        added.add(ancestor + '/');
        dominated = true;
        break;
      }
    }
    if (dominated) continue;

    // 检查这个文件是否是一个完整目录的叶子
    const dir = path.dirname(entry);
    if (dir !== '.' && tree[dir] && isCompleteDir(dir)) {
      if (!added.has(dir + '/')) {
        result.push(dir + '/');
        added.add(dir + '/');
      }
    } else {
      if (!added.has(entry)) {
        result.push(entry);
        added.add(entry);
      }
    }
  }

  return result;
}

/**
 * 将指定目录或文件打包为 zip 文件
 * @param sourceDir 要打包的源目录
 * @param destZip 目标 zip 文件的路径
 * @param filesOrOptions 兼容旧签名 string[]，或新版 PackOptions
 *
 * 忽略规则语义：
 *   - 显式 files 条目命中真实路径（archive.file / archive.directory）→ 不应用 ignore，
 *     用户明确指定即表示需要。
 *   - glob 通配（archive.glob 含默认全量）→ 应用 mergeIgnore({ custom, ignoreBuiltin })。
 */
export async function packProject(
  sourceDir: string,
  destZip: string,
  filesOrOptions?: string[] | PackOptions
): Promise<PackResult> {
  const opts: PackOptions = Array.isArray(filesOrOptions)
    ? { files: filesOrOptions }
    : (filesOrOptions || {});
  const files = opts.files;
  const ignoreList = mergeIgnore({ custom: opts.ignore, ignoreBuiltin: opts.ignoreBuiltin });

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destZip);
    const archive = archiver('zip', {
      zlib: { level: 9 }
    });

    const rawEntries: string[] = [];

    archive.on('entry', (entry: any) => {
      if (entry.stats && !entry.stats.isDirectory()) {
        rawEntries.push(entry.name);
      }
    });

    output.on('close', () => {
      const entries = collapseEntries(rawEntries);
      resolve({
        size: archive.pointer(),
        entries,
        fileCount: rawEntries.length
      });
    });

    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') {
        console.warn(err);
      } else {
        reject(err);
      }
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);

    if (files && files.length > 0) {
      files.forEach(pattern => {
        const fullPath = path.resolve(sourceDir, pattern);
        if (fs.existsSync(fullPath)) {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            archive.directory(fullPath, pattern);
          } else {
            archive.file(fullPath, { name: pattern });
          }
        } else {
          archive.glob(pattern, { cwd: sourceDir, ignore: ignoreList });
        }
      });
    } else {
      archive.glob('**/*', { cwd: sourceDir, ignore: ignoreList });
    }

    archive.finalize();
  });
}
