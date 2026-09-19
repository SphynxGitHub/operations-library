// The client's testing checklist page. It opens from a private link in the review email
// (checklist.html?t=<token>), asks the client-checklist function for that checklist, and shows it.
// Everything from the server is put on the page as plain text, never as HTML.
(function () {
    'use strict';
    var ENDPOINT = 'https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/client-checklist';
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

    var storeKey = 'checklist-ticks:' + token.slice(0, 12);
    var ticks = {};
    try { ticks = JSON.parse(window.localStorage.getItem(storeKey) || '{}') || {}; } catch (e) { ticks = {}; }
    function saveTicks() { try { window.localStorage.setItem(storeKey, JSON.stringify(ticks)); } catch (e) { /* private mode: ticks just are not remembered */ } }

    function render(data) {
        var nodes = [];
        nodes.push(el('h1', '', 'Testing checklist'));
        nodes.push(el('div', 'muted', (data.clientName || '') + (data.round ? '  |  Round ' + data.round : '')));

        var intro = el('div', 'card notice');
        if (data.reviewStart && data.reviewEnd) intro.appendChild(el('p', '', 'Your review period runs from ' + niceDate(data.reviewStart) + ' to ' + niceDate(data.reviewEnd) + '.'));
        intro.appendChild(el('p', 'muted', 'Please go through each item the way you would use it day to day and tick it off. Tell us about anything that does not work or does not look right.'));
        if (data.contactEmail) {
            var link = el('a', 'button', 'Report a problem');
            link.setAttribute('href', 'mailto:' + encodeURIComponent(data.contactEmail).replace(/%40/g, '@') + '?subject=' + encodeURIComponent('Review: ' + (data.clientName || '') + ' Round ' + (data.round || '')));
            intro.appendChild(link);
        }
        nodes.push(intro);

        var total = 0, checked = 0;
        var progress = el('div', 'muted', '');
        progress.id = 'progress';
        function updateProgress() { progress.textContent = checked + ' of ' + total + ' ticked'; }

        (data.sections || []).forEach(function (section, si) {
            var card = el('div', 'card');
            card.appendChild(el('h2', '', (si + 1) + '. ' + (section.title || '')));
            var sub = [section.requestType, section.resourceName].filter(Boolean).join('  |  ');
            if (sub) card.appendChild(el('div', 'muted', sub));
            var list = el('ul');
            (section.steps || []).forEach(function (step, ti) {
                var id = si + '-' + ti;
                total++;
                var item = el('li');
                var box = el('input');
                box.type = 'checkbox';
                box.id = 'step-' + id;
                if (ticks[id]) { box.checked = true; checked++; item.className = 'done'; }
                box.addEventListener('change', function () {
                    ticks[id] = box.checked; checked += box.checked ? 1 : -1;
                    item.className = box.checked ? 'done' : '';
                    saveTicks(); updateProgress();
                });
                var body = el('label');
                body.setAttribute('for', box.id);
                body.appendChild(el('div', 'step-title', step.title || ''));
                if (step.how) body.appendChild(el('div', 'step-detail muted', 'How: ' + step.how));
                if (step.expected) body.appendChild(el('div', 'step-detail muted', 'Expected: ' + step.expected));
                item.appendChild(box); item.appendChild(body);
                list.appendChild(item);
            });
            card.appendChild(list);
            nodes.push(card);
        });
        updateProgress();
        nodes.splice(2, 0, progress);
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
