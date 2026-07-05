# 快速开始

> 目标：用最少步骤把任意一个前端/后端项目部署到本地或内网的 Kite 服务。

## 1. 安装 CLI

Kite 把 Web 管理端、Server 后端和上传/部署执行都打包在一个 CLI 里，安装一次即可：

```bash
npm install -g @kitecd/cli
# 或使用 bun
bun add -g @kitecd/cli
```

要求 Node.js v18+（或 Bun）。后续所有命令都来自 `@kitecd/cli`。

## 2. 启动内置服务

`kite serve` 会同时拉起 Web 管理端、Server 后端、并把数据持久化到 `~/.kite/`。首次启动会打印 Admin Token，复制它用于登录 Web 管理端。

![](https://cdn.upyun.sugarat.top/mdImg/sugar/ac32b493e691ba671e62b4ca6ed9d7a5)

页面样子 ↓

![](https://cdn.upyun.sugarat.top/mdImg/sugar/bed7b622ced2ff3d27aef90720e6e968)

### 本地 / 测试环境

只在本机跑一下、验证一下部署链路，直接前台启动即可，不用 pm2：

```bash
kite serve
# 默认监听 http://127.0.0.1:5431，Ctrl+C 结束
```

### 线上 / 服务器部署

服务器长期运行推荐：**监听 127.0.0.1 + pm2 守护 + Nginx 反代**。默认挂在域名根路径下，简单直接：

```bash
# 1. 全局装 pm2（首次）
npm install -g pm2

# 2. 用 pm2 守护
kite serve --pm2 --host 127.0.0.1 --port 5431
```

Nginx 里只需要一段 `location /`，同时代理页面、API、终端 WebSocket：

:::details Nginx 反代示例（点击展开）
```nginx
server {
    listen 443 ssl;
    server_name ops.example.com;

    # ...ssl_certificate 等常规配置...

    location / {
        proxy_pass         http://127.0.0.1:5431;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;

        # 让同一个 location 也能代理终端 WebSocket
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}
```
:::

访问 `https://ops.example.com/` 即可打开管理端。

::::details 需要挂到存量站点的子路径下（`--base`，可选）
如果 `ops.example.com` 已经跑着别的服务，想把 Kite 挂在 `https://ops.example.com/kite/` 这种子路径下，可以给 `kite serve` 加 `--base`，页面、API、WebSocket 会全部带上同一个前缀，Nginx 里也只用一段 `location`。

```bash
kite serve --pm2 --host 127.0.0.1 --port 5431 --base kite
```

:::details Nginx 子路径反代示例
```nginx
location /kite/ {
    proxy_pass         http://127.0.0.1:5431;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;

    proxy_set_header   Upgrade    $http_upgrade;
    proxy_set_header   Connection "upgrade";
    proxy_read_timeout 3600s;
}
```
:::

访问 `https://ops.example.com/kite/`。项目详情页显示的 `kite init` / `kite push` 命令会自动带上 `--server https://ops.example.com/kite`，复制即用。

**`--base` 取值规则**：CLI 会做规范化——去掉首尾的 `/`，前面统一补一个 `/`。所以下面这些写法结果相同：

| 传入值 | 规范化后（KITE_BASE） |
| --- | --- |
| （不传） / `""` / `/` / `.` | `""`（不启用子路径） |
| `base` / `/base` / `/base/` | `/base` |
| `base/asd` / `/base/asd/` | `/base/asd` |

未带前缀的路径（例如直连 `http://server:5431/`、`/api/*`）会直接返回 404，避免绕过 Nginx。非法值（含空格、中文、`//` 空段、`..` 段落等）在 `kite serve` 启动时会直接报错退出。
::::

> - pm2 / Nginx 更多细节见 [CLI 文档](/cli)。
> - 不启用 pm2 的话，可以用 `nohup kite serve ... &` 或 systemd 等自选方案。

## 3. 在 Web 管理端创建项目

打开管理端并用启动时打印的 Admin Token 登录：

- **本地**：`http://127.0.0.1:5431`
- **线上**：按实际域名访问，例如 `https://ops.example.com/`（挂子路径时为 `https://ops.example.com/kite/`）

在「项目管理 → 新建项目」中填写 **项目名称** 与 **部署目录**（服务器上的绝对路径）

### 创建
支持输入创建，或者批量的选择存量目录创建

![](https://cdn.upyun.sugarat.top/mdImg/sugar/5c4c77027643d6a14f6452509d5c584b)

![](https://cdn.upyun.sugarat.top/mdImg/sugar/f8ec689957dad91dfdbe3887f1d98786)

### 项目详情

![](https://cdn.upyun.sugarat.top/mdImg/sugar/ae8edbb0f6c5510e6a099cad41a7cb78)


## 4. 初始化并部署

项目详情页会根据当前访问地址实时生成 `kite init` / `kite push` 命令

![](https://cdn.upyun.sugarat.top/mdImg/sugar/7afe3fa86fb3ff41176ef5c99b3027d1)

`kite push` 会读取 `kite.config.json` + `.env.local` + 全局配置，打包 `outputDir`；

上传后依次执行 `preDeploy` → 解压 → `postDeploy`，日志会实时回显并落到 Web 端「部署日志」页。


:::tip **默认解压行为**
覆盖模式: 同名文件会被新包覆盖，但目标目录里**已存在但新 zip 中没有的文件不会被删除**。

也可按需选择 其它清理模式

![](https://cdn.upyun.sugarat.top/mdImg/sugar/d6318580e4e47e0692b75e58796b02ba)

可以使用清理预览功能，来判断参与清理的文件和目录。
:::

## 5. 数据目录

CLI 与 Server 的所有状态都保存在 `~/.kite`，**升级 CLI 不会覆盖**：

```txt
~/.kite/
  config.json        # CLI 全局配置（serverUrl、token 等）
  kite.db            # Server 侧项目/日志/设置（libSQL 单文件）
  deployments/       # 默认部署根目录
  tmp/               # 上传、解压临时文件
  pm2/               # pm2 守护模式下的配置和日志
```

可以通过环境变量 `KITE_HOME` 自定义数据目录：

```bash
KITE_HOME=/data/kite kite serve
```

更多命令与参数详见 [CLI 文档](/cli)，部署链路细节见 [部署流程](/guide/deploy-flow)。
