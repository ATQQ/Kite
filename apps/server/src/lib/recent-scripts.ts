// 「一键填入最近成功指令」的解析逻辑：
// - parseHookCommands：从部署日志文本中提取 hook 命令（存量历史无结构化列时回退）
// - pickRecentScripts：在成功部署历史中挑选最近一次真正执行过 hook 的记录
// 拆成纯函数便于单测，不依赖 db / Elysia。

export interface RecentScripts {
  deployId: string;
  deployedAt: string;
  source: 'structured' | 'parsed' | 'none';
  preDeploy: string | null;
  postDeploy: string | null;
}

export interface DeploymentSnapshotLike {
  id: string;
  startTime: string;
  status: string;
  preDeployScript?: string | null;
  postDeployScript?: string | null;
  output?: string | null;
}

// 日志行前缀：新版 appendLog 会加 ISO 时间戳（旧版没有）
const HOOK_LOG_PREFIX = /^\d{4}-\d{2}-\d{2}T\S+\s/;
// 兼容历史格式：初始版本为 `[Deploy] Running ...`，后续为 `[Kite Deploy]` / `[Kite Rollback]`
const PRE_HOOK_RE = /^\[(?:Kite )?(?:Deploy|Rollback)\] Running Pre-deploy: (.*)$/;
const POST_HOOK_RE = /^\[(?:Kite )?(?:Deploy|Rollback)\] (?:Running Post-deploy|Dispatching Post-deploy asynchronously \(not waiting\)): (.*)$/;

export function parseHookCommands(output: string): { preDeploy: string | null; postDeploy: string | null } {
  let preDeploy: string | null = null;
  let postDeploy: string | null = null;
  for (const raw of (output || '').split('\n')) {
    const line = raw.replace(HOOK_LOG_PREFIX, '');
    const mPre = line.match(PRE_HOOK_RE);
    if (mPre) preDeploy = mPre[1].trim();
    const mPost = line.match(POST_HOOK_RE);
    if (mPost) postDeploy = mPost[1].trim();
  }
  return { preDeploy, postDeploy };
}

// history 需按 startTime 降序（与 db.deployments.findByProject 一致）。
// 逐个成功部署向下查找，返回最近一条「有 hook（结构化快照或可从日志解析）」的记录；
// 若所有成功部署都没有 hook，则以最近一次成功部署返回 source='none' 供调用方判断。
export function pickRecentScripts(history: DeploymentSnapshotLike[]): RecentScripts | null {
  const successes = history.filter((d) => d.status === 'success');
  if (successes.length === 0) return null;

  for (const d of successes) {
    const preSnapshot = d.preDeployScript ?? null;
    const postSnapshot = d.postDeployScript ?? null;
    if (preSnapshot || postSnapshot) {
      return {
        deployId: d.id,
        deployedAt: d.startTime,
        source: 'structured',
        preDeploy: preSnapshot,
        postDeploy: postSnapshot,
      };
    }
    const { preDeploy, postDeploy } = parseHookCommands(d.output || '');
    if (preDeploy || postDeploy) {
      return {
        deployId: d.id,
        deployedAt: d.startTime,
        source: 'parsed',
        preDeploy,
        postDeploy,
      };
    }
  }

  const latest = successes[0];
  return { deployId: latest.id, deployedAt: latest.startTime, source: 'none', preDeploy: null, postDeploy: null };
}
