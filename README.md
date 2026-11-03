# 雀见 Quejian

中文、卡通风格的日麻何切分析工具，支持四人麻将与三人麻将。手动输入手牌，即可比较切牌后的向听、进张种类和估算剩余张数。所有牌形计算在本机完成，无需账号或模型。

本仓库公开何切算法、界面、Windows 桌面宿主与测试，欢迎学习、提 Issue 和提交改进。项目采用 [MIT 许可证](LICENSE)，第三方素材见 [许可说明](THIRD_PARTY_NOTICES.md)。

## 功能

- 13 张看有效进张，14 张逐种比较何切；有固定面子时自动减少手牌上限。
- 支持普通型、七对子、国士无双；有固定面子时只计算普通型。
- 四麻／三麻规则切换；三麻移除二万到八万，已拔出的北不计为面子。
- 点击加牌、右键减牌、点击手牌移除，也支持中文和 `123m456p789s123z` 简写；`0` 表示赤五。
- 最多输入 `14 − 3 × 固定面子数` 张，防止误加。
- Windows 桌面运行时保存上次手牌、规则和面子数，支持导出分析结果。
- 保留 AI 跑谱网站外链，点击后由系统浏览器打开；程序不会自动提交牌谱。

当前版本只提供手动何切分析，不包含截图识牌、游戏连接或自动出牌。

## 快速运行

需要 Node.js，项目没有 npm 运行依赖。在仓库目录执行：

```sh
node --test tests/engine.test.mjs tests/sanma.test.mjs
node build-ui.mjs
node --check bundle-check.js
```

构建完成后，直接用浏览器打开 `assets/app.html` 即可试用。文件已内嵌界面、算法与背景，无需启动服务器。直接浏览时没有桌面文件对话框，导出使用浏览器下载。

开发时也可以在仓库根目录运行 `python -m http.server 8000`，再打开 `http://localhost:8000/ui/`。

## Windows 桌面运行与打包

桌面版已在 Python 3.10 上验证，窗口需要 Microsoft Edge WebView2 Runtime。

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-build.txt
node build-ui.mjs
.venv\Scripts\python.exe desktop.py
```

构建独立的 Windows 可执行文件：

```powershell
.venv\Scripts\python.exe -m PyInstaller --noconfirm --distpath dist 雀见.spec
```

输出文件为 `dist/雀见.exe`。可将它放到方便的位置，或自行创建桌面快捷方式。仓库不包含 `.venv`、生成的安装程序、运行日志或个人设置。

桌面启动自检在临时设置目录运行，不会覆盖实际保存的手牌：

```powershell
.venv\Scripts\python.exe desktop.py --self-test .\desktop-check.json
```

## 算法与代码入口

| 文件 | 内容 |
| --- | --- |
| `ui/engine.js` | 纯 JavaScript 牌形计算、向听、有效牌及何切排序 |
| `ui/app.js` | 手动选牌、简写输入、结果展示、保存和导出 |
| `ui/index.html`、`ui/styles.css` | 中文界面与卡通样式 |
| `desktop.py` | pywebview 桌面宿主，仅提供设置保存、导出与外链功能 |
| `build-ui.mjs` | 将源码与背景打包为一个离线 HTML 文件 |
| `tests/engine.test.mjs` | 四麻、特殊牌型、四张上限和随机独立验证 |
| `tests/sanma.test.mjs` | 三麻牌池、拔北与固定面子边界、随机独立验证 |

调用核心算法不需要桌面界面：

```js
import { parseTiles, analyzeHand } from './ui/engine.js';

const hand = parseTiles('19m123456p123s557z');
const result = analyzeHand({
  counts: hand.counts,
  rules: 'sanma',
  openMelds: 0,
});

console.log(result.discards);
```

`engine.js` 也接受独立的 `visible` 计数数组，供开发者在自己的分析程序中传入手牌之外的已知牌；当前图形界面没有牌河或已见牌录入。

## 如何理解结果

- “面”是仍有剩余张数的有效牌种类数；“张”是估算的未见张数。
- 图形界面按每种四张减去本人手牌及本次切牌计算，不扣除牌河、副露、宝牌指示牌或对手手牌，因此不是真实牌山余量。
- 优先比较向听更低，再比较有效张数和进张种类更多。
- 赤五与普通五合并计算牌形效率，不计算宝牌价值。
- 形状听牌不代表已经有役；本工具不判断役、番符、点数、振听或攻守，也不是 Mortal 等训练出的麻将 AI。

## 保存与隐私

桌面设置仅保存在运行电脑的 `%LOCALAPPDATA%\TingpaiLab\state.json`。该目录沿用早期名称以保留用户手牌。仓库和源码包不包含这个文件，牌形计算不会向服务器发送手牌。

## 参与开发

欢迎复现和修正牌形问题、改进界面、补充规则边界测试或完善文档。提问或提交修改前请阅读 [贡献指南](CONTRIBUTING.md)。

背景与图标为生成／原创素材，索子图形使用 CC0 公共领域素材；出处、版本及处理方式见 [ASSETS.md](ASSETS.md) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。本项目不隶属于雀魂、天凤或外链网站。
