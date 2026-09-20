// The client's testing checklist page. It opens from a private link in the review email
// (checklist.html?t=<token>), asks the client-checklist function for that checklist, and lets the client
// mark each step Pass or Fail. A Fail asks what went wrong, and that note becomes a task for the Sphynx team.
// Everything from the server is put on the page as plain text, never as HTML.
(function () {
    'use strict';
    var ENDPOINT = 'https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/client-checklist';
    var NOTE_MIN = 3;
    var NOTE_MAX = 2000;
    var app = document.getElementById('app');

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = String(text);
        return node;
    }
    function show(children) { app.replaceChildren.apply(app, children); }
    function message(title, body, kind) {
        var card = el('div', 'card ' + (kind || 'notice'));
        card.appendChild(el('h2', '', title));
        card.appendChild(el('p', 'muted', body));
        show([card]);
    }
    function niceDate(iso) {
        var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
        if (!m) return String(iso || '');
        var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
    }

    var token = new URLSearchParams(window.location.search).get('t') || '';
    if (!token) { message('This link is not complete', 'Please use the link from your email, or ask us to send it again.', 'error'); return; }

    // Save one answer. Resolves with an error message (or '' when it worked).
    function save(stepId, result, note) {
        return fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                 body: JSON.stringify({ t: token, stepId: stepId, result: result, note: note || '' }) })
            .then(function (res) {
                if (res.ok) return '';
                return res.json().catch(function () { return {}; }).then(function (body) {
                    return (body && body.message) || 'We could not save that. Please try again.';
                });
            })
            .catch(function () { return 'We could not save that. Please check your connection and try again.'; });
    }

    function render(data) {
        var answers = {};
        Object.keys(data.answers || {}).forEach(function (k) {
            var a = data.answers[k] || {};
            if (a.result === 'pass' || a.result === 'fail') answers[k] = { result: a.result, note: String(a.note || '') };
        });
        var totals = { steps: 0 };
        var progress = el('div', 'muted', '');
        progress.id = 'progress';
        function updateProgress() {
            var reviewed = 0, fails = 0;
            Object.keys(answers).forEach(function (k) { reviewed++; if (answers[k].result === 'fail') fails++; });
            progress.textContent = reviewed + ' of ' + totals.steps + ' reviewed' + (fails ? ' | ' + fails + ' need' + (fails === 1 ? 's' : '') + ' attention' : '');
        }

        var nodes = [];
        nodes.push(el('h1', '', 'Testing checklist'));
        nodes.push(el('div', 'muted', (data.clientName || '') + (data.round ? '  |  Round ' + data.round : '')));
        nodes.push(progress);

        var intro = el('div', 'card notice');
        if (data.reviewStart && data.reviewEnd) intro.appendChild(el('p', '', 'Your review period runs from ' + niceDate(data.reviewStart) + ' to ' + niceDate(data.reviewEnd) + '.'));
        intro.appendChild(el('p', 'muted', 'Please go through each item the way you would use it day to day. Mark it Pass if it works, or Fail and tell us what went wrong. We are notified about every Fail and will fix it.'));
        if (data.contactEmail) {
            var link = el('a', 'button', 'Email us instead');
            link.setAttribute('href', 'mailto:' + encodeURIComponent(data.contactEmail).replace(/%40/g, '@') + '?subject=' + encodeURIComponent('Review: ' + (data.clientName || '') + ' Round ' + (data.round || '')));
            intro.appendChild(link);
        }
        nodes.push(intro);

        (data.sections || []).forEach(function (section, si) {
            var card = el('div', 'card');
            card.appendChild(el('h2', '', (si + 1) + '. ' + (section.title || '')));
            var sub = [section.requestType, section.resourceName].filter(Boolean).join('  |  ');
            if (sub) card.appendChild(el('div', 'muted', sub));
            var list = el('ul');
            (section.steps || []).forEach(function (step) {
                totals.steps++;
                var item = el('li');
                var body = el('div', 'step-body');
                body.appendChild(el('div', 'step-title', step.title || ''));
                if (step.how) body.appendChild(el('div', 'step-detail muted', 'How: ' + step.how));
                if (step.expected) body.appendChild(el('div', 'step-detail muted', 'Expected: ' + step.expected));
                item.appendChild(body);

                if (step.id) {
                    var id = step.id;
                    var controls = el('div', 'controls');
                    var passBtn = el('button', 'choice pass', 'Pass'); passBtn.type = 'button';
                    var failBtn = el('button', 'choice fail', 'Fail'); failBtn.type = 'button';
                    var noteBox = el('div', 'note-box');
                    var noteLabel = el('label', 'muted', 'What went wrong?');
                    var note = el('textarea'); note.rows = 3; note.maxLength = NOTE_MAX; note.placeholder = 'Tell us what you saw, and what you expected instead';
                    var send = el('button', 'send', 'Send'); send.type = 'button';
                    var status = el('div', 'status muted');
                    noteBox.appendChild(noteLabel); noteBox.appendChild(note); noteBox.appendChild(send);
                    controls.appendChild(passBtn); controls.appendChild(failBtn);
                    body.appendChild(controls); body.appendChild(noteBox); body.appendChild(status);

                    var busy = false, composing = false;
                    function paint() {
                        var a = answers[id];
                        passBtn.setAttribute('aria-pressed', a && a.result === 'pass' ? 'true' : 'false');
                        failBtn.setAttribute('aria-pressed', (a && a.result === 'fail') || composing ? 'true' : 'false');
                        passBtn.classList.toggle('on', !!(a && a.result === 'pass'));
                        failBtn.classList.toggle('on', !!((a && a.result === 'fail') || composing));
                        noteBox.style.display = composing || (a && a.result === 'fail') ? 'block' : 'none';
                        passBtn.disabled = failBtn.disabled = busy;
                        send.disabled = busy || note.value.trim().length < NOTE_MIN;
                        item.className = a ? (a.result === 'pass' ? 'done' : 'failed') : '';
                    }
                    function say(text, isError) { status.textContent = text; status.className = 'status ' + (isError ? 'problem' : 'muted'); }

                    if (answers[id]) { note.value = answers[id].note; if (answers[id].result === 'fail') say('Sent. Thank you, we have been told.'); }
                    paint();

                    passBtn.addEventListener('click', function () {
                        if (busy) return;
                        var before = answers[id]; busy = true; composing = false; say('Saving...'); paint();
                        save(id, 'pass', '').then(function (err) {
                            busy = false;
                            if (err) { say(err, true); composing = false; } else { answers[id] = { result: 'pass', note: '' }; say(''); }
                            if (err && before) answers[id] = before;
                            paint(); updateProgress();
                        });
                    });
                    failBtn.addEventListener('click', function () {
                        if (busy) return;
                        composing = true; say(''); paint(); note.focus();
                    });
                    note.addEventListener('input', function () { paint(); });
                    send.addEventListener('click', function () {
                        var text = note.value.trim();
                        if (busy || text.length < NOTE_MIN) return;
                        busy = true; say('Sending...'); paint();
                        save(id, 'fail', text).then(function (err) {
                            busy = false;
                            if (err) { say(err, true); } else { answers[id] = { result: 'fail', note: text }; composing = false; say('Sent. Thank you, we have been told.'); }
                            paint(); updateProgress();
                        });
                    });
                }
                list.appendChild(item);
            });
            card.appendChild(list);
            nodes.push(card);
        });
        updateProgress();
        show(nodes);
    }

    fetch(ENDPOINT + '?t=' + encodeURIComponent(token))
        .then(function (res) {
            if (res.status === 404) { message('We could not find this checklist', 'The link may be out of date, or the review may have ended. Please ask us to send it again.', 'error'); return null; }
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        })
        .then(function (data) { if (data) render(data); })
        .catch(function () { message('Something went wrong', 'We could not load the checklist just now. Please try again in a few minutes.', 'error'); });
})();
