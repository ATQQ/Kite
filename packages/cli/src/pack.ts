import archiver from 'archiver';
import fs from 'fs';
import path from 'path';

/**
 * 将指定目录打包为 zip 文件
 * @param sourceDir 要打包的源目录
 * @param destZip 目标 zip 文件的路径
 */
export async function packProject(sourceDir: string, destZip: string): Promise<void> {
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

    // 使用 glob 匹配文件，忽略 node_modules, .git 等
    archive.glob('**/*', {
      cwd: sourceDir,
      ignore: ['node_modules/**', '.git/**', '*.zip', '.env*']
    });

    archive.finalize();
  });
}
