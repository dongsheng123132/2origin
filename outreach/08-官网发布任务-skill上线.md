你的任务：在 hequbing.com 官网博客发布一篇文章《三个 AI 技能上线 ClawHub 与 SkillHub：把「上下文必炸」变成可验证的事务》。

严格按以下步骤执行，不许跳步，不许编造：

## 0. 先加载技能
调用 skill_view(name='hequbing-site') 并完全遵循其中的流程（发布管线、SEO 清单、关键坑、提交身份）。

## 1. 素材来源（只准用这些，不许编造）
- 文章内容基于：D:\uking编程\本象协议\outreach\06-skill发布推广稿.md（正文骨架）
- 技术细节核实来源：D:\uking编程\本象协议\README.md 与本象协议仓库（禁止编造数字）
- 已核实事实（直接使用）：
  - ClawHub 三个 skill：origin-writer@1.0.1 / benxiang-memory@1.0.1 / origin-office@1.0.1，owner=dongsheng123132
  - SkillHub 三个 skill 同日上线（skillId 145380/145381/145382）
  - origin-writer 实测：deepseek-v4-flash 续写 2883 字，自动产出 1 条状态变更 + 5 条断言，门禁通过落盘
  - 海事局红头文件 2019 实测：409 个结构对象（6 章/77 条/16 表/59 勾选），verify 一致
  - 规则怪谈·无限层连载已用 OriginWriter 引擎跑 3 章（8486 字），另一 agent 在推进
  - 本象协议仓库：github.com/dongsheng123132/2origin

## 2. 写文章（HTML content）
- title: 三个 AI 技能上线 ClawHub 与 SkillHub：把「上下文必炸」变成可验证的事务
- slug: benxiang-skills-launch
- date: 2026-08-06
- 正文用 HTML（h3/p/ul/strong/blockquote），受众 = 技术决策者/AI 从业者
- 结构：三个技能各一节（干什么/为什么/实测证据），中间讲本象协议的核心主张（聊天记录≠世界状态），结尾讲无限长小说挑战 + 安装方式
- 必须带「诚实边界」声明（这是项目品牌）：示例数据基于单一模型 deepseek-v4-flash、自造夹具等
- 全文约 800-1200 字，别写长

## 3. 按 SEO 清单执行（每项都做）
- gh repo edit dongsheng123132/hequbing-blog --homepage "https://blog.hequbing.com/post?slug=benxiang-skills-launch"
- public/sitemap.xml 追加该 slug 的 <loc>
- 仓库根 CONTENT-PLAN.md 勾选本次发布
- 用当天日期 2026-08-06

## 4. 提交与验证
- 本地：git pull（仓库 C:\Users\ZhuanZ\hequbing-blog）→ 改 data/posts.json（python json.dump ensure_ascii=False indent=2）→ node server.js 冒烟 curl localhost:3000/api/posts/benxiang-skills-launch 确认 content 完整
- 提交身份必须：-c user.name="dongsheng123132" -c user.email="hefangsheng@gmail.com"
- push 后**独立验证线上**：轮询 https://blog.hequbing.com/api/posts/benxiang-skills-launch 直到返回 200 且 content 含「OriginWriter」
- gh 若 TLS 超时重试；需代理时用 HTTPS_PROXY=http://127.0.0.1:7897

## 5. 最终报告（必须如实）
- commit hash（git log -1 --format=%H）
- 线上 URL 验证结果（curl 实际输出）
- SEO 清单逐项勾选状态
- 若任何一步失败：如实报告失败原因，不许伪造成功

开始执行。
