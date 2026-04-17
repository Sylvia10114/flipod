# Claude Code Brief · Task C · CEFR-J Overrides + 全量重标

> 2026-04-17 · Jamesvd · 在 Cowork 并行跑 PRD 重构 / UI 重构的同时，Claude Code 独立吃掉这个任务。产出在 `feat/cefr-overrides` 分支，最后出一个 PR。

---

## 背景（2 分钟看完）

Flipod 当前用的 CEFR 词表是 `openlanguageprofiles/olp-en-cefrj`（CEFR-J A1-B2 主表 + Octanove C1-C2 扩展，2026-04-15 从 LLM-generated COCA-CEFR 迁移而来，CLAUDE.md 有记录）。共约 8650 词，词表本身 CC BY-SA 4.0。

**问题**：CEFR-J 对高频 function / discourse / connective 词严重高估。实测例子：

| 词 | CEFR-J 标注 | 直觉档位（Cambridge EVP 对齐） | 误差 |
|---|---|---|---|
| whenever | **C1** | B1 | +2 |
| whatever | 可能 B2/C1 | A2 | +2~+3 |
| somewhere | 未确认但疑似 B2 | A2 | +2 |
| nevertheless | C1 | B2 | +1 |
| furthermore | C1 | B2 | +1 |
| although | B2 | B1 | +1 |

后果：Feed clip 难度被系统性推高 → i+1 引擎选词偏差 → 用户水平估值漂移。

**不做 Cambridge EVP 全量迁移**（P1 的 spike 任务）。先用一个 override JSON 拍平前 50-100 个最伤的。

---

## 交付物

1. **`cefr_overrides.json`**（项目根目录）——手工维护的词 → 档位 map，50-100 词起步
2. **`tools/cefr_lookup.py`** 或在现有 CEFR 查询点注入 override 优先逻辑——`podcast_agent.py` + 所有 pipeline 脚本
3. **`listening-practice.js` 的 `clampLevel` / CEFR 查询路径**也走 override（因为第八章适配表的遮词密度依赖 CEFR 档位）
4. **`tools/retag_cefr_all_clips.py`** 跑一遍，重打所有历史 clip 的 `cefr`、`difficulty`
5. **测试**——至少对 overrides 清单里 10 个词验证 Python 端 + JS 端查询结果一致
6. PR 描述里贴出 retag 前后 `data.json` 里 `difficulty` 的 before/after 直方图（A1/A2/B1/B2/C1/C2 各多少个 clip）

---

## `cefr_overrides.json` 起步清单

按"我觉得 CEFR-J 最可能标错、且在真实 clip 里出现频率高"挑的种子。Claude Code 可以：

- 先用这 60 个作为 v0
- 跑 `tools/scan_cefr_suspect_words.py`（要新写，见下）扫当前所有 clip transcript，找出现频 ≥ 3 且当前档位 ≥ B2 的功能词候选，人工 pass 后补入

```json
{
  "_meta": {
    "version": "1.0.0",
    "rationale": "CEFR-J over-grades high-frequency function/discourse/connective words. Overrides here take precedence over CEFR-J lookup.",
    "source_convention": "Align with Cambridge English Vocabulary Profile (EVP) when known, otherwise pedagogical intuition.",
    "license_note": "This override file is Flipod-internal editorial data, not derived from CEFR-J content, so CEFR-J's CC BY-SA does not propagate here."
  },
  "overrides": {
    "whenever": "B1",
    "whatever": "A2",
    "wherever": "B1",
    "whoever": "B1",
    "however": "B1",
    "somewhere": "A2",
    "anywhere": "A2",
    "everywhere": "A2",
    "nowhere": "B1",
    "someone": "A2",
    "anyone": "A2",
    "everyone": "A1",
    "something": "A1",
    "anything": "A1",
    "everything": "A1",
    "nothing": "A1",
    "nevertheless": "B2",
    "nonetheless": "B2",
    "furthermore": "B2",
    "moreover": "B2",
    "however,": "B1",
    "although": "B1",
    "though": "B1",
    "despite": "B1",
    "whereas": "B2",
    "meanwhile": "B1",
    "otherwise": "B1",
    "therefore": "B1",
    "thus": "B2",
    "hence": "B2",
    "besides": "B1",
    "instead": "A2",
    "anyway": "A2",
    "anyways": "A2",
    "actually": "A2",
    "basically": "B1",
    "obviously": "B1",
    "probably": "A2",
    "certainly": "B1",
    "definitely": "B1",
    "eventually": "B1",
    "immediately": "B1",
    "suddenly": "A2",
    "gradually": "B2",
    "already": "A2",
    "yet": "A2",
    "still": "A2",
    "even": "A2",
    "just": "A1",
    "quite": "A2",
    "rather": "B1",
    "pretty": "A2",
    "really": "A1",
    "truly": "B1",
    "mostly": "B1",
    "mainly": "B1",
    "largely": "B2",
    "slightly": "B1",
    "hardly": "B1",
    "barely": "B1",
    "scarcely": "B2"
  }
}
```

注意 `"however,"` 带逗号是个可疑 key——实际查询端做 `normalize(token)`，建议别把标点纳入 key，全走小写纯单词。Claude Code 在落实现时如果发现查询 key 都是 clean lowercase，把这行改成 `"however": "B1"`（无逗号）。

---

## 代码层改动

### 1. `tools/cefr_lookup.py`（新建，如果没有）

```python
# 伪码示意
import json, os
from functools import lru_cache

_OVERRIDES = None
_CEFRJ = None

def _load_overrides():
    global _OVERRIDES
    if _OVERRIDES is None:
        path = os.path.join(os.path.dirname(__file__), '..', 'cefr_overrides.json')
        with open(path) as f:
            _OVERRIDES = json.load(f).get('overrides', {})
    return _OVERRIDES

def _load_cefrj():
    global _CEFRJ
    if _CEFRJ is None:
        # 现有 CEFR-J 加载逻辑，保持不动
        ...
    return _CEFRJ

@lru_cache(maxsize=20000)
def get_cefr(word: str) -> str | None:
    w = word.lower().strip()
    overrides = _load_overrides()
    if w in overrides:
        return overrides[w]
    cefrj = _load_cefrj()
    return cefrj.get(w)
```

**关键**：overrides 优先，miss 才落到 CEFR-J，再 miss 才走 LLM fallback（已有）。

### 2. `podcast_agent.py`

找到现在所有调 CEFR-J 的地方（grep `cefrj`、`cefr_lookup`、`get_cefr`），统一改走 `cefr_lookup.get_cefr`。

### 3. `listening-practice.js`

前端也要查 CEFR（`clampLevel`、选词逻辑），在初始化阶段 fetch `cefr_overrides.json` + CEFR-J 主表，合并成一个 `cefrMap` 后缓存到 `window._cefrMap`：

```js
async function loadCefrMap() {
  const [overridesResp, cefrjResp] = await Promise.all([
    fetch('/cefr_overrides.json'),
    fetch('/cefr_wordlist.json'),
  ]);
  const overrides = (await overridesResp.json()).overrides || {};
  const cefrj = await cefrjResp.json();
  // override 后装
  return { ...cefrj, ...overrides };
}
```

**顺序很重要**：spread 时 overrides 放后面，后写覆盖前写，Override 生效。

### 4. `tools/retag_cefr_all_clips.py`

```
入参: data.json 路径 (默认 ./data.json)
行为:
  1. 遍历所有 clip
  2. 对每个 clip 的 transcript.words[], 重新查 get_cefr(word)
  3. 重新计算 clip-level difficulty（保留现有算法，比如高级词占比或 max CEFR）
  4. 写回 data.json（先备份到 data.json.bak-YYYYMMDD-HHMMSS）
  5. 输出 before/after 直方图到 stdout
```

**CLAUDE.md 约束提醒**：
- 所有外部 HTTP 必须用 `curl` subprocess，不能用 `urllib/requests`（Python 3.9 SSL）
- retag 不涉及外部 HTTP，纯本地计算——但如果 LLM fallback 有 miss 要补，走 `curl` + Azure GPT（`max_completion_tokens`）
- 输出路径遵循项目约定：备份在 `output/backups/`

### 5. `tools/scan_cefr_suspect_words.py`（新建，辅助工具）

用于扩充 overrides 的第二批候选：

```
扫所有 clip transcript → 按词聚合频次 → 筛选 freq ≥ 3 且当前 CEFR ≥ B2 的词 → 
  按词频降序输出到 stdout, 附当前 CEFR-J 档位 + 在 overrides 中的状态。
  让人类 pass 后手动追加到 overrides 里。
```

---

## 校验清单（PR 合并前必须过）

- [ ] `cefr_overrides.json` 字段结构合法，`version` + `overrides` 都存在
- [ ] `get_cefr("whenever")` Python 端返回 `"B1"`
- [ ] 浏览器 console 里 `window._cefrMap.whenever` 返回 `"B1"`
- [ ] `retag_cefr_all_clips.py` 在 dry-run 模式（加 `--dry-run` 参数）正确打印 diff，不写文件
- [ ] 实跑一次，`data.json.bak-*` 备份文件存在
- [ ] PR 描述贴出 before/after `difficulty` 直方图
- [ ] 随机抽 5 个 clip 人工听，确认新 `difficulty` 比旧的更符合直觉
- [ ] CEFR-J 归属行（`cefr-attribution`）在 `index.html` 侧面板仍然可见——overrides 是内部编辑数据不需要额外归属，但 CEFR-J 的 CC BY-SA 归属不能破坏

---

## 非目标（不要顺手做）

- 不要改 CEFR-J 词表本身（许可证敏感，保持原样）
- 不要改第八章适配表的数值（那是 D 任务干的事）
- 不要去 scrape Cambridge EVP（P1 spike，要单独立项谈版权）
- 不要在 overrides 里塞内容词（名词、实义动词）——只处理 function / discourse / connective 词和高频情态/程度副词

---

## 问题升级

- overrides 超过 100 词仍觉得 CEFR-J 不准 → 停下来，ping Jamesvd，可能要提前启动 P1 的 EVP spike
- retag 跑完 `difficulty` 直方图整体左移 > 30% → 可能 override 过度，停下来回归
- 任何 CEFR-J 原始文件 checksum 变化 → 立刻回滚，CEFR-J 是不可变依赖
