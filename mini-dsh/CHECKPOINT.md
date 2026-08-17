# ch08 — 请求信封与流式协议

这是**起点**。下面这些函数体被挖空了，填完它们让测试变绿：

- `stream()` — `packages/llm/src/index.ts`
  穿过 llm/stream 这条 waterfall，最里层才落到真适配器上，并且要预热
- `prime()` — `packages/llm/src/index.ts`
  先把第一个片段拉出来再接回去。为什么必须这么做见 8.4 节
- `collect()` — `packages/llm/src/index.ts`
  把流折成 { text, calls, usage }

## 自检

```sh
node --test packages/llm/tests/llm.spec.ts
```

## 卡住了

```sh
git checkout ch08-done   # 参考答案
```

**任何一章都能直接 checkout 开工**，不需要前面的自己写对。
