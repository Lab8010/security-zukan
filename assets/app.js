(function () {
  "use strict";

  var BASIS_LABEL = { official: "公式発表", reported: "報道ベース" };

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "class") node.className = attrs[k];
      else if (k === "text") node.textContent = attrs[k];
      else if (k === "style") node.setAttribute("style", attrs[k]);
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function detailUrl(inc) { return "incidents/" + inc.id + "/"; }

  function formatDate(iso) {
    var p = iso.split("-");
    return p[0] + "年" + Number(p[1]) + "月" + Number(p[2]) + "日";
  }

  // 1,339,700 -> "約134万"; 12,231,954 -> "約1,223万"
  function formatRecords(n) {
    if (!n) return "0";
    if (n >= 10000) {
      var man = n / 10000;
      var s = man >= 100 ? Math.round(man).toLocaleString("ja-JP") : (Math.round(man * 10) / 10).toLocaleString("ja-JP");
      return "約" + s + "万";
    }
    return n.toLocaleString("ja-JP");
  }

  /* ---------- Tooltip ---------- */
  var tip = document.getElementById("tooltip");
  function showTip(evt, title, lines) {
    tip.textContent = "";
    tip.appendChild(el("strong", { text: title }));
    lines.forEach(function (l) { tip.appendChild(el("div", { class: "tt-note", text: l })); });
    tip.classList.add("show");
    moveTip(evt);
  }
  function moveTip(evt) {
    var x, y;
    if (evt && evt.clientX != null && evt.type !== "focus") { x = evt.clientX; y = evt.clientY; }
    else {
      var r = evt.currentTarget.getBoundingClientRect();
      x = r.left + r.width / 2; y = r.top;
    }
    var w = tip.offsetWidth, h = tip.offsetHeight;
    var left = Math.min(Math.max(8, x + 14), window.innerWidth - w - 8);
    var top = y - h - 12;
    if (top < 8) top = y + 18;
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  }
  function hideTip() { tip.classList.remove("show"); }
  function bindTip(node, title, lines) {
    node.addEventListener("mouseenter", function (e) { showTip(e, title, lines); });
    node.addEventListener("mousemove", moveTip);
    node.addEventListener("mouseleave", hideTip);
    node.addEventListener("focus", function (e) { showTip(e, title, lines); });
    node.addEventListener("blur", hideTip);
  }

  /* ---------- Bar chart (horizontal, HTML) ---------- */
  // Reserve room at the bar end for the value label so it never clips.
  var LABEL_RESERVE = "5.5em";
  function barRow(inc, value, max, cls, valueText, tipTitle, tipLines) {
    var frac = max > 0 ? value / max : 0;
    var width = "calc((100% - " + LABEL_RESERVE + ") * " + frac.toFixed(4) + ")";
    var track = el("span", { class: "bar-track" }, [
      el("span", { class: "bar " + cls, style: "width:" + width }),
      el("span", { class: "bar-value", style: "left:calc(" + width + " + 6px)", text: valueText })
    ]);
    var row = el("a", {
      class: "bar-row", href: detailUrl(inc),
      "aria-label": inc.org + " " + valueText + "（" + tipLines.join("、") + "）"
    }, [el("span", { class: "bar-label", text: inc.org }), track]);
    bindTip(row, tipTitle, tipLines);
    return el("li", {}, [row]);
  }

  function renderAmount(list) {
    var withAmount = list.filter(function (i) { return i.amount != null; })
      .sort(function (a, b) { return b.amount - a.amount; });
    var max = Math.max.apply(null, withAmount.map(function (i) { return i.amount; }));
    var ul = document.getElementById("chart-amount");
    withAmount.forEach(function (inc) {
      ul.appendChild(barRow(inc, inc.amount, max, inc.amount_basis,
        inc.amount.toLocaleString("ja-JP") + "億円",
        inc.org + "　" + inc.amount + "億円",
        [inc.amount_note, BASIS_LABEL[inc.amount_basis]]));
    });
    var none = list.filter(function (i) { return i.amount == null; }).map(function (i) { return i.org.replace(/（.*）/, ""); });
    document.getElementById("amount-foot").textContent =
      "金額の開示なし：" + none.join("、") + "。アスクルは特別損失のみで、売上減などの影響を含まないため実際より小さく見えます。アサヒは原材料高など攻撃以外の要因を除いた、攻撃による影響分の報道値です。";
  }

  function renderRecords(list) {
    // records が null（未公表・調査中）と 0（漏えいなし）を区別し、
    // 数値のある事例だけを大きい順に、null は末尾にまとめる。
    var known = list.filter(function (i) { return i.records != null; })
      .sort(function (a, b) { return b.records - a.records; });
    var unknown = list.filter(function (i) { return i.records == null; });
    var max = known.length ? known[0].records : 1;
    var ul = document.getElementById("chart-records");
    known.forEach(function (inc) {
      var text = inc.records ? formatRecords(inc.records) : "なし";
      var li = barRow(inc, inc.records, max, "records", text, inc.org, [inc.records_note]);
      if (!inc.records) li.querySelector(".bar-value").classList.add("none");
      ul.appendChild(li);
    });
    unknown.forEach(function (inc) {
      var li = barRow(inc, 0, max, "records", "調査中", inc.org, [inc.records_note]);
      li.querySelector(".bar-value").classList.add("none");
      ul.appendChild(li);
    });
  }

  /* ---------- Cause ranking ---------- */
  // 1つの事例が複数の原因タグを持ちうるため、バーはリンクではなく
  // <details> で開閉し、該当する事例へのリンクを中に並べる。
  function renderCauses(list, causeLabels) {
    var counts = {}; // id -> { label, count, incidents: [] }
    list.forEach(function (inc) {
      (inc.causes || []).forEach(function (id) {
        if (!counts[id]) counts[id] = { id: id, label: causeLabels[id] || id, count: 0, incidents: [] };
        counts[id].count += 1;
        counts[id].incidents.push(inc);
      });
    });
    var rows = Object.keys(counts).map(function (k) { return counts[k]; })
      .sort(function (a, b) { return b.count - a.count; });
    var max = rows.length ? rows[0].count : 1;
    var ul = document.getElementById("chart-causes");
    rows.forEach(function (row) {
      var frac = row.count / max;
      var width = "calc((100% - " + LABEL_RESERVE + ") * " + frac.toFixed(4) + ")";
      var track = el("span", { class: "bar-track" }, [
        el("span", { class: "bar causes", style: "width:" + width }),
        el("span", { class: "bar-value", style: "left:calc(" + width + " + 6px)", text: row.count + "件" })
      ]);
      var summary = el("summary", { class: "bar-row" }, [
        el("span", { class: "bar-label", text: row.label }),
        track
      ]);
      var orgList = el("ul", { class: "cause-orgs" }, row.incidents.map(function (inc) {
        return el("li", {}, [el("a", { href: detailUrl(inc) }, [
          inc.org, el("span", { class: "cause-orgs-date", text: "（" + inc.date.slice(0, 7).replace("-", "年") + "月）" })
        ])]);
      }));
      var details = el("details", { class: "cause-item" }, [summary, orgList]);
      bindTip(summary, row.label, [row.count + "件が該当。クリックすると事例を一覧できます。"]);
      ul.appendChild(el("li", {}, [details]));
    });
  }

  function renderTable(list) {
    var tbody = document.querySelector("#data-table tbody");
    list.forEach(function (inc) {
      var amount = inc.amount != null ? inc.amount + "（" + BASIS_LABEL[inc.amount_basis] + "）" : "開示なし";
      tbody.appendChild(el("tr", {}, [
        el("td", { text: inc.date }),
        el("td", {}, [el("a", { href: detailUrl(inc), text: inc.org })]),
        el("td", { text: inc.type }),
        el("td", { class: "num", text: amount }),
        el("td", { text: inc.records_note }),
        el("td", { text: inc.downtime })
      ]));
    });
  }

  /* ---------- Timeline ---------- */
  // 根本原因・防げた可能性のある対策・特定された脆弱性（公式発表のみ）。参考情報は公式でないことを明示する
  var CAUSE_STATUS = { official: "公式発表", partial: "一部のみ公表", undisclosed: "非公表" };
  function causePanel(inc) {
    var rc = inc.root_cause;
    if (!rc) return null;
    var children = [
      el("div", { class: "cause-head" }, [
        el("h4", { text: "根本原因" }),
        el("span", { class: "cause-status " + rc.status, text: CAUSE_STATUS[rc.status] || rc.status })
      ]),
      el("p", { class: "cause-text", text: rc.text }),
      el("p", { class: "cause-source", text: "出典：" + rc.source })
    ];
    (inc.vulns || []).forEach(function (v) {
      children.push(el("p", { class: "cause-vuln" }, [
        el("span", { class: "cause-vuln-label", text: "特定された脆弱性" }),
        el("a", { href: v.url, text: v.id + "（" + v.jvn + "）" }),
        " " + v.product,
        el("small", { text: v.source })
      ]));
    });
    var pv = inc.prevention;
    var pvBody = pv
      ? [el("ul", {}, pv.items.map(function (t) { return el("li", { text: t }); })),
         pv.note ? el("p", { class: "cause-note", text: pv.note }) : null,
         el("p", { class: "cause-source", text: "出典：" + pv.source })]
      : [el("p", { class: "cause-note", text: rc.status === "undisclosed"
          ? "原因と再発防止策が公表されていないため、記載していません。"
          : "再発防止策が公表されていないため、記載していません。" })];
    children.push(el("details", { class: "cause-prevent" }, [
      el("summary", { text: "防げた可能性のある対策（公式の再発防止策・指摘より）" })
    ].concat(pvBody)));
    if (inc.reference) {
      children.push(el("div", { class: "cause-ref" }, [
        el("span", { class: "cause-ref-label", text: "参考（公式発表ではありません）" }),
        el("p", { text: inc.reference.text }),
        el("p", { class: "cause-source", text: "出典：" + inc.reference.source })
      ]));
    }
    return el("section", { class: "cause-panel", "aria-label": inc.org + "の原因と対策" }, children);
  }

  function renderTimeline(list) {
    var ol = document.getElementById("timeline-list");
    var lastYear = null;
    list.forEach(function (inc) {
      var year = inc.date.slice(0, 4);
      if (year !== lastYear) {
        ol.appendChild(el("li", { class: "year", "aria-hidden": "false" }, [year + "年"]));
        lastYear = year;
      }
      var amountDd = inc.amount != null
        ? el("dd", {}, [inc.amount.toLocaleString("ja-JP") + "億円",
            el("span", { class: "basis " + inc.amount_basis, text: BASIS_LABEL[inc.amount_basis] }),
            el("small", { text: inc.amount_note })])
        : el("dd", {}, ["開示なし"]);
      var card = el("article", { class: "card event-card" }, [
        el("div", { class: "event-top" }, [
          el("time", { class: "event-date", datetime: inc.date, text: formatDate(inc.date) }),
          el("span", { class: "chip", text: inc.type }),
          el("span", { class: "chip", text: inc.industry })
        ]),
        el("h3", { class: "event-org", text: inc.org }),
        el("p", { class: "event-headline", text: inc.headline }),
        el("p", { class: "event-summary", text: inc.summary }),
        el("dl", { class: "stats" }, [
          el("div", { class: "stat" }, [el("dt", { text: "損益への影響額" }), amountDd]),
          el("div", { class: "stat" }, [el("dt", { text: "個人情報" }),
            el("dd", {}, [inc.records ? formatRecords(inc.records) + "件" : "なし", el("small", { text: inc.records_note })])]),
          el("div", { class: "stat" }, [el("dt", { text: "停止・影響期間" }), el("dd", { text: inc.downtime })])
        ]),
        causePanel(inc),
        el("a", { class: "more", href: detailUrl(inc), text: "詳細を読む →" })
      ]);
      ol.appendChild(el("li", { class: "event" }, [card]));
    });
  }

  fetch("data/incidents.json")
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (data) {
      // 新しい順（上が最新）
      var list = data.incidents.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
      document.getElementById("meta").textContent =
        "掲載事例 " + list.length + "件 ／ 最終更新 " + data.updated;
      document.getElementById("causes-total-incidents").textContent = list.length;
      renderAmount(list);
      renderRecords(list);
      renderCauses(list, data.cause_labels || {});
      renderTable(list);
      renderTimeline(list);
    })
    .catch(function (err) {
      document.getElementById("timeline-list").appendChild(
        el("li", { class: "noscript", text: "事例データを読み込めませんでした（" + err.message + "）。" }));
    });
})();
