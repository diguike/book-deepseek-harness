# ch12 — 三层配置合成

这是**起点**。下面这些函数体被挖空了，填完它们让测试变绿：

- `composeEntries()` — `packages/loader/src/index.ts`
  按层叠加。patch 按 id 定位、**整体替换** config，不深合并
- `renderDump()` — `packages/loader/src/index.ts`
  渲染成带 # == 层来源注释的文本
- `assertEntriesActivated()` — `packages/loader/src/index.ts`
  把卡在 PENDING 的插件连同它缺的服务一起报出来

## 自检

```sh
node --test packages/loader/tests/loader.spec.ts
```

## 卡住了

```sh
git checkout ch12-done   # 参考答案
```

**任何一章都能直接 checkout 开工**，不需要前面的自己写对。
