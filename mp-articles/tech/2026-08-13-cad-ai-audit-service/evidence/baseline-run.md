# 通用多模态截图基线运行记录

运行日期：2026-08-13

## 命令

```powershell
bl vision describe \
  --image cases/cad-window-audit.origin/projections/sanitized-cad/overview.png \
  --prompt "你是普通通用多模态AI，只能根据这张CAD脱敏总览截图回答。请回答：1）图中实际放置的窗有多少个；2）门有多少个；3）第97个窗的稳定对象ID、精确位置坐标和分类依据是什么；4）指出你的答案哪些可由这张截图验证。不得假设你能读取原始DWG、DXF实体或外部数据库。" \
  --model qwen-vl-max --output json
```

## 运行身份

```text
model: qwen-vl-max
request_id: 59f90fa1-f473-9b30-ba6f-1778dc0e5de5
prompt_tokens: 1357
completion_tokens: 842
total_tokens: 2199
```

## 原回答关键段落

> 从左至右，共可辨识出 7 个明确的窗。

> 经统计，共有 5 个这类结构符合门的特征。

> 无法回答此问题。图像为脱敏总览图，未显示任何编号、ID、属性标签或坐标信息。

模型最后总结为：

```text
窗：7 个
门：5 个
第97个窗的信息：无法确定，因截图中无编号或元数据
```

## 解释边界

这是“只给总览截图”的常见工作流基线。它没有访问受控 DWG、DXF 实体、图层、handle、天正代理载荷或本象对象包。它不能用于声称 `qwen-vl-max` 整体不擅长 CAD，也不是同输入、同工具条件下的模型排行榜；它证明的是截图投影不足以交付对象级审计。
