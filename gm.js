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
    /* 页面加载时（游戏读存档之前）把待应用的 GM 存档写回 localStorage。
     * 注意：这里故意不删 sessionStorage 里的备份——游戏在标题画面等待期间
     * 仍可能自动保存一次，把 GM 存档又盖掉；要留着备份，在点「继续冒险」
     * 之前再写一次，直到游戏真正进关才清理。 */
    function applyPendingSave() {
        var p = null;
        try { p = sessionStorage.getItem(PENDING_KEY); } catch (e) {}
        if (!p) return false;
        try { localStorage.setItem(SAVE_KEY, p); } catch (e) {}
        return true;
    }
    /* 游戏已经进关、读完 GM 存档后，才可以删掉备份 */
    function clearPendingSave() {
        try { sessionStorage.removeItem(PENDING_KEY); } catch (e) {}
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
        var dashUnlocked = true; // GM：冲撞开局即解锁，第 1 关也能用
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
            // 等待期间游戏可能自动保存，把 GM 存档盖掉；每轮都重新写回一次
            applyPendingSave();
            var btn = document.querySelector('#continue-button');
            if (btn && !btn.classList.contains('hidden') && !btn.disabled) {
                clearInterval(timer);
                // 点「继续冒险」前最后一刻再写一次，确保游戏读到的是 GM 存档
                applyPendingSave();
                btn.click();
                // 游戏已进关、读完存档，3 秒后清理备份（避免以后正常刷新被旧备份覆盖）
                setTimeout(clearPendingSave, 3000);
            } else if (tries > 120) {
                clearInterval(timer);
                setStatus('自动进入超时，请手动点「继续冒险」（不要点“准备好出发”，那会开新局覆盖 GM）。');
            }
        }, 500);
    }

    /* ---------- 技能（过关后“选一招”池 S，存档白名单仅认这 9 个） ----------
     * 注意：只能写这 9 个 id、不重复、总数 ≤9；池 $ 的 7 个和商店 id 写进去
     * 整个存档会被校验拒掉。改 upgrades 时必须同步改 checkpoint.upgrades，
     * 否则死一次、重闯本关就丢了（retry 会从 checkpoint 还原）。 */
    var SKILLS = [
        { id: 'auto', name: '自动奶球', desc: '自动找敌人发射奶球' },
        { id: 'defense1', name: '肚皮护盾 · 闪耀', desc: '防御减伤 42%' },
        { id: 'defense2', name: '肚皮护盾 · 辉煌', desc: '防御减伤 54%' },
        { id: 'spread', name: '哈哈三连', desc: '普攻增加两道弹幕' },
        { id: 'pierce', name: '笑穿全场', desc: '弹幕穿透两个敌人' },
        { id: 'rapid', name: '根本停不下来', desc: '普攻速度 +30%' },
        { id: 'pot', name: '护体锅盖', desc: '锅盖绕身，击退近身敌人' },
        { id: 'aftershock', name: '肚皮地震', desc: '冲撞结束引发冲击波' },
        { id: 'laugh', name: '笑到地动山摇', desc: '大笑范围扩大，伤害提升' }
    ];
    /* 技能多选的暂存：游戏每 3 秒自动保存，会把 GM 刚写进 localStorage 的
     * 技能选择覆盖回旧值；所以多选过程只认内存里的这份，不读 localStorage，
     * 每次点选都以这份为准写回存档，点「应用」时再以这份为准重进。 */
    var stagedSkills = null;
    function getOwnedSkills() {
        if (stagedSkills) return stagedSkills.slice();
        var s = readSave();
        if (s && s.state && Array.isArray(s.state.upgrades)) return s.state.upgrades;
        return [];
    }
    function stageSkills() {
        if (!stagedSkills) stagedSkills = getOwnedSkills();
        return stagedSkills;
    }
    /* 点一下技能：有了就去掉，没了就加上；只改存档、不刷新，
     * 可以连续多选，选完点「应用技能」再一次性重进生效。
     * 注意：用内存里的暂存（stageSkills）做增减，不读 localStorage，
     * 否则游戏 3 秒一次的自动保存会把前面选的覆盖掉。 */
    function toggleSkill(id) {
        var ups = stageSkills();
        var idx = ups.indexOf(id);
        var skill = null;
        SKILLS.forEach(function (k) { if (k.id === id) skill = k; });
        var name = skill ? skill.name : id;
        if (idx >= 0) {
            ups.splice(idx, 1);
        } else {
            if (ups.length >= 9) { setStatus('技能最多 9 个，先去掉一个再加'); return; }
            ups.push(id);
        }
        stagedSkills = ups;
        // 以暂存为准写回存档（state + checkpoint 同步）
        var s = readSave();
        var zone = currentZone();
        var state = (s && s.state) ? s.state : buildSave(zone, {});
        state.upgrades = ups.slice();
        if (state.checkpoint) state.checkpoint.upgrades = ups.slice();
        writeSave(state);
        renderSkills();
        setStatus((idx >= 0 ? '已去掉：' : '已选上：') + name + '（共 ' + ups.length + ' 个），选完点下面「应用技能」重进生效');
    }
    /* 技能选完后点这个：以暂存为准一次性重进游戏，让新技能生效 */
    function applySkills() {
        var ups = stageSkills();
        var s = readSave();
        var zone = currentZone();
        var state = (s && s.state) ? s.state : buildSave(zone, {});
        state.upgrades = ups.slice();
        if (state.checkpoint) state.checkpoint.upgrades = ups.slice();
        writeSave(state);
        applyAndReload('技能已应用（共 ' + ups.length + ' 个），第 ' + (zone + 1) + ' 章');
    }
    /* ---------- GM 动作 ---------- */
    function jumpToZone(zone) {
        var ups = getOwnedSkills();
        var state = buildSave(zone, {});
        // 跳关也保留已选技能（包括刚在菜单里多选的暂存）
        state.upgrades = ups.slice();
        if (state.checkpoint) state.checkpoint.upgrades = ups.slice();
        writeSave(state);
        applyAndReload('已跳到第 ' + (zone + 1) + ' 章「' + ZONES[zone] + '」');
    }
    function nextZone() {
        var z = currentZone();
        if (z >= 6) { setStatus('已经是最后一章（无声王座）了'); return; }
        jumpToZone(z + 1);
    }
    /* 卡在“选一招”画面时用：技能全满、没得选就会卡住。
     * 直接进下一关，同时保留已选的技能（跳关会清空技能，这个不会）。 */
    function skipUpgrade() {
        var s = readSave();
        var z = currentZone();
        var ups = getOwnedSkills();
        if (z >= 6) { setStatus('已经是最后一章，没有下一关了'); return; }
        var state = buildSave(z + 1, {});
        state.upgrades = ups.slice();
        if (state.checkpoint) state.checkpoint.upgrades = ups.slice();
        writeSave(state);
        applyAndReload('已跳过选技能，进第 ' + (z + 2) + ' 章「' + ZONES[z + 1] + '」（保留 ' + ups.length + ' 个技能）');
    }
    function godMode() {
        var s = readSave();
        var zone = currentZone();
        var state;
        if (isGodOn()) {
            // 关掉无敌：把无敌倒计时清零，马上就能正常受伤
            if (s && s.state) {
                state = s.state;
                state.invulnerable = 0;
            } else {
                state = buildSave(zone, {});
                state.invulnerable = 0;
            }
            writeSave(state);
            applyAndReload('无敌已关（第 ' + (zone + 1) + ' 章），现在会正常受伤');
        } else {
            // 打开无敌
            if (s && s.state) {
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
    }
    /* 无敌是否正开着：存档里 invulnerable 很大就是开着 */
    function isGodOn() {
        var s = readSave();
        return !!(s && s.state && typeof s.state.invulnerable === 'number' && s.state.invulnerable > 10000);
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
    var gmPortrait = false; /* #gm-root 当前是否旋转了 90°（竖屏手机），拖拽换算坐标用 */
    var BTN_POS_KEY = 'gm-btn-pos';
    var BTN_DEFAULT = { right: 120, bottom: 14 };
    function setStatus(t) {
        if (statusEl) statusEl.textContent = t;
    }
    /* GM 按钮自由拖拽：按住拖动可放到任意位置，松手后位置存 localStorage，
     * 下次打开还在原处。竖屏手机上容器旋转了 90°，屏幕位移要换算成容器内坐标：
     * 顺时针 90° 时，屏幕 (dx,dy) 对应容器内 (dy,-dx)；没旋转时直接用 (dx,dy)。
     * 手指一动按钮就跟（不设启动阈值，松手时总位移小于 8px 才算点按）。 */
    function makeBtnDraggable(btn) {
        var root = document.querySelector('#gm-root');
        var dragging = false;
        var startX = 0, startY = 0, startRight = 0, startBottom = 0;
        var lastX = 0, lastY = 0;
        function readPos() {
            var r = parseFloat(btn.style.right) || BTN_DEFAULT.right;
            var b = parseFloat(btn.style.bottom) || BTN_DEFAULT.bottom;
            return { right: r, bottom: b };
        }
        function clampPos(right, bottom) {
            var w = (root && root.clientWidth) || window.innerWidth;
            var h = (root && root.clientHeight) || window.innerHeight;
            return {
                right: Math.max(0, Math.min(w - 52, right)),
                bottom: Math.max(0, Math.min(h - 52, bottom))
            };
        }
        function applyPos(p) {
            var c = clampPos(p.right, p.bottom);
            btn.style.right = c.right + 'px';
            btn.style.bottom = c.bottom + 'px';
            return c;
        }
        /* 恢复上次拖到的位置 */
        try {
            var saved = JSON.parse(localStorage.getItem(BTN_POS_KEY) || 'null');
            if (saved && typeof saved.right === 'number' && typeof saved.bottom === 'number') applyPos(saved);
        } catch (e) {}
        btn.addEventListener('pointerdown', function (ev) {
            dragging = true;
            startX = ev.clientX; startY = ev.clientY;
            lastX = ev.clientX; lastY = ev.clientY;
            var p = readPos();
            startRight = p.right; startBottom = p.bottom;
            try { btn.setPointerCapture(ev.pointerId); } catch (e) {}
            ev.preventDefault();
        });
        btn.addEventListener('pointermove', function (ev) {
            if (!dragging) return;
            /* 手指一动就跟，不等阈值 */
            var sdx = ev.clientX - startX, sdy = ev.clientY - startY;
            lastX = ev.clientX; lastY = ev.clientY;
            /* 屏幕位移 -> 容器内位移 */
            var ldx = gmPortrait ? sdy : sdx;
            var ldy = gmPortrait ? -sdx : sdy;
            applyPos({ right: startRight - ldx, bottom: startBottom - ldy });
        });
        function endDrag(ev) {
            if (!dragging) return;
            dragging = false;
            /* 松手时看总位移：小于 8px 算点按（打开面板），大于等于 8px 算拖拽 */
            var totalDx = lastX - startX, totalDy = lastY - startY;
            var moved = Math.abs(totalDx) >= 8 || Math.abs(totalDy) >= 8;
            if (moved) {
                var p = readPos();
                try { localStorage.setItem(BTN_POS_KEY, JSON.stringify(p)); } catch (e) {}
                /* 拖拽后不要触发点按（否则会误开面板） */
                btn.setAttribute('data-dragged', '1');
                setTimeout(function () { btn.removeAttribute('data-dragged'); }, 50);
            } else {
                /* 没拖动过，位置不动（手指轻点时不小心挪了 1-2px 也复位） */
                applyPos({ right: startRight, bottom: startBottom });
            }
        }
        btn.addEventListener('pointerup', endDrag);
        btn.addEventListener('pointercancel', endDrag);
    }
    function resetBtnPos() {
        var btn = document.querySelector('#gm-btn');
        if (!btn) return;
        btn.style.right = BTN_DEFAULT.right + 'px';
        btn.style.bottom = BTN_DEFAULT.bottom + 'px';
        try { localStorage.removeItem(BTN_POS_KEY); } catch (e) {}
    }
    function buildUI() {
        var css = [
            /* #gm-root 是 GM 的容器：平时就是全屏透明层；竖屏手机上跟游戏一样
             * 旋转 90°，让按钮和面板都横过来、落在游戏画面里（不再竖着挡屏）。 */
            '#gm-root{position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:99999;pointer-events:none;}',
            '#gm-root>*{pointer-events:auto;}',
            '#gm-btn{position:absolute;right:120px;bottom:14px;width:52px;height:52px;border-radius:50%;',
            'background:rgba(20,16,40,.78);color:#ffd347;border:2px solid rgba(255,211,71,.65);',
            'font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,.5);',
            'touch-action:none;user-select:none;-webkit-user-select:none;}',
            '#gm-btn:active{transform:scale(.94)}',
            '#gm-panel{position:absolute;right:14px;bottom:76px;width:248px;max-height:70%;overflow:auto;',
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
            '#gm-panel .gm-close{float:right;background:none;border:none;color:#888;font-size:16px;padding:0 4px;cursor:pointer}',
            /* 竖屏手机：面板放宽一点，按钮更好点 */
            '@media (pointer:coarse) and (orientation:portrait){#gm-panel{width:min(300px,86vw);}}'
        ].join('');
        var st = document.createElement('style');
        st.textContent = css;
        document.head.appendChild(st);

        var root = document.createElement('div');
        root.id = 'gm-root';
        document.body.appendChild(root);

        var btn = document.createElement('button');
        btn.id = 'gm-btn';
        btn.textContent = 'GM';
        btn.title = 'GM 面板';
        root.appendChild(btn);

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
            '<button id="gm-skip">⏭ 跳过选技能（卡住时用）</button>' +
            '<div class="gm-sec">作弊</div>' +
            '<button id="gm-god">🛡 无敌</button>' +
            '<button id="gm-max">🍑 桃子 99 · 能量 100 · 回满血</button>' +
            '<button id="gm-peaches">🍑 黄桃罐头无限（999999 个）</button>' +
            '<div class="gm-sec">技能（过关后选的那种，自由搭配）</div>' +
            '<button id="gm-skill-toggle">🎯 技能选择 ▸ 点击展开</button>' +
            '<div id="gm-skills" style="display:none"></div>' +
            '<button id="gm-apply-skills" style="display:none">✅ 应用技能并重进</button>' +
            '<button id="gm-reset-pos">📍 重置 GM 按钮位置</button>' +
            '<div class="gm-status" id="gm-status"></div>';
        root.appendChild(panel);
        statusEl = panel.querySelector('#gm-status');

        makeBtnDraggable(btn);
        btn.addEventListener('click', function () {
            if (btn.getAttribute('data-dragged')) return; /* 刚拖完，不算点按 */
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
        panel.querySelector('#gm-skip').addEventListener('click', skipUpgrade);
        panel.querySelector('#gm-god').addEventListener('click', godMode);
        panel.querySelector('#gm-max').addEventListener('click', maxStuff);
        panel.querySelector('#gm-peaches').addEventListener('click', unlimitedPeaches);
        panel.querySelector('#gm-skill-toggle').addEventListener('click', function () {
            var box = panel.querySelector('#gm-skills');
            var applyBtn = panel.querySelector('#gm-apply-skills');
            var open = box.style.display !== 'none';
            box.style.display = open ? 'none' : 'block';
            applyBtn.style.display = open ? 'none' : 'block';
            panel.querySelector('#gm-skill-toggle').textContent = open ? '🎯 技能选择 ▸ 点击展开' : '🎯 技能选择 ▾ 点击收起';
            if (!open) renderSkills();
        });
        panel.querySelector('#gm-apply-skills').addEventListener('click', applySkills);
        panel.querySelector('#gm-reset-pos').addEventListener('click', function () {
            resetBtnPos();
            refreshStatus();
        });
        syncLayout();
        window.addEventListener('resize', syncLayout);
        window.addEventListener('orientationchange', syncLayout);
        if (window.visualViewport) window.visualViewport.addEventListener('resize', syncLayout);
        refreshStatus();
    }
    /* 跟游戏保持同一个横竖屏逻辑：触屏 + 竖屏时，游戏会把画面旋转 90°，
     * GM 容器也按同样的尺寸居中旋转 90°，按钮和面板就横过来、落在游戏画面里。
     * 横屏 / 电脑上不旋转，保持原来的全屏定位。 */
    function syncLayout() {
        var root = document.querySelector('#gm-root');
        if (!root) return;
        var w = (window.visualViewport && window.visualViewport.width) || window.innerWidth;
        var h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
        var portraitTouch = false;
        try { portraitTouch = window.matchMedia('(pointer: coarse)').matches && h > w; } catch (e) {}
        gmPortrait = portraitTouch;
        if (portraitTouch) {
            var gw = Math.min(h, w * 16 / 9);
            var gh = gw * 9 / 16;
            root.style.width = gw + 'px';
            root.style.height = gh + 'px';
            root.style.left = '50%';
            root.style.top = '50%';
            root.style.transform = 'translate(-50%, -50%) rotate(90deg)';
        } else {
            root.style.width = '100vw';
            root.style.height = '100vh';
            root.style.left = '0';
            root.style.top = '0';
            root.style.transform = '';
        }
    }
    /* 渲染技能菜单：已拥有的打 ✓，点一下切换 */
    function renderSkills() {
        var box = document.querySelector('#gm-skills');
        if (!box) return;
        var owned = getOwnedSkills();
        box.innerHTML = SKILLS.map(function (k) {
            var has = owned.indexOf(k.id) >= 0;
            return '<button data-skill="' + k.id + '" style="' + (has ? 'border-color:#ffd34d;color:#ffd34d;' : '') + '">' +
                (has ? '✓ ' : '○ ') + k.name + ' · ' + k.desc + '</button>';
        }).join('');
        box.querySelectorAll('[data-skill]').forEach(function (b) {
            b.addEventListener('click', function () {
                toggleSkill(b.getAttribute('data-skill'));
            });
        });
    }
    function refreshStatus() {
        var s = readSave();
        var z = currentZone();
        var t = '当前：第 ' + (z + 1) + ' 章「' + ZONES[z] + '」\n' +
            (s ? '已有存档（可继续冒险）' : '暂无存档：先点开始玩一下，或直接用跳关建一个') +
            '\n改存档后会自动刷新并点「继续冒险」。';
        setStatus(t);
        // 无敌按钮显示当前开关状态
        var godBtn = document.querySelector('#gm-god');
        if (godBtn) godBtn.textContent = isGodOn() ? '🛡 无敌：开（点一下关掉）' : '🛡 无敌：关（点一下打开）';
        // 技能菜单如果正开着，刷新已拥有状态
        var box = document.querySelector('#gm-skills');
        if (box && box.style.display !== 'none') renderSkills();
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
