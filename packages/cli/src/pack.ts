import archiver from 'archiver';
import fs from 'fs';
import path from 'path';

/**
 * 将指定目录或文件打包为 zip 文件
 * @param sourceDir 要打包的源目录
 * @param destZip 目标 zip 文件的路径
 * @param files 允许上传的特定文件或目录列表（可选，如果提供则仅打包这些内容）
 */
export async function packProject(sourceDir: string, destZip: string, files?: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destZip);
    const archive = archiver('zip', {
      zlib: { level: 9 } // 设置最高压缩级别
    });

    output.on('close', () => {
      resolve();
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
      // 遍历指定的 files 数组
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
          // 如果是一个 glob pattern
          archive.glob(pattern, {
            cwd: sourceDir,
            ignore: ['node_modules/**', '.git/**', '*.zip', '.env*']
          });
        }
      });
    } else {
      // 默认情况：使用 glob 匹配整个目录下的文件，忽略 node_modules, .git 等
      archive.glob('**/*', {
        cwd: sourceDir,
        ignore: ['node_modules/**', '.git/**', '*.zip', '.env*']
      });
    }

    archive.finalize();
  });
}
