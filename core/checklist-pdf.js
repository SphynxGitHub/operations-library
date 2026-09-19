//======================= CORE / CHECKLIST PDF =======================//
// Builds the client's copy of the testing checklist as a PDF, in the browser. The PDF library is passed in
// (the app loads jsPDF when it is needed), so this file has no imports and can be tested on its own.
//
// checklist: { clientName, round, sections: [{ title, requestType, resourceName, steps: [{ title, how, expected }] }] }
// info:      { reviewStart, reviewEnd, link, preparedBy }

const SMART = { '\u2018': "'", '\u2019': "'", '\u201C': '"', '\u201D': '"', '\u2013': '-', '\u2014': '-', '\u2026': '...', '\u00A0': ' ', '\u2022': '-' };

// The built-in PDF fonts cover Latin-1 only. Anything else becomes "?", so a step never breaks the file.
export function pdfSafe(text) {
    return String(text ?? '').replace(/[\u2018\u2019\u201C\u201D\u2013\u2014\u2026\u00A0\u2022]/g, (c) => SMART[c])
        .replace(/[\r\t]/g, ' ').replace(/[^\n\x20-\x7E\xA1-\xFF]/g, '?');
}

export function bytesToBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}

export function buildChecklistPdf(JsPdf, checklist, info = {}) {
    const doc = new JsPdf({ unit: 'pt', format: 'letter' });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const M = 48, LINE = 14, textW = W - M * 2;
    let y = M;

    const room = (need) => { if (y + need > H - M) { doc.addPage(); y = M; } };
    const write = (text, { size = 10, bold = false, indent = 0, gap = 0, color = [30, 41, 59] } = {}) => {
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.setFontSize(size);
        doc.setTextColor(...color);
        const lines = doc.splitTextToSize(pdfSafe(text), textW - indent);
        lines.forEach((line) => { room(LINE); doc.text(line, M + indent, y + 10); y += LINE; });
        y += gap;
    };

    write('Testing checklist', { size: 20, bold: true, gap: 4 });
    write(`${checklist.clientName || ''}  |  Round ${checklist.round}`, { size: 12, gap: 2 });
    if (info.reviewStart && info.reviewEnd) write(`Review period: ${info.reviewStart} to ${info.reviewEnd}`, { size: 11, gap: 2 });
    if (info.link) write(`Online copy: ${info.link}`, { size: 9, color: [71, 85, 105], gap: 6 });
    write('Please go through each item as you would use it day to day, tick it off, and tell us about anything that does not work or does not look right.', { size: 10, color: [71, 85, 105], gap: 12 });

    (checklist.sections || []).forEach((section, i) => {
        room(LINE * 3);
        write(`${i + 1}. ${section.title}`, { size: 13, bold: true });
        const sub = [section.requestType, section.resourceName].filter(Boolean).join('  |  ');
        if (sub) write(sub, { size: 9, color: [100, 116, 139], gap: 4 });
        (section.steps || []).forEach((step) => {
            room(LINE * 3);
            doc.setDrawColor(100, 116, 139);
            doc.rect(M, y + 1, 10, 10);
            write(step.title, { size: 10, bold: true, indent: 20 });
            if (step.how) write(`How: ${step.how}`, { size: 9, indent: 20, color: [71, 85, 105] });
            if (step.expected) write(`Expected: ${step.expected}`, { size: 9, indent: 20, color: [71, 85, 105] });
            y += 5;
        });
        y += 8;
    });

    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
        doc.setPage(p);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(148, 163, 184);
        doc.text(pdfSafe(`${info.preparedBy || 'Sphynx Automation'}  |  Page ${p} of ${pages}`), M, H - 24);
    }
    return bytesToBase64(new Uint8Array(doc.output('arraybuffer')));
}
