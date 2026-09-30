# 昆虫标本采集记录台（gbinsectlog）

面向野外昆虫调查队与标本馆技术员，把「标本采集 → 采集地与生境 → 鉴定状态 → 保藏位置」串成一条可追溯的编目链路，解决采集标签手写易错、鉴定进度无人跟踪、标本入柜后找不到位置的问题。**纯前端单页应用**，全部数据保存在浏览器 IndexedDB，不依赖任何后端服务或外部接口。

## 一、Docker 一键启动（推荐）

```bash
cp .env.example .env      # 首次启动先复制环境变量文件
docker compose up -d --build
```

启动后访问：<http://localhost:21815>

常用命令：

```bash
docker compose ps        # 查看容器状态
docker compose logs -f   # 查看日志
docker compose down      # 停止并移除容器（数据在浏览器本地，不受影响）
```

端口与项目名可在 `.env` 中调整：

```
COMPOSE_PROJECT_NAME=gbinsectlog
FRONTEND_PORT=21815
```

## 二、技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | React 18 |
| 语言 | TypeScript（`tsc --noEmit` 类型检查零错误） |
| 样式 | Tailwind CSS 3 |
| 状态管理 | Zustand |
| 路由 | React Router 6（nginx `try_files` 回落，支持直接刷新子路由） |
| 构建 | Vite 5 |
| 本地存储 | IndexedDB（Dexie 封装，含 `schemaVersion` 与升级迁移） |
| 合并测试 | Vitest + fake-indexeddb（`npm test`，覆盖撞号/回滚/幂等/三方比对） |
| 部署 | 多阶段 Dockerfile：`node:20-alpine` 构建 → `nginx:alpine` 托管 |

## 三、本地开发

```bash
cd frontend
npm install
npm run dev        # http://localhost:21815
npm run build      # 类型检查 + 生产构建
npm test           # Vitest：外业合并引擎用例（撞号重取 / 三方比对 / 回滚 / 幂等）
```

> 本地开发无需任何后端服务或环境变量。

## 四、目录结构

```
sologsb-1115/
├── docker-compose.yml          # 顶层 name: gbinsectlog，无 version 字段
├── .env.example                # COMPOSE_PROJECT_NAME / FRONTEND_PORT
├── frontend/
│   ├── Dockerfile              # 多阶段构建，nginx 阶段 chmod -R a+rX 静态资源
│   ├── nginx.conf              # try_files 前端路由回落 + gzip
│   ├── tailwind.config.js / postcss.config.js
│   ├── public/favicon.svg
│   └── src/
│       ├── types/              # specimen.ts / site.ts / storage.ts / determination.ts / merge.ts / index.ts
│       ├── stores/             # specimenStore / siteStore / storageStore / determinationStore / mergeStore（Zustand）
│       ├── components/common/  # SpecimenCard / StatusTag / CabinetGrid / SitePicker
│       ├── hooks/              # usePersistentStore / useSpecimenFilter
│       ├── pages/              # SpecimensPage / SitesPage / CollectPage / DeterminationPage / StoragePage / MergePage
│       ├── router/index.tsx
│       └── utils/              # codec.ts / export.ts / id.ts / merge.ts（合并引擎）/ sampleBatch.ts
```

## 五、数据模型与存储

| 模型 | 说明 | Dexie 表 |
| --- | --- | --- |
| Specimen 标本 | 编号、目/科/属/种、暂定名、采集日期与人、性别虫态、体长、采集方式、数量、鉴定状态 | `specimens` |
| CollectSite 采集地 | 代码、名称、行政区、经纬度海拔、生境类型、小生境、微气候、采集日期区间 | `sites` |
| Storage 保藏位置 | 保藏方式、柜/抽屉/盒/插位序号、入柜日期、经手人 | `storages` |
| Determination 鉴定记录 | 鉴定人、日期、结论（学名）、依据文献、置信度、是否需复核 | `determinations` |
| FieldConflict 字段分歧 | 外业合并时两版并存的字段：馆内/外业值、来源标记、编目员裁定结果 | `mergeConflicts` |
| MergeLedger 合并台账 | 已合并批次号、内容指纹、新增/更新/重取/分歧数、重取编号对照 | `mergeLedgers` |

- 数据库名 `gbinsectlog`，`meta` 表保存 `schemaVersion`；
- `version(2)` 升级迁移会为历史标本补齐默认采集方式（扫网）；
- `version(3)` 新增外业合并的「字段分歧」与「合并台账」两张表；
- 标本编号规则：`采集地代码-年份-流水号`（如 `QLB-2026-0007`），提交时自动分配并查重；
- 外业批次格式见 `types/merge.ts` 的 `FieldBatch`：`batchId`（幂等键）、`team`（来源）、`sites` / `specimens`（可带离队快照 `base`）/ `determinations` / `storages`；
- 数据仅存于浏览器本地，容器无状态、不挂载命名卷。

## 六、主要页面

| 路由 | 功能 |
| --- | --- |
| `/specimens` | 标本清单：按目/科、鉴定状态、采集地、采集日期区间与关键字组合筛选，多选批量推进鉴定状态，导出命中清单 |
| `/collect` | 采集登记：选择采集地后自动带出生境/小生境/微气候，一次提交多条同批次标本，编号自动生成并查重 |
| `/sites` | 采集地管理：经纬度格式校验、各地采集次数统计、50 米内邻近采集地提示与一键合并 |
| `/determination` | 鉴定工作流：待鉴定队列逐条处理，落鉴定记录并自动推进标本状态（已鉴定 / 待复核） |
| `/storage` | 保藏柜位图：柜-抽屉-盒-位三级展开，空位/占用一目了然，拖拽入柜，重复占用给出占用提示 |
| `/merge` | 外业批次合并：导入 JSON 只读预检，整批事务合并；撞号重取明细、字段分歧裁定、合并台账 |

## 七、业务约定

- 采集地代码是标本编号前缀，代码重复会被拒绝；
- 坐标 50 米内视为同一采集地，页面上给出合并提示，合并会把原采集地标本自动改挂；
- 鉴定记录提交后自动把标本状态推进为「已鉴定」，勾选「需复核」则置为「待复核」；
- 同一柜位（柜-屉-盒-位）只允许一份标本，冲突时列出已有标本编号。

### 外业批次合并约定

- 林区无信号时分队离线登记、各自按「采集地代码-年份-流水号」排号；回驻地后在 `/merge` 整批导入 JSON；
- **撞号重取**：新标本编号与馆内或同批已有编号相同（两个分队排出同号）时，顺着该号段顺延重取新号；采集信息原样保留；
- **挂接跟随**：标本上的鉴定记录、保藏柜位按 `specimenId` 跟随，重取新号后不悬空（不会出现柜位/鉴定指不到标本）；批内挂接记录必须挂本批标本，否则整批校验失败；
- **馆内保护**：馆内已鉴定（有鉴定记录）的目/科/属/种/暂定名，以及鉴定状态、鉴定人等工作流字段，不被外业版本自动覆盖；已入柜内容同理；
- **三方比对**：同一标本（按 `id` 识别）合并时以离队快照 `base` 为基准：仅外业改过的字段自动采纳；仅馆内改过的保留馆内；两边都改过、或没有快照无法判定的，两版都保留在 `mergeConflicts` 并标注来源（馆内编目 / 外业·分队名），由编目员在页面上挑一版生效；
- **整批原子**：合并在单个 Dexie 事务内完成，任何一步失败整体回滚，不会留下半批数据；
- **幂等重试**：以 `batchId` 为幂等键、内容指纹（对 JSON 键顺序不敏感）防串档；整批失败后用原批次号原样重送不会多出重复标本，已成功的批次再送直接返回原台账；
- 采集地按 `code` 匹配：馆内已有的保留馆内登记，外业标本对该采集地的引用自动 remap；新采集地随批入库；
- 柜位若与馆内重复占用，不阻断整批（记录仍跟随标本入库以免悬空），在台账与预检中列出提示，交编目员在柜位图调整。
