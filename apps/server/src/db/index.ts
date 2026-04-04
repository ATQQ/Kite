import { createClient } from '@tursodatabase/api';
// 为了简化本地测试并支持Turso，我们使用 drizzle-orm 的相关适配器
// 这里由于用户只提供了 `@tursodatabase/database`，通常它是用于通过 HTTP 访问，
// 但在大多数场景下推荐配合 libSQL 客户端。为了避免环境问题，我们在测试阶段先用 mock 或者依赖注入的方式。
// 假设后续会完善真实 DB 连接，此处保留占位，并在路由层做兼容处理

// 如果有本地 sqlite 文件需求，可以导入 'drizzle-orm/libsql' 等。
export const db = {
  // 模拟的 DB 操作
  projects: {
    async findByToken(token: string) {
      // 模拟根据 Token 获取项目配置，方便直接本地测试
      if (token === 'test-token') {
        return {
          id: 'proj_abc123',
          name: 'Test Project',
          deployPath: './test_deploy_dest',
          token: 'test-token',
          preDeployScript: '',
          postDeployScript: 'echo "Post deploy running..."'
        };
      }
      return null;
    }
  },
  deployments: {
    async insert(data: any) {
      console.log('Saved deployment log:', data.id);
    }
  }
};
