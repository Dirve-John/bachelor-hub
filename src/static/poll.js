// Renders every <section class="poll" data-poll-id="..."> on the page.
// Poll definitions are embedded at build time; results come from /api/polls/:id.
(function () {
  "use strict";

  var NAME_KEY = "bach:name";

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (attrs[k] == null || attrs[k] === false) continue;
        if (k === "text") el.textContent = attrs[k];
        else if (k === "class") el.className = attrs[k];
        else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), attrs[k]);
        else el.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
      }
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) el.appendChild(x); });
      else el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return el;
  }

  // Must match lib/polls.mjs nameKey(): ignore case and extra spaces.
  function nameKey(s) {
    return String(s || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function joinNames(names) {
    return names.join(", ");
  }

  function storedName() {
    try { return localStorage.getItem(NAME_KEY) || ""; } catch (e) { return ""; }
  }
  function rememberName(n) {
    try { localStorage.setItem(NAME_KEY, n); } catch (e) { /* private mode */ }
  }

  function initPoll(section) {
    var def = JSON.parse(section.querySelector(".poll-def").textContent);
    var api = "/api/polls/" + encodeURIComponent(def.id);
    var byKey = {}; // nameKey -> voter, from latest results
    var loadedKey = null; // which existing vote is loaded into the form
    var touched = false; // user changed checkboxes/comment by hand

    // ---------- Form ----------
    var nameInput = h("input", {
      type: "text", id: def.id + "-name", name: "name", autocomplete: "name",
      autocapitalize: "words", maxlength: "40", required: true, placeholder: "First and last name",
    });
    var boxes = def.options.map(function (o) {
      return h("input", { type: "checkbox", name: "choice", value: o.id, onchange: function () { touched = true; } });
    });
    var comment = h("textarea", {
      id: def.id + "-comment", name: "comment", maxlength: "300", rows: "3",
      placeholder: def.commentPlaceholder, oninput: function () { touched = true; },
    });
    var honeypot = h("input", { type: "text", name: "website", tabindex: "-1", autocomplete: "off" });
    var notice = h("div", { class: "note-box", role: "status" });
    var status = h("p", { class: "status", role: "status", "aria-live": "polite" });
    var submit = h("button", { type: "submit", class: "btn" }, "Submit my vote");

    var form = h("form", { class: "card", novalidate: true, onsubmit: onSubmit },
      h("h2", { text: def.title }),
      def.intro ? h("p", { class: "intro", text: def.intro }) : null,
      h("div", { class: "field" },
        h("label", { for: nameInput.id, text: "Your name" }),
        nameInput,
        h("p", { class: "hint", text: "Use the same name if you come back to change your vote." })
      ),
      notice,
      h("fieldset", null,
        h("legend", { class: "legend", text: "Weekends you can make" }),
        h("div", { class: "choices" },
          def.options.map(function (o, i) {
            return h("label", { class: "choice" },
              boxes[i],
              h("span", { class: "choice-text" },
                h("span", { class: "choice-label", text: o.label }),
                o.note ? h("span", { class: "choice-note", text: o.note }) : null
              )
            );
          })
        )
      ),
      h("div", { class: "field" },
        h("label", { for: comment.id, text: def.commentPrompt }),
        comment
      ),
      h("label", { class: "hp", "aria-hidden": "true" }, "Leave this empty", honeypot),
      submit,
      status
    );

    var closedCard = h("div", { class: "card" },
      h("h2", { text: def.title }),
      h("p", { class: "intro", text: "Voting is closed. Final results are below." })
    );

    // ---------- Results ----------
    var resultsCount = h("span", { class: "count" });
    var leader = h("p", { class: "leader" });
    var optionsBox = h("div");
    var votersCount = h("span", { class: "count" });
    var votersBox = h("div");
    var results = h("section", { class: "card", id: def.id + "-results", "aria-labelledby": def.id + "-results-h" },
      h("div", { class: "results-head" }, h("h2", { id: def.id + "-results-h", text: "Results" }), resultsCount),
      leader,
      optionsBox
    );
    var votersCard = h("section", { class: "card" },
      h("div", { class: "results-head" }, h("h2", { text: "Who's voted" }), votersCount),
      votersBox
    );

    section.appendChild(def.open ? form : closedCard);
    section.appendChild(results);
    section.appendChild(votersCard);
    optionsBox.appendChild(h("p", { class: "empty", text: "Loading results…" }));

    // ---------- Behaviour ----------
    function setStatus(kind, msg) {
      status.className = "status " + kind;
      status.textContent = msg;
    }

    function fillFrom(voter) {
      boxes.forEach(function (b) { b.checked = voter.choices.indexOf(b.value) !== -1; });
      comment.value = voter.comment || "";
      loadedKey = nameKey(voter.name);
      touched = false;
      submit.textContent = "Update my vote";
    }

    function checkName() {
      var key = nameKey(nameInput.value);
      var match = key && byKey[key];
      notice.textContent = "";
      if (match) {
        if (loadedKey !== key && !touched) fillFrom(match);
        notice.appendChild(document.createTextNode(
          "You've already voted as “" + match.name + "”. Submitting again will replace your earlier vote. "
        ));
        if (loadedKey !== key) {
          notice.appendChild(h("button", { type: "button", class: "btn-link", onclick: function () { fillFrom(match); checkName(); } },
            "Load my earlier answers"));
        }
      } else {
        if (loadedKey) {
          // Name changed away from a loaded vote: clear it unless they edited the answers.
          if (!touched) { boxes.forEach(function (b) { b.checked = false; }); comment.value = ""; }
          loadedKey = null;
        }
        submit.textContent = "Submit my vote";
      }
    }
    nameInput.addEventListener("change", checkName);
    nameInput.addEventListener("blur", checkName);

    function render(data) {
      byKey = {};
      data.voters.forEach(function (v) { byKey[nameKey(v.name)] = v; });
      var total = data.totalVoters;
      var labelById = {};
      data.poll.options.forEach(function (o) { labelById[o.id] = o.short; });

      resultsCount.textContent = total === 1 ? "1 vote" : total + " votes";
      votersCount.textContent = String(total);

      leader.textContent = "";
      if (data.topOptionIds.length) {
        var tops = data.poll.options.filter(function (o) { return data.topOptionIds.indexOf(o.id) !== -1; });
        leader.appendChild(document.createTextNode(tops.length > 1 ? "Tied for most votes: " : "Most votes: "));
        leader.appendChild(h("strong", { text: tops.map(function (o) { return o.short; }).join(", ") }));
        leader.appendChild(document.createTextNode(" (" + tops[0].count + " of " + total + ")"));
      }

      optionsBox.textContent = "";
      data.poll.options.forEach(function (o) {
        var isTop = data.topOptionIds.indexOf(o.id) !== -1;
        var pct = total ? Math.round((o.count / total) * 100) : 0;
        optionsBox.appendChild(h("div", { class: "opt" + (isTop ? " is-top" : "") },
          isTop ? h("span", { class: "badge", text: data.topOptionIds.length > 1 ? "Tied for most" : "Most votes" }) : null,
          h("div", { class: "opt-row" },
            h("span", { class: "opt-label", text: o.label }),
            h("span", { class: "opt-count", "aria-label": o.count + " can make it", text: String(o.count) })
          ),
          h("div", { class: "bar", "aria-hidden": "true" }, h("span", { style: "width:" + pct + "%" })),
          h("div", { class: "opt-names", text: o.count ? joinNames(o.names) : "Nobody yet" })
        ));
      });

      votersBox.textContent = "";
      if (!total) {
        votersBox.appendChild(h("p", { class: "empty", text: "No votes yet. Be the first." }));
      } else {
        votersBox.appendChild(h("ul", { class: "voters" },
          data.voters.map(function (v) {
            var picks = v.choices.length
              ? "Can do: " + v.choices.map(function (c) { return labelById[c]; }).join(", ")
              : "Can't make any of these weekends";
            return h("li", null,
              h("div", { class: "voter-name", text: v.name }),
              h("div", { class: "voter-picks", text: picks }),
              v.comment ? h("p", { class: "voter-comment", text: v.comment }) : null
            );
          })
        ));
      }

      if (def.open) checkName();
    }

    function load() {
      return fetch(api, { headers: { accept: "application/json" }, cache: "no-store" })
        .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || "Error"); return d; }); })
        .then(render)
        .catch(function () {
          optionsBox.textContent = "";
          optionsBox.appendChild(h("p", { class: "empty", text: "Couldn't load results. Pull down to refresh." }));
        });
    }

    function onSubmit(e) {
      e.preventDefault();
      var name = nameInput.value.replace(/\s+/g, " ").trim();
      if (!name) {
        setStatus("err", "Please enter your name.");
        nameInput.focus();
        return;
      }
      var choices = boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.value; });
      if (!choices.length && !window.confirm("You didn't check any weekends. Submit as “can't make any”?")) return;

      submit.disabled = true;
      setStatus("info", "Saving…");
      fetch(api, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ name: name, choices: choices, comment: comment.value, website: honeypot.value }),
      })
        .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || "Something went wrong."); return d; }); })
        .then(function (d) {
          rememberName(d.name || name);
          nameInput.value = d.name || name;
          loadedKey = nameKey(nameInput.value);
          touched = false;
          render(d);
          setStatus("ok", (d.updated ? "Updated. Thanks, " : "Got it. Thanks, ") + (d.name || name).split(" ")[0] + "!");
          submit.textContent = "Update my vote";
          setTimeout(function () { results.scrollIntoView({ behavior: "smooth", block: "start" }); }, 350);
        })
        .catch(function (err) { setStatus("err", err.message || "Something went wrong. Try again."); })
        .then(function () { submit.disabled = false; });
    }

    var saved = storedName();
    if (saved && def.open) nameInput.value = saved;
    load();
    document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
  }

  Array.prototype.forEach.call(document.querySelectorAll("section.poll[data-poll-id]"), initPoll);
})();
