/* GM 面板 - 勇者奶蛙传（本地自用版）
 * 原理：游戏状态全部存在 localStorage 存档里（key: naiwa:233-story:naiwa-run-v1），
 * 游戏本体是 ES module、没有暴露到 window 上，所以 GM 通过读写存档来实现。
 * 改存档后需要重新加载页面并点「继续冒险」才能生效，GM 会自动帮你点。
 * 本文件只新增，不改游戏原文件。
 */
(function () {
    'use strict';

    var SAVE_KEY = 'naiwa:233-story:naiwa-run-v1';
    var AUTO_FLAG = 'gm-autocontinue';
    var PENDING_KEY = 'gm-pending-save';
    var ZONES = ['奶笑村', '咕嘎小径', '刀盾山道', '风暴断桥', '禁声堡垒', '肃静大殿', '无声王座'];

    /* ---------- 存档读写 ---------- */
    function readSave() {
        try {
            var raw = localStorage.getItem(SAVE_KEY);
            if (!raw) return null;
            var o = JSON.parse(raw);
            if (!o || o.schema !== 1 || !o.state) return null;
            return o;
        } catch (e) { return null; }
    }
    function writeSave(state) {
        var o = { schema: 1, savedAt: Date.now(), state: state };
        var s = JSON.stringify(o);
        localStorage.setItem(SAVE_KEY, s);
        // 再存一份到 sessionStorage：页面刷新时游戏可能在卸载前自动保存，
        // 把 GM 改好的存档覆盖掉；下次加载时用这份再写回去，确保 GM 生效。
        try { sessionStorage.setItem(PENDING_KEY, s); } catch (e) {}
    }
    /* 页面加载时（游戏读存档之前）把待应用的 GM 存档写回 localStorage */
    function applyPendingSave() {
        var p = null;
        try { p = sessionStorage.getItem(PENDING_KEY); } catch (e) {}
        if (!p) return;
        try { sessionStorage.removeItem(PENDING_KEY); } catch (e) {}
        try { localStorage.setItem(SAVE_KEY, p); } catch (e) {}
    }

    /* ---------- 构造一个合法的新存档（从头开始某一关） ----------
     * 字段含义与默认值全部按游戏本体（model 构造 + enterZone + 存档校验 xe）来，
     * 校验要求：42 个数字字段必须全是有限数；5 个布尔字段必须是布尔；
     * zone 0-6 整数；dash 未解锁时 dashCharges 必须为 0；phase 只能是 playing 等 5 种；
     * hero 必须是合法 actor（kind=hero，hp 在 0-maxHp 之间）。 */
    function makeHero(zone) {
        var scale = zone === 6 ? 1.25 : 1;
        var x = (zone === 6 ? 255 : 265) * scale;
        var y = 552 * scale;
        return {
            id: 1, kind: 'hero', x: x, y: y, z: 0, vz: 0, vx: 0, vy: 0,
            hp: 120, maxHp: 120, face: 1, hit: 0, cooldown: 1.5,
            state: 'idle', timer: 0, age: 0, dead: false, radius: 28,
            attack: 0, targetX: x, targetY: y, dashHits: [], rageTime: 0,
            rageTriggered: false, dogNodes: [], buffTime: 0, aiCycle: 0,
            waveTier: 0, elite: false, combatPhase: 1, comboPartnerId: 0,
            attackPoints: [], attackAreas: []
        };
    }
    function makeBoss() {
        var scale = 1.25, x = 970 * scale, y = 535 * scale;
        return {
            id: 2, kind: 'boss', x: x, y: y, z: 0, vz: 0, vx: 0, vy: 0,
            hp: 8800, maxHp: 8800, face: 1, hit: 0, cooldown: 1.5,
            state: 'intro', timer: 2.6, age: 0, dead: false, radius: 63,
            attack: 0, targetX: x, targetY: y, dashHits: [], rageTime: 0,
            rageTriggered: false, dogNodes: [], buffTime: 0, aiCycle: 0,
            waveTier: 0, elite: false, combatPhase: 1, comboPartnerId: 0,
            attackPoints: [], attackAreas: []
        };
    }
    function buildSave(zone, opts) {
        opts = opts || {};
        var dashUnlocked = zone >= 1; // 通关第 1 关（奶笑村）后解锁肚皮冲撞
        var hero = makeHero(zone);
        var actors = [], crates = [], nextId = 1;
        if (zone === 6) {
            actors = [makeBoss()];
            nextId = 2;
        } else {
            crates = [
                { id: 2, x: 205, y: 464, hp: 1 },
                { id: 3, x: 1080, y: 594, hp: 1 },
                { id: 4, x: 961, y: 459, hp: 1 }
            ];
            nextId = 4;
        }
        var god = !!opts.god;
        var state = {
            zone: zone, wave: 0, waveRemaining: 0, spawnTimer: 0,
            nextWaveTimer: 1.8, elapsed: 0, zoneElapsed: 0,
            kills: 0, deaths: 0, combo: 0, maxCombo: 0, comboTimer: 0,
            energy: opts.maxStuff ? 100 : 30,
            dashCooldown: 0, dashMax: 2,
            dashCharges: dashUnlocked ? 2 : 0,
            attackTimer: 0.35, manualCooldown: 0,
            peaches: opts.maxStuff ? 99 : 0,
            slowRemaining: 0,
            invulnerable: god ? 999999 : 1.8,
            clock: 0, transitionTimer: 0, bossPhase: 1, lastPotHit: 0,
            superCharge: 0, superCastRemaining: 0, superLaughElapsed: 0,
            superClickRemaining: 0, superDamageDealt: 0, superDamageBudget: 0,
            bossLaughRemaining: 0, lastSuperTap: -1e12,
            nextId: nextId, seed: 43892, comboCooldown: 2.5,
            naidanElapsed: -1, naidanCooldown: 0,
            dashUnlocked: dashUnlocked, superUsed: false,
            superClearedMinions: false, specialSpawned: false,
            minibossSpawned: false,
            hero: hero, actors: actors, shots: [], crates: crates,
            upgrades: [], pending: [],
            checkpoint: {
                upgrades: [], kills: 0,
                energy: opts.maxStuff ? 100 : 30,
                peaches: opts.maxStuff ? 99 : 0,
                dashUnlocked: dashUnlocked
            },
            upgradeNext: 'zone', phase: 'playing'
        };
        if (god) { hero.hp = hero.maxHp; }
        return state;
    }

    /* ---------- 当前关卡 ---------- */
    function currentZone() {
        // 先看 HUD（CHAPTER 0X），再看存档，最后默认 0
        try {
            var el = document.querySelector('#zone-number');
            if (el) {
                var m = /CHAPTER\s*0?(\d)/i.exec(el.textContent || '');
                if (m) {
                    var z = parseInt(m[1], 10) - 1;
                    if (z >= 0 && z <= 6) return z;
                }
            }
        } catch (e) {}
        var s = readSave();
        if (s && s.state && Number.isInteger(s.state.zone)) return s.state.zone;
        return 0;
    }

    /* ---------- 改完存档 → 刷新 → 自动点「继续冒险」 ---------- */
    function applyAndReload(note) {
        try { sessionStorage.setItem(AUTO_FLAG, '1'); } catch (e) {}
        setStatus(note + '，正在重新进入…');
        setTimeout(function () { location.reload(); }, 400);
    }
    function autoContinue() {
        var flag = null;
        try { flag = sessionStorage.getItem(AUTO_FLAG); } catch (e) {}
        if (!flag) return;
        try { sessionStorage.removeItem(AUTO_FLAG); } catch (e) {}
        var tries = 0;
        var timer = setInterval(function () {
            tries++;
            var btn = document.querySelector('#continue-button');
            if (btn && !btn.classList.contains('hidden') && !btn.disabled) {
                clearInterval(timer);
                btn.click();
            } else if (tries > 120) {
                clearInterval(timer);
                setStatus('自动进入超时，请手动点「继续冒险」（不要点“准备好出发”，那会开新局覆盖 GM）。');
            }
        }, 500);
    }

    /* ---------- GM 动作 ---------- */
    function jumpToZone(zone) {
        writeSave(buildSave(zone, {}));
        applyAndReload('已跳到第 ' + (zone + 1) + ' 章「' + ZONES[zone] + '」');
    }
    function nextZone() {
        var z = currentZone();
        if (z >= 6) { setStatus('已经是最后一章（无声王座）了'); return; }
        jumpToZone(z + 1);
    }
    function godMode() {
        var s = readSave();
        var zone = currentZone();
        var state;
        if (s && s.state) {
            // 沿用现有存档，只改无敌和血量，保留当前进度
            state = s.state;
            state.invulnerable = 999999;
            if (state.hero) state.hero.hp = state.hero.maxHp || 120;
            if (state.phase && state.phase !== 'playing') state.phase = 'playing';
        } else {
            state = buildSave(zone, { god: true });
        }
        writeSave(state);
        applyAndReload('无敌已开（约 11 天内不受伤害），第 ' + (zone + 1) + ' 章');
    }
    function maxStuff() {
        var s = readSave();
        var zone = currentZone();
        var state;
        if (s && s.state) {
            state = s.state;
            state.peaches = 99;
            state.energy = 100;
            if (state.checkpoint) {
                state.checkpoint.peaches = 99;
                state.checkpoint.energy = 100;
            }
            if (state.hero) state.hero.hp = state.hero.maxHp || 120;
        } else {
            state = buildSave(zone, { maxStuff: true });
        }
        writeSave(state);
        applyAndReload('桃子 99、能量 100、血回满（第 ' + (zone + 1) + ' 章）');
    }
    function unlimitedPeaches() {
        var s = readSave();
        var zone = currentZone();
        var state;
        if (s && s.state) {
            state = s.state;
            state.peaches = 999999;
            if (state.checkpoint) state.checkpoint.peaches = 999999;
            if (state.hero) state.hero.hp = state.hero.maxHp || 120;
        } else {
            state = buildSave(zone, {});
            state.peaches = 999999;
            state.checkpoint.peaches = 999999;
        }
        writeSave(state);
        applyAndReload('黄桃罐头无限（999999 个，用不完）');
    }

    /* ---------- 面板 UI ---------- */
    var statusEl = null;
    function setStatus(t) {
        if (statusEl) statusEl.textContent = t;
    }
    function buildUI() {
        var css = [
            '#gm-btn{position:fixed;right:14px;bottom:14px;z-index:99999;width:52px;height:52px;border-radius:50%;',
            'background:rgba(20,16,40,.78);color:#ffd347;border:2px solid rgba(255,211,71,.65);',
            'font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,.5);}',
            '#gm-btn:active{transform:scale(.94)}',
            '#gm-panel{position:fixed;right:14px;bottom:76px;z-index:99999;width:248px;max-height:70vh;overflow:auto;',
            'background:rgba(18,14,36,.92);color:#eee;border:1px solid rgba(255,211,71,.4);border-radius:12px;',
            'padding:12px;font-size:14px;box-shadow:0 4px 24px rgba(0,0,0,.6);display:none;}',
            '#gm-panel.open{display:block}',
            '#gm-panel h3{margin:0 0 8px;font-size:15px;color:#ffd347}',
            '#gm-panel .gm-sec{margin:8px 0 4px;color:#9db4ff;font-size:12px}',
            '#gm-panel button{display:block;width:100%;margin:4px 0;padding:7px 8px;text-align:left;',
            'background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.18);',
            'border-radius:8px;font-size:13px;cursor:pointer}',
            '#gm-panel button:active{background:rgba(255,211,71,.25)}',
            '#gm-panel .gm-status{margin-top:8px;font-size:12px;color:#aaa;line-height:1.5;word-break:break-all}',
            '#gm-panel .gm-close{float:right;background:none;border:none;color:#888;font-size:16px;padding:0 4px;cursor:pointer}'
        ].join('');
        var st = document.createElement('style');
        st.textContent = css;
        document.head.appendChild(st);

        var btn = document.createElement('button');
        btn.id = 'gm-btn';
        btn.textContent = 'GM';
        btn.title = 'GM 面板';
        document.body.appendChild(btn);

        var panel = document.createElement('div');
        panel.id = 'gm-panel';
        var zoneBtns = ZONES.map(function (n, i) {
            return '<button data-zone="' + i + '">第 ' + (i + 1) + ' 章 · ' + n + '</button>';
        }).join('');
        panel.innerHTML =
            '<button class="gm-close" id="gm-close">✕</button>' +
            '<h3>GM 面板</h3>' +
            '<div class="gm-sec">跳关（改完自动重进）</div>' + zoneBtns +
            '<button id="gm-next">下一关 ▶</button>' +
            '<div class="gm-sec">作弊</div>' +
            '<button id="gm-god">🛡 无敌（不受伤害）</button>' +
            '<button id="gm-max">🍑 桃子 99 · 能量 100 · 回满血</button>' +
            '<button id="gm-peaches">🍑 黄桃罐头无限（999999 个）</button>' +
            '<div class="gm-status" id="gm-status"></div>';
        document.body.appendChild(panel);
        statusEl = panel.querySelector('#gm-status');

        btn.addEventListener('click', function () {
            panel.classList.toggle('open');
            refreshStatus();
        });
        panel.querySelector('#gm-close').addEventListener('click', function () {
            panel.classList.remove('open');
        });
        panel.querySelectorAll('[data-zone]').forEach(function (b) {
            b.addEventListener('click', function () {
                jumpToZone(parseInt(b.getAttribute('data-zone'), 10));
            });
        });
        panel.querySelector('#gm-next').addEventListener('click', nextZone);
        panel.querySelector('#gm-god').addEventListener('click', godMode);
        panel.querySelector('#gm-max').addEventListener('click', maxStuff);
        panel.querySelector('#gm-peaches').addEventListener('click', unlimitedPeaches);
        refreshStatus();
    }
    function refreshStatus() {
        var s = readSave();
        var z = currentZone();
        var t = '当前：第 ' + (z + 1) + ' 章「' + ZONES[z] + '」\n' +
            (s ? '已有存档（可继续冒险）' : '暂无存档：先点开始玩一下，或直接用跳关建一个') +
            '\n改存档后会自动刷新并点「继续冒险」。';
        setStatus(t);
    }

    /* ---------- 启动 ---------- */
    function init() {
        applyPendingSave();
        autoContinue();
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', buildUI);
        } else {
            buildUI();
        }
    }
    init();
})();
