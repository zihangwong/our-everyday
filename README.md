# 两人份的日常

一个只属于两个人的私人回忆簿：记录每次约会的照片、视频、地点和故事，给对方写信，规划下一次见面。整个网站只有一个 HTML 文件，用 GitHub Pages 免费托管；照片和文字存在你们自己的 Supabase 里，只有你们两个人能看到。

## 功能

- **首页**：在一起的天数、纪念日，把两颗心合在一起的小互动
- **回忆簿**：每一天一页，照片 / 视频各自配一句说明，还有当天的故事、心情和地点
- **照片库**：3D 漫游、环形展览和完整照片墙三种看法
- **时间线 / 足迹**：按时间和地点回看
- **写给彼此**：两个人互相写信，署名由登录身份决定
- **下一次见面**：把约会做成提案发给对方
- **背景音乐**：贴上 Spotify 歌曲或歌单链接
- **云同步**：两台手机共用同一份内容；照片存在私有存储桶，只有两位成员能读

名字、相识日期、在一起的日期都在网站「设置」里填写，代码里不需要改。

## 部署你们自己的一份

你需要：一个 GitHub 账号、一个免费的 Supabase 账号、大约 30 分钟。

### 1. Fork 这个仓库

点右上角 **Fork**。之后所有改动都在你自己的副本里进行。

### 2. 创建 Supabase 项目和数据表

1. 在 [Supabase Dashboard](https://supabase.com/dashboard) 新建一个免费项目，区域选离你们近的。
2. 打开 **SQL Editor**，依次把下面三个文件的全部内容各运行一次：
   1. [`supabase/schema.sql`](supabase/schema.sql)：空间、成员、内容表和私有照片桶
   2. [`supabase/email-entry.sql`](supabase/email-entry.sql)：邮箱入口名单
   3. [`supabase/letter-authorship.sql`](supabase/letter-authorship.sql)：书信署名
3. 在 **Settings → API Keys** 记下 **Project URL** 和 **publishable key**（`sb_publishable_` 开头，或旧版 anon key）。**不要**用 secret / service_role key。

### 3. 部署邮箱入口函数

伴侣用邮箱直接进入网站，靠的是 `email-entry` 这个函数。在电脑上装好 Node.js 后，于仓库目录运行：

```bash
npx supabase login
```

```bash
npx supabase functions deploy email-entry --project-ref 你的项目ID --no-verify-jwt
```

```bash
npx supabase secrets set --project-ref 你的项目ID EMAIL_ENTRY_ORIGINS=https://你的GitHub用户名.github.io
```

项目 ID 就是 Project URL 里 `https://` 和 `.supabase.co` 中间那一段。`EMAIL_ENTRY_ORIGINS` 只写协议和域名，不带路径；有多个网址时用英文逗号隔开。

### 4. 填入你的项目地址

打开 [`maincode`](maincode)，找到这一行，换成你自己的 Project URL 和 publishable key：

```js
var PUBLIC_DIARY_CONFIG={"url": "https://你的项目ID.supabase.co", "key": "sb_publishable_..."};
```

然后生成 `index.html`（网站实际发布的文件）并提交：

```bash
npm run build
```

不想装 Node.js 的话，也可以在 GitHub 网页上把 `maincode` 和 `index.html` 里的这一行都改掉，两个文件内容保持一致即可。

### 5. 打开 GitHub Pages

仓库 **Settings → Pages**，Source 选 **Deploy from a branch**，分支选 `main`、目录 `/ (root)`，保存。一两分钟后网站会出现在 `https://你的GitHub用户名.github.io/仓库名/`。

### 6. 建立你们的两人空间

1. Supabase **Authentication → Users → Add user**，用你的邮箱和一个密码新建账号，勾选自动确认。
2. 在 SQL Editor 运行下面的语句，为这个账号建立空间（把邮箱换成你的）。它会返回一个 `diary_id`，复制下来：

   ```sql
   with owner as (select id from auth.users where email = 'you@example.com'),
   d as (insert into public.diaries(owner_id) select id from owner returning id),
   m as (insert into public.diary_members select d.id, owner.id from d, owner returning diary_id)
   insert into public.diary_state(diary_id) select diary_id from m returning diary_id;
   ```

3. 把你们两个人的邮箱加进入口名单（换成真实邮箱和上一步的 `diary_id`）：

   ```sql
   insert into public.email_entry_allowlist(email, diary_id, enabled) values
     ('you@example.com',     '上一步的 diary_id', true),
     ('partner@example.com', '上一步的 diary_id', true);
   ```

4. 打开网站，输入邮箱就能进入。第一次进去后，在「设置」里填上两个人的称呼和日期。

> 邮箱入口不验证邮箱所有权：知道名单里的邮箱就能进入。请只把网址告诉对方，名单只放你们两个人的邮箱。真实邮箱只写在 Supabase 里，**不要**提交到仓库。

更详细的说明（权限设计、旧数据导入、照片与视频限制、备份）见 [SUPABASE_SETUP.md](SUPABASE_SETUP.md)。

## 开发

```bash
npm install
```

```bash
npm test
```

```bash
npm start
```

只改 `maincode`，再用 `npm run build` 生成 `index.html`；CI 会检查两者一致并跑全部测试。设计准则见 [DESIGN.md](DESIGN.md)。

## 限制

- Supabase 免费版有存储和流量上限，单个照片 / 视频不超过 50 MB。
- 每台设备的本机副本按网址分开保存；换网址后需要重新登录，从云端载入内容。
- 两台设备离线同时修改时，较旧的版本会被拒绝，不会自动合并。
