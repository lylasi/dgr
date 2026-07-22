# PEN子打工人

一个面向小学生和家庭使用的“时间币”任务应用。管理员发布并审核任务，打工人完成任务获得时数，玩游戏、看视频时按秒消耗时数。

## 已实现

- 单管理员配置密码登录。
- 多个打工人角色、独立 PIN 和长期设备登录。
- 支持系统图标和照片头像；管理员可在角色卡片中上传、替换或恢复头像。
- 每个打工人独立每日奖励，默认 2 小时。
- 管理员发布任务、指定角色和直接分配。
- 打工人参加、计时、暂停、提交任务。
- 打工人界面统一使用“参加任务”文案；自主奖励申报改为弹窗，不再挤占任务列表。
- “打工”页统一任务领取、进行、提交和最近结果；计时悬浮条可展开查看任务奖励、累计计时、最低要求差额和剩余总时长。
- 首页最近结果、打工页结果和明细中的标准任务收入可打开统一的紧凑详情，查看时间、计时、奖励类型及审核计提。
- “奖励”页以紧凑列表合并展示同类随机时间券、固定时间券和实物券；点击后再查看完整内容或操作，最近奖励记录也可打开详情，所有券永久有效并逐张留痕。
- 管理员可创建、编辑、复制和停用奖励券模板，为单个打工人直接发放多张券，并查看或撤销尚未使用的券。
- 每个打工人可独立配置每日随机时间券的开关、张数和分钟范围；每日快照与唯一约束防止刷新或多设备重复派发。
- 随机券和固定券由打工人手动使用后原子入账；实物实际交付后由打工人重新输入当前密码确认收到。
- 实物券支持默认图标和压缩后保存到 SQLite 的版本化自定义图片，已发券不会随模板修改而变化。
- 管理员正常奖励、双倍奖励、退回完善或拒绝。
- 标准奖励任务审核通过后才真正入账；管理员也可以快速补录遗漏的奖励并直接入账。
- 管理员可从首页或角色卡片快速补录已完成但未及时发布的奖励，保留任务名称、说明和任务奖励明细。
- 管理员可代打工人操作奖励或消耗计时。
- 管理员可撤销尚未入账的误领任务，打工人也可取消自己的未提交任务。
- 管理员和打工人都可修正奖励任务的累计时长，并保留修改记录。
- 管理员和打工人都可直接填写不计时的消耗时长。
- 打工人开始消耗后的 30 秒内可撤销误触且不扣款，管理员可随时取消正在运行的误触消耗。
- 已经结算的消耗可由管理员原额撤销；原消费与退款记录都会保留，且同一笔只能撤销一次。
- 统一活动计时器，关闭页面或更换设备后仍可恢复。
- 玩游戏、看视频按秒扣款，余额耗尽自动结束。
- 每日奖励、任务奖励、消费及余额调整明细。
- SQLite 服务端持久化、手机端卡通响应式界面。

角色照片会先在浏览器端裁切压缩，再保存到 SQLite，因此不同设备会看到相同头像。运行时头像属于本地业务数据，不提交到 Git。

完整产品与技术计划见 [docs/development-plan.md](docs/development-plan.md)，奖励券第一阶段规则见 [docs/reward-system-plan.md](docs/reward-system-plan.md)。

## 本地启动

环境要求：Node.js 22 或更高版本。

```bash
npm ci
cp .env.example .env.local
# 编辑 .env.local，至少填写 ADMIN_PASSWORD 和 SESSION_SECRET
npm run dev
```

打开 `.env.local` 中 `PORT` 对应的地址，默认是 <http://localhost:3000>。例如临时使用 3002 端口：

```bash
PORT=3002 npm run dev
```

管理员首次登录后，在“打工人”页面创建第一个角色并设置独立 PIN。SQLite 默认创建在 `data/pen-worker.db`。

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
| `ADMIN_PASSWORD` | 是 | 唯一管理员登录密码；修改并重启会使旧管理员登录失效 |
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
# 编辑 .env，至少填写 ADMIN_PASSWORD 和 SESSION_SECRET
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

## 数据备份

停止写入后备份 `data/pen-worker.db`，或使用 SQLite 的在线备份命令。不要只复制正在写入中的主数据库而忽略 WAL 文件。

所有任务、审核和余额明细均保存在 SQLite 中。删除浏览器 Cookie 只会清除当前设备登录，不会删除业务数据。

## 主要目录

```text
src/app/api/       管理员、打工人和登录接口
src/components/    卡通移动端界面
src/lib/db.ts      SQLite 表结构与连接
src/lib/service.ts 任务、计时、审核和账本事务
src/lib/reward-service.ts 奖励券模板、派发、使用和确认事务
src/lib/session.ts 签名设备登录 Cookie
docs/              产品与开发计划
data/              运行时 SQLite 数据，不提交 Git
```
