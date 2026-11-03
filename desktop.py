"""雀见 Windows desktop host. All Mahjong computation stays inside the local UI."""
from __future__ import annotations
import argparse
import ctypes
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import traceback
import webbrowser

import webview


def asset(name: str) -> Path:
    return Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent)) / 'assets' / name


class DesktopAPI:
    _EXTERNAL_URLS = frozenset({
        'https://mjai.ekyu.moe/',
        'https://naga.dmv.nico/naga_report/top/',
        'https://gokujan.com/',
        'https://tingque.ai/trial',
    })

    def __init__(self, state_path: Path):
        self._window = None
        self._state_path = state_path
        self._state_lock = threading.Lock()

    def load_state(self):
        try:
            with self._state_lock:
                state = json.loads(self._state_path.read_text(encoding='utf-8'))
            return self._validate_state(state)
        except (OSError, ValueError, TypeError):
            return None

    def save_state(self, state):
        try:
            state = self._validate_state(state)
            with self._state_lock:
                self._state_path.parent.mkdir(parents=True, exist_ok=True)
                temporary = self._state_path.with_suffix('.tmp')
                temporary.write_text(json.dumps(state, ensure_ascii=False), encoding='utf-8')
                os.replace(temporary, self._state_path)
            return {'ok': True}
        except (OSError, ValueError, TypeError):
            return {'ok': False}

    def _validate_state(self, state):
        if not isinstance(state, dict):
            raise ValueError('Invalid state')
        hand = state.get('hand')
        if not isinstance(hand, str) or len(hand) > 1024:
            raise ValueError('Invalid notation')
        melds = str(state.get('melds', '0'))
        rules = state.get('rules', 'yonma')
        if melds not in ('0','1','2','3','4') or rules not in ('yonma','sanma'):
            raise ValueError('Invalid rules')
        return {'hand': hand, 'melds': melds, 'rules': rules}

    def open_external(self, url: str) -> dict:
        """Open one of the visible AI replay links in the user's default browser."""
        if not isinstance(url, str) or url not in self._EXTERNAL_URLS:
            return {'ok': False, 'message': '未识别的网站链接。'}
        try:
            opened = webbrowser.open(url, new=2)
            return {'ok': bool(opened), 'message': '' if opened else '无法打开浏览器，请检查默认浏览器设置。'}
        except (OSError, webbrowser.Error):
            return {'ok': False, 'message': '无法打开浏览器，请检查默认浏览器设置。'}

    def save_json(self, text: str, suggested_name: str = '雀见-分析结果.json') -> dict:
        if not isinstance(text, str) or len(text) > 2_000_000:
            return {'ok': False, 'message': '导出内容过大或格式不正确。'}
        try:
            json.loads(text)
        except (ValueError, TypeError):
            return {'ok': False, 'message': '导出内容不是有效 JSON。'}
        # A page can suggest a filename, but cannot choose an arbitrary path.
        basename = Path(str(suggested_name)).name
        if not basename.lower().endswith('.json') or len(basename) > 100:
            basename = '雀见-分析结果.json'
        selected = self._window.create_file_dialog(
            webview.FileDialog.SAVE, save_filename=basename,
            file_types=('JSON 文件 (*.json)',),
        )
        if not selected:
            return {'ok': False, 'cancelled': True}
        path = Path(selected[0] if isinstance(selected, (tuple, list)) else selected)
        try:
            path.write_text(text, encoding='utf-8')
            return {'ok': True, 'name': path.name}
        except OSError:
            return {'ok': False, 'message': '保存失败，请选择可写入的文件夹。'}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--self-test', type=Path, help='Write a local UI startup diagnostic and exit.')
    args = parser.parse_args()
    html = asset('app.html').read_text(encoding='utf-8')
    # A startup check must not read or overwrite a real user's last hand. A new
    # temporary directory also prevents an earlier check from masking defaults.
    test_directory = tempfile.TemporaryDirectory(prefix='tingpai-check-') if args.self_test else None
    state_path = Path(test_directory.name) / 'state.json' if test_directory else Path(os.environ.get('LOCALAPPDATA', str(Path.home() / 'AppData' / 'Local'))) / 'TingpaiLab' / 'state.json'
    if args.self_test:
        html = html.replace('<head>', '''<head><script>
window.__desktopStartupErrors = [];
window.addEventListener('error', event => window.__desktopStartupErrors.push(event.message || 'Resource error'));
window.addEventListener('unhandledrejection', event => window.__desktopStartupErrors.push(String(event.reason)));
</script>''', 1)
    api = DesktopAPI(state_path)
    window = webview.create_window(
        '雀见 · 何切工作台', html=html, js_api=api,
        width=1360, height=880, min_size=(850, 620),
        background_color='#fff8ed', hidden=bool(args.self_test),
        text_select=True,
    )
    api._window = window
    diagnostic = {'ok': False}

    if args.self_test:
        def inspect():
            try:
                ready = window.events.loaded.wait(30)
                if not ready:
                    raise RuntimeError('UI did not load within 30 seconds.')
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline:
                    if window.evaluate_js("Boolean(window.pywebview?.api?.open_external && document.querySelector('#results-list [data-discard=\"33\"][aria-pressed=\"true\"]'))"):
                        break
                    time.sleep(0.1)
                # Exercise the requested editing boundaries in this app's
                # isolated test state. This never reads a user's saved hand.
                edit_checks = window.evaluate_js("""(() => {
                    const field = document.getElementById('hand-input');
                    const picker = index => document.querySelector(`#tile-picker .picker-cell[data-index="${index}"][data-red="0"] button`);
                    const count = () => document.querySelectorAll('#hand-tiles .tile').length;
                    const original = field.value;
                    picker(9).click();
                    const blocksFifteenth = field.value===original && count()===14;
                    picker(0).dispatchEvent(new MouseEvent('contextmenu', {bubbles:true,cancelable:true}));
                    const removesAtLimit = count()===13;
                    picker(0).click();
                    const addsAfterRemoval = count()===14 && field.value===original;
                    field.value='123456m1234p67s557z';
                    field.dispatchEvent(new Event('input', {bubbles:true}));
                    const rejectsExcessPaste = field.value===original;
                    const melds=document.getElementById('open-melds');
                    melds.value='1';
                    melds.dispatchEvent(new Event('change', {bubbles:true}));
                    const rejectsExcessMeldChange = melds.value==='0' && field.value===original;
                    const copyButtonRemoved = !document.getElementById('copy-hand');
                    return {blocksFifteenth,removesAtLimit,addsAfterRemoval,rejectsExcessPaste,rejectsExcessMeldChange,copyButtonRemoved};
                })()""")
                time.sleep(0.25)
                diagnostic['editingChecks'] = edit_checks
                diagnostic.update(window.evaluate_js("""(() => {
                    const text = document.body.innerText;
                    const errors = [...document.querySelectorAll('[role=alert]')]
                      .filter(e=>e.getBoundingClientRect().height>0).map(e=>e.innerText).filter(Boolean);
                    const runtimeErrors = window.__desktopStartupErrors || [];
                    const compact = node => (node?.innerText || '').replace(/\\s/g, '');
                    const defaultHand = document.getElementById('hand-input')?.value === '123456m234p67s557z';
                    const selectedDiscard = document.querySelector('#results-list [data-discard="33"][aria-pressed="true"]');
                    const hero = document.getElementById('hero-body');
                    const waits = document.getElementById('hero-foot');
                    const expectedWaits = waits?.querySelector('[data-index="22"]') && waits?.querySelector('[data-index="25"]');
                    const expectedResult = compact(hero).includes('2面/8张') && Boolean(expectedWaits);
                    const externalScripts = document.querySelectorAll('script[src]').length;
                    const externalStylesheets = document.querySelectorAll('link[rel=stylesheet]').length;
                    const hostAPI = Object.keys(window.pywebview?.api||{}).sort();
                    const handOnlyAPI = JSON.stringify(hostAPI)===JSON.stringify(['load_state','open_external','save_json','save_state']);
                    const hasAutomationUI = Boolean(document.querySelector('[data-view="screen"],#view-screen,[id^="screen-"],[id^="auto-"],canvas'));
                    const hasVisibleControls = Boolean(document.querySelector('#visible-input,#visible-details,#target-visible'));
                    const externalSites = [...document.querySelectorAll('[data-external]')].map(element => element.dataset.external).sort();
                    const expectedSites = ['https://gokujan.com/','https://mjai.ekyu.moe/','https://naga.dmv.nico/naga_report/top/','https://tingque.ai/trial'].sort();
                    return {ok: defaultHand && Boolean(selectedDiscard) && expectedResult && errors.length===0 && runtimeErrors.length===0
                        && externalScripts===0 && externalStylesheets===0 && handOnlyAPI && !hasAutomationUI
                        && !hasVisibleControls && JSON.stringify(externalSites)===JSON.stringify(expectedSites)
                        && document.title==='雀见 · 日麻何切',
                      title: document.title, text: text.slice(0,12000), errors,
                      runtimeErrors, defaultHand, selectedDiscard: selectedDiscard ? 33 : null, expectedResult,
                      inputs: document.querySelectorAll('input').length,
                      buttons: document.querySelectorAll('button').length,
                      hasVisibleControls, externalSites,
                      viewport: {width: innerWidth, height: innerHeight, contentWidth: document.documentElement.scrollWidth},
                      externalScripts, externalStylesheets, hostAPI, handOnlyAPI, hasAutomationUI};
                })()"""))
                diagnostic['ok'] = diagnostic.get('ok', False) and all(edit_checks.values())
            except Exception as error:
                diagnostic.update({'ok': False, 'error': str(error)})
            finally:
                args.self_test.parent.mkdir(parents=True, exist_ok=True)
                args.self_test.write_text(json.dumps(diagnostic, ensure_ascii=False, indent=2), encoding='utf-8')
                window.destroy()
        threading.Thread(target=inspect, daemon=True).start()

    try:
        webview.start(gui='edgechromium', private_mode=True, debug=False)
    except Exception:
        if args.self_test:
            args.self_test.parent.mkdir(parents=True, exist_ok=True)
            args.self_test.write_text(json.dumps({'ok': False, 'error': traceback.format_exc()}, ensure_ascii=False, indent=2), encoding='utf-8')
        else:
            ctypes.windll.user32.MessageBoxW(
                None, '桌面窗口无法启动。请确认已安装 Microsoft Edge WebView2 Runtime。\n这台电脑的麻将计算不需要联网或登录。',
                '雀见 · 启动提示', 0x10,
            )
        return 1
    finally:
        if test_directory:
            test_directory.cleanup()
    return 0 if not args.self_test or diagnostic.get('ok') else 1


if __name__ == '__main__':
    raise SystemExit(main())
