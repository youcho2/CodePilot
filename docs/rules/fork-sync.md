# Fork 同步流程 / Fork Sync

本仓库是 GitHub fork。为避免「fork 和上游都往 `main` 提交 → 分叉 → 合并冲突」，采用**镜像分支 + 工作分支**分离。

## 远程与分支约定

| 名称 | 指向 | 作用 |
|------|------|------|
| `origin` | `youcho2/CodePilot` | 自己的 fork |
| `upstream` | `op7418/CodePilot` | 原项目（上游） |
| `main` | 跟随 `upstream/main` | **纯上游镜像**，禁止直接提交自己的改动 |
| `codepilot/main` | 自己的提交 | 所有 fork 改动的落脚分支 |

> 核心纪律：**永远不要把自己的东西直接提交到 `main`。** 一旦 main 上出现 fork-only 提交，就无法再干净地追上游，冲突问题会复发。

## 首次配置（一次性）

```bash
git remote add upstream git@github.com:op7418/CodePilot.git
git fetch upstream
```

## 同步上游（永远 fast-forward，不会冲突）

```bash
git checkout main
git fetch upstream
git merge --ff-only upstream/main   # 若报错说明 main 被污染了，需先清理
git push origin main
```

`--ff-only` 是保险丝：只要它失败，就说明有人往 `main` 塞了提交，应先把那些提交挪回 `codepilot/main`。

## 把上游进度合进工作分支（rebase，冲突逐个提交解决）

```bash
git checkout codepilot/main
git rebase main
git push -f origin codepilot/main   # rebase 改写历史，需要 -f
```

rebase 优先于 merge：保持线性历史，冲突一个提交一个提交暴露，而不是挤成一个大 merge。

## 日常开发

- 新功能：从 `codepilot/main` 切功能分支（或直接在 `codepilot/main` 上做），完成后合回 `codepilot/main`。
- 绝不在 `main` 上写代码。
- 想要最新上游代码时，先按上面同步 `main`，再 rebase 工作分支。
