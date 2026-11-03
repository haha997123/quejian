# 算法测试

在仓库根目录分别运行：

```sh
node tests/engine.test.mjs
node tests/sanma.test.mjs
```

也可使用 Node.js 测试运行器：

```sh
node --test tests/engine.test.mjs tests/sanma.test.mjs
```

覆盖四张上限、普通型／七对子／国士、固定面子、三麻牌池、北牌及有效进张；四麻与三麻还分别用 120 手随机牌和独立计算进行比对。
