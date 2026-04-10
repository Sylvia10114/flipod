# PRD：字幕呈现规则（Subtitle Presentation）

**作者**：Sylvia + Claude
**日期**：2026-04-08
**前置文档**：AGENT-podcast-processor.md（Step 6）、index.html（字幕渲染逻辑）
**状态**：待 Sylvia 审查

---

## 1. 问题

当前 15 个 clip 中有 8 个的字幕句子边界是错的。表现为：一行字幕包含了上一句的后半段和下一句的前半段，用户看到的不是一句完整的话，而是两句话拼接的碎片。

**根因**：podcast_agent.py 的句子分割依赖 Whisper segment 的标点符号。但 Whisper 的 segment 并不总是按句子切分——有时一个 segment 就是一大段无标点文本，此时 `re.split(r'(?<=[.!?])\s+', text)` 不会做任何分割，整段文本变成一个"句子"。

这不是个别 clip 的问题，是 pipeline 的结构性缺陷。

---

## 2. 一条合格字幕行的定义

一行字幕（data.json 中的一个 line 对象）必须满足：

| 规则 | 说明 |
|---|---|
| 首字母大写 | 英文句子开头大写，除非是专有名词缩写如 "iPhone" |
| 句末标点 | 以 `.` `!` `?` 结尾 |
| 语义完整 | 是一个完整的英文句子（主语+谓语），不能是半句话 |
| 长度合理 | 5-25 个单词。超过 25 词的句子拆成子句（按逗号、分号、破折号） |
| 中文对齐 | 每行英文有对应中文翻译，语义一致 |
| 时间戳准确 | start/end 对应该句在音频中的实际起止时间 |

违反任一规则的 line 都不应该出现在 data.json 中。

---

## 3. 改动方案：processor agent 的句子分割

### 3.1 现状（有问题的逻辑）

```
podcast_agent.py → extract_clip_words()：
  1. 找 clip 时间范围内的 Whisper segments
  2. 对每个 segment 的 text 做 regex split：re.split(r'(?<=[.!?])\s+', text)
  3. 把 split 后的文本和 word 时间戳做 greedy alignment
```

问题出在第 2 步：Whisper segment 的文本可能没有标点，regex 不会分割，整段变成一个巨大的"句子"。

### 3.2 修正方案：三级分句策略

分句从 segment 级标点开始，逐级加强：

**第一级：Whisper segment 标点分句（现有逻辑，保留）**

如果 segment 文本包含 `.` `!` `?`，按这些标点分句。这是最可靠的分句方式，因为 Whisper 在 segment 级输出中会加标点。

**第二级：LLM 补标点（新增）**

如果第一级分句后，任何一个"句子"超过 25 个词，说明 Whisper 没给标点。此时把该段文本发给 LLM，要求：

```
以下是一段英语播客的转录文本，Whisper 没有正确分句。
请在合适的位置添加标点符号（句号、问号、感叹号），把它分成独立的句子。
只添加标点，不要改变任何单词。

文本：{raw_text}

输出格式：每个句子一行，句末有标点。
```

LLM 返回分好句的文本后，替换原始 segment 文本，重新做 word alignment。

**第三级：长句拆分（新增）**

经过前两级处理后，如果仍有句子超过 25 个词（比如演讲者说了一个很长的复合句），按以下优先级拆分：

1. 分号 `;` → 拆成两行
2. 破折号 `—` 或 `--` → 拆成两行
3. 逗号 `,` + 连词（and, but, or, so, because, although, when, while, if） → 在连词前拆

拆分后每段作为独立的 line，各自保留完整的 word 时间戳。

### 3.3 实现要求

```python
def split_into_sentences(segment_text, clip_words, start_offset):
    """三级分句策略"""

    # 第一级：标点分句
    sentences = re.split(r'(?<=[.!?])\s+', segment_text)

    # 检查：是否有超长句
    needs_llm = any(len(s.split()) > 25 for s in sentences)

    if needs_llm:
        # 第二级：LLM 补标点
        punctuated = llm_add_punctuation(segment_text)
        sentences = re.split(r'(?<=[.!?])\s+', punctuated)

    # 第三级：仍超长的句子，按子句拆分
    final_sentences = []
    for s in sentences:
        if len(s.split()) > 25:
            final_sentences.extend(split_long_sentence(s))
        else:
            final_sentences.append(s)

    return final_sentences
```

### 3.4 成本

LLM 补标点只在 Whisper 标点缺失时触发。根据现有数据，约 50% 的 segment 需要补标点。每个 clip 约 6-10 个 segment，所以平均每个 clip 增加 0-1 次 LLM 调用，成本可忽略。

---

## 4. 改动方案：前端字幕渲染

### 4.1 现状

前端直接渲染 data.json 中的 line.en 和 line.zh，没有做任何校验。如果 data.json 的句子边界是错的，前端原样展示错误。

### 4.2 前端不做分句

字幕分句是 processor agent 的职责。前端只负责渲染和同步，不应该在运行时做分句。原因：

1. 前端没有 LLM 能力，无法判断语义边界
2. word 时间戳已经在 agent 阶段和 line 绑定好了，前端改分句会破坏时间对齐
3. 前端逻辑越简单越好，数据质量问题在上游解决

### 4.3 前端做的事：字幕展示规则

当前字幕区显示三层信息：当前英文行、中文翻译、下一句英文预览。保持这个结构，但加几个细节：

1. **超长行截断显示**：如果 line.en 超过 40 个字符（屏幕宽度限制），用 CSS `text-overflow: ellipsis` 截断，点击展开全文。这是防御性措施——正常情况下 agent 不应该产出超长行，但万一漏了不要撑爆布局。

2. **空字幕防御**：如果 line.en 为空或 line.zh 为空，跳过该行，直接显示下一行。不要显示空白字幕区。

3. **过渡动画保留**：当前的 80ms opacity 过渡可以保留，体验合理。

---

## 5. 校验规则（validate_all_clips 增强）

podcast_agent.py 已有 `validate_all_clips()` 函数。需要新增以下校验：

| 校验项 | 条件 | 不通过处理 |
|---|---|---|
| 首字母大写 | line.en 的第一个字母是大写（或数字开头） | 自动修正（capitalize） |
| 句末标点 | line.en 以 `.` `!` `?` 结尾 | 标记 warning，LLM 补标点后重分句 |
| 最大词数 | line.en 不超过 30 个词 | 标记 warning，触发第三级拆分 |
| 最小词数 | line.en 至少 3 个词 | 与相邻行合并 |
| 中文非空 | line.zh 不为空字符串 | 触发逐句翻译 fallback |
| 时间戳连续 | 当前 line.start >= 上一行 line.start | 直接 reject 该 clip |

校验在翻译完成后、写入 new_clips.json 之前执行。不通过的 clip 记录到日志，严重问题直接 reject。

---

## 6. 修复现有 8 个问题 clip

现有 data.json 中 8 个句子边界有问题的 clip，修复策略：

**不重新跑 agent**。原始音频和 Whisper 转录结果都在 raw/ 和 output/ 目录里。写一个修复脚本：

```
fix_sentences.py：
  1. 读 data.json
  2. 对每个 clip 的 lines，检查是否符合第 5 节的校验规则
  3. 不符合的，取出该 line 的英文文本，走 LLM 补标点 → 重新分句
  4. 重新做 word-sentence alignment（word 时间戳不变）
  5. 重新翻译新分出来的句子
  6. 输出修复后的 data.json
```

预估耗时：脚本编写 30 分钟，运行 5 分钟。

---

## 7. 不做的事

- 不做前端实时分句（分句是 agent 职责）
- 不做自动换行的"歌词模式"（当前一行一句够用）
- 不做字幕字体大小用户自定义（留给后续版本）
- 不改变 data.json 的 line 数据结构（只改内容质量）

---

## 8. 验收标准

- [ ] data.json 中所有 line.en 首字母大写
- [ ] data.json 中所有 line.en 以 `.` `!` `?` 结尾
- [ ] data.json 中所有 line.en 不超过 30 个词
- [ ] data.json 中所有 line.en 至少 3 个词
- [ ] 所有 line.zh 非空
- [ ] 前端显示的字幕都是完整的句子，不存在"半句话"的情况
- [ ] validate_all_clips() 包含新增的句子级校验规则
