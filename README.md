# PEN子打工人

一个面向小学生和家庭使用的“时间币”任务应用。家庭管理者发布并审核任务，打工人完成任务获得时数，玩游戏、看视频时按秒消耗时数。

多家庭改造的五个阶段已完成：唯一系统管理员只维护家庭和老板账号，老板在家庭范围内管理日常业务，小朋友通过对应家庭入口使用自己的角色。系统继续采用单实例、单 SQLite，适合几个熟悉家庭私有使用。

## 已实现

- 唯一系统管理员使用环境变量密码登录；新变量为 `SYSTEM_ADMIN_PASSWORD`，升级期间兼容旧 `ADMIN_PASSWORD`。
- 单 SQLite 已具备家庭、老板账号、家庭绑定和主要业务对象的 `family_id` 数据基础。
- 独立系统维护后台以紧凑列表管理家庭和老板账号，创建与编辑均使用弹窗；老板可按显示名、登录名或家庭搜索。家庭统一采用系统时区，后台可重置老板密码、维护家庭绑定，并查看、复制、扫码或轮换家庭随机入口。
- 老板账号支持数据库密码认证、多家庭选择和安全切换、授权即时失效校验，以及仅限当前家庭的完整业务后台；老板可以修改账号默认名称、当前家庭昵称、自己的登录密码和当前家庭名称，并查看、复制、扫码或轮换家庭入口。
- 任务、计时、审核、账本、奖励、设置、头像和奖励图片均按 `family_id` 隔离；老板代操作会记录真实老板和目标小朋友。
- 老板可不输入小朋友 PIN 快速进入本家庭的小朋友页面；页面持续显示代操作身份，可一键返回老板后台，实物券仍只允许小朋友本人确认。
- 根首页默认公开列出所有启用中的家庭，访客先选择家庭再进入角色页，也可以粘贴完整家庭地址或直接输入入口码；系统管理员可以关闭公开家庭目录，关闭后根首页不再返回家庭或小朋友资料，但入口输入仍然可用。
- 每个家庭使用不可猜测、可轮换的 `/family/{entryCode}` 入口；系统会为入口生成真实 SVG 二维码，二维码不绕过小朋友 PIN 或老板登录；匿名角色列表和头像只对该家庭入口开放。关闭公开目录不会让已知入口失效，需要撤销旧链接时应轮换对应家庭入口。
- 多个打工人角色、独立 PIN 和长期设备登录。
- 支持系统图标和照片头像；老板可在角色卡片中上传、替换或恢复头像。
- 每个打工人独立每日奖励，默认 2 小时。
- 老板发布任务、指定角色和直接分配。
- 打工人参加、计时、暂停、提交任务。
- 打工人界面统一使用“参加任务”文案；自主奖励申报改为弹窗，不再挤占任务列表。
- “打工”页统一任务领取、进行、提交和最近结果；计时悬浮条可展开查看任务奖励、累计计时、最低要求差额和剩余总时长。
- 首页最近结果、打工页结果和明细中的标准任务收入可打开统一的紧凑详情，查看时间、计时、奖励类型及审核计提。
- “奖励”页以紧凑列表合并展示同类随机时间券、固定时间券和实物券；点击后再查看完整内容或操作，最近奖励记录也可打开详情，所有券永久有效并逐张留痕。
- 老板可创建、编辑、复制和停用奖励券模板；没有任务绑定、任务快照或已发券记录的空模板可永久删除，已有引用的模板继续只允许停用。
- 每个打工人可独立配置每日随机时间券的开关、张数和分钟范围；每日快照与唯一约束防止刷新或多设备重复派发。
- 随机券和固定券由打工人手动使用后原子入账；实物实际交付后由打工人重新输入当前密码确认收到。
- 实物券支持默认图标和压缩后保存到 SQLite 的版本化自定义图片，已发券不会随模板修改而变化。
- 老板可正常奖励、加倍奖励、退回完善或拒绝。
- 标准奖励任务审核通过后才真正入账；老板也可以快速补录遗漏的奖励并直接入账。
- 老板可从首页或角色卡片快速补录已完成但未及时发布的奖励，保留任务名称、说明和任务奖励明细。
- 老板可代小朋友操作奖励或消耗计时，并保留真实操作者审计。
- 老板可撤销尚未入账的误领任务，小朋友也可取消自己的未提交任务。
- 老板和小朋友都可修正奖励任务的累计时长，并保留修改记录。
- 老板和小朋友都可直接填写不计时的消耗时长。
- 小朋友开始消耗后的 30 秒内可撤销误触且不扣款，老板可随时取消正在运行的误触消耗。
- 已经结算的消耗可由老板原额撤销；原消费与退款记录都会保留，且同一笔只能撤销一次。
- 统一活动计时器，关闭页面或更换设备后仍可恢复。
- 玩游戏、看视频按秒扣款，余额耗尽自动结束。
- 每日奖励、任务奖励、消费及余额调整明细。
- SQLite 服务端持久化、手机端卡通响应式界面。

角色照片会先在浏览器端裁切压缩，再保存到 SQLite，因此不同设备会看到相同头像。运行时头像属于本地业务数据，不提交到 Git。

完整产品与技术计划见 [docs/development-plan.md](docs/development-plan.md)，多家庭实施与验收记录见 [docs/multi-family-system-plan-2026-07-26-012710.md](docs/multi-family-system-plan-2026-07-26-012710.md)，奖励券第一阶段规则见 [docs/reward-system-plan.md](docs/reward-system-plan.md)。

## 本地启动

环境要求：Node.js 22 或更高版本。

```bash
npm ci
cp .env.example .env.local
# 编辑 .env.local，至少填写 SYSTEM_ADMIN_PASSWORD 和 SESSION_SECRET
npm run dev
```

打开 `.env.local` 中 `PORT` 对应的地址，默认是 <http://localhost:3000>。例如临时使用 3002 端口：

```bash
PORT=3002 npm run dev
```

首次配置时，从根首页底部进入“系统维护入口”，创建老板账号并绑定“我的家庭”；系统管理员也可以在这里控制根首页是否公开显示家庭列表。之后使用老板账号创建小朋友并设置独立 PIN。老板可在“设置”页修改自己的显示名称和当前家庭名称；需要分享给家庭成员时，可以直接展示入口二维码供其扫码，也可以复制随机入口链接。SQLite 默认创建在 `data/pen-worker.db`。

## 环境配置文件

仓库提供带完整注释的 `.env.example`。它只是模板，可以提交到 Git，不能填写真实密码。

非 Docker 推荐使用 `.env.local`：

```bash
cp .env.example .env.local
```

Docker Compose 推荐使用 `.env`：

```bash
cp .env.example .env
```

这三个文件的区别：

- `.env.example`：配置说明和示例，不会作为秘密配置使用；保留空的必填项并提交到 Git。
- `.env`：项目/部署环境的通用配置。Docker Compose会自动读取它来替换 `compose.yaml` 中的 `${变量}`。
- `.env.local`：当前机器的私有覆盖配置，适合非 Docker 开发和部署；不应提交到 Git。Docker Compose默认不会读取它。

本仓库的 `npm run dev` 和 `npm start` 会依次读取 `.env`、`.env.local`，后者覆盖前者；终端中显式传入的环境变量优先级最高。例如：

```bash
PORT=3002 npm start
```

`.env` 和 `.env.local` 都已被 `.gitignore` 排除。生产环境也可以完全不创建文件，直接由 systemd、容器平台或终端提供环境变量。

主要变量如下，完整说明和推荐值见 `.env.example`：

| 变量 | 是否必填 | 作用 |
| --- | --- | --- |
| `SYSTEM_ADMIN_PASSWORD` | 新部署是 | 唯一系统管理员登录密码；修改并重启会使旧系统管理员登录失效 |
| `ADMIN_PASSWORD` | 升级兼容 | 旧部署的回退变量；两个密码同时存在时该变量不生效，以 `SYSTEM_ADMIN_PASSWORD` 为准 |
| `SESSION_SECRET` | 是 | 签名登录 Cookie，至少 32 个字符；修改会使所有设备重新登录 |
| `PORT` | 否 | Web 服务监听端口，默认 `3000` |
| `APP_TIMEZONE` | 否 | 每日奖励和自然日计算时区，默认 `Asia/Shanghai` |
| `DATABASE_PATH` | 否 | 非 Docker 的 SQLite 文件路径，默认 `./data/pen-worker.db` |
| `SESSION_MAX_AGE_DAYS` | 否 | 登录 Cookie 保留天数，默认 `180` |
| `COOKIE_SECURE` | 否 | HTTPS 时设为 `true`；局域网 HTTP 保持 `false` |
| `ALLOWED_DEV_ORIGINS` | 否 | 仅开发模式使用，允许局域网访问 `next dev` 的主机名或 IP |
| `DATA_DIR` | 否 | 仅 Docker Compose 使用，宿主机持久化数据目录，默认 `./data` |

生成随机 Session Secret 的一种方式：

```bash
openssl rand -hex 32
```

## 非 Docker 正式部署

```bash
npm ci
npm run build
npm start
```

`npm ci` 会完全按照 `package-lock.json` 安装。生产运行时可以使用 systemd、Supervisor 或其他进程管理器托管 `npm start`。修改配置后需要重启进程。

## 常用命令

```bash
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
npm start
```

## Docker 部署

Docker Compose 默认使用宿主机目录映射，不使用 Docker 命名卷：

```text
宿主机 ${DATA_DIR:-./data}  →  容器 /app/data
数据库                      →  /app/data/pen-worker.db
```

首次启动：

```bash
cp .env.example .env
# 编辑 .env，至少填写 SYSTEM_ADMIN_PASSWORD 和 SESSION_SECRET
mkdir -p data
docker compose up --build -d
```

默认访问 <http://localhost:3000>。修改 `.env` 中的配置即可选择其他端口或数据目录：

```dotenv
PORT=3002
DATA_DIR=/srv/pen-worker/data
```

对应效果是宿主机 `3002` 映射到容器 `3002`，SQLite 保存到 `/srv/pen-worker/data/pen-worker.db`。请确保 Docker 对该目录有读写权限。

常用操作：

```bash
docker compose logs -f pen-worker
docker compose restart pen-worker
docker compose down
docker compose up --build -d
```

`docker compose down` 不会删除目录映射中的数据库。生产环境应在应用前配置 HTTPS 反向代理，并在使用 HTTPS 后设置 `COOKIE_SECURE=true`。

升级现有 Docker 部署时，先在开发环境完成测试并把新代码放到部署目录，再停止旧容器、备份宿主机数据目录并重建镜像。例如使用默认 `./data` 数据目录：

```bash
docker compose stop pen-worker
upgrade_backup_dir="backups/data-before-upgrade-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$upgrade_backup_dir"
cp -a data/. "$upgrade_backup_dir"/
docker compose up --build -d pen-worker
docker compose logs --tail=100 pen-worker
```

如果配置了自定义 `DATA_DIR`，备份时应把示例中的 `data/.` 换成实际目录。`docker compose up --build` 会依据当前 `package-lock.json` 重建依赖和应用；宿主机数据目录仍映射到 `/app/data`，不会因为替换镜像而被写进或遗失在镜像中。

现有部署可以在升级过渡期继续只配置 `ADMIN_PASSWORD`。Docker 的数据库仍保存在 `${DATA_DIR:-./data}` 目录映射中，重新构建容器不会主动删除它；新代码首次连接旧库时会执行版本化迁移，把原数据归入固定的“我的家庭”。正式更新前仍必须先备份 SQLite，并建议先用备份副本演练迁移。本次多家庭开发和验证没有启动生产 Docker，也没有连接或迁移生产数据库。

## 数据备份

停止写入后备份 `data/pen-worker.db`，或使用 SQLite 的在线备份命令。不要只复制正在写入中的主数据库而忽略 WAL 文件。

所有任务、审核和余额明细均保存在 SQLite 中。删除浏览器 Cookie 只会清除当前设备登录，不会删除业务数据。

## 主要目录

```text
src/app/api/       系统管理员、老板、打工人和登录接口
src/components/    卡通移动端界面
src/lib/db.ts      SQLite 表结构与连接
src/lib/service.ts 任务、计时、审核和账本事务
src/lib/reward-service.ts 奖励券模板、派发、使用和确认事务
src/lib/session.ts 签名设备登录 Cookie
docs/              产品与开发计划
data/              运行时 SQLite 数据，不提交 Git
```
