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
- “进行中”页显示任务奖励、累计计时、最低要求差额和剩余总时长。
- 底部预留不可点击的“奖励”栏位并标注“暂未开放”，供后续随机时间券、固定时间券和实物券功能使用。
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

当前角色 `PEN` 已配置项目头像资源 [public/avatars/pen-avatar.webp](public/avatars/pen-avatar.webp)。图片为 256×256 WebP，约 12KB；新上传的头像也会先在浏览器端裁切压缩，再保存到 SQLite，因此不同设备会看到相同头像。

完整产品与技术计划见 [docs/development-plan.md](docs/development-plan.md)。

## 本地启动

环境要求：Node.js 22 或更高版本。

```bash
npm install
npm run dev
```

打开 <http://localhost:3000>。

仓库中已经准备了仅供本地开发的 `.env.local`，默认管理员密码是：

```text
123456
```

如果应用需要开放到局域网以外，请先修改这个密码和 `SESSION_SECRET`。

管理员首次登录后，在“打工人”页面创建第一个角色并设置独立 PIN。SQLite 会自动创建在 `data/pen-worker.db`。

## 配置

复制 `.env.example` 或编辑未提交到 Git 的 `.env.local`：

```dotenv
ADMIN_PASSWORD=你的管理员密码
SESSION_SECRET=至少32位随机字符串
APP_TIMEZONE=Asia/Shanghai
DATABASE_PATH=./data/pen-worker.db
SESSION_MAX_AGE_DAYS=180
COOKIE_SECURE=false
ALLOWED_DEV_ORIGINS=10.10.10.5
```

- 修改 `ADMIN_PASSWORD` 并重启后，旧管理员登录自动失效。
- `DATABASE_PATH` 必须位于持久化磁盘。
- 家庭局域网直接使用 HTTP 时保持 `COOKIE_SECURE=false`；配置 HTTPS 后改为 `true`。
- 浏览器只保存签名后的安全 Cookie，不保存明文密码和余额数据。
- `ALLOWED_DEV_ORIGINS` 用于局域网开发访问；有多个来源时使用英文逗号分隔，例如 `10.10.10.5,192.168.1.20`。

局域网开发时，用运行本项目电脑的 IP 打开，例如 `http://10.10.10.5:3000`。修改 `ALLOWED_DEV_ORIGINS` 后必须停止并重新运行 `npm run dev`，Next.js 才会读取新配置。

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

```bash
ADMIN_PASSWORD='换成你的密码' \
SESSION_SECRET='换成至少32位随机字符串' \
docker compose up --build -d
```

Docker Compose 会把 SQLite 存放到持久化卷 `pen_data`。生产环境应在应用前配置 HTTPS 反向代理。

## 数据备份

停止写入后备份 `data/pen-worker.db`，或使用 SQLite 的在线备份命令。不要只复制正在写入中的主数据库而忽略 WAL 文件。

所有任务、审核和余额明细均保存在 SQLite 中。删除浏览器 Cookie 只会清除当前设备登录，不会删除业务数据。

## 主要目录

```text
src/app/api/       管理员、打工人和登录接口
src/components/    卡通移动端界面
src/lib/db.ts      SQLite 表结构与连接
src/lib/service.ts 任务、计时、审核和账本事务
src/lib/session.ts 签名设备登录 Cookie
docs/              产品与开发计划
data/              运行时 SQLite 数据，不提交 Git
```
