# payloads/（占位）

正式包中此处存放原生载荷（本例为 `sales.arrow`）。载荷以内容寻址（digest）登记在 manifest 中，本象只引用不复制语义——**大型载荷永远不进入 AI 上下文，AI 只引用对象 ID**（Flint 原则）。
