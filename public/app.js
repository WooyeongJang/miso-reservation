/**
 * 체험 부스 예약 — 단일 페이지 스크립트
 *  화면: #screenReserve(예약) / #screenDone(완료) / #screenAdmin(관리자, 주소 해시 #admin)
 *  API 는 상대 경로(api/...)로 호출해 base path(/r/<포트>/) 아래에서도 그대로 동작한다.
 */
(function () {
    "use strict";
    var $ = function (sel, root) { return (root || document).querySelector(sel); };
    var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

    // ------------------------------------------------------------ 공통
    function api(path, opts) {
        opts = opts || {};
        var headers = { "Content-Type": "application/json" };
        if (opts.admin) headers["X-Admin-Key"] = adminKey;
        return fetch("api/" + path, {
            method: opts.method || "GET",
            headers: headers,
            body: opts.body ? JSON.stringify(opts.body) : undefined,
            cache: "no-store"
        }).then(function (res) {
            return res.json().catch(function () { return {}; }).then(function (json) {
                if (!res.ok) { var e = new Error(json.error || "요청에 실패했어요."); e.status = res.status; e.data = json; throw e; }
                return json;
            });
        });
    }

    function minutesText(min) {
        min = Number(min) || 0;
        var h = Math.floor(min / 60), m = min % 60;
        if (h && m) return h + "시간 " + m + "분";
        if (h) return h + "시간";
        return m + "분";
    }
    function bindText(key, text) { $$('[data-bind="' + key + '"]').forEach(function (el) { el.textContent = text; }); }
    function formatPhone(digits) {
        digits = digits.replace(/\D/g, "").slice(0, 11);
        if (digits.length > 3 && digits.length <= 7) return digits.slice(0, 3) + "-" + digits.slice(3);
        if (digits.length > 7) return digits.slice(0, 3) + "-" + digits.slice(3, 7) + "-" + digits.slice(7);
        return digits;
    }
    function dateKo(ymd) { var p = ymd.split("-"); return p[0] + "년 " + Number(p[1]) + "월 " + Number(p[2]) + "일"; }

    // 모달 (alert/confirm 대체)
    var overlay = $("#confirmOverlay"), msgEl = $("#confirmMessage"), okBtn = $("#confirmOkBtn"), cancelBtn = $("#confirmCancelBtn");
    function modal(message, options) {
        options = options || {};
        return new Promise(function (resolve) {
            msgEl.textContent = message;
            okBtn.textContent = options.okText || "확인";
            cancelBtn.hidden = !options.confirm;
            cancelBtn.textContent = options.cancelText || "취소";
            overlay.classList.add("is-open"); overlay.setAttribute("aria-hidden", "false");
            function done(v) { overlay.classList.remove("is-open"); overlay.setAttribute("aria-hidden", "true"); okBtn.onclick = null; cancelBtn.onclick = null; resolve(v); }
            okBtn.onclick = function () { done(true); };
            cancelBtn.onclick = function () { done(false); };
            okBtn.focus();
        });
    }
    var alertBox = function (m) { return modal(m); };
    var confirmBox = function (m, ok) { return modal(m, { confirm: true, okText: ok || "확인" }); };

    // 화면 전환
    var screens = { reserve: $("#screenReserve"), done: $("#screenDone"), admin: $("#screenAdmin") };
    function show(name) {
        Object.keys(screens).forEach(function (k) { screens[k].hidden = k !== name; });
        var sec = $(".k_section", screens[name]); if (sec) sec.scrollTop = 0;
        if (name === "admin") adminOpened(); else stopAdminTimer();
        if (name === "reserve") loadSlots();
    }
    function route() { show(location.hash === "#admin" ? "admin" : (currentDone ? "done" : "reserve")); }
    window.addEventListener("hashchange", route);

    // ------------------------------------------------------------ 화면 1 : 예약
    var nameInput = $("#nameInput"), phoneInput = $("#phoneInput"), slotGrid = $("#slotGrid"), slotEmpty = $("#slotEmpty");
    var consentRow = $("#consentRow"), ctaBtn = $("#ctaBtn"), nowClock = $("#nowClock");
    var selectedTime = null, slotTimer = null, currentDone = null;

    phoneInput.addEventListener("input", function () { this.value = formatPhone(this.value); updateCta(); });
    nameInput.addEventListener("input", updateCta);

    function isFormFilled() {
        return nameInput.value.trim().length >= 1 && phoneInput.value.replace(/\D/g, "").length >= 10 && selectedTime !== null;
    }
    function updateCta() {
        var on = consentRow.classList.contains("is-checked") && isFormFilled();
        ctaBtn.classList.toggle("is-enabled", on); ctaBtn.disabled = !on;
    }
    function setChecked(v) { consentRow.classList.toggle("is-checked", v); consentRow.setAttribute("aria-checked", String(v)); updateCta(); }
    consentRow.addEventListener("click", function () { setChecked(!consentRow.classList.contains("is-checked")); });
    consentRow.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setChecked(!consentRow.classList.contains("is-checked")); } });

    function renderSlots(data) {
        nowClock.textContent = data.now;
        bindText("boothName", data.settings.boothName);
        bindText("windowText", minutesText(data.settings.windowMinutes));
        bindText("retainText", minutesText(data.settings.retainMinutes));
        slotGrid.innerHTML = "";
        var hasAny = data.slots.length > 0;
        if (!hasAny) {
            var msg = data.status === "closed" ? "오늘 예약 시간이 끝났어요.\n(예약 가능 시간 " + data.settings.openTime + " ~ " + data.settings.closeTime + ")"
                    : data.status === "before-open" ? "아직 예약을 받지 않아요.\n" + data.settings.openTime + " 부터 " + minutesText(data.settings.windowMinutes) + " 전에 열려요."
                    : "지금 예약할 수 있는 시간이 없어요.";
            slotEmpty.textContent = msg; slotEmpty.hidden = false;
        } else slotEmpty.hidden = true;

        var stillValid = false;
        data.slots.forEach(function (s) {
            var b = document.createElement("button");
            b.type = "button"; b.className = "slot-btn"; b.setAttribute("role", "radio"); b.dataset.time = s.time;
            b.innerHTML = s.time + (s.available ? "" : "<span class='sub'>마감</span>");
            b.disabled = !s.available;
            if (s.available && s.time === selectedTime) { b.classList.add("is-selected"); b.setAttribute("aria-checked", "true"); stillValid = true; }
            else b.setAttribute("aria-checked", "false");
            slotGrid.appendChild(b);
        });
        if (!stillValid) selectedTime = null;
        updateCta();
    }
    slotGrid.addEventListener("click", function (e) {
        var b = e.target.closest(".slot-btn"); if (!b || b.disabled) return;
        $$(".slot-btn", slotGrid).forEach(function (x) { x.classList.remove("is-selected"); x.setAttribute("aria-checked", "false"); });
        b.classList.add("is-selected"); b.setAttribute("aria-checked", "true");
        selectedTime = b.dataset.time; updateCta();
    });
    function loadSlots() {
        clearTimeout(slotTimer);
        return api("slots").then(renderSlots).catch(function (e) {
            slotGrid.innerHTML = ""; slotEmpty.textContent = "시간 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요."; slotEmpty.hidden = false;
        }).then(function () { if (!screens.reserve.hidden) slotTimer = setTimeout(loadSlots, 30000); });
    }

    ctaBtn.addEventListener("click", function () {
        if (ctaBtn.disabled) return;
        var payload = { name: nameInput.value.trim(), phone: phoneInput.value, time: selectedTime, consent: true };
        confirmBox(payload.name + " 님, " + selectedTime + " 에 예약할까요?", "예약하기").then(function (ok) {
            if (!ok) return;
            ctaBtn.classList.add("is-loading");
            return api("reserve", { method: "POST", body: payload }).then(function (r) {
                currentDone = r.reservation;
                $("#doneTime").textContent = r.reservation.time;
                $("#doneName").textContent = r.reservation.name;
                $("#donePhone").textContent = r.reservation.phone;
                $("#doneDate").textContent = dateKo(r.reservation.date);
                bindText("retainText", minutesText(r.retainMinutes));
                show("done");
            }).catch(function (e) {
                alertBox(e.message).then(function () { if (e.data && e.data.refresh) loadSlots(); });
            }).then(function () { ctaBtn.classList.remove("is-loading"); });
        });
    });

    $("#doneHomeBtn").addEventListener("click", function () {
        currentDone = null; selectedTime = null;
        nameInput.value = ""; phoneInput.value = ""; setChecked(false);
        show("reserve");
    });

    // ------------------------------------------------------------ 화면 3 : 관리자
    var adminKey = sessionStorage.getItem("adminKey") || "";
    var adminLogin = $("#adminLogin"), adminPanel = $("#adminPanel"), adminKeyInput = $("#adminKeyInput");
    var adminLoginBtn = $("#adminLoginBtn"), adminSaveBtn = $("#adminSaveBtn"), adminTimer = null, activeTab = "list";

    function setAdminLogged(on) {
        adminLogin.hidden = on; adminPanel.hidden = !on;
        adminLoginBtn.hidden = on;
        adminSaveBtn.hidden = !(on && activeTab === "settings");
        updateAdminBar();
        if (on) { loadReservations(); loadSettings(); startAdminTimer(); } else stopAdminTimer();
    }
    // 보일 버튼이 없으면 하단 바 자체를 숨긴다 (예약 목록 탭)
    var adminBar = $(".bottom-bar", screens.admin);
    function updateAdminBar() { adminBar.hidden = adminLoginBtn.hidden && adminSaveBtn.hidden; }
    function adminOpened() {
        if (adminKey) {
            api("admin/login", { admin: true }).then(function () { setAdminLogged(true); })
                .catch(function () { adminKey = ""; sessionStorage.removeItem("adminKey"); setAdminLogged(false); });
        } else { setAdminLogged(false); setTimeout(function () { adminKeyInput.focus(); }, 50); }
    }
    function doLogin() {
        var key = adminKeyInput.value;
        if (!key) return alertBox("비밀번호를 입력해 주세요.");
        adminKey = key;
        api("admin/login", { admin: true }).then(function () {
            sessionStorage.setItem("adminKey", key); adminKeyInput.value = ""; setAdminLogged(true);
        }).catch(function (e) { adminKey = ""; alertBox(e.message); });
    }
    adminLoginBtn.addEventListener("click", doLogin);
    adminKeyInput.addEventListener("keydown", function (e) { if (e.key === "Enter") doLogin(); });
    $("#adminBackBtn").addEventListener("click", function (e) { e.preventDefault(); location.hash = ""; });

    $$(".admin-tab").forEach(function (t) {
        t.addEventListener("click", function () {
            activeTab = t.dataset.tab;
            $$(".admin-tab").forEach(function (x) { x.classList.toggle("is-active", x === t); });
            $("#paneList").hidden = activeTab !== "list";
            $("#paneSettings").hidden = activeTab !== "settings";
            adminSaveBtn.hidden = activeTab !== "settings";
            updateAdminBar();
            if (activeTab === "list") loadReservations(); else loadSettings();
        });
    });

    function startAdminTimer() { stopAdminTimer(); adminTimer = setInterval(function () { if (activeTab === "list") loadReservations(); }, 30000); }
    function stopAdminTimer() { clearInterval(adminTimer); adminTimer = null; }

    var resList = $("#resList"), resEmpty = $("#resEmpty");
    function loadReservations() {
        return api("admin/reservations", { admin: true }).then(function (d) {
            $("#adminNow").textContent = d.now;
            $("#resCount").textContent = d.reservations.length;
            resList.innerHTML = "";
            resEmpty.hidden = d.reservations.length > 0;
            d.reservations.forEach(function (r) {
                var el = document.createElement("div");
                el.className = "res-item" + (r.past ? " is-past" : "");
                el.innerHTML = '<div class="time"></div><div class="info"><div class="name"></div><div class="phone"><a></a></div></div><button type="button" class="del">삭제</button>';
                $(".time", el).textContent = r.time;
                $(".name", el).textContent = r.name + (r.past ? " (지남)" : "");
                var a = $(".phone a", el); a.textContent = r.phone; a.href = "tel:" + r.phone.replace(/\D/g, "");
                $(".del", el).addEventListener("click", function () {
                    confirmBox(r.time + " " + r.name + " 님 예약을 삭제할까요?", "삭제").then(function (ok) {
                        if (!ok) return;
                        api("admin/reservations/" + r.id, { method: "DELETE", admin: true }).then(loadReservations).catch(function (e) { alertBox(e.message); });
                    });
                });
                resList.appendChild(el);
            });
        }).catch(function (e) { if (e.status === 401) { adminKey = ""; sessionStorage.removeItem("adminKey"); setAdminLogged(false); } });
    }
    $("#refreshBtn").addEventListener("click", loadReservations);
    $("#clearAllBtn").addEventListener("click", function (e) {
        e.preventDefault();
        confirmBox("오늘 예약을 모두 삭제할까요?\n되돌릴 수 없어요.", "전체 삭제").then(function (ok) {
            if (!ok) return;
            api("admin/reservations", { method: "DELETE", admin: true }).then(function () { alertBox("모두 삭제했어요."); loadReservations(); }).catch(function (e) { alertBox(e.message); });
        });
    });

    var S = { boothName: $("#setBooth"), openTime: $("#setOpen"), closeTime: $("#setClose"), slotMinutes: $("#setSlot"), windowMinutes: $("#setWindow"), retainMinutes: $("#setRetain") };
    function loadSettings() {
        return api("admin/settings", { admin: true }).then(function (s) { Object.keys(S).forEach(function (k) { S[k].value = s[k]; }); }).catch(function () {});
    }
    adminSaveBtn.addEventListener("click", function () {
        var body = {};
        Object.keys(S).forEach(function (k) { body[k] = S[k].value; });
        api("admin/settings", { method: "PUT", admin: true, body: body }).then(function (s) {
            Object.keys(S).forEach(function (k) { S[k].value = s[k]; });
            alertBox("설정을 저장했어요.\n예약 가능 시간 " + s.openTime + " ~ " + s.closeTime + ", 지금부터 " + minutesText(s.windowMinutes) + " 이내, " + s.slotMinutes + "분 단위");
        }).catch(function (e) { alertBox(e.message); });
    });

    // ------------------------------------------------------------ 시작
    route();
})();
