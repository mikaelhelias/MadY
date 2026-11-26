/**
 * The standalone manual's search — the whole thing, in plain browser JavaScript with no build.
 *
 * Sections are cut at every h1 and h2, so a hit lands on the JOB ("Put a break in the axis"), not
 * on a chapter with forty other things in it. All terms must match (typing a second word narrows
 * rather than widens). A hit in the heading is worth ten; every occurrence in the body counts one.
 * Jumping to a hit highlights every occurrence in the page, which is what makes a long reference
 * table usable at all.
 */
(function () {
  var main = document.querySelector("main"),
    box = document.getElementById("q"),
    hits = document.getElementById("hits"),
    toc = document.getElementById("toc");
  var secs = [],
    cur = null,
    chap = "";
  Array.prototype.forEach.call(main.children, function (el) {
    if (/^H[12]$/.test(el.tagName)) {
      if (el.tagName === "H1") chap = el.textContent.trim();
      // `data-noindex` marks a derived index table — every route in the program, every method.
      // It is in the document to browse, and deliberately not in the search: it contains every
      // word there is, so it would out-rank the section that actually answers the question.
      cur = { id: el.id, title: el.textContent.trim(), chap: chap, els: [el], skip: el.hasAttribute("data-noindex") };
      secs.push(cur);
    } else if (cur) cur.els.push(el);
  });
  secs.forEach(function (s) {
    s.text = s.els
      .map(function (e) {
        return e.innerText || e.textContent;
      })
      .join(" ")
      .replace(/\s+/g, " ");
    s.low = s.text.toLowerCase();
    s.tlow = (s.title + " " + s.chap).toLowerCase();
  });

  function esc(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function escH(s) {
    return s.replace(/[&<>]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c];
    });
  }
  function terms(q) {
    return q
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(function (t) {
        return t.length >= 2;
      });
  }
  function clearMarks() {
    Array.prototype.forEach.call(document.querySelectorAll("mark.cp"), function (m) {
      var p = m.parentNode;
      p.replaceChild(document.createTextNode(m.textContent), m);
      p.normalize();
    });
  }
  function markIn(els, ts) {
    var re = new RegExp("(" + ts.map(esc).join("|") + ")", "gi");
    els.forEach(function (root) {
      var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null),
        nodes = [];
      while (w.nextNode()) nodes.push(w.currentNode);
      nodes.forEach(function (n) {
        var v = n.nodeValue;
        re.lastIndex = 0;
        if (!re.test(v)) return;
        re.lastIndex = 0;
        var frag = document.createDocumentFragment(),
          last = 0,
          m;
        while ((m = re.exec(v))) {
          frag.appendChild(document.createTextNode(v.slice(last, m.index)));
          var mk = document.createElement("mark");
          mk.className = "cp";
          mk.textContent = m[0];
          frag.appendChild(mk);
          last = m.index + m[0].length;
        }
        frag.appendChild(document.createTextNode(v.slice(last)));
        n.parentNode.replaceChild(frag, n);
      });
    });
  }
  function snippet(s, t) {
    var i = s.low.indexOf(t);
    if (i < 0) return escH(s.text.slice(0, 120));
    var a = Math.max(0, i - 60),
      b = Math.min(s.text.length, i + t.length + 90);
    return (
      (a ? "…" : "") +
      escH(s.text.slice(a, i)) +
      "<mark>" +
      escH(s.text.slice(i, i + t.length)) +
      "</mark>" +
      escH(s.text.slice(i + t.length, b)) +
      (b < s.text.length ? "…" : "")
    );
  }
  function goTo(s, ts) {
    clearMarks();
    if (ts.length) markIn(s.els, ts);
    document.getElementById(s.id).scrollIntoView({ block: "start" });
    try {
      history.replaceState(null, "", location.search + "#" + s.id);
    } catch (e) {
      /* file:// can refuse this; the scroll already happened */
    }
  }
  function search(q) {
    var ts = terms(q);
    if (!ts.length) {
      hits.style.display = "none";
      toc.style.display = "";
      hits.innerHTML = "";
      return;
    }
    var res = secs
      .filter(function (s) {
        if (s.skip) return false;
        return ts.every(function (t) {
          return s.low.indexOf(t) >= 0 || s.tlow.indexOf(t) >= 0;
        });
      })
      .map(function (s) {
        return {
          s: s,
          // The body contribution is capped at 3. Uncapped occurrence counting breaks as soon as
          // a section is a derived table: "Where is everything" lists every route to a control, so it
          // contains the word "axis" dozens of times and would win every axis query outright, ranking above
          // "Put a break in the axis" for the query "axis break". A heading match is what the
          // reader meant; a long table is not a better answer for being longer.
          score: ts.reduce(function (n, t) {
            return n + (s.tlow.indexOf(t) >= 0 ? 10 : 0) + Math.min(3, s.low.split(t).length - 1);
          }, 0),
        };
      })
      .sort(function (a, b) {
        return b.score - a.score;
      })
      .slice(0, 40);
    toc.style.display = "none";
    hits.style.display = "";
    hits.innerHTML =
      (res.length
        ? '<div class="n">' + res.length + " section" + (res.length > 1 ? "s" : "") + "</div>"
        : '<div class="n">No match</div>') +
      res
        .map(function (r, i) {
          return (
            '<a href="#' +
            r.s.id +
            '" data-i="' +
            i +
            '"><b>' +
            escH(r.s.title) +
            "</b><small>" +
            escH(r.s.chap) +
            "</small><span>" +
            snippet(r.s, ts[0]) +
            "</span></a>"
          );
        })
        .join("");
    Array.prototype.forEach.call(hits.querySelectorAll("a"), function (a) {
      a.onclick = function (e) {
        e.preventDefault();
        goTo(res[+a.getAttribute("data-i")].s, ts);
      };
    });
  }
  box.addEventListener("input", function () {
    search(box.value);
  });
  box.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      box.value = "";
      search("");
      clearMarks();
    }
    if (e.key === "Enter") {
      var a = hits.querySelector("a");
      if (a) a.click();
    }
  });
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      box.focus();
      box.select();
    }
  });
  var q0 = new URLSearchParams(location.search).get("q");
  if (q0) {
    box.value = q0;
    search(q0);
  }
})();
