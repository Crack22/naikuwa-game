/* 复活选择题 - 勇者奶蛙传
 * 原理：游戏复活时调 window.MetaH5Ad 的激励视频广告（isAdSupport / showAd，
 * 见 main-BsKo9vWW.js 的 Ms 类）。本文件在游戏 module 之前引入，先定义一个
 * 假的 window.MetaH5Ad，游戏检查到它已存在就不再加载真广告 SDK
 *（cdn.233xyx.com/h5ad/metah5ad_v1.min.js），复活改走这道选择题。
 * 选 A = 按“广告已看完、拿到奖励”回传（code 0 + status 4 REWARDED），游戏正常复活；
 * 选 B = 不回传，题目重新显示，直到选 A 为止。
 * 只新增本文件，不改游戏原文件。
 */
(function () {
    'use strict';

    var QUESTION = '許諾是不是天才程序员';
    var OPT_A = 'A. 简直就是天才';
    var OPT_B = 'B. 啥也不是';

    /* 游戏广告模块期望的返回值（main-BsKo9vWW.js 的 Ms 类）：
     * - isAdSupport(type, cb)：cb({code: 0, data: 1}) 表示支持
     * - showAd(type, cb)：cb({code: 0, status: 4}) 表示 REWARDED，复活成功
     *   状态码：FAILED -1 / SHOWN 0 / CLOSED 1 / SKIPPED 2 / CLICKED 3 / REWARDED 4
     */
    var modal = null;         // 题目 modal 根节点
    var hintEl = null;        // 提示文字节点
    var cardEl = null;        // 卡片节点（用来抖动）
    var pendingReward = null; // 等待玩家选择的 showAd 回调
    var quizTimer = null;     // 防呆定时器：115 秒无人作答则收起，避免游戏 120 秒超时后 modal 还盖着

    function ensureStyles() {
        if (document.getElementById('quiz-style')) return;
        var st = document.createElement('style');
        st.id = 'quiz-style';
        st.textContent = [
            '.quiz-overlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(10,6,18,.78);backdrop-filter:blur(3px);}',
            '.quiz-overlay.hidden{display:none;}',
            '.quiz-card{width:min(520px,92vw);background:#211a30;border:1px solid rgba(216,180,254,.35);border-radius:18px;padding:28px 24px 24px;text-align:center;box-shadow:0 18px 60px rgba(0,0,0,.6);}',
            /* 竖屏手机：选择题跟游戏一起横过来（游戏画面是横的，题目也要横着正对玩家） */
            '.quiz-overlay.quiz-rotated .quiz-card{width:min(520px,86%);}',
            '.quiz-eyebrow{font-size:13px;letter-spacing:.35em;color:#d8b4fe;margin-bottom:10px;}',
            '.quiz-q{font-size:26px;line-height:1.4;font-weight:800;color:#fff;margin:0 0 6px;}',
            '.quiz-sub{font-size:14px;color:#c9b8e8;margin:0 0 20px;}',
            '.quiz-opt{display:block;width:100%;margin:10px 0;padding:15px 16px;font-size:18px;font-weight:700;border-radius:12px;border:1px solid transparent;cursor:pointer;}',
            '.quiz-opt-a{background:linear-gradient(135deg,#a855f7,#ec4899);color:#fff;}',
            '.quiz-opt-a:active{transform:scale(.98);}',
            '.quiz-opt-b{background:rgba(255,255,255,.07);color:#e9e4f5;border-color:rgba(255,255,255,.18);}',
            '.quiz-opt-b:active{transform:scale(.98);}',
            '.quiz-hint{min-height:20px;margin:12px 0 0;font-size:14px;color:#f0abfc;}',
            '@keyframes quiz-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-9px)}40%{transform:translateX(9px)}60%{transform:translateX(-6px)}80%{transform:translateX(6px)}}',
            '.quiz-shake{animation:quiz-shake .45s ease;}'
        ].join('\n');
        document.head.appendChild(st);
    }

    /* 选择题跟游戏一起横过来：竖屏触屏手机上，游戏画面旋转 90° 变成横屏，
     * 选择题也要同样旋转 90°、按同样的尺寸居中，否则题目竖着、跟游戏画面对不上。
     * 横屏 / 电脑上不旋转，保持全屏遮罩。 */
    function syncQuizLayout() {
        if (!modal) return;
        var w = (window.visualViewport && window.visualViewport.width) || window.innerWidth;
        var h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
        var portraitTouch = false;
        try { portraitTouch = window.matchMedia('(pointer: coarse)').matches && h > w; } catch (e) {}
        if (portraitTouch) {
            var gw = Math.min(h, w * 16 / 9);
            var gh = gw * 9 / 16;
            modal.classList.add('quiz-rotated');
            modal.style.width = gw + 'px';
            modal.style.height = gh + 'px';
            modal.style.left = '50%';
            modal.style.top = '50%';
            modal.style.right = 'auto';
            modal.style.bottom = 'auto';
            modal.style.transform = 'translate(-50%, -50%) rotate(90deg)';
        } else {
            modal.classList.remove('quiz-rotated');
            modal.style.width = '';
            modal.style.height = '';
            modal.style.left = '';
            modal.style.top = '';
            modal.style.right = '';
            modal.style.bottom = '';
            modal.style.transform = '';
        }
    }

    function ensureModal() {
        if (modal) return;
        ensureStyles();
        modal = document.createElement('div');
        modal.className = 'quiz-overlay hidden';
        modal.id = 'quiz-overlay';
        modal.innerHTML =
            '<div class="quiz-card" id="quiz-card">' +
            '<div class="quiz-eyebrow">复 活 考 验</div>' +
            '<h2 class="quiz-q">' + QUESTION + '</h2>' +
            '<p class="quiz-sub">答对了才能复活，答错了就再想想</p>' +
            '<button type="button" class="quiz-opt quiz-opt-a" id="quiz-a">' + OPT_A + '</button>' +
            '<button type="button" class="quiz-opt quiz-opt-b" id="quiz-b">' + OPT_B + '</button>' +
            '<p class="quiz-hint" id="quiz-hint"></p>' +
            '</div>';
        (document.body || document.documentElement).appendChild(modal);
        cardEl = document.getElementById('quiz-card');
        hintEl = document.getElementById('quiz-hint');
        // 点背景不关闭，只抖一下（表示关不掉）
        modal.addEventListener('click', function (e) {
            if (e.target === modal) shake('点背景也没用，选 A 才能复活');
        });
        document.getElementById('quiz-a').addEventListener('click', onPickA);
        document.getElementById('quiz-b').addEventListener('click', onPickB);
        syncQuizLayout();
        window.addEventListener('resize', syncQuizLayout);
        window.addEventListener('orientationchange', syncQuizLayout);
        if (window.visualViewport) window.visualViewport.addEventListener('resize', syncQuizLayout);
    }

    function shake(msg) {
        if (!cardEl) return;
        if (msg && hintEl) hintEl.textContent = msg;
        cardEl.classList.remove('quiz-shake');
        void cardEl.offsetWidth; // restart animation
        cardEl.classList.add('quiz-shake');
    }

    function showQuiz(cb) {
        ensureModal();
        pendingReward = cb;
        if (hintEl) hintEl.textContent = '';
        modal.classList.remove('hidden');
        syncQuizLayout();
        if (quizTimer) clearTimeout(quizTimer);
        // 防呆：115 秒没人选就收起，游戏会在 120 秒超时后恢复按钮，玩家可再点重试
        quizTimer = setTimeout(function () {
            if (pendingReward) {
                pendingReward = null;
                hideQuiz();
            }
        }, 115000);
    }

    function hideQuiz() {
        if (quizTimer) { clearTimeout(quizTimer); quizTimer = null; }
        if (modal) modal.classList.add('hidden');
    }

    function onPickA() {
        var cb = pendingReward;
        pendingReward = null;
        hideQuiz();
        if (cb) {
            // 按游戏期望的“拿到奖励”回传：code 0 + status 4 (REWARDED)
            try { cb({ code: 0, status: 4 }); } catch (e) {}
        }
    }

    function onPickB() {
        // 不回传：游戏继续等广告结果，题目重新显示，直到选 A
        shake('选错了，再想想！');
    }

    /* ---- 假的广告 SDK：抢在游戏之前定义，游戏就不再加载真 SDK ---- */
    window.MetaH5Ad = {
        isAdSupport: function (type, cb) {
            // 异步回传“支持”，和真 SDK 的回调节奏一致
            setTimeout(function () {
                try { cb({ code: 0, data: 1 }); } catch (e) {}
            }, 0);
        },
        showAd: function (type, cb) {
            // 不播广告，弹出选择题；只有选 A 才回传 REWARDED
            showQuiz(cb);
        }
    };
})();
