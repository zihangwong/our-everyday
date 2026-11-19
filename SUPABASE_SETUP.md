# 连接你们的 Supabase 两人空间

这是 Supabase 后端的详细说明。第一次部署请先看 [README](README.md) 里的「部署你们自己的一份」，这里补充每一步背后的细节。配置完成后，日常使用只需打开网站，输入各自获准的邮箱直接进入；已有登录会自动恢复。

## 书信署名

升级或自行部署时，在基础schema之后运行 [supabase/letter-authorship.sql](supabase/letter-authorship.sql)。新信通过 `append_diary_letter` 写入，由Supabase Auth身份与空间成员关系决定作者，前端不传姓名或角色。空间创建者对应config.myName，另一位成员对应config.herName。消息ID用于失败后的幂等重试，版本检查继续保护同时发生的修改；原有书信与备份兼容，不会批量重署名。

## 当前邮箱入口的维护

- 前端的 `PUBLIC_DIARY_CONFIG` 只包含公开 Project URL 与 publishable key，不包含管理密钥或受邀邮箱。邮箱名单只在数据库中保存。
- 运行基础schema后，再运行 [supabase/email-entry.sql](supabase/email-entry.sql)。管理员在SQL Editor中为选定邮箱与现有diary_id添加 `email_entry_allowlist` 记录，并明确设置 `enabled=true`；新记录默认禁用。不要将真实邮箱名单提交到代码或公开页面。
- 部署 [supabase/functions/email-entry/index.ts](supabase/functions/email-entry/index.ts) 为 `email-entry`。该函数需要关闭旧式JWT前置检查（本地CLI配置在 `supabase/config.toml`），由函数内部的服务器名单控制准入；不要关闭其他服务的Auth或RLS。Supabase自动向函数提供管理环境变量，不能把service_role复制进HTML。
- 改正式域名时，同时更新函数 `EMAIL_ENTRY_ORIGINS`（逗号分隔，精确origin）和Authentication → URL Configuration的Site URL。
- 管理员可将该邮箱记录设为 `enabled=false` 阻止后续邮箱直入。已发出的会话仍按Auth会话生命周期有效；若要立即撤销，需另行撤销该用户的会话或空间成员权限。
- 此方式不验证邮箱所有权：知道获准邮箱即可进入。函数不发邮件、不使用邮件发送额度。它建立独立Auth会话，沿用两人限制、RLS与私有Storage，名单对匿名和普通登录用户不可读写；每个启用邮箱每分钟最多6次进入请求。

下面是更换项目或自行部署时的维护步骤，并非伴侣的日常操作流程。空的新项目应先完成主人Auth账号、空间和首次导入，再开放伴侣入口；不要让未登录访客直接创建或读取私人空间。

## 创建项目和表

1. 打开 [Supabase Dashboard](https://supabase.com/dashboard)，创建免费项目，选择靠近你们的区域。数据库密码自己保管，网站不需要它。
2. 在 SQL Editor 中新建查询，运行 [supabase/schema.sql](supabase/schema.sql) 的全部内容。脚本创建 `diaries`、`diary_members`、`diary_state` 和私有 `diary-media` 桶，并开启成员权限与版本检查。请用于新项目，不要添加“所有人可读写”的策略。
3. 在 Connect 面板或 Settings → API Keys 找到 Project URL 和 publishable key；旧版 anon key 也可使用。网站不接受 secret 或 service_role key。
4. 在网站「设置 → 两人空间 · Supabase」填入 URL 和前端key，点「保存项目配置」。另一台设备也需要同样的配置，它不会包含在日常备份里。Supabase控制台账号与这个项目中相册使用的Auth账号分开，后者需要在网站中注册。

## 两个人连接同一空间

5. 你们各自用自己的邮箱注册账号。若开启邮箱确认，先在邮箱完成确认，再回网站登录。不要为此关闭权限保护。

内置邮件服务当前只有整个项目每小时2封的发送额度，并且默认只向组织团队成员邮箱发送。出现「email rate limit exceeded」时，使用已收到的邮件完成确认，再点「登录」；不必重复注册。正式使用双人注册前，请按 [官方SMTP说明](https://supabase.com/docs/guides/auth/auth-smtp) 配置邮件服务。
6. 在 Supabase Authentication → URL Configuration 设置正式网站的 HTTPS Site URL；本机预览请填实际地址，当前预览使用 `http://127.0.0.1:4274/`。正式账号推荐在 HTTPS / localhost 使用。
7. 其中一人登录后点「创建我们的空间」，将邀请代码只发给对方。另一人登录自己的账号，填入代码点「加入她的空间」。空间最多两人，非成员不能读写媒体或文字。

## 第一次上传与旧数据

8. 先在旧网站导出 JSON 备份并另存一份原件。在新版导入到本机，检查回忆、相识日期、图片。相识日期和在一起的日期分开保存，都在设置中填写。
9. 检查正确后手动点「上传本机内容到空间」。旧图片会转存到私有桶，再提交内容；另一台设备点「载入空间内容」。连接、注册和导入本身不会自动搬运旧内容。
10. 已载入/上传空间的设备以后自动同步。两端同时离线修改时，过期版本会被拒绝；先导出本机含媒体备份，再载入空间并补回本机修改。当前不会自动逐字段合并两个离线版本。

## 照片、视频与备份

- 一次可选超过9个文件，每个有自己的caption，保留选择顺序。照片支持 JPG、PNG、WebP、GIF、AVIF，视频支持 MP4、WebM、MOV；建议 H.264 MP4，MOV和部分编码能否播放取决于浏览器。
- 单个文件≤50 MB。超过6 MiB用6 MiB分块、进度与断点重试。设备和免费项目仍有总容量、流量限制；这不是无限存储。
- 媒体文件先存 IndexedDB，文字与索引存 localStorage。不同网站地址/端口的本机存储独立；清除浏览器站点数据会清掉本机副本。
- 「导出备份」包含照片、视频的实际内容与caption，不含连接配置或登录会话。视频多时备份会变大，需要额外内存；缺失媒体时会停止并提示，避免产生不完整备份。
- 导入只替换本机清单并暂停自动上传；如需同步，另行手动上传。删除记录不立即永久删除Storage文件，避免误删；回收容量前先备份并核对未被记录引用的文件。

## 保护方式和验证范围

新版使用 Supabase Auth、Postgres RLS、私有 Storage 与短期签名链接；不再使用旧版 Google 的共享密码端到端加密。项目管理员可管理数据；不要把数据库或媒体桶设为公开。前端 publishable key 本身不授予读取私人媒体的权限。

已验证 SQL、两人权限、版本冲突、分块重试、实际13个媒体、视频播放、刷新恢复和含媒体导出。真实项目额外验证了陌生邮箱拒绝、获准邮箱免密码进入、自动加入同一空间与已有内容载入；Storage仍为私有。免费配额和视频浏览器编码限制仍适用。

官方参考：[客户端安装](https://supabase.com/docs/reference/javascript/installing)、[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、[Storage权限](https://supabase.com/docs/guides/storage/security/access-control)、[断点上传](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)、[文件限制](https://supabase.com/docs/guides/storage/uploads/file-limits)。
